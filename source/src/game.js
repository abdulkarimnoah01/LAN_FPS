/* Match sessions. The Client predicts the local player and interpolates everyone
   else; HostSession runs the authoritative HostGame next to its own Client;
   GuestSession talks to the host over the direct link. */
import { DT, RULES, WEAPONS, B, newPlayer, stepPlayer, castShot, PREDICTED } from './sim.js';
import { HostGame } from './hostgame.js';
import { NetHost, NetGuest } from './net.js';

const INTERP_MS = 100;     // remote players are drawn this far in the past
const REDUNDANCY = 4;      // each input packet repeats the last few inputs

/* Fixed-rate timer. A worker keeps ticking while the tab is in the background,
   where requestAnimationFrame stops and setInterval slows to once a second. */
export function startTicker(step) {
  let last = performance.now(), acc = 0, worker = null, timer = null;
  const run = () => {
    const now = performance.now();
    acc += now - last; last = now;
    if (acc > 250) acc = DT * 1000;
    let n = 0;
    while (acc >= DT * 1000 && n++ < 8) { acc -= DT * 1000; step(); }
  };
  try {
    worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),5)'], { type: 'text/javascript' })));
    worker.onmessage = run;
  } catch { timer = setInterval(run, 5); }
  return () => { worker?.terminate(); clearInterval(timer); };
}

export class Client {
  constructor({ world, id, send, view, hud, audio }) {
    Object.assign(this, { world, id, send, view, hud, audio });
    this.me = newPlayer(id, '', 0); this.me.alive = false;
    this.look = { yaw: 0, pitch: 0 };
    this.input = { b: 0, reload: false, melee: false, grenade: false };   // filled by the page's input handlers
    this.active = false;                    // pointer locked / playing
    this.aiming = false;                    // right click ADS
    this.selectedWeapon = 0;                // active weapon slot (0..4)
    this.seq = 0; this.pending = []; this.snaps = []; this.lastTick = -1;
    this.offset = { x: 0, y: 0, z: 0 }; this.sp = -1; this.state = null;
  }

  setWeapon(w) {
    if (w >= 0 && w < WEAPONS.length && this.selectedWeapon !== w) {
      this.selectedWeapon = w;
    }
  }

  cycleWeapon(dir) {
    const n = (this.selectedWeapon + dir + WEAPONS.length) % WEAPONS.length;
    this.setWeapon(n);
  }

  /* One fixed step: sample input, predict, send. */
  tick() {
    if (!this.state) return;
    let b = this.active ? this.input.b : 0;
    if (this.input.reload) { b |= B.RELOAD; this.input.reload = false; }
    if (this.input.melee) { b |= B.MELEE; this.input.melee = false; }
    if (this.input.grenade) { b |= B.GRENADE; this.input.grenade = false; }
    const w = this.selectedWeapon !== undefined ? this.selectedWeapon : (this.me.w || 0);
    const inp = { seq: ++this.seq, b, yaw: this.look.yaw, pitch: this.look.pitch, w };
    this.pending.push(inp);
    if (this.pending.length > 600) this.pending.shift();
    const wasReloading = this.me.rl > 0;
    if (stepPlayer(this.me, inp, this.world)) {
      const isQuick = !!(b & B.MELEE);
      const wep = isQuick ? (WEAPONS.find(x => x.id === 'knife') || WEAPONS[0]) : (WEAPONS[this.me.w || 0] || WEAPONS[0]);
      const r = castShot(this.world, [], this.me, wep);
      if (wep.melee) {
        this.view?.meleeSlash(isQuick);
        this.audio?.melee(false);
      } else {
        if (r.tracers && r.tracers.length > 1) {
          for (const tr of r.tracers) this.view?.shot(tr.from, tr.to, true, wep.id);
        } else {
          this.view?.shot(r.from, r.to, true, wep.id);
        }
        this.audio?.shot(1, 0, wep.id);
      }
    }
    if (this.me.threwGrenade) {
      this.me.threwGrenade = false;
      this.audio?.grenadePin(true);
    }
    if (!wasReloading && this.me.rl > 0) this.audio?.reload(WEAPONS[this.me.w || 0]?.id);
    this.send({ t: 'i', in: this.pending.slice(-REDUNDANCY).map(i => [i.seq, i.b, i.yaw, i.pitch, i.w]) });
  }

  onSnapshot(s, at = performance.now()) {
    if (s.tick <= this.lastTick) return;      // unordered channel: drop late ones
    this.lastTick = s.tick; this.state = s;
    this.snaps.push({ at, players: new Map(s.players.map(p => [p.id, p])) });
    while (this.snaps.length > 2 && at - this.snaps[1].at > 1000) this.snaps.shift();

    const mine = s.players.find(p => p.id === this.id);
    if (!mine) return;
    const me = this.me, before = { x: me.x, y: me.y, z: me.z };
    const respawned = mine.sp !== this.sp;
    if (respawned) { this.sp = mine.sp; this.look.yaw = mine.yaw; this.look.pitch = 0; }
    for (const k of PREDICTED) me[k] = mine[k];
    Object.assign(me, { hp: mine.hp, alive: mine.alive, k: mine.k, d: mine.d, name: mine.name, slot: mine.slot, team: mine.team, isBot: mine.isBot });
    // Replay inputs the host has not processed yet.
    this.pending = this.pending.filter(i => i.seq > mine.seq);
    for (const i of this.pending) stepPlayer(me, i, this.world);
    // Hide small corrections by easing them out over a few frames.
    const o = this.offset;
    o.x += before.x - me.x; o.y += before.y - me.y; o.z += before.z - me.z;
    if (respawned || Math.hypot(o.x, o.y, o.z) > 2) o.x = o.y = o.z = 0;
  }

  name(id) { return this.state?.players.find(p => p.id === id)?.name || 'Someone'; }

  onEvent(e) {
    const hud = this.hud, me = this.id;
    const threatAngle = () => {
      if (e.ax == null || e.az == null) return null;
      const dx = e.ax - this.me.x, dz = e.az - this.me.z;
      const threatYaw = Math.atan2(dx, -dz);
      return Math.atan2(Math.sin(threatYaw - this.look.yaw), Math.cos(threatYaw - this.look.yaw));
    };
    switch (e.t) {
      case 'shot':
        if (e.id !== me) {
          const wepId = e.wepId || WEAPONS[e.w || 0]?.id || 'ak47';
          if (wepId === 'knife') {
            const d = Math.hypot(e.from[0] - this.me.x, e.from[2] - this.me.z);
            const pan = this.audio?.panFor(this.me.x, this.me.z, this.look.yaw, e.from[0], e.from[2]) || 0;
            this.audio?.melee(false, false, pan);
          } else {
            if (e.tracers && e.tracers.length > 1) {
              for (const tr of e.tracers) this.view?.shot(tr.from, tr.to, false, wepId);
            } else {
              this.view?.shot(e.from, e.to, false, wepId);
            }
            const d = Math.hypot(e.from[0] - this.me.x, e.from[2] - this.me.z);
            const pan = this.audio?.panFor(this.me.x, this.me.z, this.look.yaw, e.from[0], e.from[2]) || 0;
            this.audio?.shot(Math.max(0.08, 1 - d / 50), pan, wepId);
          }
        }
        break;
      case 'grenade_spawn':
        this.view?.spawnGrenade(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz);
        if (e.owner !== me) {
          const pan = this.audio?.panFor(this.me.x, this.me.z, this.look.yaw, e.x, e.z) || 0;
          this.audio?.grenadePin(false, pan);
        }
        break;
      case 'explode':
        this.view?.explode(e.x, e.y, e.z, e.r, e.kind);
        {
          const dist = Math.hypot(e.x - this.me.x, e.z - this.me.z);
          const pan = this.audio?.panFor(this.me.x, this.me.z, this.look.yaw, e.x, e.z) || 0;
          this.audio?.explosion(Math.max(0.12, 1 - dist / 45), pan);
        }
        break;
      case 'barrel_destroyed':
        this.view?.destroyBarrel(e.id, e.x, e.y, e.z);
        break;
      case 'hit':
        if (e.by === me) {
          hud?.hitmarker(e.head);
          if (e.wepId === 'knife') this.audio?.melee(true, e.backstab);
          else if (e.wepId === 'grenade' || e.wepId === 'barrel') this.audio?.hit(false);
          else this.audio?.hit(e.head);
        }
        if (e.id === me) hud?.hurt(threatAngle());
        break;
      case 'kill':
        const verbIcon = e.wepId === 'knife' ? '🗡️' : (e.wepId === 'grenade' ? '💣' : (e.wepId === 'barrel' ? '💥' : (e.head ? '⊕' : '→')));
        hud?.feed(e.by ? `${this.name(e.by)} ${verbIcon} ${this.name(e.id)}` : `${this.name(e.id)} fell out`, e.by === me || e.id === me);
        if (e.by === me && e.id !== me) {
          hud?.hitmarker(true);
          hud?.elimination(this.name(e.id), !!e.head, e.wepId === 'knife', e.backstab);
          if (e.wepId === 'knife') this.audio?.melee(true, e.backstab);
          else this.audio?.hit(true);
          this.audio?.elimination(!!e.head);
        }
        if (e.id === me) { hud?.hurt(threatAngle()); this.killer = e.by ? this.name(e.by) : null; }
        break;
      case 'join': hud?.feed(`${e.name} joined`); break;
      case 'leave': hud?.feed(`${this.name(e.id)} left`); break;
      case 'end':
        if (e.isTeam) {
          const teamLabel = e.winner === 'red' ? 'RED TEAM' : 'BLUE TEAM';
          hud?.feed(`${teamLabel} WINS THE MATCH!`, true);
        } else {
          hud?.feed(`${this.name(e.winner)} wins the round!`, true);
        }
        break;
      case 'restart': hud?.feed('New round'); break;
    }
  }

  /* Remote players, interpolated INTERP_MS in the past. */
  others(now = performance.now()) {
    const t = now - INTERP_MS, snaps = this.snaps, out = [];
    if (!snaps.length) return out;
    let a = snaps[snaps.length - 1], b = a, f = 0;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].at <= t) { a = snaps[i - 1]; b = snaps[i]; f = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at)); break; }
    }
    for (const [id, pb] of b.players) {
      if (id === this.id) continue;
      const pa = a.players.get(id);
      if (!pa || pa.sp !== pb.sp || !pa.alive) { out.push(pb); continue; }
      let dy = pb.yaw - pa.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      out.push({ ...pb, x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, z: pa.z + (pb.z - pa.z) * f, yaw: pa.yaw + dy * f });
    }
    return out;
  }

  frame(dt) {
    const o = this.offset, k = Math.exp(-dt * 15);
    o.x *= k; o.y *= k; o.z *= k;
    const me = this.me, shown = { ...me, x: me.x + o.x, y: me.y + o.y, z: me.z + o.z };
    this.view?.render(dt, shown, this.others(), this.look, this.aiming, this.audio, this.me.w || 0);
    this.hud?.update(this);
  }
}

/* Host: authoritative game + local client + direct links to every guest. */
export class HostSession {
  constructor({ lobby, world, id, name, char, roomName, map = 'forest', seed = 0, mode = 'ffa', view, hud, audio, RTC, onExit }) {
    Object.assign(this, { lobby, world, id, name, char, roomName, map, seed, mode, onExit });
    this.game = new HostGame(world, { mode });
    this.client = new Client({ world, id, view, hud, audio, send: m => this.handle(id, m) });
    this.net = new NetHost({
      lobby, RTC, id, name, roomName,
      info: () => ({ players: this.game.players.size, max: RULES.maxPlayers, phase: this.game.phase, map: this.map, seed: this.seed, mode: this.mode }),
      canJoin: () => this.game.players.size >= RULES.maxPlayers ? 'Room is full' : '',
      onPeer: p => {
        try {
          this.game.addPlayer(p.id, p.name, p.char);
          this.net.send(p, { t: 'init', map: this.map, seed: this.seed, mode: this.mode });
        } catch (e) {
          this.net.send(p, { t: 'refused', msg: e.message });
          setTimeout(() => this.net.drop(p, 'full'), 500);
        }
      },
      onMessage: (p, m) => this.handle(p.id, m, p),
      onLeave: p => this.game.removePlayer(p.id),
    });
  }
  addBot(name = null, char = '', diff = 'medium') {
    return this.game.addBot(name, char, diff);
  }
  removeBot(id = null) {
    return this.game.removeBot(id);
  }
  link() { const n = this.net.peers.size; return { mode: 'host', text: n ? `Hosting · ${n} direct link${n > 1 ? 's' : ''}` : 'Hosting · waiting for players' }; }
  async start() {
    this.game.addPlayer(this.id, this.name, this.char);
    this.code = await this.net.start();
    this.stopTicker = startTicker(() => this.step());
    return this.code;
  }
  step() {
    this.client.tick();
    for (const e of this.game.step()) { this.client.onEvent(e); this.net.broadcast(e); }
    if (this.game.tick % 3 === 0) {             // 20 snapshots per second
      const s = this.game.snapshot();
      this.client.onSnapshot(s);
      this.net.broadcast(s, true);
    }
  }
  handle(id, m, peer) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'i') this.game.queueInput(id, m.in);
    else if (m.t === 'ping' && peer) this.net.send(peer, { t: 'pong', c: m.c });
    else if (m.t === 'bye' && peer) this.net.drop(peer, 'left');
  }
  async stop() { this.stopTicker?.(); await this.net.stop(); }
}

/* Guest: predicted local player, everything else from the host. */
export class GuestSession {
  constructor({ lobby, world, id, name, char, map = 'forest', seed = 0, mode = 'ffa', view, hud, audio, RTC, onExit }) {
    Object.assign(this, { onExit, map, seed, mode, ping: null });
    this.client = new Client({ world, id, view, hud, audio, send: m => this.net.send(m, m.t === 'i') });
    this.net = new NetGuest({
      lobby, RTC, id, name, char,
      onMessage: m => {
        if (m.t === 's') this.client.onSnapshot(m);
        else if (m.t === 'init') {
          if (m.mode) this.mode = m.mode;
        }
        else if (m.t === 'pong') this.ping = Math.round(performance.now() - m.c);
        else if (m.t === 'bye') this.end('The host closed the room.');
        else if (m.t === 'refused') this.end(m.msg);
        else this.client.onEvent(m);
      },
      onClose: () => this.end('The direct link to the host dropped. The host may have left or their PC went to sleep.'),
    });
  }
  link() { return { mode: 'direct', text: `Direct link${this.ping !== null ? ` · ${this.ping} ms` : ''}` }; }
  async join(room, onStatus) {
    this.room = room;
    await this.net.connect(room, { onStatus });
    let pingAt = 0;
    this.stopTicker = startTicker(() => {
      this.client.tick();
      const t = performance.now();
      if (t - pingAt > 1000) { pingAt = t; this.net.send({ t: 'ping', c: t }); }
    });
  }
  end(msg) { if (this.ended) return; this.ended = true; this.stop(); this.onExit?.(msg); }
  stop() { this.stopTicker?.(); this.net.send({ t: 'bye' }); setTimeout(() => this.net.close(), 100); }
}
