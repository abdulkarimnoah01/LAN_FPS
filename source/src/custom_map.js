/* Custom maps made in the in-game editor.
   CustomMapV1 = { v: 1, name, size, sky, items: [...] } with items of a fixed catalog of
   types. normalizeCustomMap() is the trust boundary (host input, imported files and
   network data all pass through it): unknown types/keys are dropped, numbers clamped and
   rounded, colours limited to a palette, counts and byte size capped. compileCustomMap()
   turns a valid map into world data identical in shape to the built-in maps (boxes, visuals,
   spawns, barrels, anchors), so collision, rendering, modes and bots all work unchanged. */

import { buildWalkGrid, walkDistances, distTo, distNear, layoutHash as planetHash } from './planet_map.js';

export const CUSTOM_MAP_ID = 'custom';
export const CUSTOM_MAP_VERSION = 1;
export const MAX_ITEMS = 600;
export const MAX_BYTES = 96 * 1024;
export const SIZES = [40, 56, 72, 96, 120];
export const SKIES = { day: { sky: '#8cc8f5', fog: '#a7d4f5' }, dusk: { sky: '#f3a26b', fog: '#e6a487' }, night: { sky: '#101a33', fog: '#16223f' } };

export const BLOCK_COLORS = {
  stone: '#9d9484', sand: '#c8a77a', white: '#d8dee8', slate: '#4b5563', red: '#e04848', blue: '#2f74e0',
  teal: '#1aa3c2', green: '#4f8f2a', yellow: '#e6b422', orange: '#d98a2b', pink: '#e85d9e', violet: '#7a52d9',
};

/* Tool catalog: what the editor can place and the limits on each field. */
export const ITEM_TYPES = {
  block: { label: 'Block', fields: { w: [0.4, 60, 4], d: [0.4, 60, 4], h: [0.2, 20, 2], y: [0, 18, 0] }, color: true },
  stairs: { label: 'Stairs', fields: { w: [1, 12, 3], d: [1.2, 12, 4], h: [0.4, 6, 1.6], dir: [0, 3, 0] } , color: true },
  barrel: { label: 'Barrel', fields: {} },
  tree: { label: 'Tree', fields: { s: [0.6, 1.8, 1] } },
  spawn: { label: 'Spawn', fields: { yaw: [0, 359, 0] }, team: true },
  zone: { label: 'Control zone', fields: {} },
  flag: { label: 'Flag base', fields: {}, team: true, teamOnly: true },
};

const fin = (v, d) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = v => Math.round(v * 10) / 10;

export function emptyCustomMap(name = 'My Arena', size = 56) {
  return { v: CUSTOM_MAP_VERSION, name, size, sky: 'day', items: [] };
}

/* Fresh, valid map from anything (never throws). */
export function normalizeCustomMap(raw) {
  let src = raw;
  if (typeof src === 'string') { if (src.length > MAX_BYTES) return null; try { src = JSON.parse(src); } catch { return null; } }
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  try { if (JSON.stringify(src).length > MAX_BYTES) return null; } catch { return null; }
  const size = SIZES.includes(+src.size) ? +src.size : 56, half = size / 2;
  const name = String(src.name || 'Custom Arena').replace(/[^\w\s\-.'!]/g, '').trim().slice(0, 32) || 'Custom Arena';
  const sky = Object.prototype.hasOwnProperty.call(SKIES, src.sky) ? src.sky : 'day';
  const items = [];
  for (const it of Array.isArray(src.items) ? src.items.slice(0, MAX_ITEMS) : []) {
    if (!it || typeof it !== 'object') continue;
    const def = Object.prototype.hasOwnProperty.call(ITEM_TYPES, it.t) ? ITEM_TYPES[it.t] : null;
    if (!def) continue;
    const out = { t: it.t, x: r1(clamp(fin(it.x, 0), -half + 0.5, half - 0.5)), z: r1(clamp(fin(it.z, 0), -half + 0.5, half - 0.5)) };
    for (const [k, [lo, hi, dflt]] of Object.entries(def.fields)) out[k] = k === 'dir' || k === 'yaw' ? Math.round(clamp(fin(it[k], dflt), lo, hi)) : r1(clamp(fin(it[k], dflt), lo, hi));
    if (def.color) out.c = Object.prototype.hasOwnProperty.call(BLOCK_COLORS, it.c) ? it.c : 'stone';
    if (def.team) out.team = it.team === 'red' || it.team === 'blue' ? it.team : (def.teamOnly ? 'red' : 'none');
    items.push(out);
  }
  return { v: CUSTOM_MAP_VERSION, name, size, sky, items };
}

/* World data (getMap-compatible). */
export function compileCustomMap(map) {
  const m = normalizeCustomMap(map);
  if (!m) throw Error('This map file is not a valid Spectre Orbit map.');
  const half = m.size / 2, boxes = [], visuals = [], barrels = [], spawns = [];
  const box = (x, z, w, d, h, y, hex) => {
    const min = [x - w / 2, y, z - d / 2], max = [x + w / 2, y + h, z + d / 2];
    boxes.push([...min, ...max]); visuals.push({ type: 'box', min, max, color: hex });
  };
  box(0, 0, m.size, m.size, 1, -1, '#8f8778');                                   // floor
  for (const s of [-1, 1]) {                                                      // boundary walls
    box(0, s * (half + 0.3), m.size + 1.2, 0.6, 3, 0, '#b8c4d4');
    box(s * (half + 0.3), 0, 0.6, m.size, 3, 0, '#b8c4d4');
  }
  let zone = null; const flags = {};
  for (const it of m.items) {
    if (it.t === 'block') box(it.x, it.z, it.w, it.d, it.h, it.y, BLOCK_COLORS[it.c]);
    else if (it.t === 'stairs') {
      const steps = Math.max(1, Math.ceil(it.h / 0.4)), along = it.dir % 2 === 0 ? 'z' : 'x', sign = it.dir < 2 ? 1 : -1;
      const len = along === 'z' ? it.d : it.w;
      for (let i = 0; i < steps; i++) {
        const hh = (it.h / steps) * (i + 1), off = (i - (steps - 1) / 2) * (len / steps) * sign;
        if (along === 'z') box(it.x, it.z + off, it.w, len / steps + 0.02, hh, 0, BLOCK_COLORS[it.c]);
        else box(it.x + off, it.z, len / steps + 0.02, it.d, hh, 0, BLOCK_COLORS[it.c]);
      }
    } else if (it.t === 'barrel') {
      const id = 'barrel_' + barrels.length, r = 0.42, h = 1.1;
      barrels.push({ id, x: it.x, y: 0, z: it.z, h, r, hp: 45, alive: true, boxIdx: boxes.length });
      boxes.push([it.x - r, 0, it.z - r, it.x + r, h, it.z + r]);
      visuals.push({ type: 'barrel', id, x: it.x, y: 0, z: it.z, h, r, color: '#d9521f' });
    } else if (it.t === 'tree') {
      visuals.push({ type: 'tree', x: it.x, z: it.z, scale: it.s, h: 6.5 * it.s });
      const r = 0.38 * it.s; boxes.push([it.x - r, 0, it.z - r, it.x + r, 6.5 * it.s * 0.85, it.z + r]);
    } else if (it.t === 'spawn') {
      spawns.push({ x: it.x, y: groundAt(boxes, it.x, it.z), z: it.z, yaw: it.yaw * Math.PI / 180, ...(it.team !== 'none' ? { team: it.team } : {}) });
    } else if (it.t === 'zone') zone = { x: it.x, y: 0, z: it.z };
    else if (it.t === 'flag') flags[it.team] = { x: it.x, y: 0, z: it.z };
  }
  // spawns/anchors sit on whatever they were placed on (re-resolve after all boxes exist)
  for (const s of spawns) s.y = groundAt(boxes, s.x, s.z);
  if (zone) zone.y = groundAt(boxes, zone.x, zone.z);
  for (const t of Object.keys(flags)) flags[t].y = groundAt(boxes, flags[t].x, flags[t].z);
  const objectiveAnchors = {
    ...(zone ? { control: zone } : {}),
    ...(flags.red && flags.blue ? { ctf: { red: flags.red, blue: flags.blue } } : {}),
  };
  if (!spawns.length) spawns.push({ x: 0, y: 0, z: 0, yaw: 0 });
  const world = {
    id: CUSTOM_MAP_ID, boxes, visuals, spawns, barrels, jumpPads: [], hazards: [], killY: -12,
    sky: SKIES[m.sky].sky, fog: SKIES[m.sky].fog, theme: 'custom', objectiveAnchors, custom: m,
    getSurface: () => 'concrete',
  };
  world.layoutHash = planetHash({ boxes, spawns, barrels, objectiveAnchors: { ...objectiveAnchors, size: m.size, sky: m.sky } });
  return world;
}

/* Highest standable top under (x, z) with headroom (spawns placed on platforms stand on them). */
function groundAt(boxes, x, z) {
  let y = 0;
  for (const b of boxes) if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && b[4] > y && b[4] < 18) y = b[4];
  return y;
}

/* Playability report for the editor and the host. errors block hosting; warnings advise. */
export function validateCustomMap(map) {
  const errors = [], warnings = [];
  let world;
  try { world = compileCustomMap(map); } catch (e) { return { ok: false, errors: [e.message], warnings, modes: [] }; }
  const m = world.custom, spawnItems = m.items.filter(i => i.t === 'spawn');
  if (spawnItems.length < 2) errors.push('Place at least 2 spawn points.');
  if (m.items.length >= MAX_ITEMS) warnings.push(`Item limit reached (${MAX_ITEMS}).`);
  const grid = buildWalkGrid(world.boxes, m.size / 2);
  const from = walkDistances(grid, world.spawns[0]);
  world.spawns.forEach((s, i) => { if (!Number.isFinite(distTo(grid, from, s))) errors.push(`Spawn ${i + 1} is blocked or cannot reach the others.`); });
  const red = world.spawns.filter(s => s.team === 'red').length, blue = world.spawns.filter(s => s.team === 'blue').length;
  const modes = ['ffa', 'gungame'];
  if (red && blue) modes.push('tdm'); else warnings.push('Team modes need at least one red and one blue spawn.');
  if (red && blue) {
    if (world.objectiveAnchors.control) {
      if (Number.isFinite(distNear(grid, from, world.objectiveAnchors.control))) modes.push('control'); else errors.push('The Control zone cannot be reached.');
    } else { modes.push('control'); warnings.push('No Control zone placed: Control uses the most central spawn.'); }
    if (world.objectiveAnchors.ctf) {
      const ok = ['red', 'blue'].every(t => Number.isFinite(distTo(grid, from, world.objectiveAnchors.ctf[t])));
      if (ok) modes.push('ctf'); else errors.push('A flag base cannot be reached.');
    } else warnings.push('Place a red and a blue flag base to enable Capture the Flag.');
  }
  return { ok: errors.length === 0, errors, warnings, modes, hash: world.layoutHash, world };
}

/* Starter layout so the editor never opens empty. */
export function sampleCustomMap() {
  const m = emptyCustomMap('Starter Yard', 56);
  const add = o => m.items.push(o);
  add({ t: 'block', x: 0, z: 0, w: 8, d: 8, h: 1.2, y: 0, c: 'sand' });
  add({ t: 'stairs', x: 0, z: 5.5, w: 3, d: 3, h: 1.2, dir: 2, c: 'orange' });
  add({ t: 'stairs', x: 0, z: -5.5, w: 3, d: 3, h: 1.2, dir: 0, c: 'orange' });
  for (const [x, z] of [[-10, -8], [10, 8], [-10, 8], [10, -8]]) add({ t: 'block', x, z, w: 4, d: 1, h: 1.3, y: 0, c: 'white' });
  for (const [x, z] of [[-16, 0], [16, 0]]) add({ t: 'block', x, z, w: 1.2, d: 10, h: 3, y: 0, c: 'teal' });
  add({ t: 'tree', x: -18, z: -18, s: 1 }); add({ t: 'tree', x: 18, z: 18, s: 1 });
  add({ t: 'barrel', x: -6, z: 12 }); add({ t: 'barrel', x: 6, z: -12 });
  for (const x of [-4, 4]) { add({ t: 'spawn', x, z: -23, team: 'red', yaw: 180 }); add({ t: 'spawn', x, z: 23, team: 'blue', yaw: 0 }); }
  add({ t: 'zone', x: 0, z: 0 });
  add({ t: 'flag', x: 0, z: -20, team: 'red' }); add({ t: 'flag', x: 0, z: 20, team: 'blue' });
  return m;
}
