/* Mode rule tests: catalog, team rules, Gun Game ladder, Control objective.
   node test/modes_test.mjs */

import assert from 'node:assert/strict';
import { MODE_CATALOG, isTeamMode, publicModes, isKnownMode } from '../src/modes.js';
import { CONTROL, newControlState, stepControl, controlSnapshot, zoneOccupants } from '../src/objectives.js';
import { HostGame } from '../src/hostgame.js';
import { getMap } from '../src/arena.js';
import { GUN_ORDER, gunGameWeapon, RULES } from '../src/sim.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const world = { spawns: [{ x: -10, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 10, y: 0, z: 0 }] };
const at = (team, x = 0, alive = true) => ({ team, x, y: 1, z: 0, alive });
const run = (state, players, ticks) => {
  let s = state, events = [], result = null;
  for (let i = 0; i < ticks && !result; i++) { const r = stepControl(s, players); s = r.state; events.push(...r.events); result = r.result; }
  return { s, events, result };
};

test('catalog: public modes, team predicate, unknown ids', () => {
  assert.deepEqual(publicModes().map(m => m.id), ['ffa', 'tdm', 'gungame', 'control']);
  assert.equal(isTeamMode('tdm'), true); assert.equal(isTeamMode('control'), true); assert.equal(isTeamMode('ffa'), false);
  assert.equal(isKnownMode('ctf'), false, 'CTF is not shipped yet'); assert.equal(isKnownMode('__proto__'), false);
  assert.equal(MODE_CATALOG.control.target, CONTROL.target);
});

test('Control anchor sits on the central spawn', () => {
  const s = newControlState(world);
  assert.deepEqual([s.zone.x, s.zone.z, s.zone.r], [0, 0, 6]);
});

test('Control: 5 s uncontested capture, then 1 point per second while held alone', () => {
  const red = at('red'), blue = at('blue', 30);
  let { s, events } = run(newControlState(world), [red, blue], CONTROL.captureTicks - 1);
  assert.equal(s.owner, null); assert.equal(s.capTeam, 'red');
  ({ s, events } = run(s, [red, blue], 1));
  assert.equal(s.owner, 'red'); assert.deepEqual(events, [{ t: 'zone', owner: 'red' }]);
  ({ s } = run(s, [red, blue], 60 * 3));
  assert.equal(s.score.red, 3); assert.equal(s.score.blue, 0);
});

test('Control: contested freezes capture and scoring; empty zone keeps owner without scoring', () => {
  const red = at('red'), blue = at('blue');
  let { s } = run(newControlState(world), [red, at('blue', 30)], CONTROL.captureTicks + 60);
  const score = s.score.red;
  ({ s } = run(s, [red, blue], 600));
  assert.equal(s.contested, true); assert.equal(s.score.red, score); assert.equal(s.owner, 'red');
  ({ s } = run(s, [at('red', 30), at('blue', 30)], 600));
  assert.equal(s.contested, false); assert.equal(s.owner, 'red'); assert.equal(s.score.red, score);
});

test('Control: enemy neutralises over 5 s, then captures over another 5 s; empty pauses progress', () => {
  let { s } = run(newControlState(world), [at('red'), at('blue', 30)], CONTROL.captureTicks);
  assert.equal(s.owner, 'red');
  ({ s } = run(s, [at('red', 30), at('blue')], 120));
  const mid = s.capTicks;
  ({ s } = run(s, [at('red', 30), at('blue', 30)], 300));
  assert.equal(s.capTicks, mid, 'progress paused while empty');
  let events;
  ({ s, events } = run(s, [at('red', 30), at('blue')], CONTROL.captureTicks - 120));
  assert.equal(s.owner, null); assert.deepEqual(events, [{ t: 'zone', owner: null, by: 'blue' }]);
  ({ s } = run(s, [at('red', 30), at('blue')], CONTROL.captureTicks));
  assert.equal(s.owner, 'blue');
});

test('Control: dead and team-less players never count', () => {
  const s = newControlState(world);
  assert.deepEqual(zoneOccupants(s, [at('red', 0, false), at('none'), at('blue', 0)]), { red: 0, blue: 1 });
});

test('Control: target win, timeout winner, timeout draw — each resolved exactly once', () => {
  let st = { ...newControlState(world), owner: 'red', score: { red: CONTROL.target - 1, blue: 0 } };
  let { s, result } = run(st, [at('red'), at('blue', 30)], 61);
  assert.deepEqual(result, { winner: 'red' });
  assert.equal(stepControl(s, [at('red'), at('blue', 30)]).result, null, 'no second result');
  st = { ...newControlState(world), elapsed: CONTROL.timeLimitTicks - 1, score: { red: 4, blue: 9 } };
  assert.deepEqual(stepControl(st, [at('red', 30), at('blue', 30)]).result, { winner: 'blue' });
  st = { ...newControlState(world), elapsed: CONTROL.timeLimitTicks - 1, score: { red: 7, blue: 7 } };
  assert.deepEqual(stepControl(st, [at('red', 30), at('blue', 30)]).result, { winner: 'draw' });
});

test('Control: solo practice (one team only) never runs the competitive clock', () => {
  const { s, result } = run(newControlState(world), [at('red')], CONTROL.timeLimitTicks + 10);
  assert.equal(result, null); assert.equal(s.elapsed, 0); assert.equal(s.owner, null);
});

test('HostGame Control: teams balanced, snapshot carries objective, round ends then restarts clean', () => {
  const g = new HostGame(getMap('arena', 1), { mode: 'control' });
  const a = g.addPlayer('a', 'A'), b = g.addPlayer('b', 'B'), c = g.addPlayer('c', 'C');
  assert.deepEqual([a.team, b.team, c.team], ['red', 'blue', 'red']);
  const z = g.objective.zone;
  Object.assign(a, { x: z.x, y: z.y, z: z.z });
  g.objective = { ...g.objective, owner: 'red', score: { red: CONTROL.target - 1, blue: 0 } };
  // keep a in the zone (no inputs → stays put), b and c far away
  Object.assign(b, { x: z.x + 40, z: z.z + 40 }); Object.assign(c, { x: z.x - 40, z: z.z - 40 });
  let ended = null;
  for (let i = 0; i < 70 && !ended; i++) for (const e of g.step()) if (e.t === 'end') ended = e;
  assert.equal(ended?.winner, 'red'); assert.equal(g.phase, 'ended');
  const snap = g.snapshot();
  assert.equal(snap.obj.k, 'control'); assert.equal(snap.obj.sr, CONTROL.target);
  for (let i = 0; i < (RULES.endPause + 0.2) * 60; i++) g.step();
  assert.equal(g.phase, 'play');
  assert.equal(g.objective.owner, null); assert.deepEqual(g.objective.score, { red: 0, blue: 0 });
  assert.equal(JSON.stringify(g.snapshot().obj).length < 200, true);
});

test('Team rules apply to Control as to TDM: no friendly-fire kills', () => {
  for (const mode of ['tdm', 'control']) {
    const g = new HostGame(getMap('arena', 1), { mode });
    const a = g.addPlayer('a', 'A'), b = g.addPlayer('b', 'B'), c = g.addPlayer('c', 'C');
    assert.equal(a.team, c.team);
    assert.equal(g.team, true);
  }
  assert.equal(new HostGame(getMap('arena', 1), { mode: 'ffa' }).team, false);
});

test('Gun Game ladder: AK → SMG → LMG → Shotgun → Sniper → Knife', () => {
  assert.deepEqual(GUN_ORDER, [0, 3, 4, 1, 2, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(k => gunGameWeapon(k)), [0, 3, 4, 1, 2, 5]);
});

let failed = 0;
console.log(`Running ${tests.length} mode tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} mode test(s) failed`); process.exit(1); }
console.log('All mode tests passed!');
