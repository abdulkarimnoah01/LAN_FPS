// Shared-folder signaling: two clients over one fake in-memory directory handle.
import assert from 'node:assert/strict';
import { FolderSignalingClient } from '../src/net_folder.js';

class FakeFile {
  constructor() { this.kind = 'file'; this.text = ''; this.lastModified = Date.now(); }
  async getFile() { return { text: async () => this.text, lastModified: this.lastModified }; }
  async createWritable() {
    let buf = '';
    return { write: async s => { buf += s; }, close: async () => { this.text = buf; this.lastModified = Date.now(); } };
  }
}
class FakeDir {
  constructor() { this.kind = 'directory'; this.map = new Map(); }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.map.has(name)) { if (!create) throw new Error('NotFound'); this.map.set(name, new FakeDir()); }
    return this.map.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (!this.map.has(name)) { if (!create) throw new Error('NotFound'); this.map.set(name, new FakeFile()); }
    return this.map.get(name);
  }
  async removeEntry(name) { if (!this.map.delete(name)) throw new Error('NotFound'); }
  async *entries() { for (const e of [...this.map.entries()]) yield e; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (c, t) => new Promise(r => { const un = c.on(t, m => { un(); r(m); }); });

const dir = new FakeDir();
const host = new FolderSignalingClient(dir), guest = new FolderSignalingClient(dir);
await host.connect(); await guest.connect();
host.send({ t: 'identity', peerId: 'hostA', name: 'Host' });
guest.send({ t: 'identity', peerId: 'guestB', name: 'Guest' });

console.log('Running folder signaling tests...');

const created = once(host, 'room_created');
host.send({ t: 'create_room', name: 'LAN Room', map: 'foundry', mode: 'ffa', max: 2 });
const { code } = await created;
assert.match(code, /^[A-Z0-9]{5}$/);
console.log('  ok  host creates a room with a 5 character code');

const list = once(guest, 'room_list');
guest.send({ t: 'list_rooms' });
const rooms = (await list).rooms;
assert.equal(rooms.length, 1);
assert.equal(rooms[0].code, code);
assert.equal(rooms[0].host, 'Host');
console.log('  ok  guest sees the room in the folder');

const reserved = once(guest, 'join_reserved'), request = once(host, 'guest_join_request');
guest.send({ t: 'join_room', code, char: 'mina' });
assert.equal((await reserved).room.map, 'foundry');
const req = await request;
assert.equal(req.peerId, 'guestB');
assert.equal(req.char, 'mina');
console.log('  ok  join reaches the host as a guest_join_request');

const got = [];
guest.on('signal', m => got.push(m));
host.send({ t: 'signal', target: 'guestB', signal: { type: 'offer', n: 1 } });
host.send({ t: 'signal', target: 'guestB', signal: { candidate: 'a' } });
host.send({ t: 'signal', target: 'guestB', signal: { candidate: 'b' } });
await wait(1500);
assert.deepEqual(got.map(m => m.from), ['hostA', 'hostA', 'hostA']);
assert.equal(got[0].signal.type, 'offer', 'offer is delivered before its candidates');
console.log('  ok  signals arrive in order with an authentic sender id');

host.send({ t: 'guest_joined_ack', peerId: 'guestB' });
await wait(300);
const full = once(guest, 'error');
guest.send({ t: 'join_room', code });
assert.equal((await full).code, 'ROOM_FULL');
console.log('  ok  a full room refuses further guests');

const closed = once(guest, 'error');
host.send({ t: 'leave_room' });
assert.equal((await closed).code, 'HOST_CLOSED');
const empty = once(guest, 'room_list');
guest.send({ t: 'list_rooms' });
assert.equal((await empty).rooms.length, 0);
console.log('  ok  closing the room notifies guests and removes it from the folder');

host.close(); guest.close();
console.log('All folder signaling tests passed!');
