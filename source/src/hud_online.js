/* Online-only HUD layer: the top-centre mode/objective panel. Extends the shared Hud so
   Classic keeps its HUD untouched. DOM is built once per mode; per-frame updates only
   write text/width when the value changed (no DOM rebuild per frame). */

import { Hud } from './hud.js';
import { MODE_CATALOG } from './modes.js';
import { GUN_ORDER, gunGameWeapon, WEAPONS, RULES } from './sim.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const setText = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
const setCls = (e, v) => { if (e && e.className !== v) e.className = v; };
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class OnlineHud extends Hud {
  constructor() {
    super();
    this.objEl = document.getElementById('objective');
    this.objMode = null;
    this.parts = {};
  }

  build(mode) {
    this.objMode = mode;
    const p = this.parts = {};
    const box = this.objEl;
    box.replaceChildren();
    p.mode = el('span', 'obj-mode', MODE_CATALOG[mode]?.short || mode.toUpperCase());
    box.append(p.mode);
    if (MODE_CATALOG[mode]?.team) {
      p.red = el('span', 'obj-team red', '0'); p.red.setAttribute('aria-label', 'Red team score');
      p.mid = el('div', 'obj-mid');
      p.state = el('span', 'obj-state', '');
      p.bar = el('div', 'obj-bar'); p.fill = el('div', 'obj-fill'); p.bar.append(p.fill);
      p.mid.append(p.state, p.bar);
      p.blue = el('span', 'obj-team blue', '0'); p.blue.setAttribute('aria-label', 'Blue team score');
      box.append(p.red, p.mid, p.blue);
      if (mode === 'control' || mode === 'ctf') { p.time = el('span', 'obj-time', ''); box.append(p.time); }
    } else {
      p.main = el('span', 'obj-team', '');
      p.sub = el('span', 'obj-sub', '');
      box.append(p.main, p.sub);
    }
  }

  update(client) {
    super.update(client);
    const s = client.state, me = client.me;
    if (!this.objEl) return;
    if (!s) { this.objEl.hidden = true; return; }
    this.objEl.hidden = false;
    const mode = s.mode || 'ffa';
    if (mode !== this.objMode) this.build(mode);
    const p = this.parts;

    if (mode === 'ctf' && s.obj) {
      const o = s.obj;
      setText(p.red, String(o.cr)); setText(p.blue, String(o.cb)); setText(p.time, mmss(o.tl));
      const flag = (t, f) => f.st === 'home' ? `${t} FLAG HOME` : f.st === 'carried' ? `${t} FLAG TAKEN${f.c === me.id ? ' (YOU)' : ''}` : `${t} FLAG DROPPED ${f.rt}s`;
      const alert = [['RED', o.red], ['BLUE', o.blue]].find(([, f]) => f.st !== 'home');
      setText(p.state, alert ? flag(...alert) : `BOTH FLAGS HOME · FIRST TO ${o.tgt}`);
      setCls(p.state, alert ? `obj-state ${alert[0].toLowerCase()}` : 'obj-state');
      const lead = Math.max(o.cr, o.cb) / o.tgt, w = `${Math.round(Math.min(1, lead) * 100)}%`;
      setCls(p.fill, `obj-fill ${o.cr === o.cb ? '' : o.cr > o.cb ? 'red' : 'blue'}`.trim());
      if (p.fill.style.width !== w) p.fill.style.width = w;
    } else if (mode === 'control' && s.obj) {
      const o = s.obj;
      setText(p.red, String(o.sr)); setText(p.blue, String(o.sb)); setText(p.time, mmss(o.tl));
      let label, cls, fill, fillCls;
      if (o.con) { label = 'CONTESTED'; cls = 'obj-state contested'; fill = o.own ? 1 : o.cp; fillCls = 'obj-fill'; }
      else if (o.ct && o.cp > 0 && o.ct !== o.own) { label = `${o.ct.toUpperCase()} ${o.own ? 'NEUTRALISING' : 'CAPTURING'} ${Math.round(o.cp * 100)}%`; cls = `obj-state ${o.ct}`; fill = o.cp; fillCls = `obj-fill ${o.ct}`; }
      else if (o.own) { label = `${o.own.toUpperCase()} HOLDS · ${o.tgt}`; cls = `obj-state ${o.own}`; fill = 1; fillCls = `obj-fill ${o.own}`; }
      else { label = `ZONE NEUTRAL · ${o.tgt}`; cls = 'obj-state'; fill = 0; fillCls = 'obj-fill'; }
      setText(p.state, label); setCls(p.state, cls); setCls(p.fill, fillCls);
      const w = `${Math.round(fill * 100)}%`; if (p.fill.style.width !== w) p.fill.style.width = w;
    } else if (MODE_CATALOG[mode]?.team) {
      const r = s.teams?.red?.kills || 0, b = s.teams?.blue?.kills || 0, tgt = RULES.winKillsTDM || 25;
      setText(p.red, String(r)); setText(p.blue, String(b));
      setText(p.state, `FIRST TO ${tgt}`);
      const lead = Math.max(r, b) / tgt, w = `${Math.round(Math.min(1, lead) * 100)}%`;
      setCls(p.fill, `obj-fill ${r === b ? '' : r > b ? 'red' : 'blue'}`.trim());
      if (p.fill.style.width !== w) p.fill.style.width = w;
    } else if (mode === 'gungame') {
      const k = Math.min(me.k || 0, GUN_ORDER.length - 1);
      const cur = WEAPONS[gunGameWeapon(k)]?.name || '', next = k < GUN_ORDER.length - 1 ? WEAPONS[gunGameWeapon(k + 1)]?.name : 'WIN';
      setText(p.main, `${k + 1} / ${GUN_ORDER.length}`);
      setText(p.sub, `${cur} → ${next}`);
    } else {
      let lead = 0;
      for (const q of (client.snaps?.at?.(-1)?.players?.values?.() || [])) lead = Math.max(lead, q.k || 0);
      setText(p.main, `${me.k || 0} / ${RULES.winKills}`);
      setText(p.sub, `leader ${Math.max(lead, me.k || 0)}`);
    }
  }
}
