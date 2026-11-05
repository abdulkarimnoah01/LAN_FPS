/* Operation Microverse: a seeded, fully walkable micro-planet. The planet IS the level.
   Pure and deterministic (integer-seeded PRNG, no Math.random, clocks or GPU): the host and every
   client build byte-identical collision from the same { seed, radius, density } config, so only the
   seed travels over the network. Layout is gameplay-first: districts and road loops are placed
   first, then cover and props are scattered with clearance tests so routes are never blocked.

   Output feeds sphere_sim.js (collision: terrain heightfield + oriented boxes) and
   babylon/micro_world.js (visuals: displaced icosphere + thin-instanced props). */

import { V, makeObb, terrainHeight, surfacePoint, indexObbs, nearObbs, groundRadius } from './sphere_sim.js';
const { add, sub, mul, dot, cross, len, norm } = V;

export const MICRO_MAP_ID = 'microverse';
export const MICRO_GENERATOR_VERSION = 1;

export const MICRO_PRESETS = {
  low: { radius: 72, buildings: 0.7, vegetation: 0.5, cover: 0.7 },
  medium: { radius: 72, buildings: 1, vegetation: 1, cover: 1 },
  high: { radius: 72, buildings: 1.15, vegetation: 1.4, cover: 1.15 },
};

export const MICRO_COLORS = {
  grass: [0.36, 0.72, 0.26], grassDark: [0.26, 0.58, 0.26], dirt: [0.58, 0.45, 0.30], rock: [0.5, 0.5, 0.56],
  road: [0.24, 0.26, 0.34], roadLine: [0.62, 0.66, 0.78], plaza: [0.52, 0.55, 0.68], industrial: [0.56, 0.52, 0.46],
  urban: [0.40, 0.44, 0.58], outpost: [0.42, 0.48, 0.60], trail: [0.74, 0.64, 0.44], sand: [0.74, 0.66, 0.48],
};

function norm32(seed) { const n = Number.isFinite(+seed) ? Math.trunc(+seed) : 0; return ((n % 2147483647) + 2147483647) % 2147483647; }
function prng(seed) {
  let s = (norm32(seed) ^ 0x9e3779b9) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- frames ---------- */

/* Tangent frame at unit direction `up`, rotated by yaw: { right, up, fwd, back }. */
export function frameAtDir(up, yaw = 0) {
  const ref = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const right0 = norm(cross(ref, up));
  const fwd0 = cross(up, right0);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const fwd = add(mul(fwd0, c), mul(cross(up, fwd0), s));
  const right = cross(fwd, up);
  return { right, up, fwd, back: mul(fwd, -1) };
}

const capSample = (rnd, center, rad) => {
  const cosR = Math.cos(rad), cz = 1 - rnd() * (1 - cosR), sz = Math.sqrt(1 - cz * cz), phi = rnd() * Math.PI * 2;
  const f = frameAtDir(center, 0);
  return norm(add(add(mul(center, cz), mul(f.right, sz * Math.cos(phi))), mul(f.fwd, sz * Math.sin(phi))));
};

/* ---------- districts ---------- */

const DISTRICTS = {
  spire:      { dir: [0, 1, 0],  rad: 0.40, relief: 0.08, name: 'Command Spire',   ground: 'plaza' },
  urban:      { dir: [1, 0, 0],  rad: 0.56, relief: 0.15, name: 'Neon Urban Hub',  ground: 'urban' },
  industrial: { dir: [-1, 0, 0], rad: 0.56, relief: 0.18, name: 'Industrial Ridge', ground: 'industrial' },
  forest:     { dir: [0, 0, 1],  rad: 0.62, relief: 1.0,  name: 'Forest Belt',     ground: 'grass' },
  outpost:    { dir: [0, 0, -1], rad: 0.50, relief: 0.3,  name: 'Orbital Outpost', ground: 'outpost' },
  understar:  { dir: [0, -1, 0], rad: 0.40, relief: 0.08, name: 'Under Spire',     ground: 'plaza' },
};
const ROADS = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];     // great circles: equator ring + two meridian spokes through both spires
const ROAD_HALF = 3.4;

export function districtAt(d) {
  let best = 'forest', bd = -2;
  for (const [k, z] of Object.entries(DISTRICTS)) { const c = dot(d, z.dir) - 0; if (c > bd) { bd = c; best = k; } }
  return best;
}
const roadDistance = (sph, d) => Math.min(...ROADS.map(n => Math.abs(dot(d, n)))) * sph.R;

/* Ground colour for terrain vertices: districts, road bands, lane markings, trails. */
export function terrainColor(sph, d) {
  const C = MICRO_COLORS, dist = districtAt(d);
  let col = C[DISTRICTS[dist].ground];
  if (dist === 'forest') col = ((d[0] * 7.1 + d[1] * 5.3 + d[2] * 9.7) % 2 + 2) % 2 < 1 ? C.grass : C.grassDark;
  const rd = roadDistance(sph, d);
  if (rd < ROAD_HALF) {
    col = C.road;
    const lane = Math.min(...ROADS.map(n => Math.abs(dot(d, n)))) * sph.R;
    if (lane < 0.16) col = C.roadLine;
  } else if (rd < ROAD_HALF + 0.9) col = C.plaza;
  const trail = Math.abs(dot(d, norm([0.8, 0.6, 0.0]))) * sph.R;
  if (dist === 'forest' && trail < 1.6) col = C.trail;
  return col;
}

/* ---------- generator ---------- */

function buildWorld(cfg) {
  const rnd = prng(cfg.seed), R = cfg.radius;
  const sph = {
    c: [0, 0, 0], R, seed: norm32(cfg.seed) & 0xffff, amp: 1.7 * cfg.roughness,
    zones: Object.values(DISTRICTS).map(z => ({ dir: z.dir, rad: z.rad, relief: z.relief })),
    roads: ROADS, obbs: [], pads: [],
  };
  const inst = [];             // visual instances
  const placed = [];           // footprint circles on the sphere for spacing tests
  const markers = { objectives: [], spawns: [] };
  const metrics = { buildings: 0, props: 0, trees: 0, pads: 0, ramps: 0 };

  const surf = d => surfacePoint(sph, d);
  const metres = (a, b) => len(sub(a, b)) * R;
  const roadClear = (d, r) => roadDistance(sph, d) > ROAD_HALF + r + 0.6;
  const free = (d, r, gap = 1.2) => placed.every(p => metres(p.d, d) > p.r + r + gap);
  const claim = (d, r) => placed.push({ d, r });

  /* Visual + collision box standing on the ground. h is above-ground height; embed hides the curve gap. */
  function solid(d, yaw, w, dep, h, col, tag, { collide = true, kind = 'box', lift = 0, embed = 1.0 } = {}) {
    const f = frameAtDir(d, yaw), base = add(surf(d), mul(d, lift));
    const c = add(base, mul(d, (h - embed) / 2));
    const ax = [f.right, f.up, f.back];
    inst.push({ k: kind, c, ax, s: [w, h + embed, dep], col });
    if (collide) sph.obbs.push(makeObb(c, ax, [w / 2, (h + embed) / 2, dep / 2], tag));
    return { c, ax, f, top: add(base, mul(d, h)) };
  }
  function glow(d, yaw, w, dep, h, y0, col) {
    const f = frameAtDir(d, yaw);
    inst.push({ k: 'glow', c: add(surf(d), mul(d, y0 + h / 2)), ax: [f.right, f.up, f.back], s: [w, h, dep], col });
  }
  /* Ramp rising along `fwd` of the frame at d: walkable top surface, tilted box collider. */
  function ramp(d, yaw, width, length, rise, col, tag = 'ramp', hint = null) {
    let f = frameAtDir(d, yaw);
    if (hint) { const fw = norm(sub(hint, mul(d, dot(hint, d)))); f = { up: d, fwd: fw, right: cross(fw, d), back: mul(fw, -1) }; }
    const th = Math.asin(Math.min(0.99, rise / length)), t = 0.35;
    const fwdP = add(mul(f.fwd, Math.cos(th)), mul(d, Math.sin(th)));
    const upP = sub(mul(d, Math.cos(th)), mul(f.fwd, Math.sin(th)));
    const right = f.right, back = mul(fwdP, -1);
    const topMid = add(add(surf(d), mul(f.fwd, (length * Math.cos(th)) / 2)), mul(d, rise / 2));
    const c = sub(topMid, mul(upP, t / 2));
    const ax = [right, upP, back];
    inst.push({ k: 'box', c, ax, s: [width, t, length], col });
    sph.obbs.push(makeObb(c, ax, [width / 2, t / 2, length / 2], tag));
    metrics.ramps++;
  }
  /* Ramp whose top end meets a structure `edge` metres ahead of d (negative = before d) along yaw. */
  function rampTo(d, yaw, width, length, rise, col, edge) {
    const f = frameAtDir(d, yaw), Lc = Math.sqrt(length * length - rise * rise);
    ramp(norm(add(d, mul(f.fwd, (edge - Lc) / R))), yaw, width, length, rise, col, 'ramp', f.fwd);
  }
  function pad(d, yaw, rise, col = '#35e0ff') {
    const f = frameAtDir(d, yaw), c = add(surf(d), mul(d, 0.12)), ax = [f.right, f.up, f.back];
    const o = makeObb(c, ax, [1.6, 0.15, 1.6], 'pad'); o.boost = Math.sqrt(2 * 20 * (rise + 1.3));
    sph.pads.push(o);
    inst.push({ k: 'box', c, ax, s: [3.2, 0.3, 3.2], col: '#1c2b3a' });
    inst.push({ k: 'glow', c: add(c, mul(d, 0.18)), ax, s: [2.4, 0.08, 2.4], col });
    metrics.pads++;
  }
  const yawOf = () => rnd() * Math.PI * 2;
  const snapYaw = () => Math.floor(rnd() * 4) * Math.PI / 2 + (rnd() - 0.5) * 0.1;
  const pickc = a => a[Math.floor(rnd() * a.length)];

  const D = DISTRICTS, COUNT = (n, k) => Math.max(1, Math.round(n * k));
  const URB = ['#5b6ea8', '#7a6bb8', '#4f8fb8', '#b86a9a', '#6a7fc4'], NEON = ['#ff3cc8', '#2ee6ff', '#9b5cff', '#ffd23c'];
  const IND = ['#b09a7a', '#8aa0ab', '#c9784a', '#6fa39a', '#d9a050'], CONT = ['#e0662f', '#34a8b8', '#e8b834', '#5fa044', '#b8484a'];

  /* ---- Command Spire (north pole) and Under Spire (south pole): the two hub landmarks ---- */
  function spire(key, tower, deckH, tint) {
    const d = D[key].dir, f0 = frameAtDir(d, 0);
    solid(d, 0, 26, 26, 0.5, '#6b7390', 'plaza', { embed: 1.5 });
    solid(d, 0, 22, 22, 1.0, '#7b84a2', 'plaza', { embed: 1.5 });
    solid(d, 0, 18, 18, 1.5, '#8b94b4', 'plaza', { embed: 1.5 });
    solid(d, 0, 6.4, 6.4, tower, '#4a5280', 'tower', { embed: 1.5 });
    for (let i = 1; i <= 4; i++) glow(d, 0, 6.8, 6.8, 0.35, i * tower / 5, tint);
    glow(d, 0, 2, 2, 3, tower, '#ffffff');
    // Deck ring on pillars: high ground that is strong but never dominant (open on all sides).
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const pd = norm(add(d, add(mul(f0.right, sx * 8.5 / R), mul(f0.fwd, sz * 8.5 / R))));
      solid(pd, 0, 1.3, 1.3, deckH, '#3c4560', 'pillar', { embed: 1.5 });
    }
    const dk = frameAtDir(d, 0), deckC = add(surf(d), mul(d, deckH + 0.25));
    const deckAx = [dk.right, dk.up, dk.back];
    inst.push({ k: 'box', c: deckC, ax: deckAx, s: [21, 0.5, 21], col: '#313a55' });
    // Two cut-outs (collider as 4 slabs around the tower) keep the tower footprint clear
    for (const [ox, oz, w, dp] of [[0, -8.2, 21, 4.6], [0, 8.2, 21, 4.6], [-8.2, 0, 4.6, 12], [8.2, 0, 4.6, 12]]) {
      const c = add(deckC, add(mul(dk.right, ox), mul(dk.fwd, oz)));
      sph.obbs.push(makeObb(c, deckAx, [w / 2, 0.25, dp / 2], 'deck'));
    }
    glow(d, 0, 21.2, 21.2, 0.15, deckH + 0.5, tint);
    // Ways up: four launch pads on the plaza and one long ramp
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const pd = norm(add(d, add(mul(f0.right, Math.cos(a) * 12.8 / R), mul(f0.fwd, Math.sin(a) * 12.8 / R))));
      pad(pd, a, deckH + 0.5, tint);
    }
    rampTo(d, 0, 3.4, (deckH + 0.5) / 0.342, deckH + 0.5, '#4a5470', -10.5);
    // Crates for cover around the plaza
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + 0.4;
      const cd = norm(add(d, add(mul(f0.right, Math.cos(a) * 16.5 / R), mul(f0.fwd, Math.sin(a) * 16.5 / R))));
      solid(cd, a, 1.6, 1.6, 1.4, pickc(CONT), 'crate'); metrics.props++;
    }
    claim(d, 17);
    markers.objectives.push({ id: key, name: D[key].name, dir: d, p: add(surf(d), mul(d, 1.5)) });
  }
  spire('spire', 42, 11, '#ff3cc8');
  spire('understar', 30, 8, '#2ee6ff');

  /* ---- Neon Urban Hub (+X): compact blocks, alleys, rooftop launch routes ---- */
  {
    const z = D.urban;
    solid(z.dir, 0.2, 12, 12, 0.5, '#6a7298', 'plaza', { embed: 1.5 });       // hub plaza with a beacon cover piece
    solid(z.dir, 0.2, 2.2, 2.2, 5.5, '#2a2f4a', 'beacon', { embed: 1.5 });
    glow(z.dir, 0.2, 2.5, 2.5, 0.3, 4.8, '#2ee6ff');
    claim(z.dir, 8);
    markers.objectives.push({ id: 'urban', name: z.name, dir: z.dir, p: add(surf(z.dir), mul(z.dir, 1.5)) });
    const want = COUNT(24, cfg.buildings);
    let made = 0;
    for (let n = 0; n < 420 && made < want; n++) {
      const d = capSample(rnd, z.dir, z.rad), w = 6.5 + rnd() * 5.5, dp = 6.5 + rnd() * 5.5, r = Math.hypot(w, dp) / 2;
      if (!roadClear(d, r) || !free(d, r, 5)) continue;
      const low = rnd() < 0.34, h = low ? 4.6 + rnd() * 1.3 : 7 + rnd() * 11, yaw = snapYaw();
      solid(d, yaw, w, dp, h, pickc(URB), 'building');
      glow(d, yaw, w + 0.12, dp + 0.12, 0.3, h - 0.9, pickc(NEON));
      if (!low && rnd() < 0.5) glow(d, yaw, 0.3, dp + 0.14, h * 0.6, 1.6, pickc(NEON));
      claim(d, r); made++; metrics.buildings++;
      if (low) {   // rooftop route: a launch pad beside it
        const f = frameAtDir(d, yaw), pd = norm(add(d, mul(f.fwd, (dp / 2 + 3.4) / R)));
        pad(pd, yaw, h);
        claim(pd, 2.4);
      }
    }
    for (let n = 0; n < 160 && metrics.props < COUNT(60, cfg.cover); n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.05);
      if (!free(d, 1.2, 0.8)) continue;
      const wall = rnd() < 0.4, yaw = snapYaw();
      if (wall) solid(d, yaw, 4.2, 0.5, 1.15, '#566075', 'wall'); else solid(d, yaw, 1.5, 1.5, 1.3, pickc(CONT), 'crate');
      claim(d, 1.4); metrics.props++;
    }
  }

  /* ---- Industrial Ridge (-X): containers, silos, pipes, catwalks ---- */
  {
    const z = D.industrial;
    markers.objectives.push({ id: 'industrial', name: z.name, dir: z.dir, p: add(surf(z.dir), mul(z.dir, 1.5)) });
    solid(z.dir, 0, 10, 10, 0.5, '#4c4a47', 'plaza', { embed: 1.5 });
    claim(z.dir, 7);
    let made = 0; const want = COUNT(14, cfg.buildings);
    for (let n = 0; n < 300 && made < want; n++) {
      const d = capSample(rnd, z.dir, z.rad), kind = rnd(), yaw = snapYaw();
      if (kind < 0.18) {       // silo
        const dia = 5 + rnd() * 2; if (!roadClear(d, dia / 2) || !free(d, dia / 2, 3)) continue;
        const h = 9 + rnd() * 5;
        const f = frameAtDir(d, yaw), c = add(surf(d), mul(d, (h - 1) / 2));
        inst.push({ k: 'cyl', c, ax: [f.right, f.up, f.back], s: [dia, h + 1, dia], col: pickc(IND) });
        sph.obbs.push(makeObb(c, [f.right, f.up, f.back], [dia * 0.39, (h + 1) / 2, dia * 0.39], 'silo'));
        glow(d, yaw, dia + 0.1, dia + 0.1, 0.25, h - 1.5, '#ffb23c');
        claim(d, dia / 2); made++; metrics.buildings++;
      } else if (kind < 0.40) { // warehouse + catwalk
        const w = 14 + rnd() * 6, dp = 9 + rnd() * 3, r = Math.hypot(w, dp) / 2;
        if (!roadClear(d, r) || !free(d, r + 8, 3)) continue;
        solid(d, yaw, w, dp, 6.4, pickc(IND), 'building'); glow(d, yaw, w + 0.1, dp + 0.1, 0.3, 5.2, '#ffb23c');
        const f = frameAtDir(d, yaw), side = norm(add(d, mul(f.right, (w / 2 + 3.6) / R)));
        solid(side, yaw + Math.PI / 2, 12, 3.4, 0.35, '#6b7580', 'catwalk', { lift: 3.4, embed: 0.2 });   // platform at 3.4 m
        for (const s of [-1, 1]) solid(norm(add(side, mul(frameAtDir(d, yaw).fwd, s * 5.2 / R))), yaw, 0.5, 0.5, 3.4, '#4a525c', 'post', { embed: 1 });
        rampTo(side, yaw, 2.6, 11.8, 3.75, '#5a636e', -6);
        claim(d, r + 8); made++; metrics.buildings++;
      } else {                  // container stack
        if (!roadClear(d, 5) || !free(d, 5, 2)) continue;
        solid(d, yaw, 12, 2.6, 2.6, pickc(CONT), 'container');
        if (rnd() < 0.45) { rampTo(d, yaw - Math.PI / 2, 2.4, 7, 2.6, '#68707a', -6); claim(d, 11); } else claim(d, 6);
        made++; metrics.buildings++;
      }
    }
    for (let n = 0; n < 220 && metrics.props < COUNT(70, cfg.cover); n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.05); if (!free(d, 1.4, 0.8)) continue;
      const yaw = snapYaw(), k = rnd();
      if (k < 0.3) { solid(d, yaw, 12, 0.9, 0.9, '#8a8e96', 'pipe'); claim(d, 6); }
      else if (k < 0.7) { solid(d, yaw, 1.2, 1.2, 1.2, pickc(CONT), 'crate'); claim(d, 1.2); }
      else { solid(d, yaw, 3, 0.6, 1.2, '#6c6a66', 'wall'); claim(d, 1.8); }
      metrics.props++;
    }
  }

  /* ---- Forest Belt (+Z): rolling terrain, trees, boulders, plateaus ---- */
  {
    const z = D.forest;
    markers.objectives.push({ id: 'forest', name: z.name, dir: z.dir, p: add(surf(z.dir), mul(z.dir, 1.5)) });
    for (let i = 0; i < 3; i++) {   // rock plateaus with a ramp each
      for (let n = 0; n < 40; n++) {
        const d = capSample(rnd, z.dir, z.rad * 0.85), yaw = snapYaw();
        if (!roadClear(d, 9) || !free(d, 9, 3)) continue;
        solid(d, yaw, 10, 8, 2.6, '#7a7d86', 'cliff');
        const f = frameAtDir(d, yaw);
        rampTo(d, yaw, 3, 7.4, 2.6, '#8a8c93', -4);
        claim(d, 12); metrics.buildings++; break;
      }
    }
    const trees = COUNT(70, cfg.vegetation), rocks = COUNT(24, cfg.vegetation), bushes = COUNT(46, cfg.vegetation);
    for (let n = 0, made = 0; n < 900 && made < trees; n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.15), th = 3.2 + rnd() * 2.2;
      if (!roadClear(d, 1.2) || !free(d, 1.1, 2.2)) continue;
      const s0 = surf(d), f = frameAtDir(d, yawOf());
      const trunkC = add(s0, mul(d, th / 2 - 0.4));
      inst.push({ k: 'cyl', c: trunkC, ax: [f.right, f.up, f.back], s: [0.55, th + 0.8, 0.55], col: '#6b4a2f' });
      if (rnd() < 0.7) sph.obbs.push(makeObb(trunkC, [f.right, f.up, f.back], [0.3, (th + 0.8) / 2, 0.3], 'trunk'));
      const fol = pickc(['#2f8f3a', '#3da64a', '#2a7d4a', '#56b04a']), fd = 3.6 + rnd() * 2.2;
      inst.push({ k: 'cone', c: add(s0, mul(d, th + 1.6)), ax: [f.right, f.up, f.back], s: [fd, 4.4 + rnd() * 2, fd], col: fol });
      inst.push({ k: 'cone', c: add(s0, mul(d, th + 3.4)), ax: [f.right, f.up, f.back], s: [fd * 0.7, 3.4, fd * 0.7], col: fol });
      claim(d, 1.1); made++; metrics.trees++;
    }
    for (let n = 0, made = 0; n < 300 && made < rocks; n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.1), sz = 2 + rnd() * 3;
      if (!roadClear(d, sz) || !free(d, sz * 0.8, 1.5)) continue;
      const f = frameAtDir(d, yawOf()), c = add(surf(d), mul(d, sz * 0.25));
      inst.push({ k: 'ico', c, ax: [f.right, f.up, f.back], s: [sz * 1.3, sz, sz * 1.1], col: pickc(['#7b7e86', '#6c6f78', '#8a8d93']) });
      sph.obbs.push(makeObb(c, [f.right, f.up, f.back], [sz * 0.45, sz * 0.4, sz * 0.42], 'rock'));
      claim(d, sz * 0.8); made++; metrics.props++;
    }
    for (let n = 0, made = 0; n < 400 && made < bushes; n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.2); if (!roadClear(d, 1)) continue;
      const f = frameAtDir(d, yawOf()), sz = 0.9 + rnd() * 1.1;
      inst.push({ k: 'ico', c: add(surf(d), mul(d, sz * 0.3)), ax: [f.right, f.up, f.back], s: [sz * 1.4, sz, sz * 1.4], col: pickc(['#3da64a', '#4cbf55', '#2f8f3a', '#e86ab8']) });
      made++;
    }
  }

  /* ---- Orbital Outpost (-Z): neon bunkers, jump pads, an antenna ---- */
  {
    const z = D.outpost;
    markers.objectives.push({ id: 'outpost', name: z.name, dir: z.dir, p: add(surf(z.dir), mul(z.dir, 1.5)) });
    solid(z.dir, 0, 9, 9, 0.5, '#454c63', 'plaza', { embed: 1.5 });
    const f0 = frameAtDir(z.dir, 0);
    solid(z.dir, 0, 1.0, 1.0, 20, '#2a3050', 'antenna', { collide: true, embed: 1.5 });
    glow(z.dir, 0, 1.4, 1.4, 0.8, 20, '#ff3cc8');
    claim(z.dir, 6);
    for (let n = 0, made = 0; n < 300 && made < COUNT(8, cfg.buildings); n++) {
      const d = capSample(rnd, z.dir, z.rad), yaw = snapYaw();
      if (!roadClear(d, 5) || !free(d, 5, 4)) continue;
      solid(d, yaw, 6, 6, 3.2, '#39405a', 'bunker'); glow(d, yaw, 6.1, 6.1, 0.22, 2.9, '#2ee6ff');
      solid(d, yaw, 3, 3, 0.4, '#262c44', 'roof', { lift: 3.2, embed: 0, collide: false });
      pad(norm(add(d, mul(frameAtDir(d, yaw).right, 7.2 / R))), yaw, 3.2, '#ff3cc8');
      claim(d, 8); made++; metrics.buildings++;
    }
    for (let n = 0; n < 200 && metrics.props < COUNT(110, cfg.cover); n++) {
      const d = capSample(rnd, z.dir, z.rad * 1.1); if (!free(d, 1.4, 1)) continue;
      const yaw = snapYaw();
      if (rnd() < 0.5) solid(d, yaw, 4, 0.5, 1.2, '#4c5470', 'wall'); else solid(d, yaw, 1.4, 1.4, 1.2, pickc(CONT), 'crate');
      claim(d, 1.6); metrics.props++;
    }
  }

  /* ---- Road furniture: lamps along every great-circle road (visual only) ---- */
  for (const n of ROADS) {
    const f = frameAtDir(n, 0), steps = Math.floor((2 * Math.PI * R) / 18);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2, d0 = add(mul(f.right, Math.cos(a)), mul(f.fwd, Math.sin(a)));
      const d = norm(add(d0, mul(n, (ROAD_HALF + 0.8) / R * (i % 2 ? 1 : -1))));
      if (!free(d, 0.4, 0)) continue;
      const lf = frameAtDir(d, 0), s0 = surf(d);
      inst.push({ k: 'cyl', c: add(s0, mul(d, 2.1)), ax: [lf.right, lf.up, lf.back], s: [0.18, 4.4, 0.18], col: '#3a4058' });
      inst.push({ k: 'glow', c: add(s0, mul(d, 4.5)), ax: [lf.right, lf.up, lf.back], s: [0.7, 0.18, 0.7], col: i % 3 ? '#2ee6ff' : '#ff3cc8' });
    }
  }

  /* ---- Spawns: spread around the whole globe, never inside geometry ---- */
  const spawns = [];
  const bodyHit = d => {
    const P = add(surf(d), mul(d, 0.9));
    return nearObbs(sph, P).some(o => { const l = [dot(sub(P, o.c), o.ax[0]), dot(sub(P, o.c), o.ax[1]), dot(sub(P, o.c), o.ax[2])]; return Math.abs(l[0]) < o.he[0] + 1.6 && Math.abs(l[1]) < o.he[1] + 1.6 && Math.abs(l[2]) < o.he[2] + 1.6; });
  };
  indexObbs(sph);
  const rings = [[0, 12], [0.55, 8], [-0.55, 8], [0.95, 4], [-0.95, 4]];
  for (const [lat, count] of rings) {
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 14; tries++) {
        const lon = ((i + (tries ? rnd() * 0.5 : 0)) / count) * Math.PI * 2, la = lat + (tries ? (rnd() - 0.5) * 0.25 : 0);
        const d = norm([Math.cos(la) * Math.cos(lon), Math.sin(la), Math.cos(la) * Math.sin(lon)]);
        if (bodyHit(d) || roadDistance(sph, d) < ROAD_HALF + 0.5 && false) continue;
        const p = add(surf(d), mul(d, 0.06)), up = d, ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const h = norm(cross(up, cross(ref, up)));      // tangent toward the equator ring's walking direction
        spawns.push({ x: p[0], y: p[1], z: p[2], dir: d, h, team: d[2] >= 0.15 ? 'red' : d[2] <= -0.15 ? 'blue' : undefined });
        break;
      }
    }
  }
  for (const s of spawns) if (!s.team) delete s.team;

  /* ---- Objectives: control zone on the Command Spire plaza; a flag-style pair on the two poles ---- */
  const spireMk = markers.objectives.find(o => o.id === 'spire'), underMk = markers.objectives.find(o => o.id === 'understar');
  const objectiveAnchors = { control: { x: spireMk.p[0], y: spireMk.p[1], z: spireMk.p[2], s: 1 } };

  indexObbs(sph);
  return { sph, inst, spawns, markers, objectiveAnchors, metrics, underMk };
}

/* ---------- validation: every spawn and objective is reachable on foot ---------- */

/* Fibonacci-sphere sample graph. A sample is free when no solid box (taller than a step) covers it. */
function reachability(sph, spawns, markers) {
  const N = 5200, R = sph.R, pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * ga;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  const blocked = pts.map(d => {
    const P = add(surfacePoint(sph, d), mul(d, 0.9));
    for (const o of nearObbs(sph, P)) {
      if (o.tag === 'ramp' || o.tag === 'pad' || o.tag === 'catwalk' || o.tag === 'deck' || o.tag === 'plaza') continue;
      const l = [dot(sub(P, o.c), o.ax[0]), dot(sub(P, o.c), o.ax[1]), dot(sub(P, o.c), o.ax[2])];
      if (Math.abs(l[0]) < o.he[0] + 0.45 && Math.abs(l[1]) < o.he[1] && Math.abs(l[2]) < o.he[2] + 0.45) return true;
    }
    return false;
  });
  // Neighbour grid by cube hashing the unit sphere at ~ 4 m resolution.
  const cell = 4.2 / R, grid = new Map();
  const key = d => `${Math.floor(d[0] / cell)},${Math.floor(d[1] / cell)},${Math.floor(d[2] / cell)}`;
  pts.forEach((d, i) => { const k = key(d); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const nearest = d => { let b = -1, bd = Infinity; for (let i = 0; i < N; i++) { if (blocked[i]) continue; const e = (pts[i][0] - d[0]) ** 2 + (pts[i][1] - d[1]) ** 2 + (pts[i][2] - d[2]) ** 2; if (e < bd) { bd = e; b = i; } } return b; };
  const start = nearest(spawns[0].dir);
  const seen = new Uint8Array(N); const q = [start]; seen[start] = 1;
  const reach = (4.6 / R) ** 2;
  while (q.length) {
    const i = q.pop(), d = pts[i], cx = Math.floor(d[0] / cell), cy = Math.floor(d[1] / cell), cz = Math.floor(d[2] / cell);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const l = grid.get(`${cx + x},${cy + y},${cz + z}`); if (!l) continue;
      for (const j of l) if (!seen[j] && !blocked[j] && (pts[j][0] - d[0]) ** 2 + (pts[j][1] - d[1]) ** 2 + (pts[j][2] - d[2]) ** 2 < reach) { seen[j] = 1; q.push(j); }
    }
  }
  let free = 0, ok = 0;
  for (let i = 0; i < N; i++) if (!blocked[i]) { free++; if (seen[i]) ok++; }
  const targets = [...spawns.map(s => s.dir), ...markers.objectives.map(m => m.dir)];
  const unreachable = targets.filter(d => !seen[nearest(d)]).length;
  return { free, reached: ok, ratio: free ? ok / free : 0, unreachable };
}

function layoutHash(sph, spawns, anchors) {
  let h = 2166136261 >>> 0;
  const feed = n => { const v = Math.round(n * 100) | 0; h = Math.imul(h ^ (v & 0xff), 16777619); h = Math.imul(h ^ ((v >>> 8) & 0xff), 16777619); h = Math.imul(h ^ ((v >>> 16) & 0xff), 16777619); };
  for (const o of sph.obbs) { o.c.forEach(feed); o.he.forEach(feed); o.ax[1].forEach(feed); }
  for (const s of spawns) { feed(s.x); feed(s.y); feed(s.z); }
  feed(anchors.control.x); feed(anchors.control.y); feed(anchors.control.z);
  return (h >>> 0).toString(16);
}

const MAX_ATTEMPTS = 6;

/* Public entry: returns a playable world object understood by HostGame, GuestSession and the view. */
export function generateMicroPlanet({ seed = 0, preset = 'medium', radius, buildings, vegetation, cover, roughness = 1, generatorVersion = MICRO_GENERATOR_VERSION } = {}) {
  if (generatorVersion !== MICRO_GENERATOR_VERSION) throw Error(`Microverse generator v${generatorVersion} is not supported by this build (v${MICRO_GENERATOR_VERSION}).`);
  const pr = MICRO_PRESETS[preset] || MICRO_PRESETS.medium;
  const cfgBase = { radius: radius ?? pr.radius, buildings: buildings ?? pr.buildings, vegetation: vegetation ?? pr.vegetation, cover: cover ?? pr.cover, roughness };
  const base = norm32(seed);
  let built = null, used = base, report = null;
  for (let i = 0; i < MAX_ATTEMPTS && !built; i++) {
    const w = buildWorld({ ...cfgBase, seed: base + i });
    const rep = reachability(w.sph, w.spawns, w.markers);
    if (rep.unreachable === 0 && rep.ratio > 0.9 && w.spawns.length >= 16) { built = w; used = base + i; report = rep; }
    else if (!built && i === MAX_ATTEMPTS - 1) { built = w; used = base + i; report = rep; }
  }
  const { sph, inst, spawns, markers, objectiveAnchors, metrics } = built;
  return {
    id: MICRO_MAP_ID, theme: 'micro', sphere: sph, instances: inst, boxes: [], visuals: [], barrels: [], jumpPads: [], hazards: [],
    killY: -1e9, spawns, objectiveAnchors, markers, sky: '#05060f', fog: '#0a0d22',
    planet: { seed: used, requestedSeed: base, generatorVersion: MICRO_GENERATOR_VERSION, radius: cfgBase.radius, preset },
    layoutHash: layoutHash(sph, spawns, objectiveAnchors),
    metrics: { ...metrics, obbs: sph.obbs.length, instances: inst.length, spawns: spawns.length, reachRatio: +report.ratio.toFixed(3), unreachable: report.unreachable },
    getSurface: () => 'concrete',
  };
}

export { groundRadius };
