/* Automated Unit Tests for Spectre Orbit Online Matchmaking & Signaling Server */

import assert from 'node:assert/strict';
import { createServer } from '../index.mjs';
import { WebSocket } from 'ws';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.messages = [];
    ws.on('message', data => {
      ws.messages.push(JSON.parse(data.toString()));
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function waitForMessage(ws, predicate, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = ws.messages.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for message matching predicate in: ${JSON.stringify(ws.messages)}`);
}

test('HTTP endpoints (/health, /ice, /rooms)', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.status, 'ok');
  assert.equal(healthData.protocol, 'spectre-1.5');

  const iceRes = await fetch(`http://127.0.0.1:${port}/ice`);
  assert.equal(iceRes.status, 200);
  const iceData = await iceRes.json();
  assert(Array.isArray(iceData.iceServers));
  assert(iceData.iceServers.length > 0);

  const roomsRes = await fetch(`http://127.0.0.1:${port}/rooms`);
  assert.equal(roomsRes.status, 200);
  const roomsData = await roomsRes.json();
  assert(Array.isArray(roomsData));

  close();
});

test('WebSocket handshake, room creation, browsing, and reservation', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // 1. Host connects
  const hostWs = await connectWs(port);
  const welcome = await waitForMessage(hostWs, m => m.t === 'welcome');
  assert.equal(welcome.protocol, 'spectre-1.5');
  assert(welcome.sessionId);

  hostWs.send(JSON.stringify({ t: 'identity', peerId: 'host_peer_1', name: 'Commander' }));
  hostWs.send(JSON.stringify({ t: 'create_room', name: 'Alpha Strike', map: 'foundry', mode: 'ffa', max: 6 }));

  const created = await waitForMessage(hostWs, m => m.t === 'room_created');
  assert.match(created.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
  assert.equal(created.room.name, 'Alpha Strike');
  assert.equal(created.room.map, 'foundry');

  // 2. Guest connects and browses
  const guestWs = await connectWs(port);
  await waitForMessage(guestWs, m => m.t === 'welcome');
  guestWs.send(JSON.stringify({ t: 'identity', peerId: 'guest_peer_1', name: 'Scout' }));
  guestWs.send(JSON.stringify({ t: 'list_rooms' }));

  const roomList = await waitForMessage(guestWs, m => m.t === 'room_list');
  assert.equal(roomList.rooms.length, 1);
  assert.equal(roomList.rooms[0].code, created.code);
  assert.equal(roomList.rooms[0].host, 'Commander');

  // 3. Guest joins
  guestWs.send(JSON.stringify({ t: 'join_room', code: created.code, char: 'abdulkarim' }));
  const reserved = await waitForMessage(guestWs, m => m.t === 'join_reserved');
  assert.equal(reserved.code, created.code);

  const hostJoinReq = await waitForMessage(hostWs, m => m.t === 'guest_join_request');
  assert.equal(hostJoinReq.peerId, 'guest_peer_1');
  assert.equal(hostJoinReq.name, 'Scout');

  // 4. Signaling routing: Host sends offer to guest
  hostWs.send(JSON.stringify({
    t: 'signal',
    target: 'guest_peer_1',
    signal: { type: 'offer', sdp: 'fake-sdp-offer' }
  }));

  const guestSignal = await waitForMessage(guestWs, m => m.t === 'signal');
  assert.equal(guestSignal.from, 'host_peer_1');
  assert.equal(guestSignal.signal.sdp, 'fake-sdp-offer');

  // 5. Signaling routing: Guest sends answer to host
  guestWs.send(JSON.stringify({
    t: 'signal',
    target: 'host_peer_1',
    signal: { type: 'answer', sdp: 'fake-sdp-answer' }
  }));

  const hostSignal = await waitForMessage(hostWs, m => m.t === 'signal' && m.signal.type === 'answer');
  assert.equal(hostSignal.from, 'guest_peer_1');
  assert.equal(hostSignal.signal.sdp, 'fake-sdp-answer');

  // 6. Host confirms guest joined
  hostWs.send(JSON.stringify({
    t: 'guest_joined_ack',
    peerId: 'guest_peer_1',
    reservationId: hostJoinReq.reservationId
  }));

  const hostRoomState = await waitForMessage(hostWs, m => m.t === 'room_state');
  assert.equal(hostRoomState.players, 2);

  hostWs.close();
  guestWs.close();
  close();
});

test('Host disconnect notifies guests and removes room', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const hostWs = await connectWs(port);
  hostWs.send(JSON.stringify({ t: 'identity', peerId: 'host_2', name: 'Host2' }));
  hostWs.send(JSON.stringify({ t: 'create_room', name: 'Temp Room' }));
  const created = await waitForMessage(hostWs, m => m.t === 'room_created');

  const guestWs = await connectWs(port);
  guestWs.send(JSON.stringify({ t: 'identity', peerId: 'guest_2', name: 'Guest2' }));
  guestWs.send(JSON.stringify({ t: 'join_room', code: created.code }));
  await waitForMessage(guestWs, m => m.t === 'join_reserved');

  // Host closes connection
  hostWs.close();

  const guestErr = await waitForMessage(guestWs, m => m.t === 'error' && m.code === 'HOST_DISCONNECTED');
  assert.equal(guestErr.code, 'HOST_DISCONNECTED');

  const roomsRes = await fetch(`http://127.0.0.1:${port}/rooms`);
  const rooms = await roomsRes.json();
  assert.equal(rooms.length, 0);

  guestWs.close();
  close();
});

test('Capacity enforcement with reservations', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Create room with max 2 players
  const hostWs = await connectWs(port);
  hostWs.send(JSON.stringify({ t: 'identity', peerId: 'host_cap', name: 'Host' }));
  hostWs.send(JSON.stringify({ t: 'create_room', name: 'Duo Only', max: 2 }));
  const created = await waitForMessage(hostWs, m => m.t === 'room_created');

  // Guest 1 joins and takes reservation
  const guest1Ws = await connectWs(port);
  guest1Ws.send(JSON.stringify({ t: 'identity', peerId: 'guest_1', name: 'G1' }));
  guest1Ws.send(JSON.stringify({ t: 'join_room', code: created.code }));
  await waitForMessage(guest1Ws, m => m.t === 'join_reserved');

  // Guest 2 attempts to join -> should be rejected with ROOM_FULL
  const guest2Ws = await connectWs(port);
  guest2Ws.send(JSON.stringify({ t: 'identity', peerId: 'guest_2', name: 'G2' }));
  guest2Ws.send(JSON.stringify({ t: 'join_room', code: created.code }));
  const fullErr = await waitForMessage(guest2Ws, m => m.t === 'error' && m.code === 'ROOM_FULL');
  assert.equal(fullErr.code, 'ROOM_FULL');

  hostWs.close();
  guest1Ws.close();
  guest2Ws.close();
  close();
});

test('Rate limiting kicks in when flooded', async () => {
  const { server, close } = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const ws = await connectWs(port);
  await waitForMessage(ws, m => m.t === 'welcome');

  // Send 50 messages rapidly
  for (let i = 0; i < 50; i++) {
    ws.send(JSON.stringify({ t: 'ping', c: i }));
  }

  const rateErr = await waitForMessage(ws, m => m.t === 'error' && m.code === 'RATE_LIMIT');
  assert.equal(rateErr.code, 'RATE_LIMIT');

  ws.close();
  close();
});

async function runAll() {
  console.log(`Running ${tests.length} server unit tests...`);
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
  console.log('All server unit tests passed!');
}

runAll();
