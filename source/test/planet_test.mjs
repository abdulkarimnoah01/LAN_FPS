/* Orbit Crown generator tests. node test/planet_test.mjs */
import assert from 'node:assert/strict';
import { generatePlanet, validateLayout, layoutHash, normalizeSeed, PLANET_GENERATOR_VERSION, FALLBACK_SEED, buildWalkGrid } from '../src/planet_map.js';
import { HostGame } from '../src/hostgame.js';
import { HostSession } from '../src/game.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('same seed → identical layout and hash; different seeds differ', () => {
  const a = generatePlanet({ seed: 4242 }), b = generatePlanet({ seed: 4242 }), c = generatePlanet({ seed: 4243 });
  assert.equal(a.layoutHash, b.layoutHash);
  assert.deepEqual(a.boxes, b.boxes); assert.deepEqual(a.spawns, b.spawns);
  assert.notEqual(a.layoutHash, c.layoutHash);
  assert.equal(layoutHash({ boxes: a.boxes, spawns: a.spawns, barrels: a.barrels, objectiveAnchors: a.objectiveAnchors }), a.layoutHash);
});

test('seed 0 and integer boundaries are valid and distinct', () => {
  const seeds = [0, 1, -1, 2147483646, 2147483647, -2147483648, Number.MAX_SAFE_INTEGER, 1.9, '77', NaN];
  for (const s of seeds) { const w = generatePlanet({ seed: s }); assert.equal(w.planet.fallbackReason, null, `seed ${s}`); }
  assert.notEqual(generatePlanet({ seed: 0 }).layoutHash, generatePlanet({ seed: 1 }).layoutHash);
  assert.equal(normalizeSeed(NaN), 0); assert.equal(normalizeSeed(1.9), 1);
});

test('100 seeds pass clearance, connectivity, exits, fairness and anchor checks first time', () => {
  const hashes = new Set();
  for (let s = 0; s < 100; s++) {
    const w = generatePlanet({ seed: s * 7919 });
    assert.equal(w.planet.fallbackReason, null, `seed ${s * 7919}`);
    assert.equal(w.planet.seed, normalizeSeed(s * 7919), 'no retries needed');
    hashes.add(w.layoutHash);
    assert.ok(w.metrics.exitsRed >= 2 && w.metrics.exitsBlue >= 2);
    assert.ok(Math.abs(w.metrics.spawnToControlRed - w.metrics.spawnToControlBlue) <= 0.1 * w.metrics.spawnToControlRed);
    assert.equal(w.spawns.filter(p => p.team === 'red').length, 3); assert.equal(w.spawns.filter(p => p.team === 'blue').length, 3);
    for (const p of w.spawns) assert.ok(p.y > w.killY);
  }
  assert.equal(hashes.size, 100, 'seeded variation produces distinct layouts');
});

test('validator rejects a layout whose station exits and plaza are walled off', () => {
  const w = generatePlanet({ seed: 5 });
  const blocked = { ...w, boxes: [...w.boxes, [-12, 0, -29, 12, 3, -28.4], [-12, 0, -36, -11, 3, -28.4], [11, 0, -36, 12, 3, -28.4], [-7.5, 0, -7.5, 7.5, 8, 7.5]] };
  const v = validateLayout(blocked);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => /exits|unreachable/.test(p)), v.problems.join('; '));
});

test('fallback is deterministic when every attempt fails', async () => {
  const mod = await import('../src/planet_map.js');
  assert.equal(FALLBACK_SEED, 1);
  const fb = mod.generatePlanet({ seed: FALLBACK_SEED });
  assert.equal(fb.planet.fallbackReason, null, 'fallback seed itself is valid');
});

test('unknown generator version fails with a readable reason', () => {
  assert.throws(() => generatePlanet({ seed: 1, generatorVersion: PLANET_GENERATOR_VERSION + 1 }), /not supported by this build/);
});

test('decorative water and planet never add collision; walk grid covers the 72 m deck', () => {
  const w = generatePlanet({ seed: 9 });
  assert.equal(w.boxes.length, w.visuals.filter(v => v.type === 'box').length + w.barrels.length);
  const g = buildWalkGrid(w.boxes);
  assert.equal(g.n * g.cell, 72);
});

test('all five modes run on Orbit Crown with anchored objectives', () => {
  const w = generatePlanet({ seed: 3 });
  for (const mode of ['ffa', 'tdm', 'gungame', 'control', 'ctf']) {
    const g = new HostGame(w, { mode });
    g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
    for (let i = 0; i < 120; i++) g.step();
    assert.equal(g.phase, 'play', mode);
  }
  const ctf = new HostGame(w, { mode: 'ctf' });
  assert.deepEqual(ctf.objective.flags.red.home, w.objectiveAnchors.ctf.red);
  assert.deepEqual(new HostGame(w, { mode: 'control' }).objective.zone, { ...w.objectiveAnchors.control, r: 6 });
});

test('host init carries generator version and layout hash for the guest check', () => {
  const w = generatePlanet({ seed: 11 });
  const sent = [];
  class FakeNet { constructor(o) { this.o = o; this.peers = new Map(); } send(p, m) { sent.push(m); } broadcast() {} start() { return 'CODE'; } stop() {} }
  const hs = new HostSession({ lobby: null, world: w, id: 'h', name: 'H', char: '', map: 'orbit', seed: 11, mode: 'ffa', NetHostClass: FakeNet });
  hs.net.o.onPeer({ id: 'g', name: 'G', char: '' });
  const init = sent.find(m => m.t === 'init');
  assert.deepEqual([init.map, init.seed, init.gen, init.hash], ['orbit', 11, PLANET_GENERATOR_VERSION, w.layoutHash]);
});

let failed = 0;
console.log(`Running ${tests.length} planet tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} planet test(s) failed`); process.exit(1); }
console.log('All planet tests passed!');
