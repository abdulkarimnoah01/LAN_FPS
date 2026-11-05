/* Dynamic weather tests. node test/weather_test.mjs */
import assert from 'node:assert/strict';
import { weatherSchedule, weatherAt, encodeWeather, decodeWeather, blendLook, WEATHER_STATES, BLEND_SECONDS, weatherAllowed, normalizeWeatherOption } from '../src/weather.js';
import { HostGame } from '../src/hostgame.js';
import { getMap } from '../src/arena.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('schedule is deterministic, starts sunny, never repeats a state back-to-back, 90–180 s spells', () => {
  const a = weatherSchedule(42, 3600), b = weatherSchedule(42, 3600);
  assert.deepEqual(a, b);
  assert.equal(a[0].id, 'sunny');
  for (let i = 1; i < a.length; i++) {
    assert.notEqual(a[i].id, a[i - 1].id);
    assert.equal(a[i].start, a[i - 1].end);
  }
  for (const s of a) assert.ok(s.end - s.start >= 90 && s.end - s.start < 180);
  assert.ok(new Set(a.map(s => s.id)).size === 4, 'all four states appear within an hour');
  assert.notDeepEqual(weatherSchedule(43, 3600), a);
});

test('weatherAt blends over 12 s at each change and holds otherwise', () => {
  const sched = weatherSchedule(7, 2000), change = sched[1].start;
  const mid = weatherAt('dynamic', 7, change + BLEND_SECONDS / 2);
  assert.deepEqual([mid.from, mid.to], [sched[0].id, sched[1].id]); assert.ok(Math.abs(mid.k - 0.5) < 1e-9);
  const held = weatherAt('dynamic', 7, change + BLEND_SECONDS + 1);
  assert.deepEqual([held.from, held.to, held.k], [sched[1].id, sched[1].id, 1]);
  assert.deepEqual(weatherAt('rain', 7, 999), { from: 'rain', to: 'rain', k: 1 });
  assert.equal(weatherAt('off', 7, 10), null);
});

test('snapshot encoding round-trips and rejects garbage', () => {
  for (const w of [{ from: 'sunny', to: 'rain', k: 0.25 }, { from: 'fog', to: 'fog', k: 1 }]) assert.deepEqual(decodeWeather(encodeWeather(w)), w);
  for (const bad of [null, 'rain', [9, 0, 50], [0, 1], { 0: 1 }]) assert.equal(decodeWeather(bad), null);
  assert.equal(decodeWeather([0, 3, 500]).k, 1);
});

test('blended look interpolates between states', () => {
  const sunny = blendLook({ from: 'sunny', to: 'sunny', k: 1 }), rain = blendLook({ from: 'rain', to: 'rain', k: 1 });
  const half = blendLook({ from: 'sunny', to: 'rain', k: 0.5 });
  assert.equal(sunny.rain, 0); assert.equal(rain.rain, 1); assert.equal(half.rain, 0.5);
  assert.ok(half.sun < sunny.sun && half.sun > rain.sun);
  assert.equal(blendLook({ from: 'fog', to: 'fog', k: 1 }, { fogStart: 90, fogEnd: 700 }).fogEnd, 46, 'fog distance is absolute');
  assert.equal(blendLook(null, { fogStart: 90, fogEnd: 700 }).fogEnd, 700, 'sunny keeps the map fog');
});

test('host snapshots carry weather (late joiners get it); off by default for Classic', () => {
  const g = new HostGame(getMap('arena', 1), { mode: 'ffa', weather: 'dynamic', weatherSeed: 9 });
  g.addPlayer('a', 'A');
  for (let i = 0; i < 60; i++) g.step();
  const wx = g.snapshot().wx;
  assert.ok(Array.isArray(wx) && WEATHER_STATES[wx[0]]);
  g.addPlayer('late', 'Late');
  assert.deepEqual(g.snapshot().wx, wx);
  assert.equal(new HostGame(getMap('arena', 1), { mode: 'ffa' }).snapshot().wx, undefined);
  assert.equal(normalizeWeatherOption('blizzard'), 'dynamic');
});

test('indoor and space arenas have no weather', () => {
  for (const m of ['foundry', 'glowplant', 'zenith']) assert.equal(weatherAllowed(m), false);
  for (const m of ['orbit', 'school', 'railyard', 'forest']) assert.equal(weatherAllowed(m), true);
});

let failed = 0;
console.log(`Running ${tests.length} weather tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} weather test(s) failed`); process.exit(1); }
console.log('All weather tests passed!');
