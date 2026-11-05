/* Spectre Orbit Light: shared-folder signaling.
   Same client contract as OnlineSignalingClient (on / send / connected / iceServers), but the
   "matchmaking server" is a folder both PCs can read and write. Gameplay still runs over a
   direct WebRTC DataChannel; the folder only carries the room list and the offer/answer notes.

   folder/rooms/<CODE>.json   the host rewrites it every 2 s while the room is open
   folder/inbox/<peerId>/*.json  messages addressed to one peer; the reader deletes each after use */

const POLL_MS = 400;
const ROOM_REFRESH_MS = 2000;
const ROOM_TTL_MS = 9000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rand = n => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class FolderSignalingClient {
  constructor(dir) {
    this.dir = dir;
    this.kind = 'folder';
    this.connected = false;
    this.sessionId = null;
    this.iceServers = []; // LAN host candidates need no STUN
    this.handlers = new Map();
    this.id = null;
    this.name = 'Player';
    this.room = null;     // set while this peer hosts: { info, players:Set }
    this.hostId = null;   // set while this peer is a guest
    this.seq = 0;
    this.busy = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of [...set]) fn(data);
  }

  async connect() {
    if (this.connected) return;
    this.rooms = await this.dir.getDirectoryHandle('rooms', { create: true });
    this.inbox = await this.dir.getDirectoryHandle('inbox', { create: true });
    this.sessionId = 'f' + rand(8);
    this.connected = true;
    this.pollTimer = setInterval(() => this._poll(), POLL_MS);
    this.emit('status', 'Connected to shared folder');
  }

  send(msg) {
    this._handle(msg).catch(e => {
      console.warn('[folder]', e);
      this.emit('error', { t: 'error', code: 'FOLDER_IO', message: 'Shared folder error: ' + (e?.message || e) });
    });
  }

  close() {
    clearInterval(this.pollTimer);
    clearInterval(this.roomTimer);
    if (this.room) this._closeRoom().catch(() => {});
    this.connected = false;
    this.emit('close');
  }

  async _write(dirHandle, name, obj) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj));
    await w.close();
  }

  async _post(target, msg) {
    const name = `${Date.now()}-${String(this.seq++).padStart(6, '0')}-${rand(3)}.json`; // named before any await so order is kept
    const box = await this.inbox.getDirectoryHandle(target, { create: true });
    await this._write(box, name, msg);
  }

  async _readJson(fh) {
    try { return JSON.parse(await (await fh.getFile()).text()); } catch { return null; }
  }

  async _poll() {
    if (this.busy || !this.id) return;
    this.busy = true;
    try {
      const box = await this.inbox.getDirectoryHandle(this.id, { create: true });
      const files = [];
      for await (const [name, h] of box.entries()) if (h.kind === 'file') files.push([name, h]);
      files.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      for (const [name, h] of files) {
        const msg = await this._readJson(h);
        if (!msg) {
          // Still being written by the other PC; drop it only if it is clearly stale.
          const f = await h.getFile();
          if (Date.now() - f.lastModified > 15000) await box.removeEntry(name).catch(() => {});
          continue;
        }
        await box.removeEntry(name).catch(() => {});
        if (msg.t) this.emit(msg.t, msg);
      }
    } catch (e) {
      console.warn('[folder] poll', e);
    } finally {
      this.busy = false;
    }
  }

  async _listRooms() {
    const out = [];
    for await (const [name, h] of this.rooms.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      const r = await this._readJson(h);
      if (!r || Date.now() - r.ts > ROOM_TTL_MS) {
        // Abandoned room (host closed the tab); sweep it so the list stays clean.
        if (!r || Date.now() - r.ts > ROOM_TTL_MS * 4) await this.rooms.removeEntry(name).catch(() => {});
        continue;
      }
      out.push(r);
    }
    return out;
  }

  async _publishRoom() {
    if (!this.room) return;
    const info = { ...this.room.info, players: this.room.players.size, ts: Date.now() };
    await this._write(this.rooms, info.code + '.json', info);
  }

  async _closeRoom() {
    const room = this.room;
    this.room = null;
    clearInterval(this.roomTimer);
    for (const pid of room.players) {
      if (pid !== this.id) await this._post(pid, { t: 'error', code: 'HOST_CLOSED', message: 'Host has closed the match.' }).catch(() => {});
    }
    await this.rooms.removeEntry(room.info.code + '.json').catch(() => {});
  }

  async _handle(msg) {
    switch (msg.t) {
      case 'ping':
        this.emit('pong', { t: 'pong', c: msg.c });
        break;

      case 'identity':
        this.id = String(msg.peerId || this.sessionId).slice(0, 32).replace(/[^\w-]/g, '_');
        this.name = String(msg.name || 'Player').slice(0, 24);
        await this.inbox.getDirectoryHandle(this.id, { create: true });
        break;

      case 'create_room': {
        if (this.room) { this.emit('error', { t: 'error', code: 'ALREADY_IN_ROOM', message: 'Already in a room.' }); return; }
        const taken = new Set((await this._listRooms()).map(r => r.code));
        let code;
        do code = rand(5); while (taken.has(code));
        const max = Math.min(Math.max(parseInt(msg.max || '6', 10), 2), 12);
        const info = {
          code, name: String(msg.name || `${this.name}'s Match`).slice(0, 32), host: this.name, hostPeerId: this.id,
          map: String(msg.map || 'foundry').slice(0, 24), seed: parseInt(msg.seed || '0', 10) || 0,
          mode: String(msg.mode || 'ffa').slice(0, 8), max, isPrivate: !!msg.isPrivate,
        };
        this.room = { info, players: new Set([this.id]) };
        await this._publishRoom();
        this.roomTimer = setInterval(() => this._publishRoom().catch(() => {}), ROOM_REFRESH_MS);
        this.emit('room_created', { t: 'room_created', code, room: { ...info, maxPlayers: max } });
        break;
      }

      case 'heartbeat':
        break; // the folder client refreshes the room file on its own timer

      case 'list_rooms': {
        const rooms = (await this._listRooms()).filter(r => !r.isPrivate)
          .map(r => ({ code: r.code, name: r.name, host: r.host, map: r.map, mode: r.mode, players: r.players, max: r.max }));
        this.emit('room_list', { t: 'room_list', rooms });
        break;
      }

      case 'join_room': {
        const code = String(msg.code || '').trim().toUpperCase();
        const r = (await this._listRooms()).find(x => x.code === code);
        if (!r) { this.emit('error', { t: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found in this folder, or the host is gone.' }); return; }
        if (r.players >= r.max) { this.emit('error', { t: 'error', code: 'ROOM_FULL', message: 'Room is at full capacity.' }); return; }
        this.hostId = r.hostPeerId;
        const reservationId = 'r' + rand(10);
        this.emit('join_reserved', {
          t: 'join_reserved', code, reservationId,
          room: { code, name: r.name, host: r.host, map: r.map, seed: r.seed, mode: r.mode, maxPlayers: r.max },
        });
        await this._post(r.hostPeerId, { t: 'guest_join_request', reservationId, peerId: this.id, name: this.name, char: String(msg.char || '').slice(0, 32) });
        break;
      }

      case 'guest_joined_ack':
        if (this.room && msg.peerId) { this.room.players.add(msg.peerId); await this._publishRoom(); }
        break;

      case 'guest_left':
        if (this.room) { this.room.players.delete(msg.peerId); await this._publishRoom(); }
        break;

      case 'signal':
        if (msg.target) await this._post(String(msg.target).replace(/[^\w-]/g, '_'), { t: 'signal', from: this.id, signal: msg.signal });
        break;

      case 'leave_room':
        if (this.room) await this._closeRoom();
        else if (this.hostId) {
          await this._post(this.hostId, { t: 'peer_disconnected', peerId: this.id }).catch(() => {});
          this.hostId = null;
        }
        break;
    }
  }
}

/* Directory handle persistence (IndexedDB) so the folder is remembered between visits. */
const idb = (mode, fn) => new Promise((resolve, reject) => {
  const open = indexedDB.open('spectre-orbit-light', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('kv');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  };
});

export const saveFolderHandle = h => idb('readwrite', s => s.put(h, 'folder')).catch(() => {});
export const savedFolderHandle = () => idb('readonly', s => s.get('folder')).catch(() => null);

export async function pickFolder() {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot open shared folders. Use Chrome or Edge.');
  const h = await window.showDirectoryPicker({ id: 'spectre-light', mode: 'readwrite' });
  saveFolderHandle(h);
  return h;
}

/* Reuse the remembered folder when its permission is still granted (or can be re-granted by this click). */
export async function rememberedFolder(prompt = true) {
  const h = await savedFolderHandle();
  if (!h) return null;
  try {
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return h;
    if (prompt && (await h.requestPermission({ mode: 'readwrite' })) === 'granted') return h;
  } catch {}
  return null;
}
