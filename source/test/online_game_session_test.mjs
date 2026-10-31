/* End-to-end integration test of HostSession and GuestSession over OnlineNetHost / OnlineNetGuest */

import assert from 'node:assert/strict';
import { createServer } from '../../server/index.mjs';
import { OnlineSignalingClient, OnlineNetHost, OnlineNetGuest } from '../src/net_online.js';
import { fakeOnlineRTC } from './fakes_online.mjs';
import { HostSession, GuestSession } from '../src/game.js';
import { getMap } from '../src/arena.js';
import { B } from '../src/sim.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function until(fn, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error('Timed out waiting for ' + what);
}

test('Online HostSession & GuestSession run authoritative gameplay, prediction, and hitscan combat', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const serverUrl = `ws://127.0.0.1:${port}`;
  const RTC = fakeOnlineRTC();

  const world = getMap('arena', 0);

  // Mock view and hud
  const mockView = {
    shot: () => {},
    meleeSlash: () => {},
    spawnGrenade: () => {},
    explode: () => {},
    destroyBarrel: () => {},
    render: () => {},
  };
  const mockHud = {
    update: () => {},
    hitmarker: () => {},
    hurt: () => {},
    feed: () => {},
    elimination: () => {},
  };

  const hostSignal = new OnlineSignalingClient(serverUrl);
  const hostSession = new HostSession({
    signaling: hostSignal,
    NetHostClass: OnlineNetHost,
    RTC,
    world,
    id: 'host_p1',
    name: 'General Knox',
    char: 'abdulkarim',
    roomName: 'Pro Deathmatch',
    map: 'forest',
    seed: 42,
    mode: 'ffa',
    view: mockView,
    hud: mockHud,
  });

  const code = await hostSession.start();
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);

  const guestSignal = new OnlineSignalingClient(serverUrl);
  const guestSession = new GuestSession({
    signaling: guestSignal,
    NetGuestClass: OnlineNetGuest,
    RTC,
    world,
    id: 'guest_p2',
    name: 'Ranger Maya',
    char: 'mina',
    map: 'forest',
    seed: 42,
    mode: 'ffa',
    view: mockView,
    hud: mockHud,
  });

  await guestSession.join({ code });

  // Wait for both players to enter match
  await until(() => hostSession.game.players.size === 2, 3000, 'host game to register both players');
  assert.equal(hostSession.game.players.has('host_p1'), true);
  assert.equal(hostSession.game.players.has('guest_p2'), true);

  // Simulate ticks
  guestSession.client.active = true;
  guestSession.client.input.b = B.FWD;

  for (let t = 0; t < 15; t++) {
    guestSession.client.tick();
    hostSession.step();
    await sleep(10);
  }

  // Verify guest received snapshots and has valid state
  await until(() => guestSession.client.state !== null, 2000, 'guest to receive authoritative snapshot');
  assert(guestSession.client.state.players.length === 2);

  // Combat: host shoots guest
  const guestPlayer = hostSession.game.players.get('guest_p2');
  const initialHp = guestPlayer.hp;
  assert.equal(initialHp, 100);

  // Position host and guest with direct clear line of sight
  // Game forward is -Z when yaw = 0. Host at z = 18, Guest at z = 15
  const hostPlayer = hostSession.game.players.get('host_p1');
  guestPlayer.x = 0;
  guestPlayer.y = 0;
  guestPlayer.z = 15;
  hostPlayer.x = 0;
  hostPlayer.y = 0;
  hostPlayer.z = 18;
  hostPlayer.yaw = 0;
  hostPlayer.pitch = 0;
  hostSession.client.me.x = 0;
  hostSession.client.me.y = 0;
  hostSession.client.me.z = 18;
  hostSession.client.look.yaw = 0;
  hostSession.client.look.pitch = 0;

  // Host fires shot
  hostSession.client.active = true;
  hostSession.client.input.b = B.FIRE;
  for (let i = 0; i < 10; i++) {
    hostSession.step();
    await sleep(15);
    if (guestPlayer.hp < initialHp) break;
  }

  await until(() => guestPlayer.hp < initialHp, 2000, 'guest to take damage from host shot');
  assert(guestPlayer.hp === 75 || guestPlayer.hp === 50, 'Shot deals 25 body or 50 headshot damage');

  await guestSession.stop();
  await hostSession.stop();
  hostSignal.close();
  guestSignal.close();
  close();
});

async function run() {
  console.log(`Running ${tests.length} online game session integration tests...`);
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      console.error(`  FAIL ${name}`);
      console.error(e);
      process.exit(1);
    }
  }
  console.log('All online game session tests passed!');
}

run();
