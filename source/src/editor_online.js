/* In-game map editor (online edition). Top-down grid editor over CustomMapV1, live
   playability checks, local save slots, JSON import/export, a 3D preview, and handoff to
   Play test / Host. All data passes through normalizeCustomMap before it is used or sent. */

import {
  ITEM_TYPES, BLOCK_COLORS, SIZES, SKIES, MAX_ITEMS, emptyCustomMap, normalizeCustomMap, validateCustomMap, sampleCustomMap, compileCustomMap,
} from './custom_map.js';

const SLOTS_KEY = 'lanfps.maps.v1', ACTIVE_KEY = 'lanfps.customMap.active';
const TEAM_HEX = { red: '#f05d5e', blue: '#4f8ff0', none: '#e2e8f0' };
const TOOLS = [['select', 'Select / move'], ['block', 'Block'], ['stairs', 'Stairs'], ['barrel', 'Barrel'], ['tree', 'Tree'],
  ['spawn:red', 'Red spawn'], ['spawn:blue', 'Blue spawn'], ['spawn:none', 'FFA spawn'], ['zone', 'Control zone'], ['flag:red', 'Red flag'], ['flag:blue', 'Blue flag'], ['erase', 'Erase']];

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
};

/* Persistence helpers (tolerant of unavailable storage). */
export function loadSlots() { try { return JSON.parse(localStorage.getItem(SLOTS_KEY) || '{}') || {}; } catch { return {}; } }
function saveSlots(s) { try { localStorage.setItem(SLOTS_KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function getActiveCustomMap() { try { return normalizeCustomMap(localStorage.getItem(ACTIVE_KEY) || 'null'); } catch { return null; } }
export function setActiveCustomMap(m) { try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(normalizeCustomMap(m))); } catch {} }

export class MapEditor {
  constructor(root, { toast = () => {}, onPlay, onHost, createPreview } = {}) {
    Object.assign(this, { root, toast, onPlay, onHost, createPreview });
    this.map = getActiveCustomMap() || sampleCustomMap();
    this.tool = 'select'; this.sel = -1; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.drag = null;
    this.history = [];
    this.build();
    this.changed(true);   // the open map is the active custom map (shows up in the map picker)
  }

  /* ---------- UI ---------- */
  build() {
    const tools = el('div', { class: 'ed-tools', role: 'toolbar', 'aria-label': 'Editor tools' });
    this.toolBtns = TOOLS.map(([id, label]) => {
      const b = el('button', { type: 'button', class: 'anim-btn', 'data-tool': id, text: label, onclick: () => this.setTool(id) });
      tools.append(b); return b;
    });
    this.canvas = el('canvas', { class: 'ed-canvas', tabindex: '0', 'aria-label': 'Top-down map canvas. Click to place, drag to move, Delete removes, arrows nudge, wheel zooms.' });
    this.props = el('div', { class: 'ed-props' });
    this.report = el('div', { class: 'ed-report', 'aria-live': 'polite' });
    this.nameInput = el('input', { class: 'field', maxlength: '32', 'aria-label': 'Map name' });
    this.nameInput.oninput = () => { this.map.name = this.nameInput.value; this.changed(); };
    this.sizeSel = el('select', { class: 'field', 'aria-label': 'Map size' });
    for (const sz of SIZES) this.sizeSel.append(el('option', { value: sz, text: `${sz} × ${sz} m` }));
    this.sizeSel.onchange = () => { this.snapshot(); this.map.size = +this.sizeSel.value; this.map = normalizeCustomMap(this.map); this.changed(); };
    this.skySel = el('select', { class: 'field', 'aria-label': 'Sky' });
    for (const k of Object.keys(SKIES)) this.skySel.append(el('option', { value: k, text: k[0].toUpperCase() + k.slice(1) }));
    this.skySel.onchange = () => { this.map.sky = this.skySel.value; this.changed(); };
    this.slotSel = el('select', { class: 'field', 'aria-label': 'Saved maps' });
    const btn = (text, fn, primary = false) => el('button', { type: 'button', class: primary ? 'btn btn-primary small' : 'small-btn', text, onclick: fn });
    this.fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: '' });
    this.fileInput.onchange = () => this.importFile();
    const side = el('div', { class: 'ed-side' },
      el('div', { class: 'small-cap', text: 'MAP' }),
      el('label', { class: 'field-label', text: 'Name' }), this.nameInput,
      el('div', { class: 'ed-row' }, el('div', {}, el('label', { class: 'field-label', text: 'Size' }), this.sizeSel), el('div', {}, el('label', { class: 'field-label', text: 'Sky' }), this.skySel)),
      el('div', { class: 'ed-row ed-actions' }, btn('New', () => this.newMap()), btn('Starter', () => this.loadMap(sampleCustomMap())), btn('Undo', () => this.undo()), btn('3D preview', () => this.preview())),
      el('div', { class: 'small-cap', text: 'SAVED MAPS' }),
      el('div', { class: 'ed-row' }, this.slotSel, btn('Load', () => this.loadSlot()), btn('Delete', () => this.deleteSlot())),
      el('div', { class: 'ed-row ed-actions' }, btn('Save', () => this.saveSlot()), btn('Export', () => this.exportFile()), btn('Import', () => this.fileInput.click()), this.fileInput),
      el('div', { class: 'small-cap', text: 'SELECTION' }), this.props,
      el('div', { class: 'small-cap', text: 'PLAYABILITY' }), this.report,
      el('div', { class: 'ed-row ed-actions' }, btn('▶ Play test', () => this.play()), btn('Host this map ↗', () => this.host(), true)));
    this.root.replaceChildren(el('div', { class: 'ed-layout' }, el('div', { class: 'ed-main' }, tools, this.canvas), side));
    this.hookCanvas();
    this.setTool('select');
    this.refreshSlots();
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  setTool(id) { this.tool = id; for (const b of this.toolBtns) b.classList.toggle('on', b.dataset.tool === id); }

  /* ---------- canvas mapping ---------- */
  scale() { const r = this.canvas.getBoundingClientRect(); return (Math.min(r.width, r.height) / (this.map.size + 4)) * this.zoom; }
  toWorld(ev) {
    const r = this.canvas.getBoundingClientRect(), s = this.scale();
    return { x: (ev.clientX - r.left - r.width / 2 - this.pan.x) / s, z: (ev.clientY - r.top - r.height / 2 - this.pan.y) / s };
  }
  snap(v) { return Math.round(v * 2) / 2; }
  hit(p) {
    for (let i = this.map.items.length - 1; i >= 0; i--) {
      const it = this.map.items[i], w = it.w || 1.2, d = it.d || 1.2;
      const r = it.t === 'zone' ? 6 : 0;
      if (r ? Math.hypot(p.x - it.x, p.z - it.z) < 1.2 : Math.abs(p.x - it.x) <= w / 2 && Math.abs(p.z - it.z) <= d / 2) return i;
    }
    return -1;
  }

  hookCanvas() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      c.focus(); c.setPointerCapture(e.pointerId);
      const p = this.toWorld(e);
      if (e.button === 1 || e.button === 2) { this.drag = { pan: true, sx: e.clientX, sy: e.clientY, px: this.pan.x, py: this.pan.y }; return; }
      const idx = this.hit(p);
      if (this.tool === 'erase') { if (idx >= 0) { this.snapshot(); this.map.items.splice(idx, 1); this.sel = -1; this.changed(); } return; }
      if (this.tool === 'select' || idx >= 0 && this.tool === 'select') {
        this.sel = idx;
        if (idx >= 0) { this.snapshot(); const it = this.map.items[idx]; this.drag = { idx, ox: it.x - p.x, oz: it.z - p.z }; }
        this.renderProps(); this.draw(); return;
      }
      this.place(p);
    });
    c.addEventListener('pointermove', e => {
      if (!this.drag) return;
      if (this.drag.pan) { this.pan.x = this.drag.px + e.clientX - this.drag.sx; this.pan.y = this.drag.py + e.clientY - this.drag.sy; this.draw(); return; }
      const p = this.toWorld(e), it = this.map.items[this.drag.idx];
      it.x = this.snap(p.x + this.drag.ox); it.z = this.snap(p.z + this.drag.oz);
      this.map = normalizeCustomMap(this.map); this.draw();
    });
    const end = () => { if (this.drag && !this.drag.pan) this.changed(); this.drag = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.5, Math.min(4, this.zoom * (e.deltaY < 0 ? 1.12 : 0.89))); this.draw(); }, { passive: false });
    c.addEventListener('keydown', e => {
      if (this.sel < 0) return;
      const it = this.map.items[this.sel], step = e.shiftKey ? 2 : 0.5;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) { e.preventDefault(); this.snapshot(); it.x += mv[0]; it.z += mv[1]; this.changed(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.snapshot(); this.map.items.splice(this.sel, 1); this.sel = -1; this.changed(); }
      else if (e.key === 'r' && it.t === 'stairs') { this.snapshot(); it.dir = (it.dir + 1) % 4; this.changed(); }
      else if (e.key === 'r' && it.t === 'spawn') { this.snapshot(); it.yaw = (it.yaw + 45) % 360; this.changed(); }
    });
  }

  place(p) {
    if (this.map.items.length >= MAX_ITEMS) { this.toast(`Item limit reached (${MAX_ITEMS}).`); return; }
    const [t, team] = this.tool.split(':');
    const def = ITEM_TYPES[t];
    if (!def) return;
    this.snapshot();
    if (t === 'zone') this.map.items = this.map.items.filter(i => i.t !== 'zone');
    if (t === 'flag') this.map.items = this.map.items.filter(i => !(i.t === 'flag' && i.team === team));
    const it = { t, x: this.snap(p.x), z: this.snap(p.z) };
    for (const [k, [, , d]] of Object.entries(def.fields)) it[k] = d;
    if (def.color) it.c = this.lastColor || (t === 'stairs' ? 'orange' : 'stone');
    if (def.team) it.team = team || 'none';
    if (t === 'spawn') it.yaw = it.z < 0 ? 180 : 0;
    this.map.items.push(it);
    this.map = normalizeCustomMap(this.map);
    this.sel = this.map.items.length - 1;
    this.changed();
  }

  /* ---------- properties ---------- */
  renderProps() {
    const it = this.map.items[this.sel];
    if (!it) { this.props.replaceChildren(el('p', { class: 'muted-note', text: 'Pick a tool and click the grid to place it. Select tool: click to select, drag to move. Delete removes; R rotates stairs/spawns; arrows nudge (Shift = 2 m).' })); return; }
    const def = ITEM_TYPES[it.t], rows = [el('div', { class: 'ed-sel-title', text: `${def.label}${it.team && it.team !== 'none' ? ` (${it.team})` : ''}` })];
    const num = (k, label, step = 0.5) => {
      const i = el('input', { class: 'field', type: 'number', step, value: it[k], 'aria-label': label });
      i.onchange = () => { this.snapshot(); it[k] = +i.value; this.map = normalizeCustomMap(this.map); this.changed(); };
      return el('label', { class: 'ed-num' }, el('span', { text: label }), i);
    };
    rows.push(el('div', { class: 'ed-grid' }, num('x', 'X'), num('z', 'Z'),
      ...Object.keys(def.fields).map(k => num(k, { w: 'Width', d: 'Depth', h: 'Height', y: 'Base Y', dir: 'Direction', s: 'Scale', yaw: 'Facing °' }[k], k === 'dir' ? 1 : k === 'yaw' ? 45 : 0.5))));
    if (def.color) {
      const sw = el('div', { class: 'swatch-group', role: 'group', 'aria-label': 'Colour' });
      for (const [id, hex] of Object.entries(BLOCK_COLORS)) {
        const b = el('button', { type: 'button', class: 'swatch-btn' + (it.c === id ? ' on' : ''), title: id, 'aria-label': id });
        b.style.backgroundColor = hex;
        b.onclick = () => { this.snapshot(); it.c = this.lastColor = id; this.changed(); };
        sw.append(b);
      }
      rows.push(sw);
    }
    rows.push(el('div', { class: 'ed-row' },
      el('button', { type: 'button', class: 'small-btn', text: 'Duplicate', onclick: () => { this.snapshot(); this.map.items.push({ ...it, x: it.x + 1, z: it.z + 1 }); this.map = normalizeCustomMap(this.map); this.sel = this.map.items.length - 1; this.changed(); } }),
      el('button', { type: 'button', class: 'small-btn', text: 'Delete', onclick: () => { this.snapshot(); this.map.items.splice(this.sel, 1); this.sel = -1; this.changed(); } })));
    this.props.replaceChildren(...rows);
  }

  /* ---------- state ---------- */
  snapshot() { this.history.push(JSON.stringify(this.map)); if (this.history.length > 60) this.history.shift(); }
  undo() { const s = this.history.pop(); if (s) { this.map = normalizeCustomMap(s); this.sel = -1; this.changed(); } }
  changed(persist = true) {
    this.map = normalizeCustomMap(this.map);
    this.nameInput.value = this.map.name; this.sizeSel.value = this.map.size; this.skySel.value = this.map.sky;
    if (this.sel >= this.map.items.length) this.sel = -1;
    this.renderProps(); this.draw();
    if (persist) setActiveCustomMap(this.map);
    clearTimeout(this.vt);
    this.vt = setTimeout(() => this.validate(), 150);
  }
  validate() {
    const v = this.result = validateCustomMap(this.map);
    const li = (cls, text) => el('li', { class: cls, text });
    this.report.replaceChildren(
      el('div', { class: v.ok ? 'pill-equipped' : 'pill-equipped off', text: v.ok ? `Playable · ${this.map.items.length} items` : 'Needs fixes' }),
      el('ul', { class: 'ed-issues' }, ...v.errors.map(e => li('err', e)), ...v.warnings.map(w => li('warn', w))),
      el('p', { class: 'muted-note', text: `Modes: ${v.modes.map(m => m.toUpperCase()).join(', ') || 'none'}` }));
    return v;
  }
  newMap() { this.snapshot(); this.loadMap(emptyCustomMap('New Arena', 56)); }
  loadMap(m) { const n = normalizeCustomMap(m); if (!n) { this.toast('That is not a valid map file.'); return; } this.map = n; this.sel = -1; this.pan = { x: 0, y: 0 }; this.zoom = 1; this.changed(); }

  refreshSlots() {
    const slots = loadSlots();
    this.slotSel.replaceChildren(...(Object.keys(slots).length ? Object.keys(slots).sort().map(n => el('option', { value: n, text: n })) : [el('option', { value: '', text: 'No saved maps' })]));
  }
  saveSlot() { const s = loadSlots(); s[this.map.name] = this.map; if (saveSlots(s)) { this.refreshSlots(); this.slotSel.value = this.map.name; this.toast(`Saved “${this.map.name}”.`); } else this.toast('Could not save (storage unavailable).'); }
  loadSlot() { const s = loadSlots()[this.slotSel.value]; if (s) this.loadMap(s); }
  deleteSlot() { const s = loadSlots(); if (!s[this.slotSel.value]) return; delete s[this.slotSel.value]; saveSlots(s); this.refreshSlots(); this.toast('Deleted.'); }
  exportFile() {
    const blob = new Blob([JSON.stringify(this.map, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${this.map.name.replace(/\s+/g, '_') || 'map'}.spectre-map.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async importFile() {
    const f = this.fileInput.files?.[0]; this.fileInput.value = '';
    if (!f) return;
    if (f.size > 96 * 1024) { this.toast('Map file is too large (96 KB max).'); return; }
    this.snapshot(); this.loadMap(await f.text());
  }

  play() { const v = this.validate(); if (!v.ok) { this.toast('Fix the problems listed under Playability first.'); return; } setActiveCustomMap(this.map); this.onPlay?.(this.map); }
  host() { const v = this.validate(); if (!v.ok) { this.toast('Fix the problems listed under Playability first.'); return; } setActiveCustomMap(this.map); this.onHost?.(this.map); }
  preview() { try { this.createPreview?.(compileCustomMap(this.map)); } catch (e) { this.toast(e.message); } }

  /* ---------- drawing ---------- */
  draw() {
    const c = this.canvas, r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d'), s = this.scale(), half = this.map.size / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    g.save();
    g.translate(r.width / 2 + this.pan.x, r.height / 2 + this.pan.y); g.scale(s, s);
    g.fillStyle = SKIES[this.map.sky].sky + '22'; g.fillRect(-half - 2, -half - 2, this.map.size + 4, this.map.size + 4);
    g.fillStyle = '#2a3042'; g.fillRect(-half, -half, this.map.size, this.map.size);
    g.lineWidth = 1 / s;
    for (let v = -half; v <= half; v += 1) {
      g.strokeStyle = v % 4 === 0 ? 'rgba(148,178,230,0.22)' : 'rgba(148,178,230,0.08)';
      g.beginPath(); g.moveTo(v, -half); g.lineTo(v, half); g.moveTo(-half, v); g.lineTo(half, v); g.stroke();
    }
    g.strokeStyle = '#b8c4d4'; g.lineWidth = 0.6; g.strokeRect(-half, -half, this.map.size, this.map.size);
    const sorted = this.map.items.map((it, i) => [it, i]).sort((a, b) => ((a[0].y || 0) + (a[0].h || 0)) - ((b[0].y || 0) + (b[0].h || 0)));
    for (const [it, i] of sorted) {
      g.save(); g.translate(it.x, it.z);
      if (it.t === 'block' || it.t === 'stairs') {
        g.fillStyle = BLOCK_COLORS[it.c]; g.globalAlpha = 0.9; g.fillRect(-it.w / 2, -it.d / 2, it.w, it.d); g.globalAlpha = 1;
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.08; g.strokeRect(-it.w / 2, -it.d / 2, it.w, it.d);
        if (it.t === 'stairs') {
          g.fillStyle = 'rgba(255,255,255,0.85)'; const a = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][it.dir];
          g.rotate(a); g.beginPath(); g.moveTo(0.9, 0); g.lineTo(-0.5, -0.6); g.lineTo(-0.5, 0.6); g.fill();
        } else if (s * Math.min(it.w, it.d) > 26) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `${Math.min(1, it.w / 3)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${it.h}m`, 0, 0); }
      } else if (it.t === 'barrel') { g.fillStyle = '#d9521f'; g.beginPath(); g.arc(0, 0, 0.45, 0, Math.PI * 2); g.fill(); }
      else if (it.t === 'tree') { g.fillStyle = '#2f8f4a'; g.beginPath(); g.arc(0, 0, 1.6 * it.s, 0, Math.PI * 2); g.fill(); g.fillStyle = '#92400e'; g.beginPath(); g.arc(0, 0, 0.35, 0, Math.PI * 2); g.fill(); }
      else if (it.t === 'spawn') {
        g.rotate(-(it.yaw * Math.PI / 180)); g.fillStyle = TEAM_HEX[it.team]; g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.65, 0.6); g.lineTo(-0.65, 0.6); g.closePath(); g.fill();
      } else if (it.t === 'zone') { g.strokeStyle = '#fbbf24'; g.setLineDash([0.6, 0.4]); g.lineWidth = 0.18; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(0, 0, 0.4, 0, Math.PI * 2); g.fill(); }
      else if (it.t === 'flag') { g.fillStyle = TEAM_HEX[it.team]; g.fillRect(-0.08, -1.2, 0.16, 1.6); g.beginPath(); g.moveTo(0.08, -1.2); g.lineTo(1, -0.9); g.lineTo(0.08, -0.6); g.fill(); g.strokeStyle = TEAM_HEX[it.team]; g.lineWidth = 0.1; g.beginPath(); g.arc(0, 0, 2, 0, Math.PI * 2); g.stroke(); }
      if (i === this.sel) { g.strokeStyle = '#22d3ee'; g.lineWidth = 0.18; const w = it.w || 1.6, d = it.d || 1.6; g.strokeRect(-w / 2 - 0.2, -d / 2 - 0.2, w + 0.4, d + 0.4); }
      g.restore();
    }
    g.restore();
  }
}
