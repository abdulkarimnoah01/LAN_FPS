/* Spherical-world simulation: the planet itself is the level.
   Pure maths, no DOM and no Babylon, so the host, the predicting clients and the Node tests
   all run the exact same code. Gravity points at the planet centre, every player has a local
   frame (up = away from the centre, heading = a tangent vector transported along the surface),
   terrain is an analytic heightfield over the sphere and structures are oriented boxes (OBBs).
   Imported by sim.js, which owns the weapon/ammo rules; this file owns movement and collision. */

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; },
};
const { add, sub, mul, dot, cross, len, norm } = V;

/* ---------- terrain ---------- */

function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177) ^ Math.imul(seed | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sstep = t => t * t * (3 - 2 * t);
function vnoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = sstep(x - ix), fy = sstep(y - iy), fz = sstep(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}

/* Relief weight 0..1: forests roll, roads and city districts stay nearly flat so routes read well. */
function reliefAt(sph, d) {
  let a = 1;
  for (const z of sph.zones) {
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(d, z.dir))));
    const w = 1 - sstep(Math.max(0, Math.min(1, (ang - z.rad * 0.75) / (z.rad * 0.4))));
    a = a * (1 - w) + z.relief * w;
  }
  for (const n of sph.roads) {
    const w = 1 - sstep(Math.max(0, Math.min(1, (Math.abs(dot(d, n)) - 0.03) / 0.04)));
    a *= 1 - 0.85 * w;
  }
  return a;
}

/* Height above the base radius for a unit direction. */
export function terrainHeight(sph, d) {
  const f = sph.R / 22;
  const n = vnoise(d[0] * f, d[1] * f, d[2] * f, sph.seed) * 0.65
    + vnoise(d[0] * f * 2.3 + 17, d[1] * f * 2.3, d[2] * f * 2.3, sph.seed + 1) * 0.35;
  return (n - 0.5) * 2 * sph.amp * reliefAt(sph, d);
}
/* Radius of the ground at a world position's direction. */
export function groundRadius(sph, P) {
  const d = norm(sub(P, sph.c));
  return sph.R + terrainHeight(sph, d);
}
export const surfacePoint = (sph, d) => add(sph.c, mul(d, sph.R + terrainHeight(sph, d)));

/* ---------- oriented boxes ---------- */

/* OBB: c centre, ax[3] orthonormal axes (ax[1] = the box's "up"), he half extents. */
export function makeObb(c, ax, he, tag = 'solid') {
  return { c, ax, he, tag, br: Math.hypot(he[0], he[1], he[2]) };
}
const toLocal = (o, p) => { const d = sub(p, o.c); return [dot(d, o.ax[0]), dot(d, o.ax[1]), dot(d, o.ax[2])]; };
const toWorldDir = (o, l) => add(add(mul(o.ax[0], l[0]), mul(o.ax[1], l[1])), mul(o.ax[2], l[2]));

const CELL = 8;
function cellKey(x, y, z) { return (Math.floor(x / CELL) + 64) * 40000 + (Math.floor(y / CELL) + 64) * 200 + (Math.floor(z / CELL) + 64); }

/* Builds the broad-phase grid once per world. Safe to call repeatedly. */
export function indexObbs(sph) {
  sph.grid = new Map();
  for (let i = 0; i < sph.obbs.length; i++) {
    const o = sph.obbs[i];
    const lo = [o.c[0] - o.br, o.c[1] - o.br, o.c[2] - o.br], hi = [o.c[0] + o.br, o.c[1] + o.br, o.c[2] + o.br];
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
          const k = cellKey(x * CELL, y * CELL, z * CELL);
          const l = sph.grid.get(k);
          if (l) l.push(i); else sph.grid.set(k, [i]);
        }
  }
}
export function nearObbs(sph, P) {
  if (!sph.grid) indexObbs(sph);
  const l = sph.grid.get(cellKey(P[0], P[1], P[2]));
  return l ? l.map(i => sph.obbs[i]) : [];
}

/* ---------- player frame ---------- */

export function upOf(sph, P) { return norm(sub(P, sph.c)); }

/* Parallel-transport style: keep the old heading's component in the new tangent plane. */
function tangent(h, up) {
  let t = sub(h, mul(up, dot(h, up)));
  if (len(t) < 1e-5) {
    const alt = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    t = sub(alt, mul(up, dot(alt, up)));
  }
  return norm(t);
}
function turn(h, up, ang) {
  if (!ang) return h;
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(mul(h, c), mul(cross(up, h), s));
}

/* Player frame: { up, fwd (heading), right }. Heading is stored on the player as hx,hy,hz. */
export function frameOf(sph, p) {
  const up = upOf(sph, [p.x, p.y, p.z]);
  const fwd = tangent([p.hx, p.hy, p.hz], up);
  return { up, fwd, right: cross(fwd, up) };
}

/* Direction a player is looking, with optional yaw/pitch offsets (spread). */
export function lookDir(sph, p, pitch = p.pitch, yawOff = 0, pitchOff = 0) {
  const f = frameOf(sph, p);
  const h = turn(f.fwd, f.up, yawOff);
  const pt = pitch + pitchOff;
  return norm(add(mul(h, Math.cos(pt)), mul(f.up, Math.sin(pt))));
}

/* Put a player on the ground at direction d, facing the tangent hint. */
export function placeOnSurface(sph, p, d, hint = [0, 0, -1]) {
  const P = add(surfacePoint(sph, d), mul(d, 0.05));
  const h = tangent(hint, d);
  Object.assign(p, { x: P[0], y: P[1], z: P[2], vx: 0, vy: 0, vz: 0, hx: h[0], hy: h[1], hz: h[2], g: true });
}

/* ---------- movement ---------- */

/* Pushes a sphere (centre S, radius r) out of an OBB. Returns the push vector or null. */
function sphereVsObb(o, S, r) {
  const l = toLocal(o, S);
  const q = [Math.max(-o.he[0], Math.min(o.he[0], l[0])), Math.max(-o.he[1], Math.min(o.he[1], l[1])), Math.max(-o.he[2], Math.min(o.he[2], l[2]))];
  const d = [l[0] - q[0], l[1] - q[1], l[2] - q[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  if (dist >= r) return null;
  if (dist > 1e-6) return toWorldDir(o, mul(d, (r - dist) / dist));
  // Centre inside the box: leave through the nearest face.
  let best = 0, bd = Infinity, sign = 1;
  for (let i = 0; i < 3; i++) {
    const dd = o.he[i] - Math.abs(l[i]);
    if (dd < bd) { bd = dd; best = i; sign = l[i] >= 0 ? 1 : -1; }
  }
  const out = [0, 0, 0]; out[best] = sign * (bd + r);
  return toWorldDir(o, out);
}

/* One fixed step of movement for a player on a sphere world. K carries the shared constants. */
export function stepMoveSphere(p, inp, world, K, curH, maxSpeed) {
  const sph = world.sphere, b = inp.b;
  let P = [p.x, p.y, p.z], Vel = [p.vx, p.vy, p.vz];
  const up = upOf(sph, P);
  if (!Number.isFinite(p.ly)) p.ly = inp.yaw;
  let H = tangent([p.hx, p.hy, p.hz], up);
  H = tangent(turn(H, up, inp.yaw - p.ly), up);
  p.ly = inp.yaw;
  const right = cross(H, up);

  const fwdIn = ((b & K.FWD) ? 1 : 0) - ((b & K.BACK) ? 1 : 0);
  const sideIn = ((b & K.RIGHT) ? 1 : 0) - ((b & K.LEFT) ? 1 : 0);
  let wish = add(mul(H, fwdIn), mul(right, sideIn));
  const wl = len(wish);
  if (wl > 0) wish = mul(wish, 1 / wl);

  let vUp = dot(Vel, up);
  let Vt = sub(Vel, mul(up, vUp));
  const a = (p.g ? K.ACCEL : K.AIR_ACCEL) * K.DT;
  const want = mul(wish, maxSpeed);
  for (let i = 0; i < 3; i++) Vt[i] += Math.max(-a, Math.min(a, want[i] - Vt[i]));
  if (p.g && (b & K.JUMP) && !p.cr) { vUp = K.JUMP_V; p.g = false; }
  vUp = Math.max(vUp - K.GRAVITY * K.DT, -40);

  // Integrate, then resolve against structures and the ground.
  P = add(P, mul(add(Vt, mul(up, vUp)), K.DT));
  let grounded = false;
  const feetUp = () => upOf(sph, P);
  const obbs = nearObbs(sph, P);

  for (const o of obbs) {
    // Standing on (or stepping up onto) a box top, in the box's own frame.
    const l = toLocal(o, P);
    const m = K.R * 0.4;
    if (Math.abs(l[0]) < o.he[0] + m && Math.abs(l[2]) < o.he[2] + m) {
      const h = l[1] - o.he[1];
      const vBoxUp = dot(add(Vt, mul(up, vUp)), o.ax[1]);
      if (h > -K.STEP && h < 0.04 && vBoxUp <= 0.5 && l[1] > -o.he[1]) {
        P = add(P, mul(o.ax[1], -h));
        grounded = true;
        const u2 = feetUp();
        if (dot(up, u2) > 0.9) { vUp = Math.max(vUp, 0); if (vUp < 0) vUp = 0; }
      }
    }
  }

  // Body spheres (waist and head) push out of walls.
  const u1 = feetUp();
  const body = curH > 1.5 ? [0.9, curH - K.R] : [Math.max(0.55, curH - K.R)];
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obbs) {
      for (const hh of body) {
        const S = add(P, mul(u1, hh));
        const push = sphereVsObb(o, S, K.R);
        if (push) {
          P = add(P, push);
          const n = norm(push), into = dot(add(Vt, mul(up, vUp)), n);
          if (into < 0) {
            const vt = dot(Vt, n);
            if (vt < 0) Vt = sub(Vt, mul(n, vt));
            const vu = dot(n, up);
            if (vu < -0.5 && vUp > 0) vUp = 0;       // bonked a ceiling
          }
        }
      }
    }
  }

  // Ground.
  const rel = sub(P, sph.c), r = len(rel), d = mul(rel, 1 / (r || 1)), gr = sph.R + terrainHeight(sph, d);
  const snap = p.g && vUp <= 0.5 ? 0.14 : 0.01;
  if (r <= gr + snap) {
    P = add(sph.c, mul(d, gr));
    if (vUp < 0) vUp = 0;
    grounded = true;
  }

  // Jump pads: launch along the pad's own up.
  for (const pad of sph.pads || []) {
    const l = toLocal(pad, P);
    if (Math.abs(l[0]) < pad.he[0] && Math.abs(l[2]) < pad.he[2] && l[1] > -pad.he[1] - 0.2 && l[1] < pad.he[1] + 1.2) {
      const pu = pad.ax[1], cu = upOf(sph, P);
      vUp = pad.boost * Math.max(0.3, dot(pu, cu));
      grounded = false;
      p.onJumpPad = true;
    }
  }

  const fin = upOf(sph, P);
  // Velocity lives in world space: re-express with the (slightly rotated) up.
  const Vw = add(Vt, mul(up, vUp));
  const vUp2 = dot(Vw, fin);
  const out = grounded ? add(sub(Vw, mul(fin, vUp2)), mul(fin, Math.max(0, vUp2))) : Vw;
  Object.assign(p, { x: P[0], y: P[1], z: P[2], vx: out[0], vy: out[1], vz: out[2], g: grounded });
  const nh = tangent(H, fin);
  p.hx = nh[0]; p.hy = nh[1]; p.hz = nh[2];
}

/* Free headroom to stand up? (head sphere against boxes) */
export function sphereStandFree(world, p, K) {
  const sph = world.sphere, P = [p.x, p.y, p.z], up = upOf(sph, P);
  const S = add(P, mul(up, K.H_STAND - K.R));
  for (const o of nearObbs(sph, P)) if (sphereVsObb(o, S, K.R)) return false;
  return true;
}

/* Fell through the world or the planet's crust. */
export function belowCrust(world, p) {
  const sph = world.sphere, P = [p.x, p.y, p.z];
  return len(sub(P, sph.c)) < groundRadius(sph, P) - 4;
}

/* ---------- rays ---------- */

function rayBoxLocal(o, d, min, max, tmax) {
  let t0 = 0, t1 = tmax;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return Infinity; continue; }
    const inv = 1 / d[i];
    let a = (min[i] - o[i]) * inv, c = (max[i] - o[i]) * inv;
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export function rayObb(o, org, dir, tmax) {
  // Cheap bounding-sphere reject first.
  const oc = sub(o.c, org), tc = dot(oc, dir);
  if (tc < -o.br || tc > tmax + o.br) return Infinity;
  const d2 = dot(oc, oc) - tc * tc;
  if (d2 > o.br * o.br) return Infinity;
  const lo = toLocal(o, org), ld = [dot(dir, o.ax[0]), dot(dir, o.ax[1]), dot(dir, o.ax[2])];
  return rayBoxLocal(lo, ld, [-o.he[0], -o.he[1], -o.he[2]], o.he, tmax);
}

/* First hit along a ray against the terrain heightfield. */
export function rayTerrain(sph, org, dir, tmax) {
  const top = sph.R + sph.amp + 0.5;
  let t = 0;
  const f = tt => { const P = add(org, mul(dir, tt)); const rel = sub(P, sph.c); const r = len(rel); return r - (sph.R + terrainHeight(sph, mul(rel, 1 / r))); };
  let prevT = 0, prevF = f(0);
  if (prevF < 0) return 0;
  while (t < tmax) {
    const P = add(org, mul(dir, t)), r = len(sub(P, sph.c));
    // High above the crust: leap ahead by the clearance.
    const step = r > top + 1 ? Math.max(0.6, (r - top) * 0.7) : 0.6;
    t = Math.min(tmax, t + step);
    const fv = f(t);
    if (fv < 0) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) hi = mid; else lo = mid; }
      return hi;
    }
    prevT = t; prevF = fv;
    if (t >= tmax) break;
  }
  return Infinity;
}

/* Nearest solid (terrain or structure) distance along a ray, or Infinity. */
export function rayWorld(world, org, dir, tmax) {
  const sph = world.sphere;
  let best = Math.min(tmax, rayTerrain(sph, org, dir, tmax));
  for (const o of sph.obbs) {
    const t = rayObb(o, org, dir, best);
    if (t < best) best = t;
  }
  return best;
}

export function sphereLOS(world, a, b) {
  const d = sub(b, a), dist = len(d);
  if (dist < 0.01) return true;
  return rayWorld(world, a, mul(d, 1 / dist), dist - 0.05) >= dist - 0.05;
}

/* ---------- combat ---------- */

/* Hitscan with the same contract as sim.castShot. K supplies the player box constants. */
export function castShotSphere(world, players, shooter, wep, rand, K) {
  const sph = world.sphere;
  const pellets = wep.pellets || 1;
  const spread = (wep.spread || 0) * (shooter.cr ? 0.7 : 1.0);
  const eyeH = shooter.cr ? K.EYE_CROUCH : K.EYE_STAND;
  const sUp = upOf(sph, [shooter.x, shooter.y, shooter.z]);
  const o = add([shooter.x, shooter.y, shooter.z], mul(sUp, eyeH));
  const pad = pellets > 1 ? K.PELLET_PAD : 0;
  const hits = [], tracers = [];
  const list = [...players];

  for (let i = 0; i < pellets; i++) {
    let yo = 0, po = 0;
    if (spread > 0 && pellets > 1) {
      const angle = rand() * Math.PI * 2, r = Math.sqrt(rand()) * spread;
      yo = Math.cos(angle) * r; po = Math.sin(angle) * r;
    } else if (spread > 0) {
      yo = (rand() - 0.5) * spread; po = (rand() - 0.5) * spread;
    }
    const d = lookDir(sph, shooter, shooter.pitch, yo, po);
    let best = wep.range || 150;
    let hit = null;
    best = rayWorld(world, o, d, best);
    for (const p of list) {
      if (p === shooter || !p.alive) continue;
      const f = frameOf(sph, p);
      const origin = [dot(sub(o, [p.x, p.y, p.z]), f.right), dot(sub(o, [p.x, p.y, p.z]), f.up), dot(sub(o, [p.x, p.y, p.z]), f.fwd)];
      const ld = [dot(d, f.right), dot(d, f.up), dot(d, f.fwd)];
      const h = p.cr ? K.H_CROUCH : K.H_STAND, hs = p.cr ? K.HEAD_CROUCH : K.HEAD_STAND;
      const rb = K.R + pad, rh = 0.22 + pad;
      const th = rayBoxLocal(origin, ld, [-rh, hs, -rh], [rh, h + 0.05, rh], best);
      if (th < best) { best = th; hit = { id: p.id, head: true }; }
      const tb = rayBoxLocal(origin, ld, [-rb, 0, -rb], [rb, hs, rb], best);
      if (tb < best) { best = tb; hit = { id: p.id, head: false }; }
      if (hit && hit.id === p.id && wep.melee) {
        const ft = frameOf(sph, shooter);
        if (dot(f.fwd, ft.fwd) > 0.27) { hit.head = true; hit.backstab = true; }
      }
    }
    tracers.push({ from: o, to: add(o, mul(d, best === Infinity ? (wep.range || 150) : best)) });
    if (hit) hits.push(hit);
  }
  return { from: o, to: tracers[0].to, tracers, hits, hit: hits[0] || null };
}

/* Grenade: radial gravity, bounces off terrain and boxes. Mutates and returns g. */
export function stepGrenadeSphere(g, world, G) {
  const sph = world.sphere;
  let P = [g.x, g.y, g.z], Vel = [g.vx, g.vy, g.vz];
  const up = upOf(sph, P);
  Vel = sub(Vel, mul(up, G.gravity * G.dt));
  P = add(P, mul(Vel, G.dt));
  for (const o of nearObbs(sph, P)) {
    const push = sphereVsObb(o, P, G.radius);
    if (push) {
      P = add(P, push);
      const n = norm(push), vn = dot(Vel, n);
      if (vn < 0) Vel = sub(Vel, mul(n, vn * 1.55));
      Vel = mul(Vel, 0.8);
    }
  }
  const rel = sub(P, sph.c), r = len(rel), d = mul(rel, 1 / r), gr = sph.R + terrainHeight(sph, d) + G.radius;
  if (r < gr) {
    P = add(sph.c, mul(d, gr));
    const vn = dot(Vel, d);
    if (vn < 0) Vel = sub(Vel, mul(d, vn * 1.45));
    Vel = mul(Vel, 0.72);
    if (Math.abs(dot(Vel, d)) < 0.8) Vel = sub(Vel, mul(d, dot(Vel, d)));
  }
  g.x = P[0]; g.y = P[1]; g.z = P[2]; g.vx = Vel[0]; g.vy = Vel[1]; g.vz = Vel[2];
  return g;
}

/* Player-to-point distance helper for explosions: straight 3D, which already respects the curve. */
export const dist3 = (a, b) => len(sub(a, b));

/* Speed along the surface (what footsteps, bob and run/walk animation care about). */
export function tangentSpeed(sph, p) {
  const up = upOf(sph, [p.x, p.y, p.z]), v = [p.vx || 0, p.vy || 0, p.vz || 0];
  return len(sub(v, mul(up, dot(v, up))));
}
