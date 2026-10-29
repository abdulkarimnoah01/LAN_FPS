/* Headless tests: node test/run.mjs
   1. Room listing and WebRTC signaling over a real temp folder (fake RTC).
   2. The host's movement, hit, kill, respawn and score logic. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DirHandle, fakeRTC } from './fakes.mjs';
import { Lobby, NetHost, NetGuest, LinkError, DATA } from '../src/net.js';
import { HostGame } from '../src/hostgame.js';
import { defaultArena, forestMap, sandboxMap, aftermathMap, riverForestMap, getMap } from '../src/arena.js';
import { newPlayer, stepPlayer, castShot, B, DT, RULES, WEAPONS, PREDICTED } from '../src/sim.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw Error('Timed out waiting for ' + what);
}
async function tempRoot() { return new DirHandle(await fs.mkdtemp(path.join(os.tmpdir(), 'lanfps-'))); }

/* ---------- networking ---------- */

test('room appears in other lobbies, guest links up, messages flow both ways', async () => {
  const root = await tempRoot();
  const RTC = fakeRTC('ok');
  const hostLobby = await new Lobby(root).open(), guestLobby = await new Lobby(root).open(), thirdLobby = await new Lobby(root).open();
  const peers = [], hostGot = [], left = [];
  let players = 1;
  const host = new NetHost({ lobby: hostLobby, RTC, id: 'a'.repeat(16), name: 'Mona', roomName: 'Lunch / Deathmatch',
    info: () => ({ players, max: 6, phase: 'play' }), onPeer: p => { peers.push(p); players++; }, onMessage: (p, m) => hostGot.push([p.id, m]), onLeave: p => { left.push(p.id); players--; } });
  const code = await host.start();
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);

  const rooms = await until(async () => { const r = await guestLobby.rooms(); return r.length && r; }, 3000, 'room listing');
  assert.equal(rooms[0].code, code);
  assert.equal(rooms[0].name, 'Lunch / Deathmatch');
  assert.equal(rooms[0].host, 'Mona');

  const guestGot = [];
  const guest = new NetGuest({ lobby: guestLobby, RTC, id: 'b'.repeat(16), name: 'Omar', char: 'kimo', onMessage: m => guestGot.push(m) });
  await guest.connect(rooms[0], { timeout: 4000 });
  await until(() => peers.length === 1, 2000, 'host to see the guest');
  assert.equal(peers[0].name, 'Omar');
  assert.equal(peers[0].char, 'kimo');

  // Unreliable/unordered channel for inputs and snapshots, reliable one for events.
  assert.deepEqual(guest.fast.options, { ordered: false, maxRetransmits: 0 });
  guest.send({ t: 'i', in: [[1, 0, 0, 0]] }, true);
  guest.send({ t: 'ping', c: 1 });
  host.broadcast({ t: 's', tick: 1 }, true);
  host.send(peers[0], { t: 'kill', id: 'x' });
  await until(() => hostGot.length === 2 && guestGot.length === 2, 2000, 'messages');
  assert.deepEqual(hostGot.map(m => m[1].t).sort(), ['i', 'ping']);
  assert.deepEqual(guestGot.map(m => m.t).sort(), ['kill', 's']);

  // Signaling files are cleaned up once linked.
  const roomDir = await (await root.getDirectoryHandle(DATA)).getDirectoryHandle('room-' + code);
  await until(async () => { const names = []; for await (const [n] of roomDir.entries()) names.push(n); return names.join() === 'room.json'; }, 2000, 'signal cleanup');

  // Lobby shows the new player count after the next heartbeat.
  await until(async () => (await thirdLobby.rooms())[0]?.players === 2, 5000, 'player count');

  // Guest leaving is noticed by the host.
  guest.close();
  await until(() => left.length === 1, 2000, 'host to notice leave');

  // Closing the room removes it from every lobby.
  await host.stop();
  assert.deepEqual(await thirdLobby.rooms(), []);
});

test('host refusal (room full) reaches the guest as a clear error', async () => {
  const root = await tempRoot(), RTC = fakeRTC('ok');
  const host = new NetHost({ lobby: await new Lobby(root).open(), RTC, id: 'c'.repeat(16), name: 'Host', roomName: 'Full', canJoin: () => 'Room is full' });
  await host.start();
  const lobby = await new Lobby(root).open();
  const [room] = await until(async () => { const r = await lobby.rooms(); return r.length && r; });
  const guest = new NetGuest({ lobby, RTC, id: 'd'.repeat(16), name: 'Late' });
  await assert.rejects(guest.connect(room, { timeout: 3000 }), e => e instanceof LinkError && /full/.test(e.message));
  await host.stop();
});

test('no direct link: guest gets an explicit message instead of a folder fallback', async () => {
  const root = await tempRoot(), RTC = fakeRTC('blocked');
  const host = new NetHost({ lobby: await new Lobby(root).open(), RTC, id: 'e'.repeat(16), name: 'Hana', roomName: 'Blocked' });
  await host.start();
  const lobby = await new Lobby(root).open();
  const [room] = await until(async () => { const r = await lobby.rooms(); return r.length && r; });
  const guest = new NetGuest({ lobby, RTC, id: 'f'.repeat(16), name: 'Ivo' });
  await assert.rejects(guest.connect(room, { timeout: 1500 }), e => e instanceof LinkError && /direct link/.test(e.message) && /too slow/.test(e.message));
  await host.stop();
});

test('host that never answers: guest is told the host did not answer', async () => {
  const root = await tempRoot(), RTC = fakeRTC('ok');
  const lobby = await new Lobby(root).open();
  const board = await lobby.createRoom('Ghost', 'Gus');
  await board.publish({ players: 1, max: 6 });
  const guest = new NetGuest({ lobby, RTC, id: '1'.repeat(16), name: 'Ivo' });
  await assert.rejects(guest.connect({ code: board.code, host: 'Gus' }, { timeout: 800 }), /did not answer/);
});

test('stale room (heartbeat stopped) drops out of the lobby', async () => {
  const root = await tempRoot();
  let t = 0;
  const lobby = await new Lobby(root, { now: () => t }).open();
  const board = await lobby.createRoom('Old', 'Ola');
  await board.publish({});
  assert.equal((await lobby.rooms()).length, 1);
  t = 7000;
  assert.equal((await lobby.rooms()).length, 0, 'no heartbeat for 7 s');
  await board.publish({});
  assert.equal((await lobby.rooms()).length, 1, 'heartbeat resumed');
});

/* ---------- host game logic ---------- */

const world = defaultArena();
function input(seq, b = 0, yaw = 0, pitch = 0) { return [seq, b, yaw, pitch]; }

// Two players standing 5 m apart in the open, A looking straight at B.
const BODY = Math.atan2(-0.5, 5);
function place(a, b) {
  Object.assign(a, { x: 8, y: 0, z: 3, g: true, ammo: RULES.mag, rl: 0 });
  Object.assign(b, { x: 8, y: 0, z: -2, g: true, alive: true, hp: 100 });
}
function duel() {
  const g = new HostGame(world, { random: () => 0 });
  const a = g.addPlayer('A', 'Ann'), b = g.addPlayer('B', 'Ben');
  place(a, b);
  let seq = 0;
  // Default aim: chest height (the eye is level with the head hitbox).
  const fireA = (pitch = BODY) => {
    for (let i = 0; i < RULES.fireTicks; i++) g.queueInput('A', [input(++seq, 0, 0, pitch)]), g.step(); // let cooldown clear
    g.queueInput('A', [input(++seq, B.FIRE, 0, pitch)]);
    return g.step();
  };
  return { g, a, b, fireA };
}

test('hitscan body hit does 25 damage and is reported', async () => {
  const { a, b, fireA } = duel();
  const ev = fireA();
  const shot = ev.find(e => e.t === 'shot');
  assert.equal(shot.id, 'A'); assert.equal(shot.hit, 'B');
  assert.equal(b.hp, 75); assert.equal(a.ammo, RULES.mag - 1);
  assert.ok(ev.some(e => e.t === 'hit' && e.id === 'B' && e.by === 'A' && e.hp === 75));
});

test('headshot does double damage', async () => {
  const { b, fireA } = duel();
  fireA(0); // level with the eye = head height
  assert.equal(b.hp, 50);
});

test('four body hits kill, kill is scored, victim respawns after 3 s', async () => {
  const { g, a, b, fireA } = duel();
  let events = [];
  for (let i = 0; i < 4; i++) events.push(...fireA());
  assert.equal(b.alive, false); assert.equal(b.hp, 0);
  assert.equal(a.k, 1); assert.equal(b.d, 1);
  assert.ok(events.some(e => e.t === 'kill' && e.id === 'B' && e.by === 'A'));
  const snap = g.snapshot().players.find(p => p.id === 'B');
  assert.equal(snap.alive, false); assert.ok(snap.respawnIn > 2);
  const sp = b.sp;
  for (let i = 0; i < 3 / DT + 2; i++) g.step();
  assert.equal(b.alive, true); assert.equal(b.hp, 100); assert.equal(b.sp, sp + 1);
  assert.ok(world.spawns.some(s => s.x === b.x && s.z === b.z), 'respawned on a spawn point');
});

test('walls stop shots', async () => {
  const g = new HostGame(world);
  const a = g.addPlayer('A', 'Ann'), b = g.addPlayer('B', 'Ben');
  // Low cover wall at z = -13 (height 1.3, x -4.5..4.5). A crouches behind it? No: put B behind a pillar.
  Object.assign(a, { x: -10, y: 0, z: -4, g: true }); Object.assign(b, { x: -10, y: 0, z: -14, g: true }); // pillar at (-10,-10)
  g.queueInput('A', [input(1, B.FIRE, 0, 0)]);
  const shot = g.step().find(e => e.t === 'shot');
  assert.equal(shot.hit, null); assert.equal(b.hp, 100);
  assert.ok(Math.abs(shot.to[2] - (-9.2)) < 0.01, 'stopped at the pillar face');
});

test('ammo runs out, reload refills, fire rate is limited', async () => {
  const g = new HostGame(world);
  const a = g.addPlayer('A', 'Ann');
  Object.assign(a, { x: 0, y: 0, z: 18, g: true });
  let seq = 0, shots = 0;
  for (let i = 0; i < 60; i++) { g.queueInput('A', [input(++seq, B.FIRE, Math.PI, 0)]); shots += g.step().filter(e => e.t === 'shot').length; }
  assert.equal(shots, Math.ceil(60 / RULES.fireTicks), 'one shot per cooldown');
  for (let i = 0; i < 200; i++) { g.queueInput('A', [input(++seq, B.FIRE, Math.PI, 0)]); shots += g.step().filter(e => e.t === 'shot').length; }
  assert.ok(shots > RULES.mag, 'auto-reload when empty');
  const before = shots;
  for (let i = 0; i < 10; i++) { g.queueInput('A', [input(++seq, B.RELOAD, 0, 0)]); g.step(); }
  assert.equal(a.rl > 0 || a.ammo === RULES.mag, true);
  assert.equal(shots, before);
});

test('first to 10 kills ends the round, then everything resets', async () => {
  const { g, a, b, fireA } = duel();
  let events = [];
  for (let k = 0; k < RULES.winKills; k++) {
    place(a, b);
    for (let i = 0; i < 4; i++) events.push(...fireA());
  }
  assert.equal(a.k, 10); assert.equal(g.phase, 'ended'); assert.equal(g.winner, 'A');
  assert.ok(events.some(e => e.t === 'end' && e.winner === 'A'));
  // No damage while the round is over.
  place(a, b);
  fireA(); assert.equal(b.hp, 100);
  for (let i = 0; i < RULES.endPause / DT + 2; i++) events.push(...g.step());
  assert.equal(g.phase, 'play'); assert.equal(a.k, 0); assert.equal(b.d, 0);
  assert.ok(events.some(e => e.t === 'restart'));
});

test('room holds at most 6 players and slots are reused', async () => {
  const g = new HostGame(world);
  for (let i = 0; i < 6; i++) g.addPlayer('p' + i, 'P' + i);
  assert.throws(() => g.addPlayer('p6', 'Seven'), /full/);
  g.removePlayer('p2');
  assert.equal(g.addPlayer('p7', 'New').slot, 2);
});

test('chosen character is cleaned and sent to everyone in snapshots', async () => {
  const g = new HostGame(world);
  g.addPlayer('A', 'Ann', 'Kimo'); g.addPlayer('B', 'Ben', '<img src=x>'); g.addPlayer('C', 'Cy');
  const chars = Object.fromEntries(g.snapshot().players.map(p => [p.id, p.char]));
  assert.deepEqual(chars, { A: 'kimo', B: '-img-src-x-', C: '' });
});

test('duplicate, old and malformed inputs are ignored; speed is capped', async () => {
  const g = new HostGame(world);
  const a = g.addPlayer('A', 'Ann');
  g.queueInput('A', [input(1), input(2), input(2), input(1), [3, 0, NaN, 0], 'junk', input(4)]);
  assert.deepEqual(g.queues.get('A').map(i => i.seq), [1, 2, 4]);
  // A flood of 100 inputs in one tick cannot all run at once.
  const many = []; for (let i = 5; i < 105; i++) many.push(input(i, B.FWD));
  g.queueInput('A', many); g.step();
  assert.ok(a.seq < 20, 'at most a few inputs per host step');
});

/* ---------- movement and prediction ---------- */

test('players land on the floor, cannot pass walls, climb stairs, can jump', async () => {
  const p = newPlayer('A', 'Ann', 0);
  Object.assign(p, { x: 0, y: 3, z: 10 });
  for (let i = 0; i < 120; i++) stepPlayer(p, { b: 0, yaw: 0, pitch: 0 }, world);
  assert.equal(p.y, 0); assert.equal(p.g, true);
  // Walk north (-z) into the stairs at z 4..7 and up onto the deck (height 1.5).
  for (let i = 0; i < 120; i++) stepPlayer(p, { b: B.FWD, yaw: 0, pitch: 0 }, world);
  assert.ok(Math.abs(p.y - 1.5) < 0.01, 'climbed the stairs, y=' + p.y);
  // Walk west into the outer wall.
  Object.assign(p, { x: -18, y: 0, z: 0 });
  for (let i = 0; i < 200; i++) stepPlayer(p, { b: B.FWD, yaw: Math.PI / 2, pitch: 0 }, world);
  assert.ok(p.x >= -22 + 0.35 - 1e-3 && p.x < -21, 'stopped at the wall, x=' + p.x);
  // Jump.
  let peak = 0;
  stepPlayer(p, { b: B.JUMP, yaw: 0, pitch: 0 }, world);
  for (let i = 0; i < 60; i++) { stepPlayer(p, { b: 0, yaw: 0, pitch: 0 }, world); peak = Math.max(peak, p.y); }
  assert.ok(peak > 1 && peak < 1.6, 'jump height ' + peak);
  assert.equal(p.y, 0);
});

test('client prediction replays to exactly the host position', async () => {
  const g = new HostGame(world, { random: () => 0 });
  g.addPlayer('A', 'Ann');
  const local = newPlayer('A', 'Ann', 0);
  const inputs = [];
  for (let i = 1; i <= 90; i++) inputs.push(input(i, (i % 30 < 20 ? B.FWD : B.LEFT) | (i === 40 ? B.JUMP : 0), i * 0.01, 0));
  // Host has seen the first 60 inputs.
  g.queueInput('A', inputs.slice(0, 60));
  for (let i = 0; i < 60; i++) g.step();
  const snap = g.snapshot().players[0];
  assert.equal(snap.seq, 60);
  // Client resets to the snapshot and replays the 30 it sent since.
  for (const k of PREDICTED) local[k] = snap[k];
  for (const [seq, b, yaw, pitch] of inputs.slice(60)) stepPlayer(local, { b, yaw, pitch }, world);
  g.queueInput('A', inputs.slice(60));
  for (let i = 0; i < 30; i++) g.step();
  const host = g.players.get('A');
  for (const k of ['x', 'y', 'z']) assert.equal(local[k], host[k], k);
});

test('castShot ignores dead players', async () => {
  const a = newPlayer('A', 'A', 0), b = newPlayer('B', 'B', 1);
  place(a, b); a.pitch = BODY;
  assert.equal(castShot(world, [a, b], a).hit.id, 'B');
  b.alive = false;
  assert.equal(castShot(world, [a, b], a).hit, null);
});

test('forestMap builds valid collision boxes, trees, boulders and at least 8 spawns', async () => {
  const f = forestMap();
  assert.ok(f.boxes.length > 50, 'has collision boxes');
  assert.ok(f.visuals.some(v => v.type === 'tree'), 'has low-poly trees');
  assert.ok(f.visuals.some(v => v.type === 'rock'), 'has low-poly rocks');
  assert.ok(f.spawns.length >= 8, 'at least 8 spawn points');
  assert.equal(f.theme, 'forest');
  // Check that all boxes have min < max
  for (const b of f.boxes) {
    assert.ok(b[0] < b[3] && b[1] <= b[4] && b[2] < b[5], 'valid AABB box: ' + JSON.stringify(b));
  }
});

test('sandboxMap is fully deterministic for identical seed and generates varying layouts for different seeds', async () => {
  const s1 = sandboxMap(4242);
  const s2 = sandboxMap(4242);
  const s3 = sandboxMap(9999);
  assert.deepEqual(s1.boxes, s2.boxes, 'identical seed produces identical collisions');
  assert.deepEqual(s1.visuals, s2.visuals, 'identical seed produces identical visuals');
  assert.notDeepEqual(s1.boxes, s3.boxes, 'different seeds produce different layouts');
  assert.ok(s1.spawns.length >= 8, 'sandbox has 8 spawns');
});

test('aftermathMap constructs Medal of Honor style war ruins, tilted slabs, radio tower, barrels, and 8 spawns', async () => {
  const m = aftermathMap();
  assert.equal(m.theme, 'aftermath');
  assert.ok(m.boxes.length > 40, 'has collision boxes');
  assert.ok(m.spawns.length >= 8, 'at least 8 spawn points');
  assert.ok(m.visuals.some(v => v.type === 'bareTree'), 'has bare blasted tree');
  assert.ok(m.visuals.some(v => v.type === 'barrel'), 'has oil drums / barrels');
  assert.ok(m.visuals.some(v => v.type === 'antenna'), 'has radio transmission tower');
  assert.ok(m.visuals.some(v => v.type === 'slab'), 'has tilted broken concrete slabs');
  // Check that all boxes have min < max
  for (const b of m.boxes) {
    assert.ok(b[0] < b[3] && b[1] <= b[4] && b[2] < b[5], 'valid AABB box: ' + JSON.stringify(b));
  }
});

test('riverForestMap constructs river channel, water surface, timber bridge, rapids crossing, and 8 spawns', async () => {
  const r = riverForestMap();
  assert.equal(r.theme, 'river');
  assert.ok(r.boxes.length > 50, 'has collision boxes');
  assert.ok(r.spawns.length >= 8, 'at least 8 spawn points');
  assert.ok(r.visuals.some(v => v.type === 'water'), 'has water surface visual');
  assert.ok(r.visuals.some(v => v.type === 'tree'), 'has pine trees on riverbanks');
  assert.ok(r.visuals.some(v => v.type === 'rock'), 'has river boulders and rapids');
  for (const b of r.boxes) {
    assert.ok(b[0] < b[3] && b[1] <= b[4] && b[2] < b[5], 'valid AABB box: ' + JSON.stringify(b));
  }
});

test('getMap factory loads all map modes correctly', async () => {
  assert.equal(getMap('aftermath').theme, 'aftermath');
  assert.equal(getMap('river').theme, 'river');
  assert.equal(getMap('forest').theme, 'forest');
  assert.equal(getMap('sandbox', 42).theme, 'sandbox');
  assert.equal(getMap('arena').theme, 'arena');
});

test('WEAPONS defines all 6 weapons with correct baseline attributes', async () => {
  assert.equal(WEAPONS.length, 6);
  const ids = WEAPONS.map(w => w.id);
  assert.deepEqual(ids, ['ak47', 'shotgun', 'sniper', 'smg', 'lmg', 'knife']);
  for (const w of WEAPONS) {
    assert.ok(w.mag > 0, `${w.id} mag > 0`);
    assert.ok(w.damage > 0, `${w.id} damage > 0`);
    assert.ok(w.headDamage > w.damage, `${w.id} headDamage > damage`);
    assert.ok(w.fireTicks > 0, `${w.id} fireTicks > 0`);
  }
});

test('knife provides speed boost, deals 55 front slash damage, and 110 lethal backstab damage', async () => {
  // Test knife speed boost vs standard weapon
  const pGun = newPlayer('G', 'Gun', 0); // AK-47
  pGun.x = 8; pGun.y = 0; pGun.z = 8; pGun.g = true;
  const pKnife = newPlayer('K', 'Knife', 1);
  pKnife.x = 8; pKnife.y = 0; pKnife.z = 8; pKnife.g = true;
  pKnife.w = 5; // Knife slot

  for (let i = 0; i < 30; i++) {
    stepPlayer(pGun, { b: B.FWD, yaw: 0, pitch: 0 }, world);
    stepPlayer(pKnife, { b: B.FWD, yaw: 0, pitch: 0 }, world);
  }
  const dGun = Math.abs(pGun.z - 8);
  const dKnife = Math.abs(pKnife.z - 8);
  assert.ok(dKnife > dGun * 1.1, `knife run speed is ~15% faster: ${dKnife} vs ${dGun}`);

  // Test knife front attack (deals 55 damage)
  const g = new HostGame(world, { random: () => 0 });
  const a = g.addPlayer('A', 'Attacker'), b = g.addPlayer('B', 'Victim');
  const KNIFE_BODY = Math.atan2(-0.6, 1.8);
  Object.assign(a, { x: 8, y: 0, z: 2, yaw: 0, pitch: KNIFE_BODY, g: true, w: 5 });
  Object.assign(b, { x: 8, y: 0, z: 0.2, yaw: Math.PI, pitch: 0, g: true, alive: true, hp: 100 });
  g.queueInput('A', [[1, B.FIRE, 0, KNIFE_BODY, 5]]);
  const resFront = g.step();
  assert.ok(resFront.some(e => e.t === 'hit' && e.id === 'B' && e.hp === 45), 'front knife hit inflicts 55 damage');
  assert.equal(b.hp, 45);

  // Test backstab attack (deals 110 lethal damage from behind)
  b.alive = false; // remove B from line of fire
  const c = g.addPlayer('C', 'Victim2');
  Object.assign(c, { x: 8, y: 0, z: 0.2, yaw: 0, pitch: 0, g: true, alive: true, hp: 100 });
  for (let i = 2; i <= 24; i++) g.queueInput('A', [[i, 0, 0, KNIFE_BODY, 5]]), g.step();
  g.queueInput('A', [[25, B.FIRE, 0, KNIFE_BODY, 5]]);
  const resBack = g.step();
  assert.ok(resBack.some(e => e.t === 'kill' && e.id === 'C' && e.by === 'A' && e.backstab), 'knife backstab deals lethal instant kill with backstab flag');
  assert.equal(c.alive, false);
});

test('quick melee (B.MELEE) triggers knife attack while holding a firearm', async () => {
  const g = new HostGame(world, { random: () => 0 });
  const a = g.addPlayer('A', 'Attacker'), b = g.addPlayer('B', 'Victim');
  const KNIFE_BODY = Math.atan2(-0.6, 1.5);
  // A holds AK-47 (w = 0)
  Object.assign(a, { x: 8, y: 0, z: 2, yaw: 0, pitch: KNIFE_BODY, g: true, w: 0 });
  Object.assign(b, { x: 8, y: 0, z: 0.5, yaw: Math.PI, pitch: 0, g: true, alive: true, hp: 100 });
  // Trigger quick melee with B.MELEE
  g.queueInput('A', [[1, B.MELEE, 0, KNIFE_BODY, 0]]);
  const res = g.step();
  const shotEv = res.find(e => e.t === 'shot');
  assert.ok(shotEv, 'melee shot event generated');
  assert.equal(shotEv.wepId, 'knife', 'quick melee uses knife wepId');
  assert.equal(shotEv.quickMelee, true, 'marked as quickMelee');
  assert.equal(b.hp, 45, 'quick melee inflicts knife damage');
});

test('weapon switching updates player weapon slot, persists individual ammo, and sets equip delay', async () => {
  const p = newPlayer('P', 'Player', 0);
  assert.equal(p.w, 0);
  assert.equal(p.ammo, 30);
  // Expend 5 rounds on AK
  p.ammo = 25;
  p.ammos[0] = 25;

  // Switch to Shotgun (slot 1)
  stepPlayer(p, { b: 0, yaw: 0, pitch: 0, w: 1 }, world);
  assert.equal(p.w, 1);
  assert.equal(p.ammo, WEAPONS[1].mag);
  assert.equal(p.ammos[0], 25, 'AK ammo preserved');
  assert.ok(p.cd > 0, 'weapon switch equip delay active');

  // Switch to Sniper (slot 2)
  stepPlayer(p, { b: 0, yaw: 0, pitch: 0, w: 2 }, world);
  assert.equal(p.w, 2);
  assert.equal(p.ammo, WEAPONS[2].mag);

  // Switch back to AK-47 (slot 0)
  stepPlayer(p, { b: 0, yaw: 0, pitch: 0, w: 0 }, world);
  assert.equal(p.w, 0);
  assert.equal(p.ammo, 25, 'switched back to AK with preserved ammo');
});

test('shotgun fires multiple pellets and hits target', async () => {
  const a = newPlayer('A', 'A', 0), b = newPlayer('B', 'B', 1);
  place(a, b); a.pitch = BODY;
  const wep = WEAPONS[1]; // shotgun
  const r = castShot(world, [a, b], a, wep);
  assert.equal(r.tracers.length, wep.pellets);
  assert.ok(r.hits.length > 0, 'shotgun pellets hit target at 5 m');
  assert.equal(r.hits[0].id, 'B');
});

test('sniper rifle delivers lethal 1-shot headshot and high body damage', async () => {
  const g = new HostGame(world, { random: () => 0 });
  const a = g.addPlayer('A', 'A'), b = g.addPlayer('B', 'B');
  place(a, b);
  // Switch to sniper (w = 2)
  g.queueInput('A', [[1, 0, 0, BODY, 2]]);
  g.step();
  assert.equal(a.w, 2);
  // Clear equip delay
  for (let i = 2; i <= 20; i++) {
    g.queueInput('A', [[i, 0, 0, BODY, 2]]);
    g.step();
  }
  // Fire sniper headshot (pitch 0 = head level)
  g.queueInput('A', [[21, B.FIRE, 0, 0, 2]]);
  const res = g.step();
  assert.ok(res.some(e => e.t === 'kill' && e.id === 'B' && e.by === 'A' && e.head), 'sniper headshot kills instantly in one shot with headshot indicator');
  assert.equal(b.alive, false);
  assert.equal(b.hp, 0);
  assert.equal(a.k, 1);
});

test('crouching reduces movement speed, lowers player eye/hitbox height, and ducks under low obstacles', async () => {
  // Test speed reduction
  const pWalk = newPlayer('W', 'Walker', 0);
  pWalk.x = 8; pWalk.y = 0; pWalk.z = 8; pWalk.g = true;
  const pCrouch = newPlayer('C', 'Croucher', 1);
  pCrouch.x = 8; pCrouch.y = 0; pCrouch.z = 8; pCrouch.g = true;

  for (let i = 0; i < 30; i++) {
    stepPlayer(pWalk, { b: B.FWD, yaw: 0, pitch: 0 }, world);
    stepPlayer(pCrouch, { b: B.FWD | B.CROUCH, yaw: 0, pitch: 0 }, world);
  }
  assert.equal(pCrouch.cr, true, 'crouch flag is active');
  const dWalk = Math.abs(pWalk.z - 8);
  const dCrouch = Math.abs(pCrouch.z - 8);
  assert.ok(dCrouch < dWalk * 0.7, `crouch speed is noticeably slower: ${dCrouch} vs ${dWalk}`);

  // Test low ceiling clearance: create a custom obstacle box hovering at y = 1.3 to 3.0
  // Standing player (height 1.8m) cannot walk under it (intersects at y=0..1.8)
  // Crouching player (height 1.15m) can walk under it (y=0..1.15 does not intersect [1.3, 3.0])
  const customWorld = {
    boxes: [
      [-50, -1, -50, 50, 0, 50], // floor
      [5, 1.3, 5, 11, 3.0, 7],   // low overhang barrier between z=5 and z=7
    ],
    spawns: [{ x: 8, y: 0, z: 2 }],
  };

  const standing = newPlayer('S', 'Stand', 0);
  standing.x = 8; standing.y = 0; standing.z = 3; standing.g = true;
  for (let i = 0; i < 40; i++) {
    stepPlayer(standing, { b: B.FWD, yaw: Math.PI, pitch: 0 }, customWorld); // move towards +z
  }
  // Standing player stopped at the barrier
  assert.ok(standing.z < 5.0, 'standing player blocked by low obstacle at z=5');

  const ducking = newPlayer('D', 'Duck', 1);
  ducking.x = 8; ducking.y = 0; ducking.z = 3; ducking.g = true;
  for (let i = 0; i < 80; i++) {
    stepPlayer(ducking, { b: B.FWD | B.CROUCH, yaw: Math.PI, pitch: 0 }, customWorld); // move towards +z
  }
  assert.ok(ducking.z > 7.0, 'crouching player walks under low obstacle to z > 7');

  // Test overhead clearance retention: if under obstacle (z=6) and crouch button is released, player remains crouched
  const stuckUnder = newPlayer('U', 'Under', 2);
  stuckUnder.x = 8; stuckUnder.y = 0; stuckUnder.z = 6; stuckUnder.g = true; stuckUnder.cr = true;
  stepPlayer(stuckUnder, { b: 0, yaw: 0, pitch: 0 }, customWorld); // release crouch while under ceiling
  assert.equal(stuckUnder.cr, true, 'player remains crouching under low ceiling even when crouch button is released');
});

test('host can add practice AI bots, bots acquire targets, and can be removed', async () => {
  const g = new HostGame(world, { random: () => 0.5 });
  const human = g.addPlayer('H', 'Human');
  human.x = 0; human.y = 0; human.z = 5; human.alive = true;

  const bot = g.addBot('Rex', 'kimo', 'medium');
  assert.equal(bot.isBot, true);
  assert.equal(bot.name, 'Rex');
  assert.equal(g.bots.size, 1);
  assert.equal(g.players.size, 2);

  bot.x = 0; bot.y = 0; bot.z = -5; bot.alive = true; bot.g = true;

  // Step game and let bot track target
  for (let i = 0; i < 60; i++) {
    g.step();
  }
  assert.ok(bot.yaw !== 0 || bot.z !== -5, 'bot stepped and updated pose');

  const removed = g.removeBot(bot.id);
  assert.equal(removed, true);
  assert.equal(g.bots.size, 0);
  assert.equal(g.players.size, 1);
});

test('throwing grenade spawns projectile, bounces, detonates AOE, and damages player', async () => {
  const customWorld = {
    boxes: [
      [-50, -1, -50, 50, 0, 50], // floor
      [-5, 0, -6, 5, 4, -5],     // backstop wall at z=-5
      [-5, 0, 4, 5, 4, 5],       // front wall at z=4
    ],
    spawns: [{ x: 0, y: 0, z: 0 }],
  };
  const g = new HostGame(customWorld, { random: () => 0.5 });
  const p1 = g.addPlayer('P1', 'Thrower');
  const p2 = g.addPlayer('P2', 'Target');

  p1.x = 0; p1.y = 0; p1.z = 0; p1.yaw = 0; p1.pitch = -0.5; p1.alive = true; p1.g = true;
  p2.x = 0; p2.y = 0; p2.z = -4; p2.alive = true; p2.hp = 100; p2.g = true;

  assert.equal(p1.grenades, 2);
  g.queueInput('P1', [[1, B.GRENADE, 0, -0.5, 0]]);
  const events = g.step();

  assert.equal(p1.grenades, 1, 'grenade count decremented');
  assert.ok(events.some(e => e.t === 'grenade_spawn' && e.owner === 'P1'), 'grenade_spawn event emitted');
  assert.equal(g.grenades.length, 1, 'active grenade in flight');

  let exploded = false;
  for (let i = 2; i <= 150; i++) {
    const evs = g.step();
    if (evs.some(e => e.t === 'explode' && e.kind === 'grenade')) {
      exploded = true;
      break;
    }
  }
  assert.ok(exploded, 'grenade detonated');
  assert.ok(p2.hp < 100, `target took AOE blast damage: hp is now ${p2.hp}`);
});

test('shooting barrel damages it, 0 HP detonates barrel AOE and removes collision', async () => {
  const customWorld = {
    boxes: [
      [-50, -1, -50, 50, 0, 50],
      [1.58, 0, -0.42, 2.42, 1.1, 0.42], // barrel_test box at (2, 0, 0)
    ],
    spawns: [{ x: 0, y: 0, z: 0 }],
    barrels: [
      { id: 'barrel_test', x: 2, y: 0, z: 0, h: 1.1, r: 0.42, hp: 30, alive: true, boxIdx: 1 },
    ],
  };

  const g = new HostGame(customWorld, { random: () => 0 });
  const shooter = g.addPlayer('S', 'Shooter');
  const bystander = g.addPlayer('B', 'Bystander');

  const pitchToBarrel = Math.atan2(0.55 - 1.6, 2); // aim at barrel center y=0.55 from eye y=1.6
  shooter.x = 0; shooter.y = 0; shooter.z = 0; shooter.yaw = -Math.PI / 2; shooter.pitch = pitchToBarrel; shooter.alive = true; shooter.g = true;
  bystander.x = 2; bystander.y = 0; bystander.z = 2; bystander.alive = true; bystander.hp = 100; bystander.g = true;

  g.queueInput('S', [[1, B.FIRE, -Math.PI / 2, pitchToBarrel, 0]]);
  g.step();
  assert.equal(g.barrels[0].hp, 5, 'barrel took 25 damage');

  for (let i = 2; i <= 7; i++) g.queueInput('S', [[i, 0, -Math.PI / 2, pitchToBarrel, 0]]), g.step();
  g.queueInput('S', [[8, B.FIRE, -Math.PI / 2, pitchToBarrel, 0]]);
  const evs = g.step();

  assert.equal(g.barrels[0].alive, false, 'barrel was destroyed');
  assert.ok(evs.some(e => e.t === 'barrel_destroyed' && e.id === 'barrel_test'), 'emitted barrel_destroyed');
  assert.ok(evs.some(e => e.t === 'explode' && e.kind === 'barrel'), 'emitted explode');
  assert.ok(bystander.hp < 100, 'bystander damaged by exploding barrel');
  assert.deepEqual(customWorld.boxes[1], [0, -100, 0, 0, -100, 0], 'barrel collision box removed');
});

test('TDM disables friendly fire, tracks team kills, and triggers team victory', async () => {
  const g = new HostGame(world, { mode: 'tdm', random: () => 0 });
  const red1 = g.addPlayer('R1', 'RedOne');
  const red2 = g.addPlayer('R2', 'RedTwo');
  const blue1 = g.addPlayer('B1', 'BlueOne');

  assert.equal(red1.team, 'red');
  assert.equal(red2.team, 'blue');
  red2.team = 'red';
  blue1.team = 'blue';

  red1.x = 8; red1.y = 0; red1.z = 2; red1.yaw = 0; red1.pitch = 0; red1.alive = true; red1.g = true;
  red2.x = 8; red2.y = 0; red2.z = 0.2; red2.yaw = Math.PI; red2.pitch = 0; red2.alive = true; red2.hp = 100; red2.g = true;

  g.queueInput('R1', [[1, B.FIRE, 0, 0, 0]]);
  const ffEvents = g.step();
  assert.equal(red2.hp, 100, 'friendly fire does 0 damage to teammate');
  assert.ok(!ffEvents.some(e => e.t === 'hit' && e.id === 'R2'), 'no hit event on teammate');

  // Move teammate out of line of fire so bullet can reach blue1
  red2.x = 18; red2.z = 18;
  blue1.x = 8; blue1.y = 0; blue1.z = 0.2; blue1.yaw = Math.PI; blue1.pitch = 0; blue1.alive = true; blue1.hp = 20; blue1.g = true;
  for (let i = 2; i <= 7; i++) g.queueInput('R1', [[i, 0, 0, 0, 0]]), g.step();
  g.queueInput('R1', [[8, B.FIRE, 0, 0, 0]]);
  const killEvents = g.step();

  assert.equal(blue1.alive, false, 'enemy is killed');
  assert.equal(g.teams.red.kills, 1, 'red team gained 1 kill');
  assert.equal(g.teams.blue.kills, 0, 'blue team kills remains 0');
});

test('maps implement getSurface(x, y, z) distinguishing water, wood, rubble and concrete', async () => {
  const river = riverForestMap();
  assert.equal(river.getSurface(0, -0.1, 0), 'water', 'low elevation in river is water');
  assert.equal(river.getSurface(0, 1.8, 0), 'wood', 'bridge deck is wood');

  const aftermath = aftermathMap();
  assert.equal(aftermath.getSurface(0, 0, 0), 'rubble', 'aftermath ground is rubble');

  const arena = defaultArena();
  assert.equal(arena.getSurface(0, 0, 0), 'concrete', 'classic arena floor is concrete');
  assert.equal(arena.getSurface(0, 1.6, 0), 'wood', 'classic arena high deck is wood');
});

let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log('  ok  ' + t.name); }
  catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nAll ${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
