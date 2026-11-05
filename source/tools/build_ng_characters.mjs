/* Generates the four Spectre Orbit Next Gen bodies as rigged, animated GLBs.
   node tools/build_ng_characters.mjs   (or: npm run build:characters)

   Every body is built by the same part list, so all four share: joint names/hierarchy (the
   17 joints used by the legacy roster), animation clip names, vertex layout per part and the
   UV layout in src/ng_bodies.js. Only proportions differ. Output: assets/characters_ng/*.glb */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { NG_BODIES, NG_UV, NG_ATLAS_SIZE, ARM_T, LEG_T, TORSO_T, paintNgAtlas } from '../src/ng_bodies.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'assets', 'characters_ng');

export const JOINTS = ['Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'UpperArm.L', 'Forearm.L', 'Hand.L', 'UpperArm.R', 'Forearm.R', 'Hand.R',
  'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R'];
const PARENT = { Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  'UpperArm.L': 'Chest', 'Forearm.L': 'UpperArm.L', 'Hand.L': 'Forearm.L',
  'UpperArm.R': 'Chest', 'Forearm.R': 'UpperArm.R', 'Hand.R': 'Forearm.R',
  'UpperLeg.L': 'Hips', 'LowerLeg.L': 'UpperLeg.L', 'Foot.L': 'LowerLeg.L',
  'UpperLeg.R': 'Hips', 'LowerLeg.R': 'UpperLeg.R', 'Foot.R': 'LowerLeg.R' };
const J = Object.fromEntries(JOINTS.map((n, i) => [n, i]));

/* ---------- vector helpers ---------- */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ---------- mesh builder: flat-shaded, every triangle owns its vertices ---------- */
class MeshBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.jnt = []; this.wgt = []; }
  tri(a, b, c, outward) {   // a/b/c = { p, uv, w: [[joint, weight], ...] }
    let n = norm(cross(sub(b.p, a.p), sub(c.p, a.p)));
    if (outward && dot(n, outward) < 0) { [b, c] = [c, b]; n = mul(n, -1); }
    for (const v of [a, b, c]) {
      this.pos.push(...v.p); this.nrm.push(...n); this.uv.push(...v.uv);
      const w = v.w.slice(0, 4); while (w.length < 4) w.push([0, 0]);
      const sum = w.reduce((s, x) => s + x[1], 0) || 1;
      this.jnt.push(...w.map(x => x[0])); this.wgt.push(...w.map(x => x[1] / sum));
    }
  }
  get count() { return this.pos.length / 3; }
}

/* Lofts rings into a tube. ring = { c, rx, rz, t, w, fb?, bb? }; basis = [a, b] where the ring
   point at angle φ is c + a·rx·sinφ − b·rz·cosφ (φ = 0 back, φ = π front/u = 0.5).
   phi = [φ0, φ1] for open shells. caps: 'start' | 'end' | 'both'. */
function loft(mb, rings, { region, sides = 8, basis = [[1, 0, 0], [0, 0, 1]], phi = [0, Math.PI * 2], caps = 'none', tScale = [0, 1] }) {
  const inset = 2.5 / NG_ATLAS_SIZE;   // keep bilinear/mip sampling inside the region
  const [u0, v0, u1, v1] = NG_UV[region].map((x, i) => x + (i < 2 ? inset : -inset));
  const closed = phi[1] - phi[0] >= Math.PI * 2 - 1e-6;
  const pts = rings.map(r => {
    const row = [];
    for (let j = 0; j <= sides; j++) {
      const f = j / sides, a = phi[0] + (phi[1] - phi[0]) * f;
      const cz = -Math.cos(a), frontSide = cz > 0;
      const bulge = 1 + (frontSide ? (r.fb || 0) : (r.bb || 0)) * cz * cz;
      const p = add(add(r.c, mul(basis[0], r.rx * Math.sin(a))), mul(basis[1], r.rz * cz * bulge));
      const tt = (r.t - tScale[0]) / (tScale[1] - tScale[0]);
      row.push({ p, uv: [lerp(u0, u1, f), lerp(v0, v1, Math.min(1, Math.max(0, tt)))], w: r.w, axis: r.c });
    }
    return row;
  });
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = pts[i][j], b = pts[i][j + 1], c = pts[i + 1][j + 1], d = pts[i + 1][j];
      const mid = mul(add(add(a.p, b.p), add(c.p, d.p)), 0.25);
      const out = sub(mid, lerp3(a.axis, d.axis, 0.5));
      mb.tri(a, b, c, out); mb.tri(a, c, d, out);
    }
  }
  const cap = (row, other) => {
    const ctr = mul(row.slice(0, sides).reduce((s, v) => add(s, v.p), [0, 0, 0]), 1 / sides);
    const out = sub(ctr, other);
    const cuv = [row.reduce((s, v) => s + v.uv[0], 0) / row.length, row[0].uv[1]];
    const centre = { p: ctr, uv: cuv, w: row[0].w };
    for (let j = 0; j < sides; j++) mb.tri(centre, row[j], row[j + 1], out);
  };
  if (closed && (caps === 'start' || caps === 'both')) cap(pts[0], rings[1].c);
  if (closed && (caps === 'end' || caps === 'both')) cap(pts[pts.length - 1], rings[rings.length - 2].c);
}

const W = (...pairs) => pairs.map(([n, w]) => [J[n], w]);

/* ---------- one body ---------- */
function buildBody(b) {
  const H = b.height, hs = H / 1.8, fem = b.bust > 0;
  const mb = new MeshBuilder();
  const jp = {};   // joint world positions

  // Spine column
  jp.Hips = [0, 0.52 * H, 0];
  jp.Spine = [0, 0.6 * H, 0];
  jp.Chest = [0, 0.7 * H, 0];
  jp.Neck = [0, 0.83 * H, 0];
  const hh = 0.128 * H, headTop = H, chinY = H - hh;
  jp.Head = [0, chinY + 0.01, 0];

  // Torso (t follows the painter's TORSO_T)
  const [cx, cz] = b.chestR, [wx, wz] = b.waistR, [hx, hz] = b.hipR;
  loft(mb, [
    { t: 0, c: [0, 0.835 * H, -0.005], rx: 0.065 * hs, rz: 0.055 * hs, w: W(['Chest', 0.5], ['Neck', 0.5]) },
    { t: 0.07, c: [0, 0.815 * H, 0], rx: b.shoulder, rz: cz * 0.85, w: W(['Chest', 1]) },
    { t: TORSO_T.chest, c: [0, 0.755 * H, 0.005], rx: cx, rz: cz, fb: b.bust, w: W(['Chest', 1]) },
    { t: 0.4, c: [0, 0.69 * H, 0], rx: lerp(cx, wx, 0.55), rz: lerp(cz, wz, 0.5), fb: b.bust * 0.3, w: W(['Chest', 0.5], ['Spine', 0.5]) },
    { t: TORSO_T.waist, c: [0, 0.625 * H, 0], rx: wx, rz: wz, w: W(['Spine', 1]) },
    { t: TORSO_T.belt, c: [0, 0.578 * H, 0], rx: lerp(wx, hx, 0.6), rz: lerp(wz, hz, 0.6), w: W(['Spine', 0.4], ['Hips', 0.6]) },
    { t: 0.82, c: [0, 0.525 * H, -0.005], rx: hx, rz: hz, bb: b.glute, w: W(['Hips', 1]) },
    { t: 1, c: [0, 0.47 * H, 0], rx: hx * 0.72, rz: hz * 0.7, w: W(['Hips', 1]) },
  ], { region: 'torso', sides: 12, caps: 'both' });

  // Neck
  loft(mb, [
    { t: 0, c: [0, chinY + 0.02, -0.01], rx: 0.048 * hs, rz: 0.05 * hs, w: W(['Head', 0.6], ['Neck', 0.4]) },
    { t: 1, c: [0, 0.83 * H, -0.005], rx: 0.058 * hs, rz: 0.055 * hs, w: W(['Neck', 0.7], ['Chest', 0.3]) },
  ], { region: 'neck', sides: 8 });

  // Head: t = 0 crown … 1 chin (eyes ≈ 0.47, mouth ≈ 0.74 in the painter)
  const hsF = hs * (fem ? 0.93 : 1);
  const headRing = (t, rx, rz, dz = 0) => ({ t, c: [0, headTop - t * hh, 0.012 * hs + dz], rx: rx * hsF, rz: rz * hsF, w: W(['Head', 1]) });
  const headRings = [headRing(0, 0.015, 0.015), headRing(0.08, 0.058, 0.064), headRing(0.2, 0.086, 0.098), headRing(0.35, 0.094, 0.106),
    headRing(0.5, 0.093, 0.104, 0.004), headRing(0.62, 0.088, 0.1, 0.006), headRing(0.75, 0.078, 0.092, 0.006),
    headRing(0.88, fem ? 0.055 : 0.064, 0.078, 0.008), headRing(1, fem ? 0.026 : 0.036, 0.042, 0.016)];
  loft(mb, headRings, { region: 'head', sides: 12, caps: 'both' });

  // Nose: a faceted wedge on the face
  {
    const zf = 0.012 * hs + 0.104 * hsF;
    const top = { p: [0, headTop - 0.5 * hh, zf - 0.004], uv: [0.69, 0.16], w: W(['Head', 1]) };
    const l = { p: [-0.018 * hsF, headTop - 0.66 * hh, zf - 0.002], uv: [0.64, 0.28], w: W(['Head', 1]) };
    const r = { p: [0.018 * hsF, headTop - 0.66 * hh, zf - 0.002], uv: [0.74, 0.28], w: W(['Head', 1]) };
    const tip = { p: [0, headTop - 0.64 * hh, zf + 0.026 * hsF], uv: [0.69, 0.24], w: W(['Head', 1]) };
    mb.tri(top, l, tip, [-0.5, 0, 1]); mb.tri(top, tip, r, [0.5, 0, 1]); mb.tri(l, r, tip, [0, -1, 0.3]);
  }
  // Ears
  for (const s of [-1, 1]) {
    const x = s * 0.094 * hsF, y = headTop - 0.52 * hh, z = 0.0;
    loft(mb, [
      { t: 0, c: [x, y + 0.03 * hs, z], rx: 0.012 * hs, rz: 0.022 * hs, w: W(['Head', 1]) },
      { t: 1, c: [x + s * 0.004, y - 0.025 * hs, z], rx: 0.01 * hs, rz: 0.016 * hs, w: W(['Head', 1]) },
    ], { region: 'ears', sides: 5, caps: 'both' });
  }

  // Hair: a crown cap plus a back shell open at the face; length by style
  const hairK = b.hair === 'curl' ? 1.14 : 1.08;
  const hairRing = (t, k = hairK, dz = -0.006) => {
    const src = headRings.reduce((best, r) => Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best, headRings[0]);
    const y = headTop - t * hh + (t < 0.05 ? 0.012 : 0.006);
    return { t, c: [0, y, src.c[2] + dz], rx: Math.max(0.02 * hs, src.rx * k), rz: Math.max(0.02 * hs, src.rz * k), w: W(['Head', 1]) };
  };
  loft(mb, [hairRing(0), hairRing(0.08), hairRing(0.2), hairRing(0.28)], { region: 'hair', sides: 12, caps: 'start' });
  const backEnd = { crop: 0.52, curl: 0.56, bob: 0.86, long: 1.0 }[b.hair];
  const back = [hairRing(0.24), hairRing(0.4), hairRing(backEnd * 0.8)];
  back.push(hairRing(backEnd));
  if (b.hair === 'long') {   // drape down to the shoulder blades
    back.push({ t: 1.3, c: [0, 0.82 * H, -0.04 * hs], rx: 0.12 * hs, rz: 0.08 * hs, w: W(['Neck', 0.6], ['Head', 0.4]) });
    back.push({ t: 1.6, c: [0, 0.76 * H, -0.06 * hs], rx: 0.11 * hs, rz: 0.06 * hs, w: W(['Chest', 0.7], ['Neck', 0.3]) });
  }
  const openFace = b.hair === 'crop' || b.hair === 'curl' ? 0.62 : 0.7;
  loft(mb, back, { region: 'hair', sides: 10, phi: [-Math.PI * openFace, Math.PI * openFace], tScale: [0.24, b.hair === 'long' ? 1.6 : backEnd] });

  // Arms
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const sh = [s * (b.shoulder - 0.015), 0.815 * H, -0.005];
    const el = add(sh, [s * 0.05, -0.19 * H, -0.01]);
    const wr = add(el, [s * 0.02, -0.15 * H, 0.02]);
    const tip = add(wr, [s * 0.006, -0.1 * H, 0.012]);
    jp[`UpperArm.${side}`] = sh; jp[`Forearm.${side}`] = el; jp[`Hand.${side}`] = wr;
    const L = b.limb, UA = `UpperArm.${side}`, FA = `Forearm.${side}`, HA = `Hand.${side}`;
    const at = t => t <= ARM_T.elbow ? lerp3(sh, el, t / ARM_T.elbow) : t <= ARM_T.wrist ? lerp3(el, wr, (t - ARM_T.elbow) / (ARM_T.wrist - ARM_T.elbow)) : lerp3(wr, tip, (t - ARM_T.wrist) / (1 - ARM_T.wrist));
    loft(mb, [
      { t: 0, c: add(at(0), [0, 0.02, 0]), rx: 0.062 * L * hs, rz: 0.066 * L * hs, w: W(['Chest', 0.4], [UA, 0.6]) },
      { t: 0.18, c: at(0.18), rx: 0.06 * L * hs, rz: 0.06 * L * hs, w: W([UA, 1]) },
      { t: ARM_T.elbow, c: at(ARM_T.elbow), rx: 0.048 * L * hs, rz: 0.048 * L * hs, w: W([UA, 0.5], [FA, 0.5]) },
      { t: 0.6, c: at(0.6), rx: 0.05 * L * hs, rz: 0.048 * L * hs, w: W([FA, 1]) },
      { t: ARM_T.wrist, c: at(ARM_T.wrist), rx: 0.034 * hs, rz: 0.03 * hs, w: W([FA, 0.5], [HA, 0.5]) },
      { t: 0.9, c: at(0.9), rx: 0.026 * hs, rz: 0.048 * hs, w: W([HA, 1]) },
      { t: 1, c: at(1), rx: 0.014 * hs, rz: 0.03 * hs, w: W([HA, 1]) },
    ], { region: 'arm', sides: 8, caps: 'end' });
  }

  // Legs
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const hip = [s * hx * 0.5, 0.5 * H, 0];
    const knee = [s * hx * 0.46, 0.275 * H, 0.012];
    const ankle = [s * hx * 0.44, 0.05 * H, -0.012];
    jp[`UpperLeg.${side}`] = hip; jp[`LowerLeg.${side}`] = knee; jp[`Foot.${side}`] = ankle;
    const UL = `UpperLeg.${side}`, LL = `LowerLeg.${side}`, FT = `Foot.${side}`, L = b.limb;
    const at = t => t <= LEG_T.knee ? lerp3(hip, knee, t / LEG_T.knee) : lerp3(knee, ankle, (t - LEG_T.knee) / (1 - LEG_T.knee));
    const thigh = fem ? 0.1 : 0.095;
    loft(mb, [
      { t: 0, c: add(at(0), [0, 0.02, 0]), rx: hx * 0.52, rz: hz * 0.9, w: W(['Hips', 0.5], [UL, 0.5]) },
      { t: 0.18, c: at(0.18), rx: thigh * L * hs, rz: thigh * L * hs, w: W([UL, 1]) },
      { t: LEG_T.knee, c: at(LEG_T.knee), rx: 0.062 * L * hs, rz: 0.064 * L * hs, w: W([UL, 0.5], [LL, 0.5]) },
      { t: 0.68, c: at(0.68), rx: 0.066 * L * hs, rz: 0.066 * L * hs, bb: 0.25, w: W([LL, 1]) },
      { t: 1, c: at(1), rx: 0.045 * hs, rz: 0.045 * hs, w: W([LL, 0.6], [FT, 0.4]) },
    ], { region: 'leg', sides: 8 });
    // Foot runs along +Z; the ring's "front" (u = 0.5) faces up
    const fy = ankle[1];
    loft(mb, [
      { t: 0, c: [ankle[0], fy * 0.55, -0.045 * hs], rx: 0.042 * hs, rz: fy * 0.55, w: W([FT, 1]) },
      { t: 0.4, c: [ankle[0], fy * 0.5, 0.04 * hs], rx: 0.048 * hs, rz: fy * 0.5, w: W([FT, 1]) },
      { t: 0.8, c: [ankle[0], fy * 0.4, 0.13 * hs], rx: 0.048 * hs, rz: fy * 0.4, w: W([FT, 1]) },
      { t: 1, c: [ankle[0], fy * 0.32, 0.17 * hs], rx: 0.034 * hs, rz: fy * 0.3, w: W([FT, 1]) },
    ], { region: 'foot', sides: 8, basis: [[1, 0, 0], [0, -1, 0]], caps: 'both' });
  }

  return { mb, jp };
}

/* ---------- animation ---------- */
const DEG = Math.PI / 180;
function quat([x, y, z]) {   // XYZ intrinsic, degrees
  const [cx, sx] = [Math.cos(x * DEG / 2), Math.sin(x * DEG / 2)];
  const [cy, sy] = [Math.cos(y * DEG / 2), Math.sin(y * DEG / 2)];
  const [cz, sz] = [Math.cos(z * DEG / 2), Math.sin(z * DEG / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
const S = p => Math.sin(p * Math.PI * 2);

/* Pose functions: phase p ∈ [0,1] → { joint: [rx, ry, rz] degrees, hips: [dx, dy, dz] metres·H }.
   Rest pose: arms hang, legs straight. +rx tips a downward limb backwards. */
const CLIPS = {
  idle: { dur: 2.4, loop: true, pose: p => ({ Chest: [1.5 * S(p), 0, 0], Head: [-1 * S(p), 2 * S(p / 2), 0], 'UpperArm.L': [2 * S(p), 0, 5], 'UpperArm.R': [2 * S(p), 0, -5], 'Forearm.L': [-10, 0, 0], 'Forearm.R': [-10, 0, 0], hips: [0, -0.003 * (1 + S(p)), 0] }) },
  walk: { dur: 1.0, loop: true, pose: p => ({
    'UpperLeg.L': [-24 * S(p), 0, 0], 'UpperLeg.R': [24 * S(p), 0, 0],
    'LowerLeg.L': [28 * Math.max(0, S(p + 0.25)) + 4, 0, 0], 'LowerLeg.R': [28 * Math.max(0, S(p + 0.75)) + 4, 0, 0],
    'Foot.L': [8 * S(p), 0, 0], 'Foot.R': [-8 * S(p), 0, 0],
    'UpperArm.L': [18 * S(p), 0, 5], 'UpperArm.R': [-18 * S(p), 0, -5], 'Forearm.L': [-18, 0, 0], 'Forearm.R': [-18, 0, 0],
    Spine: [3, 4 * S(p), 0], Hips: [0, -5 * S(p), 0], hips: [0, -0.012 * Math.abs(Math.cos(p * Math.PI * 2)), 0] }) },
  run: { dur: 0.66, loop: true, pose: p => ({
    'UpperLeg.L': [-44 * S(p) - 8, 0, 0], 'UpperLeg.R': [44 * S(p) - 8, 0, 0],
    'LowerLeg.L': [70 * Math.max(0, S(p + 0.3)) + 18, 0, 0], 'LowerLeg.R': [70 * Math.max(0, S(p + 0.8)) + 18, 0, 0],
    'UpperArm.L': [38 * S(p), 0, 8], 'UpperArm.R': [-38 * S(p), 0, -8], 'Forearm.L': [-75, 0, 0], 'Forearm.R': [-75, 0, 0],
    Spine: [12, 6 * S(p), 0], Hips: [0, -8 * S(p), 0], hips: [0, -0.02 - 0.02 * Math.abs(Math.cos(p * Math.PI * 2)), 0] }) },
  crouch: { dur: 2.0, loop: true, pose: p => ({
    'UpperLeg.L': [-72, 0, -4], 'UpperLeg.R': [-72, 0, 4], 'LowerLeg.L': [112, 0, 0], 'LowerLeg.R': [112, 0, 0], 'Foot.L': [-40, 0, 0], 'Foot.R': [-40, 0, 0],
    Spine: [18 + 1.5 * S(p), 0, 0], Chest: [6, 0, 0], Head: [-20, 0, 0],
    'UpperArm.L': [-25, 0, 8], 'UpperArm.R': [-25, 0, -8], 'Forearm.L': [-50, 0, 0], 'Forearm.R': [-50, 0, 0], hips: [0, -0.2, -0.06] }) },
  crouch_walk: { dur: 1.2, loop: true, pose: p => ({
    'UpperLeg.L': [-72 - 14 * S(p), 0, -4], 'UpperLeg.R': [-72 + 14 * S(p), 0, 4], 'LowerLeg.L': [112 + 10 * S(p), 0, 0], 'LowerLeg.R': [112 - 10 * S(p), 0, 0], 'Foot.L': [-40, 0, 0], 'Foot.R': [-40, 0, 0],
    Spine: [20, 3 * S(p), 0], Head: [-22, 0, 0],
    'UpperArm.L': [-25 + 8 * S(p), 0, 8], 'UpperArm.R': [-25 - 8 * S(p), 0, -8], 'Forearm.L': [-50, 0, 0], 'Forearm.R': [-50, 0, 0], hips: [0, -0.2, -0.06] }) },
  die: { dur: 1.2, loop: false, pose: p => {
    const k = Math.min(1, p * 1.25), e = k * k * (3 - 2 * k), buckle = Math.sin(Math.min(1, p * 2) * Math.PI);
    return { Hips: [-88 * e, 0, 0], 'UpperLeg.L': [-30 * buckle, 0, -6 * e], 'UpperLeg.R': [-24 * buckle, 0, 6 * e], 'LowerLeg.L': [50 * buckle, 0, 0], 'LowerLeg.R': [40 * buckle, 0, 0],
      'UpperArm.L': [0, 0, 60 * e], 'UpperArm.R': [0, 0, -60 * e], 'Forearm.L': [-20 * e, 0, 0], 'Forearm.R': [-20 * e, 0, 0], Head: [10 * e, 0, 0],
      hips: [0, -0.43 * e, -0.05 * e] };
  } },
};
CLIPS.death = CLIPS.die;

/* ---------- glTF writer ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function buildGlb(body) {
  const { mb, jp } = buildBody(body);
  const H = body.height;
  const chunks = []; let offset = 0;
  const bufferViews = [], accessors = [];
  const pushView = (buf, target) => {
    while (offset % 4) { chunks.push(Buffer.alloc(1)); offset++; }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf); offset += buf.length;
    return bufferViews.length - 1;
  };
  const accessor = (arr, type, compType, target, extra = {}) => {
    const Ctor = compType === 5126 ? Float32Array : compType === 5123 ? Uint16Array : Uint8Array;
    const typed = new Ctor(arr);
    const bv = pushView(Buffer.from(typed.buffer), target);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    accessors.push({ bufferView: bv, componentType: compType, count: typed.length / n, type, ...extra });
    return accessors.length - 1;
  };
  const minmax = (arr, n) => { const mn = Array(n).fill(Infinity), mx = Array(n).fill(-Infinity); for (let i = 0; i < arr.length; i++) { const k = i % n; mn[k] = Math.min(mn[k], arr[i]); mx[k] = Math.max(mx[k], arr[i]); } return { min: mn, max: mx }; };

  const POS = accessor(mb.pos, 'VEC3', 5126, 34962, minmax(mb.pos, 3));
  const NRM = accessor(mb.nrm, 'VEC3', 5126, 34962);
  const UV = accessor(mb.uv, 'VEC2', 5126, 34962);
  const JNT = accessor(mb.jnt, 'VEC4', 5123, 34962);
  const WGT = accessor(mb.wgt, 'VEC4', 5126, 34962);

  // Nodes: 0 Armature, 1 mesh, 2.. joints
  const jointNode = n => 2 + J[n];
  const nodes = [{ name: 'Armature', children: [1, jointNode('Hips')] }, { name: `${body.code}_mesh`, mesh: 0, skin: 0 }];
  const restLocal = {};
  for (const n of JOINTS) {
    const parent = PARENT[n];
    restLocal[n] = parent ? sub(jp[n], jp[parent]) : jp[n];
    const children = JOINTS.filter(c => PARENT[c] === n).map(jointNode);
    nodes.push({ name: n, translation: restLocal[n], ...(children.length ? { children } : {}) });
  }
  const ibm = [];
  for (const n of JOINTS) { const p = jp[n]; ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1); }
  const IBM = accessor(ibm, 'MAT4', 5126);

  // Texture
  const atlas = paintNgAtlas(body.id, {}, NG_ATLAS_SIZE);
  const imgView = pushView(png(atlas, NG_ATLAS_SIZE, NG_ATLAS_SIZE));

  // Animations
  const animations = [];
  for (const [name, clip] of Object.entries(CLIPS)) {
    const keys = clip.loop ? 16 : 24;
    const times = Array.from({ length: keys + 1 }, (_, i) => (i / keys) * clip.dur);
    const input = accessor(times, 'SCALAR', 5126, undefined, { min: [0], max: [clip.dur] });
    const samplers = [], channels = [];
    const poses = times.map((_, i) => clip.pose(clip.loop ? (i % keys) / keys : i / keys));
    for (const n of JOINTS) {
      const rot = poses.flatMap(p => quat(p[n] || [0, 0, 0]));
      samplers.push({ input, output: accessor(rot, 'VEC4', 5126), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: jointNode(n), path: 'rotation' } });
    }
    const tr = poses.flatMap(p => add(restLocal.Hips, mul(p.hips || [0, 0, 0], H)));
    samplers.push({ input, output: accessor(tr, 'VEC3', 5126), interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: jointNode('Hips'), path: 'translation' } });
    animations.push({ name, samplers, channels });
  }

  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'Spectre Orbit build_ng_characters.mjs' },
    scene: 0, scenes: [{ nodes: [0] }], nodes,
    meshes: [{ name: `${body.code}_mesh`, primitives: [{ attributes: { POSITION: POS, NORMAL: NRM, TEXCOORD_0: UV, JOINTS_0: JNT, WEIGHTS_0: WGT }, material: 0 }] }],
    skins: [{ name: 'ng_rig', joints: JOINTS.map(jointNode), inverseBindMatrices: IBM, skeleton: jointNode('Hips') }],
    materials: [{ name: 'ng_atlas', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: imgView, mimeType: 'image/png' }],
    animations, accessors, bufferViews, buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return { glb: Buffer.concat([header, jh, json, bh, binPad]), triangles: mb.count / 3, vertices: mb.count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const body of NG_BODIES) {
    const { glb, triangles } = buildGlb(body);
    const file = path.join(outDir, body.file + '.glb');
    fs.writeFileSync(file, glb);
    console.log(`  + ${path.relative(root, file)}  ${body.code}  ${triangles} tris  ${(glb.length / 1024).toFixed(0)} KB`);
  }
}
