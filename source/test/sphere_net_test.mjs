/* Two clients on one micro planet: identical seeded worlds, synchronised transforms, hits and respawns. */
import assert from 'node:assert/strict';
import { createServer } from '../../server/index.mjs';
import { OnlineSignalingClient, OnlineNetHost, OnlineNetGuest } from '../src/net_online.js';
import { fakeOnlineRTC } from './fakes_online.mjs';
import { HostSession, GuestSession } from '../src/game.js';
import { generateMicroPlanet } from '../src/micro_planet.js';
import { B } from '../src/sim.js';
import { V, frameOf, groundRadius } from '../src/sphere_sim.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(20); }
  throw new Error('Timed out waiting for ' + what);
}

console.log('Running microverse two-client tests...');
const { server, close } = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const serverUrl = `ws://127.0.0.1:${server.address().port}`;
const RTC = fakeOnlineRTC();

// Each side generates its own copy from the seed alone.
const worldH = generateMicroPlanet({ seed: 11 }), worldG = generateMicroPlanet({ seed: 11 });
assert.equal(worldH.layoutHash, worldG.layoutHash, 'host and guest build identical collision from the seed');

const view = { shot() {}, meleeSlash() {}, spawnGrenade() {}, explode() {}, destroyBarrel() {}, render() {} };
const hud = { update() {}, hitmarker() {}, hurt() {}, feed() {}, elimination() {} };
const hs = new OnlineSignalingClient(serverUrl), gs = new OnlineSignalingClient(serverUrl);
const host = new HostSession({ signaling: hs, NetHostClass: OnlineNetHost, RTC, world: worldH, id: 'h1', name: 'Host', char: 'abdulkarim', roomName: 'Globe', map: 'microverse', seed: 11, mode: 'ffa', view, hud });
const code = await host.start();
const guest = new GuestSession({ signaling: gs, NetGuestClass: OnlineNetGuest, RTC, world: worldG, id: 'g1', name: 'Guest', char: 'mina', map: 'microverse', seed: 11, mode: 'ffa', view, hud });
await guest.join({ code });
await until(() => host.game.players.size === 2, 3000, 'both players registered');

host.stopTicker?.(); guest.stopTicker?.();   // the test steps both sessions by hand
const hp = host.game.players.get('h1'), gp = host.game.players.get('g1');
const sph = worldH.sphere;

/* Put a player at a surface direction facing a tangent hint, on the host and in their own client. */
function teleport(sess, p, dir, hint) {
  const sp = { dir, ...(() => { const r = V.mul(dir, groundRadius(sph, V.mul(dir, sph.R)) + 0.06); return { x: r[0], y: r[1], z: r[2] }; })() };
  const up = dir, t = V.norm(V.sub(hint, V.mul(up, V.dot(hint, up))));
  Object.assign(p, { x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, hx: t[0], hy: t[1], hz: t[2], ly: 0, yaw: 0, pitch: 0, g: true });
  p.sp++;
  sess.client.look.yaw = 0; sess.client.look.pitch = 0;
}

/* 1. Opposite sides of the planet: both see each other correctly in the authoritative snapshot. */
teleport(host, hp, V.norm([0.2, 1, 0.1]), [1, 0, 0]);
teleport(guest, gp, V.norm([-0.2, -1, -0.1]), [1, 0, 0]);
for (let i = 0; i < 20; i++) { guest.client.tick(); host.step(); await sleep(8); }
await until(() => guest.client.state?.players.length === 2, 2000, 'guest snapshot');
const seen = guest.client.state.players.find(p => p.id === 'h1');
assert.ok(seen && seen.y > 40, 'guest sees the host on the opposite hemisphere');
assert.ok(guest.client.me.y < -40, 'guest stands on the underside');
const gf = frameOf(sph, guest.client.me);
assert.ok(gf.up[1] < -0.5, 'guest local up points down in world space');
console.log('  ok  both clients load the same planet and see each other on opposite hemispheres');

/* 2. Prediction: the guest walks on the underside; client and host agree. */
guest.client.active = true; guest.client.input.b = B.FWD;
let maxErr = 0;
for (let i = 0; i < 180; i++) {
  guest.client.tick(); host.step();
  if (i % 5 === 0) await sleep(4);
  const c = guest.client.me, h = gp;
  maxErr = Math.max(maxErr, Math.hypot(c.x - h.x, c.y - h.y, c.z - h.z));
}
guest.client.input.b = 0;
assert.ok(maxErr < 6, `prediction stays near the authoritative state (${maxErr.toFixed(2)} m max, in-flight inputs allowed)`);
await sleep(60); for (let i = 0; i < 20; i++) { guest.client.tick(); host.step(); await sleep(6); }
assert.ok(Math.hypot(guest.client.me.x - gp.x, guest.client.me.y - gp.y, guest.client.me.z - gp.z) < 1.5, 'prediction converges after movement stops');
console.log('  ok  prediction and reconciliation hold while walking the underside');

/* 3. Combat: a hit lowers health, kills respawn the victim on the planet. */
const a0 = Math.atan2(0.8, 0.6);
teleport(host, hp, [Math.cos(a0), 0, Math.sin(a0)], [0, 0, 1]);
teleport(guest, gp, [Math.cos(a0 + 0.05), 0, Math.sin(a0 + 0.05)], [0, 0, -1]);
await until(() => { guest.client.tick(); host.step(); return host.client.sp === hp.sp && guest.client.sp === gp.sp; }, 3000, 'clients acknowledge their respawn');
for (let i = 0; i < 6; i++) { guest.client.tick(); host.step(); await sleep(8); }
// Aim the host at the guest.
{
  const f = frameOf(sph, hp), eye = V.add([hp.x, hp.y, hp.z], V.mul(f.up, 1.6)), tgt = V.add([gp.x, gp.y, gp.z], V.mul(frameOf(sph, gp).up, 1.0));
  const d = V.norm(V.sub(tgt, eye)), tan = V.sub(d, V.mul(f.up, V.dot(d, f.up)));
  const yaw = -Math.atan2(V.dot(tan, f.right), V.dot(tan, f.fwd));
  host.client.look.yaw = yaw; host.client.look.pitch = Math.asin(V.dot(d, f.up));
}
const hp0 = gp.hp;
host.client.active = true; host.client.input.b = B.FIRE;
for (let i = 0; i < 40 && gp.hp === hp0; i++) { guest.client.tick(); host.step(); await sleep(8); }
host.client.input.b = 0;
assert.ok(gp.hp < hp0, `host damaged the guest (${hp0} -> ${gp.hp})`);
await until(() => { guest.client.tick(); host.step(); return guest.client.state?.players.find(p => p.id === 'g1')?.hp < hp0; }, 2000, 'guest sees its own damage');
gp.hp = 1; host.game.kill(gp, hp, false, 'ak47');
assert.equal(gp.alive, false);
await until(() => { host.game.time += 4; host.step(); return gp.alive; }, 3000, 'victim respawn');
assert.ok(Math.abs(V.len([gp.x, gp.y, gp.z]) - groundRadius(sph, [gp.x, gp.y, gp.z])) < 1.5, 'respawn lands on the planet surface');
console.log('  ok  hits, deaths and respawns work across the globe');

await guest.stop(); await host.stop(); hs.close(); gs.close(); close();
console.log('All microverse two-client tests passed!');
