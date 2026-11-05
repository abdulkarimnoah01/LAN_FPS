/* Custom map format, validator and compiler tests. node test/custom_map_test.mjs */
import assert from 'node:assert/strict';
import { normalizeCustomMap, compileCustomMap, validateCustomMap, sampleCustomMap, emptyCustomMap, MAX_ITEMS, MAX_BYTES } from '../src/custom_map.js';
import { HostGame } from '../src/hostgame.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('sample map is valid, supports all five modes and hashes deterministically', () => {
  const v = validateCustomMap(sampleCustomMap());
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.modes.sort(), ['control', 'ctf', 'ffa', 'gungame', 'tdm']);
  assert.equal(validateCustomMap(sampleCustomMap()).hash, v.hash);
  const moved = sampleCustomMap(); moved.items[0].x += 1;
  assert.notEqual(validateCustomMap(moved).hash, v.hash);
});

test('normalize is the trust boundary: drops unknown types/keys, clamps numbers, limits colours and size', () => {
  const m = normalizeCustomMap({ v: 1, name: '<img onerror=x>', size: 999, sky: 'javascript:', items: [
    { t: 'block', x: 1e9, z: -1e9, w: -5, d: 'NaN', h: 1e6, y: -3, c: 'url(x)', evil: 1 },
    { t: '__proto__', x: 0, z: 0 }, { t: 'script', x: 0 }, null, 7, { t: 'flag', x: 0, z: 0, team: 'green' },
  ] });
  assert.equal(m.size, 56); assert.equal(m.sky, 'day'); assert.equal(m.name, 'img onerrorx');
  assert.equal(m.items.length, 2);
  const b = m.items[0];
  assert.deepEqual([b.x, b.z, b.w, b.h, b.y, b.c, b.evil], [27.5, -27.5, 0.4, 20, 0, 'stone', undefined]);
  assert.equal(m.items[1].team, 'red');
  assert.equal(normalizeCustomMap('{not json'), null);
  assert.equal(normalizeCustomMap('x'.repeat(MAX_BYTES + 1)), null);
  assert.equal(normalizeCustomMap([1, 2]), null);
  const many = emptyCustomMap(); for (let i = 0; i < MAX_ITEMS + 50; i++) many.items.push({ t: 'barrel', x: 0, z: 0 });
  assert.equal(normalizeCustomMap(many).items.length, MAX_ITEMS);
});

test('validator reports blocked spawns, unreachable objectives and missing team spawns', () => {
  const m = sampleCustomMap();
  m.items.push({ t: 'block', x: -4, z: -23, w: 3, d: 3, h: 4, y: 0, c: 'slate' });   // bury a red spawn
  const v = validateCustomMap(m);
  assert.equal(v.ok, false); assert.ok(v.errors.some(e => /blocked/.test(e)), v.errors.join('; '));
  const solo = emptyCustomMap(); solo.items.push({ t: 'spawn', x: 0, z: 0, team: 'none' }, { t: 'spawn', x: 5, z: 5, team: 'none' });
  const s = validateCustomMap(solo);
  assert.equal(s.ok, true); assert.deepEqual(s.modes, ['ffa', 'gungame']);
  assert.ok(s.warnings.some(w => /red and one blue/.test(w)));
  assert.equal(validateCustomMap(emptyCustomMap()).ok, false, 'needs spawns');
});

test('compiled world plays every supported mode with the editor anchors', () => {
  const w = compileCustomMap(sampleCustomMap());
  for (const mode of ['ffa', 'tdm', 'gungame', 'control', 'ctf']) {
    const g = new HostGame(w, { mode }); g.addPlayer('a', 'A'); g.addPlayer('b', 'B');
    for (let i = 0; i < 90; i++) g.step();
    assert.equal(g.phase, 'play');
  }
  assert.deepEqual(new HostGame(w, { mode: 'control' }).objective.zone, { ...w.objectiveAnchors.control, r: 6 });
  assert.ok(w.spawns.every(s => Number.isFinite(s.y)));
  const onPlatform = compileCustomMap({ ...sampleCustomMap(), items: [{ t: 'block', x: 0, z: 0, w: 4, d: 4, h: 2, y: 0, c: 'red' }, { t: 'spawn', x: 0, z: 0 }] });
  assert.equal(onPlatform.spawns[0].y, 2, 'spawn placed on a block stands on it');
});

test('network payload stays well under the cap', () => {
  const m = sampleCustomMap(); for (let i = 0; i < 400; i++) m.items.push({ t: 'block', x: (i % 20) - 10, z: Math.floor(i / 20) - 10, w: 1, d: 1, h: 1, y: 0, c: 'teal' });
  const bytes = JSON.stringify(normalizeCustomMap(m)).length;
  assert.ok(bytes < MAX_BYTES / 2, `${bytes} bytes`);
});

let failed = 0;
console.log(`Running ${tests.length} custom map tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} custom map test(s) failed`); process.exit(1); }
console.log('All custom map tests passed!');
