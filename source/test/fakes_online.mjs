/* Fake WebRTC for Online testing with STUN/TURN support */

class Emitter {
  constructor() { this.handlers = {}; }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(f => f !== fn); }
  emit(type, ev = {}) {
    if (typeof this['on' + type] === 'function') this['on' + type](ev);
    for (const fn of [...(this.handlers[type] || [])]) fn(ev);
  }
}

class FakeChannel extends Emitter {
  constructor(label, options) {
    super();
    this.label = label;
    this.options = options;
    this.readyState = 'connecting';
    this.other = null;
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('DataChannel not open');
    const other = this.other;
    setTimeout(() => {
      if (other && other.readyState === 'open') {
        other.emit('message', { data });
      }
    }, 2);
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.emit('close');
    if (this.other && this.other.readyState !== 'closed') this.other.close();
  }
}

const registry = new Map();
let counter = 0;

export function fakeOnlineRTC() {
  return class FakeOnlinePeerConnection extends Emitter {
    constructor(config) {
      super();
      this.config = config;
      this.uid = ++counter;
      this.channels = [];
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = 'new';
      registry.set(this.uid, this);
    }
    createDataChannel(label, options) {
      const ch = new FakeChannel(label, options);
      this.channels.push(ch);
      return ch;
    }
    async createOffer() {
      return { type: 'offer', sdp: `fake-offer:${this.uid}` };
    }
    async createAnswer() {
      return { type: 'answer', sdp: `fake-answer:${this.uid}` };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
      // Emit fake candidate
      setTimeout(() => {
        this.emit('icecandidate', { candidate: { candidate: `candidate:fake-${this.uid}` } });
      }, 5);
    }
    async setRemoteDescription(d) {
      this.remoteDescription = d;
      const remoteId = Number(d.sdp.split(':')[1]);
      const remote = registry.get(remoteId);
      if (!remote) throw new Error('Unknown remote description: ' + d.sdp);
      this.remote = remote;

      if (d.type === 'offer') {
        // Guest received offer from host
      } else if (d.type === 'answer') {
        // Host received answer from guest -> connect channels!
        setTimeout(() => this._link(remote), 10);
      }
    }
    async addIceCandidate(cand) {
      // Accepted
    }
    _link(guest) {
      const host = this;
      for (const ch of host.channels) {
        const twin = new FakeChannel(ch.label, ch.options);
        ch.other = twin;
        twin.other = ch;
        guest.channels.push(twin);
        guest.emit('datachannel', { channel: twin });
        ch.readyState = twin.readyState = 'open';
        twin.emit('open');
        ch.emit('open');
      }
      host.connectionState = guest.connectionState = 'connected';
    }
    close() {
      this.connectionState = 'closed';
      for (const ch of this.channels) ch.close();
      registry.delete(this.uid);
    }
  };
}

// Global browser shims for Node testing if needed
if (typeof globalThis.RTCSessionDescription === 'undefined') {
  globalThis.RTCSessionDescription = class { constructor(init) { Object.assign(this, init); } };
}
if (typeof globalThis.RTCIceCandidate === 'undefined') {
  globalThis.RTCIceCandidate = class { constructor(init) { Object.assign(this, init); } };
}
