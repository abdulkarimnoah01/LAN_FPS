// Operation Microverse: spherical gravity, movement, collision, combat and generation.
import assert from 'node:assert/strict';
import { generateMicroPlanet } from '../src/micro_planet.js';
import { newPlayer, stepPlayer, castShot, stepGrenade, B, DT, GRENADE } from '../src/sim.js';
import { V, upOf, frameOf, groundRadius, placeOnSurface, surfacePoint } from '../src/sphere_sim.js';
import { HostGame } from '../src/hostgame.js';

const world = generateMicroPlanet({ seed: 7 });
const sph = world.sphere;
console.log('Running microverse sphere tests...');

const fresh = (d, hint) => { const p = newPlayer('t', 'T', 0); placeOnSurface(sph, p, d, hint); p.alive = true; p.w = 5; p.ammos = [30, 8, 5, 40, 75, 1]; return p; };
const input = (p, b, yaw = p.yaw, pitch = 0) => ({ seq: ++p.seq, b, yaw, pitch, w: p.w });
const onGround = p => Math.abs(V.len(V.sub([p.x, p.y, p.z], sph.c)) - groundRadius(sph, [p.x, p.y, p.z])) < 0.5;

/* 1. The planet is closed and every spawn stands on it. */
{
  assert.equal(world.metrics.unreachable, 0, 'every spawn/objective reachable on foot');
  assert.ok(world.metrics.reachRatio > 0.9, 'walkable ground is one connected region');
  for (const s of world.spawns) {
    const r = V.len([s.x, s.y, s.z]);
    assert.ok(Math.abs(r - groundRadius(sph, [s.x, s.y, s.z])) < 0.2, 'spawn sits on the terrain');
  }
  assert.ok(world.spawns.some(s => s.y < -20) && world.spawns.some(s => s.y > 20), 'spawns on both hemispheres');
  console.log('  ok  closed planet, every spawn on the surface and reachable (both hemispheres)');
}

/* 2. Walk a full loop around the equator road: consistent controls, no snapping, stays on the crust. */
{
  const p = fresh(V.norm([0.6, 0, 0.8]), [-0.8, 0, 0.6]);
  p.ly = 0;
  const start = [p.x, p.y, p.z];
  let swept = 0, maxStep = 0, lastDir = upOf(sph, start), minY = 0, maxY = 0, stuck = 0, left = 0;
  const axis = [0, 1, 0];
  for (let t = 0; t < 9000 && swept < Math.PI * 2 - 0.15; t++) {
    const f = frameOf(sph, p), want = V.norm(V.cross(axis, f.up));
    const yawErr = -Math.atan2(V.dot(want, f.right), V.dot(want, f.fwd));
    let yaw = p.ly + Math.max(-0.1, Math.min(0.1, yawErr));
    let b = B.FWD;
    const before = [p.x, p.y, p.z];
    const vt = Math.hypot(p.vx, p.vy, p.vz);
    if (vt < 0.4) { stuck++; if (stuck > 8) { b |= B.JUMP; if (stuck % 40 < 20) b |= B.RIGHT; else b |= B.LEFT; } } else stuck = 0;
    stepPlayer(p, input(p, b, yaw), world);
    const step = V.len(V.sub([p.x, p.y, p.z], before));
    maxStep = Math.max(maxStep, step);
    assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite');
    assert.ok(Math.abs(V.len([p.x, p.y, p.z]) - groundRadius(sph, [p.x, p.y, p.z])) < 14, 'never far from the crust');
    const d = upOf(sph, [p.x, p.y, p.z]);
    swept += Math.acos(Math.max(-1, Math.min(1, V.dot(d, lastDir)))) * (V.dot(V.cross(lastDir, d), axis) > 0 ? 1 : -1);
    lastDir = d; minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); left = t;
  }
  assert.ok(swept > Math.PI * 2 - 0.2, `completed the loop (swept ${swept.toFixed(2)} rad in ${left} ticks)`);
  assert.ok(maxStep < 0.5, `no teleport snaps (max step ${maxStep.toFixed(3)} m)`);
  console.log(`  ok  walked a full loop around the globe in ${(left * DT).toFixed(0)} s (max step ${maxStep.toFixed(2)} m)`);
}

/* 3. Underside: stand on the far side, gravity points to the centre, a jump returns to the ground. */
{
  const spawn = world.spawns.find(s => s.y < -40);
  const p = fresh(spawn.dir, spawn.h);
  for (let i = 0; i < 40; i++) stepPlayer(p, input(p, 0), world);
  assert.ok(p.g && onGround(p), 'standing on the underside');
  const up = upOf(sph, [p.x, p.y, p.z]);
  assert.ok(up[1] < -0.5, 'local up points away from the centre, downwards in world space');
  stepPlayer(p, input(p, B.JUMP), world);
  let peak = 0;
  for (let i = 0; i < 120; i++) { stepPlayer(p, input(p, 0), world); peak = Math.max(peak, V.len([p.x, p.y, p.z]) - groundRadius(sph, [p.x, p.y, p.z])); }
  assert.ok(peak > 1 && peak < 2.2, `jump height ${peak.toFixed(2)} m`);
  assert.ok(p.g && onGround(p), 'jump returns to the planet');
  console.log('  ok  stands, jumps and lands on the underside');
}

/* 4. Poles and heading: the heading stays tangent and finite across both poles. */
{
  const p = fresh(V.norm([0.05, 1, 0]), [1, 0, 0]);
  for (let i = 0; i < 400; i++) stepPlayer(p, input(p, B.FWD, p.ly + 0.01), world);
  const f = frameOf(sph, p);
  assert.ok(Math.abs(V.dot(f.fwd, f.up)) < 1e-6 && Math.abs(V.len(f.fwd) - 1) < 1e-6, 'heading tangent and unit length at the pole');
  console.log('  ok  controls stay stable near the pole');
}

/* 5. Combat: the planet blocks shots between opposite hemispheres; open sightlines hit. */
{
  const a = world.spawns.find(s => s.y > 40), b = world.spawns.find(s => s.y < -40);
  const sh = fresh(a.dir, a.h), far = fresh(b.dir, b.h); far.id = 'far'; far.w = 0;
  const f = frameOf(sph, sh);
  const toFar = V.norm(V.sub([far.x, far.y + 1.0, far.z], [sh.x, sh.y, sh.z]));
  // Point the shooter at the far player through the planet.
  const tan = V.sub(toFar, V.mul(f.up, V.dot(toFar, f.up)));
  sh.pitch = Math.asin(V.dot(toFar, f.up));
  const yaw = -Math.atan2(V.dot(tan, f.right), V.dot(tan, f.fwd));
  sh.hx = V.norm(V.add(V.mul(f.fwd, Math.cos(yaw)), V.mul(V.cross(f.up, f.fwd), Math.sin(yaw))))[0];
  const hh = V.norm(V.add(V.mul(f.fwd, Math.cos(yaw)), V.mul(V.cross(f.up, f.fwd), Math.sin(yaw))));
  [sh.hx, sh.hy, sh.hz] = hh;
  const wep = { id: 'ak47', range: 400, pellets: 1, spread: 0 };
  const r = castShot(world, [sh, far], sh, wep, () => 0.5);
  assert.equal(r.hit, null, 'planet blocks the shot through its core');

  // Open ground: two players a few metres apart on the same flat plaza.
  const a0 = Math.atan2(0.8, 0.6);   // open stretch of the equator road
  const s1 = fresh([Math.cos(a0), 0, Math.sin(a0)], [0, 0, 1]), s2 = fresh([Math.cos(a0 + 0.06), 0, Math.sin(a0 + 0.06)], [0, 0, 1]);
  s2.id = 'v'; s1.cr = false;
  const f1 = frameOf(sph, s1), dir = V.norm(V.sub([s2.x, s2.y, s2.z], [s1.x, s1.y, s1.z]));
  const tn = V.sub(dir, V.mul(f1.up, V.dot(dir, f1.up)));
  const y1 = -Math.atan2(V.dot(tn, f1.right), V.dot(tn, f1.fwd));
  const h1 = V.norm(V.add(V.mul(f1.fwd, Math.cos(y1)), V.mul(V.cross(f1.up, f1.fwd), Math.sin(y1))));
  [s1.hx, s1.hy, s1.hz] = h1;
  const aimAt = V.norm(V.sub(V.add([s2.x, s2.y, s2.z], V.mul(upOf(sph, [s2.x, s2.y, s2.z]), 1.0)), V.add([s1.x, s1.y, s1.z], V.mul(f1.up, 1.6))));
  s1.pitch = Math.asin(V.dot(aimAt, f1.up));
  const r2 = castShot(world, [s1, s2], s1, wep, () => 0.5);
  assert.equal(r2.hit?.id, 'v', 'a shot along an open sightline hits (any gravity orientation)');
  console.log('  ok  planet blocks cross-planet shots; open sightlines hit');
}

/* 6. Grenades obey radial gravity and never sink into the crust. */
{
  const p = fresh(world.spawns.find(s => s.y < -30).dir, [0, 0, 1]);
  const up = upOf(sph, [p.x, p.y, p.z]);
  const g = { x: p.x + up[0] * 1.6, y: p.y + up[1] * 1.6, z: p.z + up[2] * 1.6, ...(() => { const v = V.add(V.mul(frameOf(sph, p).fwd, GRENADE.speed), V.mul(up, GRENADE.lift)); return { vx: v[0], vy: v[1], vz: v[2] }; })() };
  let landed = false;
  for (let i = 0; i < 60 * 3; i++) {
    stepGrenade(g, world);
    const r = V.len([g.x, g.y, g.z]), gr = groundRadius(sph, [g.x, g.y, g.z]);
    assert.ok(r > gr - 0.35, 'grenade stays above the ground');
    if (r - gr < 0.4 && i > 20) landed = true;
  }
  assert.ok(landed, 'grenade falls back to the surface');
  console.log('  ok  grenades fall toward the planet and bounce on the crust');
}

/* 7. Seeded determinism. */
{
  const a = generateMicroPlanet({ seed: 7 }), b = generateMicroPlanet({ seed: 7 }), c = generateMicroPlanet({ seed: 8 });
  assert.equal(a.layoutHash, b.layoutHash);
  assert.notEqual(a.layoutHash, c.layoutHash);
  assert.equal(a.sphere.obbs.length, b.sphere.obbs.length);
  console.log('  ok  same seed, same planet; different seed, different planet');
}

/* 8. Host game integration: players, a bot, 12 s of play, snapshots stay sane. */
{
  const g = new HostGame(world, { mode: 'ffa', random: () => 0.5 });
  g.addPlayer('h', 'Host'); g.addBot('Bot');
  for (let i = 0; i < 12 * 60; i++) {
    const p = g.players.get('h');
    g.apply(p, { seq: p.seq + 1, b: B.FWD | (i % 90 < 5 ? B.JUMP : 0), yaw: Math.sin(i / 40), pitch: 0, w: 0 });
    g.step();
  }
  const snap = g.snapshot();
  for (const p of snap.players) {
    assert.ok([p.x, p.y, p.z, p.hx, p.hy, p.hz].every(Number.isFinite), 'finite snapshot');
    if (p.alive) assert.ok(Math.abs(V.len([p.x, p.y, p.z]) - groundRadius(sph, [p.x, p.y, p.z])) < 25, 'player near the crust');
  }
  assert.throws(() => new HostGame(world, { mode: 'ctf' }), /not available/);
  const c = new HostGame(world, { mode: 'control' });
  assert.ok(c.objective && c.objective.zone.s === 1, 'control zone exists on the spire plaza');
  console.log('  ok  host game runs players and bots on the globe; control mode works, CTF refused');
}

console.log('All microverse sphere tests passed!');
