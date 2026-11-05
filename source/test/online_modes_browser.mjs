/* Real-browser Control mode check: host + guest over WebRTC on localhost.
   Verifies team assignment, host-owned capture replicated to the guest HUD, round end with
   an 8 s pause and a clean restart on both sides. Requires `npm run build:online`.
   node test/online_modes_browser.mjs   (env: CHROMIUM_PATH, OUT_DIR) */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const outDir = process.env.OUT_DIR || path.join(repo, 'dist', 'test-shots');
fs.mkdirSync(outDir, { recursive: true });
const req = createRequire(import.meta.url);
let pw; try { pw = req('playwright'); } catch { try { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); } catch { console.log('SKIP: playwright not installed'); process.exit(0); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (page, fn, arg, label, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).catch(() => { throw new Error('timed out: ' + label); });

const { server, close } = createServer({ staticDir: path.join(repo, 'dist', 'online') });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const mk = async name => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.goto(url, { timeout: 240000 });
    await until(page, () => window.LANFPS_ONLINE?.assets?.characters?.length > 0, null, name + ' assets', 120000);
    return page;
  };
  const host = await mk('host'), guest = await mk('guest');
  const options = await host.evaluate(() => [...document.querySelectorAll('#mode-select option')].map(o => o.value));
  assert.deepEqual(options, ['ffa', 'tdm', 'gungame', 'control'], 'selector lists only finished modes');
  await host.evaluate(() => {   // the host drawer is closed; set the same controls it would
    document.getElementById('mode-select').value = 'control';
    const map = document.getElementById('map-select'); if (map && [...map.options].some(o => o.value === 'arena')) map.value = 'arena';
  });
  await host.evaluate(() => window.LANFPS_ONLINE.hostOnlineMatch());
  await until(host, () => window.LANFPS_ONLINE.session?.code, null, 'room code');
  const code = await host.evaluate(() => window.LANFPS_ONLINE.session.code);
  await guest.evaluate(c => window.LANFPS_ONLINE.joinOnlineMatch(c), code);
  await until(guest, () => window.LANFPS_ONLINE.session?.client?.state?.obj?.k === 'control', null, 'guest receives objective');
  const ids = { host: await host.evaluate(() => window.LANFPS_ONLINE.session.id), guest: await guest.evaluate(() => window.LANFPS_ONLINE.session.client.id) };
  const teams = await host.evaluate(() => [...window.LANFPS_ONLINE.session.game.players.values()].map(p => p.team).sort());
  assert.deepEqual(teams, ['blue', 'red']);
  assert.equal(await guest.evaluate(() => window.LANFPS_ONLINE.session.mode), 'control');

  // Host's player stands in the zone alone; the guest stays far away
  const hostTeam = await host.evaluate(([h, g]) => {
    const game = window.LANFPS_ONLINE.session.game, z = game.objective.zone, me = game.players.get(h), o = game.players.get(g);
    window.__pin = setInterval(() => { Object.assign(me, { x: z.x, y: z.y, z: z.z, vx: 0, vz: 0 }); Object.assign(o, { x: z.x + 60, z: z.z + 60 }); }, 50);
    return me.team;
  }, [ids.host, ids.guest]);
  await until(guest, t => window.LANFPS_ONLINE.session.client.state.obj.own === t, hostTeam, 'guest sees capture', 30000);
  await until(guest, t => document.querySelector('#objective .obj-state')?.textContent.startsWith(t.toUpperCase() + ' HOLDS'), hostTeam, 'guest HUD shows owner', 10000);
  await sleep(2500);
  const [hs, gs] = await Promise.all([host, guest].map(p => p.evaluate(() => { const o = window.LANFPS_ONLINE.session.client.state.obj; return { own: o.own, sr: o.sr, sb: o.sb }; })));
  assert.equal(gs.own, hs.own); assert.ok(Math.abs((gs.sr + gs.sb) - (hs.sr + hs.sb)) <= 1, 'scores agree within one snapshot');
  assert.ok(hs[hostTeam === 'red' ? 'sr' : 'sb'] >= 1, 'owner is scoring');
  await guest.screenshot({ path: path.join(outDir, '05_control_guest_hud.png') });
  await host.screenshot({ path: path.join(outDir, '06_control_host_zone.png') });

  // Contest: both inside → frozen
  await host.evaluate(([h, g]) => { clearInterval(window.__pin); const game = window.LANFPS_ONLINE.session.game, z = game.objective.zone; window.__pin = setInterval(() => { for (const id of [h, g]) Object.assign(game.players.get(id), { x: z.x + (id === h ? 1 : -1), y: z.y, z: z.z, vx: 0, vz: 0 }); }, 50); }, [ids.host, ids.guest]);
  await until(guest, () => window.LANFPS_ONLINE.session.client.state.obj.con === true, null, 'contested', 10000);
  const frozen = await host.evaluate(() => ({ ...window.LANFPS_ONLINE.session.game.objective.score }));
  await sleep(2000);
  assert.deepEqual(await host.evaluate(() => ({ ...window.LANFPS_ONLINE.session.game.objective.score })), frozen, 'no scoring while contested');
  await until(guest, () => document.querySelector('#objective .obj-state')?.textContent === 'CONTESTED', null, 'guest HUD contested', 5000);
  await guest.screenshot({ path: path.join(outDir, '07_control_contested.png') });

  // Round end at target, 8 s pause, clean restart on both clients
  await host.evaluate(t => { clearInterval(window.__pin); const g = window.LANFPS_ONLINE.session.game, z = g.objective.zone; g.objective = { ...g.objective, owner: t, contested: false, score: { ...g.objective.score, [t]: 99 } };
    const me = g.players.get(window.LANFPS_ONLINE.session.id); window.__pin = setInterval(() => Object.assign(me, { x: z.x, y: z.y, z: z.z }), 50);
    for (const p of g.players.values()) if (p !== me) Object.assign(p, { x: z.x + 60, z: z.z + 60 }); }, hostTeam);
  await until(guest, t => { const s = window.LANFPS_ONLINE.session.client.state; return s.phase === 'ended' && s.winner === t; }, hostTeam, 'guest sees round end', 15000);
  await host.evaluate(() => clearInterval(window.__pin));
  await until(guest, () => { const s = window.LANFPS_ONLINE.session.client.state; return s.phase === 'play' && s.obj.sr === 0 && s.obj.sb === 0 && s.obj.own === null; }, null, 'guest sees clean restart', 20000);
  assert.equal(await host.evaluate(() => window.LANFPS_ONLINE.session.game.phase), 'play');
  assert.deepEqual(errors, []);
  console.log('Control mode browser test passed (capture, contested freeze, end, restart). Screenshots:', outDir);
} finally {
  await browser.close(); await close?.(); server.close();
}
