/* Spectre Orbit Online — Internet WebRTC Transport & Matchmaking Client
   Uses WebSocket signaling + WebRTC RTCDataChannel + STUN/TURN.
   Implements identical NetHost / NetGuest contracts as net.js for seamless integration. */

export class LinkError extends Error {}

const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];

export class OnlineSignalingClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this.iceServers = DEFAULT_ICE_SERVERS;
    this.handlers = new Map(); // type -> Set<fn>
    this.pendingRequests = new Map(); // reqId -> { resolve, reject, timeout }
    this.reqSeq = 0;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, data) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) fn(data);
  }

  async connect(timeout = 6000) {
    if (this.ws && this.connected) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.connected) {
          try { this.ws?.close(); } catch {}
          reject(new LinkError('Connection to matchmaking server timed out. Check network or server status.'));
        }
      }, timeout);

      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.connected = true;
          this.emit('status', 'Connected to matchmaking server');
        };

        ws.onmessage = ev => {
          let msg;
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (!msg || !msg.t) return;

          if (msg.t === 'welcome') {
            this.sessionId = msg.sessionId;
            if (msg.iceServers && Array.isArray(msg.iceServers)) {
              this.iceServers = msg.iceServers;
            }
            clearTimeout(timer);
            resolve();
          }

          this.emit(msg.t, msg);
        };

        ws.onerror = err => {
          this.emit('error', err);
        };

        ws.onclose = () => {
          this.connected = false;
          this.emit('close');
        };
      } catch (e) {
        clearTimeout(timer);
        reject(new LinkError('Failed to initialize WebSocket: ' + e.message));
      }
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
      this.connected = false;
    }
  }
}

/* LocalNetHost: Offline / Solo / Practice Host without external signaling */
export class LocalNetHost {
  constructor(opts = {}) {
    Object.assign(this, opts);
    this.peers = new Map();
  }
  async start() {
    return 'SOLO';
  }
  broadcast(msg, fast) {}
  send(peer, msg, fast) {}
  drop(peer, reason) {}
  async stop() {}
}

/* OnlineNetHost: Implements the Host side of WebRTC multiplayer */
export class OnlineNetHost {
  constructor({ signaling, RTC = window.RTCPeerConnection, id, name, roomName, map, seed, mode, max = 6, info, canJoin, onPeer, onMessage, onLeave }) {
    Object.assign(this, { signaling, RTC, id, name, roomName, map, seed, mode, max, info, canJoin, onPeer, onMessage, onLeave });
    this.peers = new Map(); // peerId -> { id, name, char, pc, rel, fast }
    this.pendingPeers = new Map(); // peerId -> { pc, ... }
    this.code = null;
    this.heartbeatTimer = null;
    this.unsubs = [];
  }

  async start() {
    await this.signaling.connect();
    this.signaling.send({ t: 'identity', peerId: this.id, name: this.name });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new LinkError('Timed out creating room on server')), 6000);

      const unCreated = this.signaling.on('room_created', msg => {
        clearTimeout(timeout);
        this.code = msg.code;
        this._setupSignalingListeners();
        this._startHeartbeat();
        resolve(msg.code);
      });
      this.unsubs.push(unCreated);

      const unErr = this.signaling.on('error', msg => {
        if (msg.code === 'ALREADY_IN_ROOM' || msg.code === 'RATE_LIMIT') {
          clearTimeout(timeout);
          reject(new LinkError('Failed to create room: ' + msg.message));
        }
      });
      this.unsubs.push(unErr);

      this.signaling.send({
        t: 'create_room',
        name: this.roomName,
        map: this.map,
        seed: this.seed,
        mode: this.mode,
        max: this.max,
      });
    });
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.signaling.send({ t: 'heartbeat', players: this.peers.size + 1 });
    }, 10000);
  }

  _setupSignalingListeners() {
    // 1. Guest join request: Host generates offer or sets up WebRTC
    const unReq = this.signaling.on('guest_join_request', async req => {
      const rejectReason = this.canJoin ? this.canJoin() : null;
      if (rejectReason) {
        this.signaling.send({
          t: 'signal',
          target: req.peerId,
          signal: { type: 'refused', msg: rejectReason }
        });
        return;
      }

      try {
        await this._negotiateWithGuest(req);
      } catch (e) {
        console.warn('[OnlineNetHost] Negotiation error with guest:', e);
      }
    });
    this.unsubs.push(unReq);

    // 2. Guest signaling messages (answer or ICE candidates)
    const unSig = this.signaling.on('signal', async msg => {
      const peer = this.peers.get(msg.from) || this.pendingPeers.get(msg.from);
      if (!peer || !peer.pc) return;

      const sig = msg.signal;
      if (sig.type === 'answer') {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sig));
          // Drain buffered candidates if any
          if (peer.bufferedCandidates && peer.bufferedCandidates.length) {
            for (const cand of peer.bufferedCandidates) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            peer.bufferedCandidates = [];
          }
        } catch (err) {
          console.warn('[OnlineNetHost] Error setting remote answer:', err);
        }
      } else if (sig.candidate) {
        if (peer.pc.remoteDescription) {
          try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
          } catch (err) {
            console.warn('[OnlineNetHost] Error adding ICE candidate:', err);
          }
        } else {
          peer.bufferedCandidates = peer.bufferedCandidates || [];
          peer.bufferedCandidates.push(sig.candidate);
        }
      }
    });
    this.unsubs.push(unSig);

    // 3. Peer disconnected from server
    const unDisc = this.signaling.on('peer_disconnected', msg => {
      const p = this.peers.get(msg.peerId);
      if (p) this.drop(p, 'left');
    });
    this.unsubs.push(unDisc);
  }

  async _negotiateWithGuest(req) {
    const guestId = req.peerId;
    const pc = new this.RTC({
      iceServers: this.signaling.iceServers,
    });

    const pending = {
      id: guestId,
      name: req.name,
      char: req.char,
      reservationId: req.reservationId,
      pc,
      bufferedCandidates: [],
      rel: null,
      fast: null,
    };
    this.pendingPeers.set(guestId, pending);

    // Create DataChannels on host side
    const rel = pc.createDataChannel('rel', { ordered: true });
    const fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    pending.rel = rel;
    pending.fast = fast;

    // Trickle ICE: forward local candidates to guest
    pc.onicecandidate = ev => {
      if (ev.candidate) {
        this.signaling.send({
          t: 'signal',
          target: guestId,
          signal: { candidate: ev.candidate },
        });
      }
    };

    let channelsReady = 0;
    const checkChannels = () => {
      channelsReady++;
      if (channelsReady === 2) {
        // Both channels open! Move to active peers
        this.pendingPeers.delete(guestId);
        this.peers.set(guestId, pending);
        this.signaling.send({
          t: 'guest_joined_ack',
          peerId: guestId,
          reservationId: req.reservationId,
        });
        this.onPeer?.(pending);
      }
    };

    rel.onopen = checkChannels;
    fast.onopen = checkChannels;

    rel.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        this.onMessage?.(pending, data);
      } catch {}
    };

    fast.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        this.onMessage?.(pending, data);
      } catch {}
    };

    rel.onclose = () => this.drop(pending, 'channel_closed');
    fast.onclose = () => this.drop(pending, 'channel_closed');

    // Create SDP Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.signaling.send({
      t: 'signal',
      target: guestId,
      signal: { type: 'offer', sdp: offer.sdp },
    });
  }

  send(peer, msg, fast = false) {
    const ch = fast ? peer.fast : peer.rel;
    if (ch && ch.readyState === 'open') {
      try { ch.send(JSON.stringify(msg)); } catch {}
    }
  }

  broadcast(msg, fast = false) {
    const raw = JSON.stringify(msg);
    for (const peer of this.peers.values()) {
      const ch = fast ? peer.fast : peer.rel;
      if (ch && ch.readyState === 'open') {
        try { ch.send(raw); } catch {}
      }
    }
  }

  drop(peer, reason = 'drop') {
    if (!peer || peer._dropped) return;
    peer._dropped = true;
    this.peers.delete(peer.id);
    this.pendingPeers.delete(peer.id);
    try { peer.rel?.close(); } catch {}
    try { peer.fast?.close(); } catch {}
    try { peer.pc?.close(); } catch {}
    this.signaling.send({ t: 'guest_left', peerId: peer.id });
    this.onLeave?.(peer);
  }

  async stop() {
    clearInterval(this.heartbeatTimer);
    for (const un of this.unsubs) un();
    for (const peer of Array.from(this.peers.values())) {
      this.drop(peer, 'stop');
    }
    this.signaling.send({ t: 'leave_room' });
  }
}

/* OnlineNetGuest: Implements the Guest side of WebRTC multiplayer */
export class OnlineNetGuest {
  constructor({ signaling, RTC = window.RTCPeerConnection, id, name, char, onMessage, onClose }) {
    Object.assign(this, { signaling, RTC, id, name, char, onMessage, onClose });
    this.pc = null;
    this.rel = null;
    this.fast = null;
    this.bufferedCandidates = [];
    this.unsubs = [];
    this.hostPeerId = null;
  }

  async connect(room, { onStatus, timeout = this.signaling.kind === 'folder' ? 45000 : 12000 } = {}) { // shared folders are slower to signal
    onStatus?.('Connecting to matchmaking server...');
    await this.signaling.connect();
    this.signaling.send({ t: 'identity', peerId: this.id, name: this.name });

    onStatus?.(`Reserving slot in match [${room.code}]...`);
    const code = room.code;

    return new Promise((resolve, reject) => {
      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          this.close();
          reject(new LinkError(`Connection to room ${code} timed out after ${timeout / 1000}s. Check ICE/firewall.`));
        }
      }, timeout);

      const cleanup = () => {
        clearTimeout(timer);
        for (const un of this.unsubs) un();
      };

      const unRes = this.signaling.on('join_reserved', async msg => {
        if (msg.code !== code) return;
        onStatus?.('Slot reserved. Negotiating WebRTC peer connection...');

        this.pc = new this.RTC({
          iceServers: this.signaling.iceServers,
        });

        this.pc.onicecandidate = ev => {
          if (ev.candidate && this.hostPeerId) {
            this.signaling.send({
              t: 'signal',
              target: this.hostPeerId,
              signal: { candidate: ev.candidate },
            });
          }
        };

        let channelsReady = 0;
        const onChannelReady = () => {
          channelsReady++;
          if (channelsReady === 2 && !isDone) {
            isDone = true;
            cleanup();
            onStatus?.('Direct WebRTC DataChannel established!');
            resolve();
          }
        };

        this.pc.ondatachannel = ev => {
          const ch = ev.channel;
          if (ch.label === 'rel') {
            this.rel = ch;
            ch.onopen = onChannelReady;
            ch.onmessage = m => {
              try { this.onMessage?.(JSON.parse(m.data)); } catch {}
            };
            ch.onclose = () => this.onClose?.();
          } else if (ch.label === 'fast') {
            this.fast = ch;
            ch.onopen = onChannelReady;
            ch.onmessage = m => {
              try { this.onMessage?.(JSON.parse(m.data)); } catch {}
            };
            ch.onclose = () => this.onClose?.();
          }
        };
      });
      this.unsubs.push(unRes);

      const unSig = this.signaling.on('signal', async msg => {
        const sig = msg.signal;
        this.hostPeerId = msg.from;

        if (sig.type === 'refused') {
          if (!isDone) {
            isDone = true;
            cleanup();
            reject(new LinkError('Host refused connection: ' + (sig.msg || 'Room full')));
          }
          return;
        }

        if (sig.type === 'offer') {
          onStatus?.('Received host offer. Generating answer...');
          try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(sig));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);

            this.signaling.send({
              t: 'signal',
              target: this.hostPeerId,
              signal: { type: 'answer', sdp: answer.sdp },
            });

            // Drain buffered candidates
            if (this.bufferedCandidates.length) {
              for (const cand of this.bufferedCandidates) {
                await this.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
              this.bufferedCandidates = [];
            }
          } catch (err) {
            console.warn('[OnlineNetGuest] Error handling offer:', err);
          }
        } else if (sig.candidate) {
          if (this.pc.remoteDescription) {
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
            } catch (err) {
              console.warn('[OnlineNetGuest] Error adding candidate:', err);
            }
          } else {
            this.bufferedCandidates.push(sig.candidate);
          }
        }
      });
      this.unsubs.push(unSig);

      const unErr = this.signaling.on('error', msg => {
        if (!isDone) {
          isDone = true;
          cleanup();
          reject(new LinkError(msg.message || msg.code || 'Signaling error'));
        }
      });
      this.unsubs.push(unErr);

      this.signaling.send({
        t: 'join_room',
        code,
        char: this.char,
      });
    });
  }

  send(msg, fast = false) {
    const ch = fast ? this.fast : this.rel;
    if (ch && ch.readyState === 'open') {
      try { ch.send(JSON.stringify(msg)); } catch {}
    }
  }

  close() {
    for (const un of this.unsubs) un();
    try { this.rel?.close(); } catch {}
    try { this.fast?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.signaling.send({ t: 'leave_room' });
  }
}
