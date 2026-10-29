/* Node stand-ins for the browser APIs the game uses: a File System Access
   directory handle over a real temp folder, and an in-memory WebRTC pair. */
import fs from 'node:fs/promises';
import path from 'node:path';

function domError(name, message) { const e = new Error(message); e.name = name; return e; }
async function exists(p) { try { return await fs.stat(p); } catch { return null; } }

class FileHandle {
  constructor(file) { this.path = file; this.name = path.basename(file); this.kind = 'file'; }
  async getFile() {
    const buf = await fs.readFile(this.path), st = await fs.stat(this.path);
    return { size: buf.length, lastModified: st.mtimeMs, text: async () => buf.toString('utf8') };
  }
  async createWritable() {
    let text = '';
    return { write: async v => { text = String(v); }, close: async () => { await fs.writeFile(this.path + '.tmp', text); await fs.rename(this.path + '.tmp', this.path); }, abort: async () => {} };
  }
}

export class DirHandle {
  constructor(dir) { this.path = dir; this.name = path.basename(dir); this.kind = 'directory'; }
  async getDirectoryHandle(name, o = {}) {
    const p = path.join(this.path, name), st = await exists(p);
    if (!st) { if (!o.create) throw domError('NotFoundError', name); await fs.mkdir(p); }
    else if (!st.isDirectory()) throw domError('TypeMismatchError', name);
    return new DirHandle(p);
  }
  async getFileHandle(name, o = {}) {
    const p = path.join(this.path, name), st = await exists(p);
    if (!st && !o.create) throw domError('NotFoundError', name);
    return new FileHandle(p);
  }
  async *entries() {
    for (const e of await fs.readdir(this.path, { withFileTypes: true })) {
      if (e.name.endsWith('.tmp')) continue;
      yield [e.name, e.isDirectory() ? new DirHandle(path.join(this.path, e.name)) : new FileHandle(path.join(this.path, e.name))];
    }
  }
  async removeEntry(name, o = {}) {
    if (!(await exists(path.join(this.path, name)))) throw domError('NotFoundError', name);
    await fs.rm(path.join(this.path, name), { recursive: !!o.recursive });
  }
}

/* ---- Fake WebRTC ---- */
class Emitter {
  constructor() { this.handlers = {}; }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  emit(type, ev = {}) { for (const fn of [...(this.handlers[type] || [])]) fn(ev); }
}

class FakeChannel extends Emitter {
  constructor(label, options) { super(); this.label = label; this.options = options; this.readyState = 'connecting'; this.other = null; }
  send(data) {
    if (this.readyState !== 'open') throw domError('InvalidStateError', 'not open');
    const other = this.other;
    setTimeout(() => { if (other.readyState === 'open') other.emit('message', { data }); }, 1);
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; this.emit('close');
    if (this.other) this.other.close();
  }
}

const registry = new Map();
let counter = 0;

/* `mode`: 'ok' connects; 'blocked' exchanges descriptions but never opens,
   like two PCs whose network will not let a direct link through. */
export function fakeRTC(mode = 'ok') {
  return class FakePeerConnection extends Emitter {
    constructor(config) {
      super();
      if (!config || !Array.isArray(config.iceServers) || config.iceServers.length) throw Error('LAN only: iceServers must be []');
      this.uid = ++counter; this.channels = []; this.connectionState = 'new'; this.iceGatheringState = 'new'; this.localDescription = null;
      registry.set(this.uid, this);
    }
    createDataChannel(label, options) { const ch = new FakeChannel(label, options); this.channels.push(ch); return ch; }
    async createOffer() { return { type: 'offer', sdp: 'fake-offer:' + this.uid }; }
    async createAnswer() { return { type: 'answer', sdp: 'fake-answer:' + this.uid }; }
    async setLocalDescription(d) { this.localDescription = d; this.iceGatheringState = 'complete'; setTimeout(() => this.emit('icegatheringstatechange'), 1); }
    async setRemoteDescription(d) {
      const remote = registry.get(Number(d.sdp.split(':')[1]));
      if (!remote) throw Error('unknown description');
      this.remote = remote;
      if (d.type === 'answer' && mode === 'ok') setTimeout(() => this.link(), 5);
    }
    link() {
      const host = this.remote;
      for (const ch of this.channels) {
        const twin = new FakeChannel(ch.label, ch.options);
        ch.other = twin; twin.other = ch; host.channels.push(twin);
        host.emit('datachannel', { channel: twin });
        ch.readyState = twin.readyState = 'open';
        twin.emit('open'); ch.emit('open');
      }
      this.connectionState = host.connectionState = 'connected';
    }
    close() {
      if (this.connectionState === 'closed') return;
      this.connectionState = 'closed';
      for (const ch of this.channels) ch.close();
      this.emit('connectionstatechange');
    }
  };
}
