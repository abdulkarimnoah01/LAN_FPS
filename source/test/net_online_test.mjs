/* Test suite for Online WebRTC Transport with real Matchmaking Server */

import assert from 'node:assert/strict';
import { createServer } from '../../server/index.mjs';
import { OnlineSignalingClient, OnlineNetHost, OnlineNetGuest, LinkError } from '../src/net_online.js';
import { fakeOnlineRTC } from './fakes_online.mjs';

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

test('OnlineNetHost and OnlineNetGuest connect over signaling, establish WebRTC DataChannels, and exchange data', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const serverUrl = `ws://127.0.0.1:${port}`;

  const RTC = fakeOnlineRTC();

  // 1. Host creates room
  const hostSignal = new OnlineSignalingClient(serverUrl);
  const hostPeers = [];
  const hostGot = [];
  const hostLeft = [];

  const host = new OnlineNetHost({
    signaling: hostSignal,
    RTC,
    id: 'host_session_xyz',
    name: 'Major Nora',
    roomName: 'Online Arena 1',
    map: 'foundry',
    seed: 42,
    mode: 'ffa',
    max: 6,
    onPeer: p => hostPeers.push(p),
    onMessage: (p, m) => hostGot.push([p.id, m]),
    onLeave: p => hostLeft.push(p.id),
  });

  const code = await host.start();
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);

  // 2. Guest connects to room
  const guestSignal = new OnlineSignalingClient(serverUrl);
  const guestGot = [];
  const statuses = [];

  const guest = new OnlineNetGuest({
    signaling: guestSignal,
    RTC,
    id: 'guest_session_abc',
    name: 'Ghost Hunter',
    char: 'abdulkarim',
    onMessage: m => guestGot.push(m),
    onClose: () => {},
  });

  await guest.connect({ code }, { onStatus: s => statuses.push(s) });

  await until(() => hostPeers.length === 1, 3000, 'host to register guest peer');
  assert.equal(hostPeers[0].id, 'guest_session_abc');
  assert.equal(hostPeers[0].name, 'Ghost Hunter');

  // 3. Test data exchange
  guest.send({ t: 'i', seq: 1, yaw: 0.5 }, true);
  guest.send({ t: 'ping', c: 100 }, false);

  host.broadcast({ t: 's', tick: 60 }, true);
  host.send(hostPeers[0], { t: 'kill', id: 'target_1' }, false);

  await until(() => hostGot.length === 2 && guestGot.length === 2, 3000, 'messages to flow both directions');

  assert.deepEqual(hostGot.map(x => x[1].t).sort(), ['i', 'ping']);
  assert.deepEqual(guestGot.map(x => x.t).sort(), ['kill', 's']);

  // 4. Guest disconnect
  guest.close();
  await until(() => hostLeft.length === 1, 2000, 'host to notice guest leave');
  assert.equal(hostLeft[0], 'guest_session_abc');

  // 5. Host stop
  await host.stop();
  hostSignal.close();
  guestSignal.close();
  close();
});

test('Multi-client room connection and host capacity rejection', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const serverUrl = `ws://127.0.0.1:${port}`;
  const RTC = fakeOnlineRTC();

  const hostSignal = new OnlineSignalingClient(serverUrl);
  const hostPeers = [];

  const host = new OnlineNetHost({
    signaling: hostSignal,
    RTC,
    id: 'host_multi',
    name: 'Host Multi',
    roomName: '2-Player Max',
    max: 2, // Host + 1 guest only
    onPeer: p => hostPeers.push(p),
  });

  const code = await host.start();

  // Guest 1 connects
  const g1Signal = new OnlineSignalingClient(serverUrl);
  const g1 = new OnlineNetGuest({
    signaling: g1Signal, RTC, id: 'guest_1', name: 'G1', char: 'kimo',
  });
  await g1.connect({ code });
  await until(() => hostPeers.length === 1, 2000, 'host to register guest 1');

  // Guest 2 attempts to connect -> rejected by server as room full
  const g2Signal = new OnlineSignalingClient(serverUrl);
  const g2 = new OnlineNetGuest({
    signaling: g2Signal, RTC, id: 'guest_2', name: 'G2', char: 'mina',
  });

  await assert.rejects(
    g2.connect({ code }),
    e => e instanceof LinkError && /full/i.test(e.message)
  );

  g1.close();
  g2.close();
  await host.stop();
  hostSignal.close();
  g1Signal.close();
  g2Signal.close();
  close();
});

async function run() {
  console.log(`Running ${tests.length} online networking tests...`);
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
  console.log('All online networking tests passed!');
}

run();
