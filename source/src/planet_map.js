/* Orbit Crown — a seeded tiny-planet arena.
   Pure and deterministic: integer-seeded PRNG only (no Math.random, clocks or GPU), plain
   serialisable data, then a validator and a canonical layout hash. Collision and visuals
   are produced from the same layout. The playable crown is a fixed Y-up terraced district on
   top of a visible planet (the planet itself is non-colliding decoration); this is NOT
   full-sphere traversal. */

export const PLANET_GENERATOR_VERSION = 1;
export const ORBIT_MAP_ID = 'orbit';
export const FALLBACK_SEED = 1;
const MAX_ATTEMPTS = 8;
const HALF = 36;            // playable half-extent (72 × 72 m)
const STEP = 0.55;          // must match sim.js
const CLEAR = 2.2;          // standing clearance required by the validator
const R = 0.35;             // player radius (sim.js)

// Stylised palette: bright, saturated, clean (original art direction).
export const ORBIT_COLORS = {
  deck: '#9d9484', road: '#3d4451', roadLine: '#f1f5f9', curb: '#cbd5e1', plaza: '#c8a77a', plazaTrim: '#d86b4f',
  rail: '#b8c4d4', glass: '#4fb3e8', red: '#e04848', redDark: '#9e2f30', blue: '#2f74e0', blueDark: '#1b47a8',
  kioskA: '#f0a92b', kioskB: '#2fbf86', kioskC: '#e85d9e', kioskD: '#8f6fe0', crate: '#d98a2b', planter: '#4f8f2a',
  car1: '#d93b3b', car2: '#1aa3c2', car3: '#e6b422', car4: '#7a52d9', tower: '#d8dee8', towerTrim: '#ee7d2f',
  pillar: '#d6d3d1', roof: '#1597d6', wall: '#e6b84c', barrel: '#d9521f',
};

/* mulberry32 with a normalised seed: 0 stays valid and distinct from 1. */
export function normalizeSeed(seed) {
  const n = Number.isFinite(+seed) ? Math.trunc(+seed) : 0;
  return ((n % 2147483647) + 2147483647) % 2147483647;
}
function prng(seed) {
  let s = (normalizeSeed(seed) ^ 0x9e3779b9) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Layout {
  constructor() { this.boxes = []; this.visuals = []; this.barrels = []; this.tags = []; }
  /* Solid box (collision + visual). x/z centre, w/d footprint, h height, y base. */
  box(x, z, w, d, h, y, color, tag = 'solid') {
    const min = [x - w / 2, y, z - d / 2], max = [x + w / 2, y + h, z + d / 2];
    this.boxes.push([...min, ...max]);
    this.tags.push(tag);
    this.visuals.push({ type: 'box', min, max, color });
  }
  /* Point-symmetric pair (x,z) ↔ (−x,−z): both teams get the same tactical structure. */
  pair(x, z, w, d, h, y, color, tag, colorB = color) {
    this.box(x, z, w, d, h, y, color, tag);
    this.box(-x, -z, w, d, h, y, colorB, tag);
  }
  deco(v) { this.visuals.push(v); }
  barrel(x, z) {
    const id = 'barrel_' + this.barrels.length, r = 0.42, h = 1.1;
    this.barrels.push({ id, x, y: 0, z, h, r, hp: 45, alive: true, boxIdx: this.boxes.length });
    this.boxes.push([x - r, 0, z - r, x + r, h, z + r]);
    this.tags.push('barrel');
    this.visuals.push({ type: 'barrel', id, x, y: 0, z, h, r, color: ORBIT_COLORS.barrel });
  }
}

function buildLayout(seed) {
  const rnd = prng(seed), C = ORBIT_COLORS, L = new Layout();
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const jitter = a => (rnd() * 2 - 1) * a;

  // Deck and boundary (architecture, not invisible walls)
  L.box(0, 0, HALF * 2, HALF * 2, 1, -1, C.deck, 'floor');
  for (const s of [-1, 1]) {
    L.box(0, s * (HALF + 0.3), HALF * 2 + 1.2, 0.6, 2.6, 0, C.rail, 'boundary');
    L.box(s * (HALF + 0.3), 0, 0.6, HALF * 2, 2.6, 0, C.rail, 'boundary');
  }

  // Ring road loop (flat, decorative) + lane markings
  L.deco({ type: 'orbitRoad', inner: 17, outer: 23, y: 0.02, color: C.road, line: C.roadLine });

  // Central contest plaza: 14 × 14 terrace, 1.2 m, two 0.4 m steps on all four sides
  L.box(0, 0, 14, 14, 1.2, 0, C.plaza, 'plaza');
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 0; i < 2; i++) {
      const off = 7 + 1.2 * (2 - i) - 0.6, h = 0.4 * (i + 1);
      if (ax) L.box(ax * off, 0, 1.2, 5, h, 0, C.plazaTrim, 'step');
      else L.box(0, az * off, 5, 1.2, h, 0, C.plazaTrim, 'step');
    }
  }
  // Landmark: Orbit beacon on the plaza (blocks the straight sightline across it)
  L.box(0, 0, 1.4, 1.4, 7, 1.2, C.tower, 'landmark');
  L.deco({ type: 'orbitBeacon', x: 0, y: 8.2, z: 0 });
  // Plaza cover: low walls, mirrored
  L.pair(-3.5, 3, 3.2, 0.6, 1.1, 1.2, C.plazaTrim, 'cover');
  L.pair(3.5, 3, 0.6, 2.6, 1.1, 1.2, C.plazaTrim, 'cover');

  // Team stations (red −z, blue +z): back wall, wings, canopy; three open exits
  for (const [s, col, dark] of [[-1, C.red, C.redDark], [1, C.blue, C.blueDark]]) {
    const zc = s * 30;
    L.box(0, s * 35.2, 18, 0.8, 4.2, 0, dark, 'station');
    L.box(-9.4, s * 32.8, 0.8, 5.6, 3.4, 0, col, 'station');
    L.box(9.4, s * 32.8, 0.8, 5.6, 3.4, 0, col, 'station');
    L.box(0, s * 32.6, 19.6, 6, 0.3, 3.4, col, 'roof');
    L.deco({ type: 'orbitBase', x: 0, z: zc, team: s < 0 ? 'red' : 'blue', color: col });
    // forward cover for the station exits
    L.box(-5, s * 25.5, 3, 0.7, 1.2, 0, C.wall, 'cover');
    L.box(5, s * 25.5, 3, 0.7, 1.2, 0, C.wall, 'cover');
  }

  // Covered flank colonnades (x = ±27), mirrored: pillars + glass roof + broken inner wall
  for (const s of [-1, 1]) {
    for (let k = -2; k <= 2; k++) L.box(s * 29, k * 6.5, 0.8, 0.8, 3.4, 0, C.pillar, 'pillar');
    for (let k = -2; k <= 2; k++) L.box(s * 25, k * 6.5, 0.8, 0.8, 3.4, 0, C.pillar, 'pillar');
    L.box(s * 27, 0, 5.2, 28, 0.25, 3.4, C.glass, 'roof');
    L.box(s * 24.6, -9.75, 0.5, 4.5, 1.2, 0, C.wall, 'cover');
    L.box(s * 24.6, 9.75, 0.5, 4.5, 1.2, 0, C.wall, 'cover');
  }

  // Landmark towers between the flank and the station (point symmetric)
  L.pair(-28, -18, 3, 3, 9, 0, C.tower, 'landmark');
  L.deco({ type: 'orbitTowerTop', x: -28, z: -18, y: 9, color: C.towerTrim });
  L.deco({ type: 'orbitTowerTop', x: 28, z: 18, y: 9, color: C.towerTrim });

  // Districts. Park (+x,−z ↔ −x,+z): planters, round trees, shallow decorative pond.
  for (const s of [-1, 1]) {
    const px = s * 12, pz = -s * 12;
    L.deco({ type: 'water', x: px + s * 1.5, y: 0.04, z: pz - s * 1.5, w: 5, d: 3.4 });
    L.box(px - s * 3.4, pz + s * 2.2, 2.2, 2.2, 0.9, 0, C.planter, 'cover');
    L.box(px + s * 3.6, pz + s * 3.4, 2.2, 2.2, 0.9, 0, C.planter, 'cover');
    for (const [tx, tz] of [[px - s * 3.4, pz + s * 2.2], [px + s * 3.6, pz + s * 3.4]]) {
      L.deco({ type: 'orbitTree', x: tx, y: 0.9, z: tz, s: 0.9 + rnd() * 0.4, hue: Math.floor(rnd() * 3) });
    }
  }
  // Market (+x,+z ↔ −x,−z): kiosks with awnings, crates
  const kioskColors = [C.kioskA, C.kioskB, C.kioskC, C.kioskD];
  for (const s of [-1, 1]) {
    const mx = s * 12, mz = s * 12;
    for (const [dx, dz] of [[-2.6, 0], [2.6, 1.6]]) {
      const col = pick(kioskColors);
      L.box(mx + s * dx, mz + s * dz, 2.6, 2, 2.4, 0, col, 'kiosk');
      L.deco({ type: 'orbitAwning', x: mx + s * dx, z: mz + s * dz + s * 1.3, w: 3, color: col, y: 2.4 });
    }
  }

  // Seeded cover along the ring road: parked cars/crates at slots every ~9 m, mirrored.
  // Slots sit on the road's centre line so lanes either side stay open.
  const carColors = [C.car1, C.car2, C.car3, C.car4];
  const slots = [[-20, -6], [-20, 6], [-8, 20], [8, 20], [20, -14], [-14, -20]];
  for (const [sx, sz] of slots) {
    if (rnd() < 0.18) continue;   // seeded variation: some slots stay empty
    const alongX = Math.abs(sz) === 20;
    const x = sx + (alongX ? jitter(1.6) : 0), z = sz + (alongX ? 0 : jitter(1.6));
    if (rnd() < 0.7) {
      const w = alongX ? 4.2 : 1.9, d = alongX ? 1.9 : 4.2, col = pick(carColors);
      L.pair(x, z, w, d, 1.35, 0, col, 'car');
    } else {
      L.pair(x, z, 1.4, 1.4, 1.4, 0, C.crate, 'cover');
    }
  }
  // Barrels (explosive), mirrored
  for (const [bx, bz] of [[-6.5, -17], [17, 4]]) { L.barrel(bx, bz); L.barrel(-bx, -bz); }

  // Spawns: three per team under/around each station; plus four neutral for FFA spread.
  const spawns = [];
  for (const [s, team] of [[-1, 'red'], [1, 'blue']]) {
    for (const dx of [-5, 0, 5]) spawns.push({ x: s * dx, y: 0, z: s * 31.5, team, yaw: s < 0 ? Math.PI : 0 });   // index-mirrored
  }
  for (const [x, z] of [[-31, 6], [31, -6], [-12, -27], [12, 27]]) spawns.push({ x, y: 0, z, yaw: Math.atan2(x, z) });

  const objectiveAnchors = {
    control: { x: 0, y: 1.2, z: 0 },      // plaza centre; the beacon inside the zone is cover
    ctf: { red: { x: 0, y: 0, z: -29.5 }, blue: { x: 0, y: 0, z: 29.5 } },
  };
  return { boxes: L.boxes, tags: L.tags, visuals: L.visuals, barrels: L.barrels, spawns, objectiveAnchors };
}

/* ---- validation: walkable-surface grid + flood fill ----
   Each 0.5 m cell keeps up to 4 standable heights (box tops with 2.2 m headroom, where only
   obstacles taller than a step count as blocking). Moves step up ≤ 0.55 m or drop ≤ 2 m. */
const CELL = 0.5, LEVELS = 4;
export function buildWalkGrid(boxes) {
  const n = Math.round((HALF * 2) / CELL), surf = new Float32Array(n * n * LEVELS).fill(NaN);
  for (let ix = 0; ix < n; ix++) {
    const x = -HALF + (ix + 0.5) * CELL;
    const colBoxes = boxes.filter(b => x + R > b[0] && x - R < b[3]);
    for (let iz = 0; iz < n; iz++) {
      const z = -HALF + (iz + 0.5) * CELL;
      const near = colBoxes.filter(b => z + R > b[2] && z - R < b[5]);
      const tops = [];
      for (const b of near) if (x >= b[0] - R * 0.5 && x <= b[3] + R * 0.5 && z >= b[2] - R * 0.5 && z <= b[5] + R * 0.5) tops.push(b[4]);
      tops.sort((p, q) => p - q);
      let li = 0, last = NaN;
      for (const h of tops) {
        if (h === last || li >= LEVELS) continue;
        let blocked = false;
        for (const b of near) if (b[1] < h + CLEAR - 1e-3 && b[4] > h + STEP) { blocked = true; break; }
        if (!blocked) { surf[(ix * n + iz) * LEVELS + li++] = h; last = h; }
      }
    }
  }
  return { n, surf, cell: CELL, half: HALF };
}

const cellOf = (g, x, z) => {
  const ix = Math.floor((x + g.half) / g.cell), iz = Math.floor((z + g.half) / g.cell);
  return ix >= 0 && iz >= 0 && ix < g.n && iz < g.n ? ix * g.n + iz : -1;
};
const levelAt = (g, c, y) => { for (let l = 0; l < LEVELS; l++) { const h = g.surf[c * LEVELS + l]; if (h === h && Math.abs(h - y) <= STEP + 0.05) return l; } return -1; };

/* BFS distances (metres) from a point; Float32Array indexed by cell*LEVELS+level, Infinity = unreachable. */
export function walkDistances(g, from) {
  const dist = new Float32Array(g.n * g.n * LEVELS).fill(Infinity);
  const c0 = cellOf(g, from.x, from.z), l0 = c0 < 0 ? -1 : levelAt(g, c0, from.y);
  if (l0 < 0) return dist;
  const q = new Int32Array(g.n * g.n * LEVELS); let head = 0, tail = 0;
  q[tail++] = c0 * LEVELS + l0; dist[c0 * LEVELS + l0] = 0;
  while (head < tail) {
    const k = q[head++], c = (k / LEVELS) | 0, h = g.surf[k], d = dist[k] + g.cell;
    const ix = (c / g.n) | 0, iz = c % g.n;
    for (let dir = 0; dir < 4; dir++) {
      const jx = ix + (dir === 0 ? 1 : dir === 1 ? -1 : 0), jz = iz + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
      if (jx < 0 || jz < 0 || jx >= g.n || jz >= g.n) continue;
      const cj = jx * g.n + jz;
      for (let l = 0; l < LEVELS; l++) {
        const kj = cj * LEVELS + l, h2 = g.surf[kj];
        if (h2 !== h2 || h2 - h > STEP || h - h2 > 2.0 || dist[kj] <= d) continue;
        dist[kj] = d; q[tail++] = kj;
      }
    }
  }
  return dist;
}

/* Nearest reachable cell within `r` metres of p (for anchors that sit on a landmark). */
function distNear(g, dist, p, r = 3) {
  let best = Infinity;
  for (let dx = -r; dx <= r; dx += g.cell) for (let dz = -r; dz <= r; dz += g.cell) {
    if (dx * dx + dz * dz > r * r) continue;
    best = Math.min(best, distTo(g, dist, { x: p.x + dx, y: p.y, z: p.z + dz }));
  }
  return best;
}

function distTo(g, dist, p) {
  const c = cellOf(g, p.x, p.z);
  if (c < 0) return Infinity;
  let best = Infinity;
  for (let l = 0; l < LEVELS; l++) { const h = g.surf[c * LEVELS + l]; if (h === h && Math.abs(h - p.y) <= STEP + 0.05) best = Math.min(best, dist[c * LEVELS + l]); }
  return best;
}

/* Station exits: of the three directions out of a team station (left, front, right), how many
   have reachable open ground 2 m beyond the station footprint. */
function exitCount(g, dist, s) {
  const zf = s * 29.4, zb = s * 34.6;   // front edge and back of the station
  const probes = { left: [], front: [], right: [] };
  for (let t = 0; t <= 1; t += 0.1) {
    const z = zb + (zf - zb) * t;
    probes.left.push({ x: -11.6, y: 0, z }); probes.right.push({ x: 11.6, y: 0, z });
  }
  for (let x = -8; x <= 8; x += 1) probes.front.push({ x, y: 0, z: zf - s * 2 });
  return Object.values(probes).filter(list => list.some(p => Number.isFinite(distTo(g, dist, p)))).length;
}

export function validateLayout(layout) {
  const problems = [];
  const grid = buildWalkGrid(layout.boxes);
  const red = layout.spawns.filter(sp => sp.team === 'red'), blue = layout.spawns.filter(sp => sp.team === 'blue');
  if (layout.spawns.length < 6 || red.length < 3 || blue.length < 3) problems.push('fewer than 6 team spawns');
  const fromRed = walkDistances(grid, red[0]), fromBlue = walkDistances(grid, blue[0]);
  const a = layout.objectiveAnchors;
  for (const sp of layout.spawns) if (!Number.isFinite(distTo(grid, fromRed, sp))) problems.push(`spawn ${sp.x},${sp.z} unreachable or blocked`);
  if (!Number.isFinite(distNear(grid, fromRed, a.control))) problems.push('control zone unreachable');
  for (const [name, p] of [['red flag', a.ctf.red], ['blue flag', a.ctf.blue]]) if (!Number.isFinite(distTo(grid, fromRed, p))) problems.push(`${name} unreachable`);
  for (const sp of red) if (Math.hypot(sp.x - a.ctf.blue.x, sp.z - a.ctf.blue.z) < 15) problems.push('red spawn too close to blue base');
  for (const sp of blue) if (Math.hypot(sp.x - a.ctf.red.x, sp.z - a.ctf.red.z) < 15) problems.push('blue spawn too close to red base');
  const exitsRed = exitCount(grid, fromRed, -1), exitsBlue = exitCount(grid, fromBlue, 1);
  if (exitsRed < 2 || exitsBlue < 2) problems.push(`station exits red ${exitsRed} blue ${exitsBlue}`);
  const dRed = distNear(grid, fromRed, a.control), dBlue = distNear(grid, fromBlue, a.control);
  if (!(Math.abs(dRed - dBlue) <= 0.1 * Math.max(dRed, dBlue))) problems.push(`unfair control routes ${dRed} vs ${dBlue}`);
  const flagRoute = distTo(grid, walkDistances(grid, a.ctf.red), a.ctf.blue);
  if (!Number.isFinite(flagRoute)) problems.push('no base-to-base route');
  const metrics = { spawnToControlRed: dRed, spawnToControlBlue: dBlue, flagRoute, flagRouteSeconds: +(flagRoute / 6.5).toFixed(1), exitsRed, exitsBlue };
  return { ok: problems.length === 0, problems, metrics };
}

/* Canonical hash of the gameplay layout: boxes, spawns, barrels, anchors, version (cm-quantised). */
export function layoutHash(layout) {
  const q = v => Math.round(v * 100);
  const parts = [PLANET_GENERATOR_VERSION,
    layout.boxes.map(b => b.map(q).join(',')).join(';'),
    layout.spawns.map(s => [q(s.x), q(s.y), q(s.z), s.team || '-'].join(',')).join(';'),
    layout.barrels.map(b => [q(b.x), q(b.z)].join(',')).join(';'),
    JSON.stringify(layout.objectiveAnchors, Object.keys(layout.objectiveAnchors).sort())];
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/* World data compatible with getMap(). Tries up to 8 seeds, then a known-good fallback. */
export function generatePlanet({ seed = 0, generatorVersion = PLANET_GENERATOR_VERSION } = {}) {
  if (generatorVersion !== PLANET_GENERATOR_VERSION) throw Error(`Orbit Crown generator v${generatorVersion} is not supported by this build (v${PLANET_GENERATOR_VERSION}).`);
  const base = normalizeSeed(seed);
  let layout = null, used = base, report = null, fallbackReason = null;
  for (let i = 0; i < MAX_ATTEMPTS && !layout; i++) {
    const cand = buildLayout(base + i), v = validateLayout(cand);
    if (v.ok) { layout = cand; used = base + i; report = v; }
  }
  if (!layout) {
    fallbackReason = `seed ${base} failed validation ${MAX_ATTEMPTS} times; using fallback seed ${FALLBACK_SEED}`;
    layout = buildLayout(FALLBACK_SEED); used = FALLBACK_SEED; report = validateLayout(layout);
    if (typeof console !== 'undefined') console.warn('[orbit]', fallbackReason);
  }
  const hash = layoutHash(layout);
  const tagOf = new Map(layout.boxes.map((b, i) => [b, layout.tags[i]]));
  return {
    id: ORBIT_MAP_ID,
    boxes: layout.boxes,
    visuals: layout.visuals,
    spawns: layout.spawns,
    barrels: layout.barrels,
    jumpPads: [],
    hazards: [],
    killY: -12,
    sky: '#9bd4f5',
    fog: '#bfe3f7',
    theme: 'orbit',
    objectiveAnchors: layout.objectiveAnchors,
    planet: { seed: used, requestedSeed: base, generatorVersion: PLANET_GENERATOR_VERSION, radius: 150, half: HALF, fallbackReason },
    layoutHash: hash,
    metrics: report.metrics,
    getSurface: (x, y, z) => {
      for (const b of layout.boxes) if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && Math.abs(y - b[4]) < 0.2) {
        const t = tagOf.get(b);
        return t === 'car' || t === 'pillar' ? 'metal' : t === 'kiosk' || t === 'roof' ? 'wood' : 'concrete';
      }
      return 'concrete';
    },
  };
}
