/* Weapon/throwable tests. node test/weapons_test.mjs */

import assert from 'node:assert/strict';
import { HostGame } from '../src/hostgame.js';
import { getMap } from '../src/arena.js';
import { B, DT, GRENADE, stepGrenadeBody } from '../src/sim.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const flat = { boxes: [[-200, -1, -200, 200, 0, 200]], spawns: [{ x: 0, y: 0, z: 0, yaw: 0 }], killY: -30, barrels: [] };

test('a thrown grenade leaves the thrower and lands well downrange before the fuse', () => {
  const g = new HostGame(flat, { mode: 'ffa' });
  const p = g.addPlayer('a', 'A');
  Object.assign(p, { x: 0, y: 0, z: 0, yaw: 0, g: true });
  g.queueInput('a', [[1, B.GRENADE, 0, 0.25, 0]]);
  g.step();
  assert.equal(g.grenades.length, 1, 'grenade spawned');
  const nade = g.grenades[0];
  let last = { ...nade };
  for (let i = 0; i < Math.floor((GRENADE.fuse - 0.05) / DT); i++) { g.step(); if (g.grenades[0]) last = { ...g.grenades[0] }; }
  const dist = Math.hypot(last.x - p.x, last.z - p.z);
  assert.ok(dist > 10, `travelled ${dist.toFixed(1)} m`);
  assert.ok(last.y >= 0 && last.y < 0.5, 'resting on the floor');
  assert.equal(p.grenades, 1);
});

test('renderer replay of the spawn event matches the host trajectory exactly', () => {
  const world = getMap('arena', 1);
  const g = new HostGame(world, { mode: 'ffa' });
  const p = g.addPlayer('a', 'A');
  g.queueInput('a', [[1, B.GRENADE, p.yaw, 0.3, 0]]);
  let spawn = null;
  for (const e of g.step()) if (e.t === 'grenade_spawn') spawn = e;
  assert.ok(spawn);
  // the host already advanced one step after spawning; replay from the (rounded) event
  const vis = { x: spawn.x, y: spawn.y, z: spawn.z, vx: spawn.vx, vy: spawn.vy, vz: spawn.vz };
  stepGrenadeBody(vis, world.boxes, DT);
  for (let i = 0; i < 90; i++) { g.step(); stepGrenadeBody(vis, world.boxes, DT); }
  const host = g.grenades[0];
  assert.ok(host, 'still in flight');
  assert.ok(Math.hypot(host.x - vis.x, host.y - vis.y, host.z - vis.z) < 0.25, 'visual within 25 cm of host after 1.5 s');
});

test('grenade bounces off walls instead of passing through', () => {
  const walled = { ...flat, boxes: [...flat.boxes, [-5, 0, -6, 5, 4, -5]] };   // wall 5 m ahead (-Z)
  const g = { x: 0, y: 1.6, z: 0, vx: 0, vy: 0, vz: -GRENADE.speed };
  for (let i = 0; i < 60; i++) stepGrenadeBody(g, walled.boxes, DT);
  assert.ok(g.z > -5, `stayed in front of the wall (z=${g.z.toFixed(2)})`);
});

let failed = 0;
console.log(`Running ${tests.length} weapon tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} weapon test(s) failed`); process.exit(1); }
console.log('All weapon tests passed!');
