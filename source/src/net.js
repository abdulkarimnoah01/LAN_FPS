/* Finding each other and connecting.

   The shared network folder (File System Access API) is only a notice board:
     _LAN_FPS_DATA/room-CODE/room.json      host heartbeat, listed in every lobby
     _LAN_FPS_DATA/room-CODE/join-ID.json   a guest's WebRTC offer
     _LAN_FPS_DATA/room-CODE/answer-ID.json the host's WebRTC answer
   Gameplay then runs over a direct WebRTC DataChannel with no ICE servers, so it
   only ever uses the local network. A folder on an SMB share is far too slow for
   real-time play, so there is no folder fallback: if the direct link cannot be
   made the guest is told so. */

export const DATA = '_LAN_FPS_DATA';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;
const BEAT_MS = 1000, ROOM_DEAD_MS = 6000, ROOM_PURGE_MS = 10 * 60000, POLL_MS = 300;

export class LinkError extends Error { constructor(message) { super(message); this.name = 'LinkError'; } }

export function randomHex(n = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
}
function randomCode() { return Array.from(crypto.getRandomValues(new Uint8Array(5)), b => ALPHABET[b % ALPHABET.length]).join(''); }
export function cleanName(s, max = 20, fallback = 'Player') {
  const t = Array.from(String(s || '').trim()).filter(c => /[\p{L}\p{N} ._\-'#!&/()]/u.test(c)).slice(0, max).join('').trim();
  return t || fallback;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Network shares briefly refuse reads of files that just changed (stale file
// details) and can expose half-written files. Every read here is small and is
// simply retried on the next poll, so any failure means "nothing yet".
async function readJSON(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size > 256 * 1024) return null;
    const json = JSON.parse(await file.text());
    return { json, mtime: file.lastModified };
  } catch { return null; }
}
async function writeJSON(dir, name, value) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  try { await w.write(JSON.stringify(value)); await w.close(); } catch (e) { try { await w.abort(); } catch {} throw e; }
}
async function remove(dir, name, recursive = false) { try { await dir.removeEntry(name, { recursive }); } catch {} }

/* Waits until the browser has listed its local addresses (no STUN/TURN, so this
   is quick). Call before setLocalDescription, await after. */
function gathering(pc, ms = 2000, settle = 300) {
  return new Promise(resolve => {
    let quiet;
    const done = () => { clearTimeout(timer); clearTimeout(quiet); pc.removeEventListener('icecandidate', cand); pc.removeEventListener('icegatheringstatechange', state); resolve(); };
    const cand = e => { if (!e.candidate) return done(); clearTimeout(quiet); quiet = setTimeout(done, settle); };
    const state = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, ms);
    pc.addEventListener('icecandidate', cand); pc.addEventListener('icegatheringstatechange', state);
    if (pc.iceGatheringState === 'complete') done();
  });
}

/* StorageDirectory: In-browser DirectoryHandle backed by localStorage.
   Provides a seamless fallback when OPFS (navigator.storage.getDirectory())
   is restricted (e.g. running from file:// urls in Chrome). */
export class StorageDirectory {
  constructor(prefix = '_lanfps_fs:') {
    this.prefix = prefix;
    this.kind = 'directory';
    this.name = prefix;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const dirPrefix = this.prefix + name + '/';
    if (!create) {
      let exists = false;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(dirPrefix)) { exists = true; break; }
      }
      if (!exists) {
        const err = new Error('A requested file or directory could not be found');
        err.name = 'NotFoundError';
        throw err;
      }
    }
    return new StorageDirectory(dirPrefix);
  }
  async getFileHandle(name, { create = false } = {}) {
    const key = this.prefix + name;
    if (!create && localStorage.getItem(key) === null) {
      const err = new Error('A requested file or directory could not be found');
      err.name = 'NotFoundError';
      throw err;
    }
    return {
      kind: 'file',
      name,
      async getFile() {
        const val = localStorage.getItem(key);
        if (val === null) throw new Error('Not found');
        try {
          const parsed = JSON.parse(val);
          return {
            size: (parsed.data || '').length,
            lastModified: parsed.mtime || Date.now(),
            async text() { return parsed.data || ''; }
          };
        } catch {
          return {
            size: val.length,
            lastModified: Date.now(),
            async text() { return val; }
          };
        }
      },
      async createWritable() {
        let buf = '';
        return {
          async write(text) { buf += text; },
          async close() {
            localStorage.setItem(key, JSON.stringify({ data: buf, mtime: Date.now() }));
          },
          async abort() {}
        };
      }
    };
  }
  async removeEntry(name, { recursive = false } = {}) {
    const target = this.prefix + name;
    const prefixSlash = target + '/';
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === target || (recursive && k && k.startsWith(prefixSlash))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }
  async *entries() {
    const seen = new Set();
    const pLen = this.prefix.length;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.prefix)) {
        const rest = k.slice(pLen);
        const slashIdx = rest.indexOf('/');
        if (slashIdx === -1) {
          if (!seen.has(rest)) {
            seen.add(rest);
            yield [rest, { kind: 'file', name: rest }];
          }
        } else {
          const dirName = rest.slice(0, slashIdx);
          if (!seen.has(dirName)) {
            seen.add(dirName);
            yield [dirName, new StorageDirectory(this.prefix + dirName + '/')];
          }
        }
      }
    }
  }
}

/* ---- Lobby: room listing on the shared folder ---- */
export class Lobby {
  constructor(root, { now = () => performance.now(), wallNow = () => Date.now() } = {}) {
    this.root = root; this.now = now; this.wallNow = wallNow; this.seen = new Map();
  }
  async open() { this.data = await this.root.getDirectoryHandle(DATA, { create: true }); return this; }

  /* Live rooms. A room counts as live while its heartbeat keeps changing, timed
     on this PC's own clock so clock differences between PCs do not matter. A room
     seen for the first time is trusted if its own timestamp is recent. */
  async rooms() {
    const out = [];
    for await (const [name, handle] of this.data.entries()) {
      if (handle.kind !== 'directory' || !name.startsWith('room-') || !CODE.test(name.slice(5))) continue;
      const code = name.slice(5), rec = await readJSON(handle, 'room.json');
      if (!rec || rec.json.code !== code) continue;
      const r = rec.json, t = this.now();
      let s = this.seen.get(code);
      if (!s || s.beat !== r.beat) { s = { beat: r.beat, at: t, changed: !!s }; this.seen.set(code, s); }
      const live = t - s.at < ROOM_DEAD_MS && (s.changed || Math.abs(this.wallNow() - r.at) < ROOM_DEAD_MS) && !r.closed;
      if (live) out.push({ code, name: cleanName(r.name, 32, code), host: cleanName(r.host), players: r.players | 0, max: r.max | 0, phase: r.phase, map: r.map || 'forest', seed: r.seed || 0 });
      // Housekeeping: rooms abandoned long ago (crashed hosts) are removed.
      else if (rec.mtime && this.wallNow() - rec.mtime > ROOM_PURGE_MS) remove(this.data, name, true);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async createRoom(roomName, hostName) {
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      try { await this.data.getDirectoryHandle('room-' + code); continue; } catch {}
      const dir = await this.data.getDirectoryHandle('room-' + code, { create: true });
      return new RoomBoard(this, dir, code, cleanName(roomName, 32, 'Deathmatch'), cleanName(hostName));
    }
    throw Error('Could not create a room folder');
  }
}

/* Host side of the notice board. */
class RoomBoard {
  constructor(lobby, dir, code, name, host) { Object.assign(this, { lobby, dir, code, name, host, beat: 0, handled: new Set() }); }
  publish(info = {}) {
    return writeJSON(this.dir, 'room.json', { v: 1, code: this.code, name: this.name, host: this.host, beat: ++this.beat, at: this.lobby.wallNow(), ...info });
  }
  /* New join requests (each offer is handled once). */
  async joins() {
    const out = [];
    for await (const [name, h] of this.dir.entries()) {
      if (h.kind !== 'file' || !/^join-[a-f0-9]{16}\.json$/.test(name)) continue;
      const rec = await readJSON(this.dir, name);
      const j = rec?.json;
      if (!j || 'join-' + j.id + '.json' !== name || typeof j.sdp !== 'string' || j.sdp.length > 30000 || typeof j.offerId !== 'string') continue;
      if (this.handled.has(j.offerId)) continue;
      this.handled.add(j.offerId);
      out.push({ id: j.id, name: cleanName(j.name), char: typeof j.char === 'string' ? j.char.slice(0, 32) : '', offerId: j.offerId, sdp: j.sdp });
    }
    return out;
  }
  answer(id, value) { return writeJSON(this.dir, 'answer-' + id + '.json', value); }
  forget(id) { remove(this.dir, 'join-' + id + '.json'); remove(this.dir, 'answer-' + id + '.json'); }
  async close() { try { await this.publish({ closed: true }); } catch {} await remove(this.lobby.data, 'room-' + this.code, true); }
}

/* ---- Host: accepts guests and keeps one direct link per guest ---- */
export class NetHost {
  constructor({ lobby, RTC = globalThis.RTCPeerConnection, id, name, roomName, info = () => ({}), onPeer = () => {}, onMessage = () => {}, onLeave = () => {}, canJoin = () => '' }) {
    Object.assign(this, { lobby, RTC, id, name, roomName, info, onPeer, onMessage, onLeave, canJoin });
    this.peers = new Map(); this.running = false;
  }
  async start() {
    this.board = await this.lobby.createRoom(this.roomName, this.name);
    await this.board.publish(this.info());
    this.running = true; this.lastBeat = this.lobby.now();
    this.loop();
    return this.board.code;
  }
  async loop() {
    while (this.running) {
      try { await this.pollOnce(); } catch {}
      await sleep(POLL_MS);
    }
  }
  async pollOnce() {
    if (this.lobby.now() - this.lastBeat >= BEAT_MS) { this.lastBeat = this.lobby.now(); await this.board.publish(this.info()); }
    for (const req of await this.board.joins()) this.accept(req).catch(() => {});
  }
  async accept(req) {
    const refusal = this.peers.has(req.id) ? '' : this.canJoin(req);
    if (refusal) return this.board.answer(req.id, { offerId: req.offerId, error: refusal });
    const old = this.peers.get(req.id);
    if (old) this.drop(old, 'reconnected');
    const pc = new this.RTC({ iceServers: [] });
    const peer = { id: req.id, name: req.name, char: req.char, pc, rel: null, fast: null, open: false };
    this.peers.set(req.id, peer);
    const check = () => {
      if (!peer.open && peer.rel?.readyState === 'open' && peer.fast?.readyState === 'open' && this.peers.get(peer.id) === peer) {
        peer.open = true; this.board.forget(peer.id); this.onPeer(peer);
      }
    };
    pc.addEventListener('datachannel', e => {
      const ch = e.channel;
      if (ch.label === 'rel') peer.rel = ch; else if (ch.label === 'fast') peer.fast = ch; else return;
      ch.addEventListener('open', check);
      ch.addEventListener('close', () => this.drop(peer, 'closed'));
      ch.addEventListener('message', ev => { if (peer.open) { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(peer, m); } });
      check();
    });
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(peer, pc.connectionState); });
    await pc.setRemoteDescription({ type: 'offer', sdp: req.sdp });
    const answer = await pc.createAnswer(), wait = gathering(pc);
    await pc.setLocalDescription(answer); await wait;
    if (this.peers.get(req.id) !== peer) return;
    await this.board.answer(req.id, { offerId: req.offerId, sdp: pc.localDescription.sdp });
    setTimeout(() => { if (!peer.open) this.drop(peer, 'timeout'); }, 25000);
  }
  send(peer, msg, fast = false) {
    const ch = fast ? peer.fast : peer.rel;
    if (peer.open && ch?.readyState === 'open') try { ch.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch {}
  }
  broadcast(msg, fast = false) {
    const text = JSON.stringify(msg);
    for (const p of this.peers.values()) this.send(p, text, fast);
  }
  drop(peer, why) {
    if (this.peers.get(peer.id) !== peer) return;
    this.peers.delete(peer.id);
    try { peer.pc.close(); } catch {}
    this.board?.forget(peer.id);
    if (peer.open) this.onLeave(peer, why);
  }
  async stop() {
    this.running = false;
    for (const p of [...this.peers.values()]) { this.send(p, { t: 'bye' }); this.drop(p, 'host left'); }
    await this.board?.close();
  }
}

/* ---- Guest: one direct link to the host ---- */
export class NetGuest {
  constructor({ lobby, RTC = globalThis.RTCPeerConnection, id, name, char = '', onMessage = () => {}, onClose = () => {} }) {
    Object.assign(this, { lobby, RTC, id, name, char, onMessage, onClose });
  }
  /* Resolves once both channels are open. Rejects with a LinkError that says
     what went wrong when the direct link cannot be made. */
  async connect(room, { timeout = 15000, onStatus = () => {} } = {}) {
    if (typeof this.RTC !== 'function') throw new LinkError('This browser has no WebRTC, so it cannot make the direct link the game needs. Use Chrome or Edge.');
    const dir = await this.lobby.data.getDirectoryHandle('room-' + room.code);
    const pc = this.pc = new this.RTC({ iceServers: [] });
    this.rel = pc.createDataChannel('rel', { ordered: true });
    this.fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    for (const ch of [this.rel, this.fast]) {
      ch.addEventListener('message', ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(m); });
      ch.addEventListener('close', () => this.closed('closed'));
    }
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) this.closed(pc.connectionState); });

    onStatus('Preparing a direct link…');
    const offer = await pc.createOffer(), wait = gathering(pc);
    await pc.setLocalDescription(offer); await wait;
    const offerId = randomHex(6), deadline = this.lobby.now() + timeout;
    await writeJSON(dir, 'join-' + this.id + '.json', { id: this.id, name: cleanName(this.name), char: this.char, offerId, sdp: pc.localDescription.sdp, at: this.lobby.wallNow() });
    onStatus('Waiting for ' + room.host + ' to answer…');

    let answered = false;
    const fail = msg => { remove(dir, 'join-' + this.id + '.json'); remove(dir, 'answer-' + this.id + '.json'); this.close(); throw new LinkError(msg); };
    while (this.lobby.now() < deadline) {
      if (!answered) {
        const a = (await readJSON(dir, 'answer-' + this.id + '.json'))?.json;
        if (a && a.offerId === offerId) {
          if (a.error) fail(a.error);
          answered = true; onStatus('Opening the direct link…');
          await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
        }
      }
      if (this.rel.readyState === 'open' && this.fast.readyState === 'open') {
        remove(dir, 'join-' + this.id + '.json'); remove(dir, 'answer-' + this.id + '.json');
        this.open = true; return;
      }
      if (pc.connectionState === 'failed') break;
      await sleep(answered ? 50 : 250);
    }
    if (!answered) fail(`${room.host}'s game did not answer. Their LAN_FPS tab may be closed or asleep, or the shared folder is slow to update. Try again in a moment.`);
    fail(`Could not open a direct link to ${room.host}'s PC. LAN_FPS needs a direct PC-to-PC connection on the local network; the shared folder is only used to find each other and is far too slow for real-time play. Check that both PCs are on the same network (no VPN), and that the firewall allows Chrome/Edge on private networks.`);
  }
  send(msg, fast = false) {
    const ch = fast ? this.fast : this.rel;
    if (this.open && ch?.readyState === 'open') try { ch.send(JSON.stringify(msg)); } catch {}
  }
  closed(why) { if (!this.open) return; this.open = false; try { this.pc.close(); } catch {} this.onClose(why); }
  close() { this.open = false; try { this.pc?.close(); } catch {} }
}
