/* Real-browser smoke test for the Next Gen appearance slice.
   Starts the matchmaking/static server on a free localhost port, opens two isolated Chromium
   contexts (separate storage = two players), picks different Next Gen bodies and looks in the
   creator UI, saves them, hosts in one and joins from the other over real WebRTC, then checks
   each side renders the other's body + canonical look. Screenshots go to $OUT_DIR
   (default: <repo>/dist/test-shots).

   Requires a prior `npm run build:online`. Uses Playwright if available:
     node test/online_upgrade_browser.mjs
   Optional env: CHROMIUM_PATH (browser binary), OUT_DIR. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const staticDir = path.join(repo, 'dist', 'online');
const outDir = process.env.OUT_DIR || path.join(repo, 'dist', 'test-shots');
fs.mkdirSync(outDir, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch {}
  try { return createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); } catch {}
  console.log('SKIP: playwright is not installed (npm i -g playwright to run this smoke test)');
  process.exit(0);
}

const { chromium } = loadPlaywright();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(page, fn, arg, timeout = 60000, label = 'condition') {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 250 }); }
  catch (e) {
    const diag = await page.evaluate(() => {
      const o = window.LANFPS_ONLINE, v = o?.view;
      return { session: o?.session?.constructor?.name, ended: o?.session?.ended, snaps: o?.session?.client?.snaps?.length,
        players: o?.session?.client?.snaps?.at?.(-1) ? [...o.session.client.snaps.at(-1).players.values()].map(p => [p.id, p.char, p.lk]) : null,
        avatars: v?.avatars ? [...v.avatars].map(([id, a]) => [id, a.charId, a.loaded, a.model?.lookCode, a.lookCode]) : null,
        toast: document.querySelector('.toast, #toast')?.textContent };
    }).catch(err => String(err));
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(diag)}`);
  }
}

async function design(page, bodyId, presetName, shot) {
  await page.evaluate(() => window.LANFPS_ONLINE.go('operative'));
  await page.click(`#roster-cards .roster-hero-item[data-id="${bodyId}"]`);
  await page.locator('#creator-presets button', { hasText: presetName }).click();
  await waitFor(page, ([id]) => { const m = window.LANFPS_ONLINE && document.querySelector('#creator-status')?.textContent; return !!m; }, [bodyId], 20000, 'creator status');
  await sleep(1200);   // let the turntable render the new atlas
  await page.screenshot({ path: path.join(outDir, shot) });
  await page.click('#btn-roster-equip');
  return page.evaluate(() => ({ char: localStorage.getItem('lanfps.char'), look: JSON.parse(localStorage.getItem('lanfps.look.v1')) }));
}

const { server, close } = createServer({ staticDir });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
console.log('server', url);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const mk = async name => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') console.log(`[${name}] ${m.text()}`); });
    await page.goto(url, { timeout: 240000 });
    await waitFor(page, () => window.LANFPS_ONLINE?.assets?.characters?.length > 0, null, 90000, `${name} assets`);
    return page;
  };
  const host = await mk('host');
  const guest = await mk('guest');

  const hostSaved = await design(host, 'ng-female-tall', 'Vice Coast', '01_creator_host.png');
  const guestSaved = await design(guest, 'ng-male-short', 'Night Shift', '02_creator_guest.png');
  assert.equal(hostSaved.char, 'ng-female-tall');
  assert.equal(guestSaved.char, 'ng-male-short');
  const hostCode = `${hostSaved.look.outfitId}.${hostSaved.look.skinId}.${hostSaved.look.shaderId}.${hostSaved.look.accentId}`;
  const guestCode = `${guestSaved.look.outfitId}.${guestSaved.look.skinId}.${guestSaved.look.shaderId}.${guestSaved.look.accentId}`;
  assert.notEqual(hostCode, guestCode);
  console.log('saved looks', hostCode, guestCode);

  // Saved look survives a reload (persistence) and the creator shows it selected
  await guest.reload();
  await waitFor(guest, () => window.LANFPS_ONLINE?.assets?.characters?.length > 0, null, 90000, 'guest reload');
  assert.equal(await guest.evaluate(() => localStorage.getItem('lanfps.char')), 'ng-male-short');

  await host.evaluate(() => window.LANFPS_ONLINE.hostOnlineMatch());
  await waitFor(host, () => window.LANFPS_ONLINE.session?.code, null, 60000, 'room code');
  const code = await host.evaluate(() => window.LANFPS_ONLINE.session.code);
  console.log('room', code);
  await guest.evaluate(c => window.LANFPS_ONLINE.joinOnlineMatch(c), code);

  const hostId = await host.evaluate(() => window.LANFPS_ONLINE.session.id);
  const guestId = await guest.evaluate(() => window.LANFPS_ONLINE.session.client.id);
  // Each side sees the other with the right body and the host-canonical look
  const seen = (page, otherId) => page.evaluate(id => {
    const av = window.LANFPS_ONLINE.view?.avatars?.get(id);
    return av ? { char: av.charId, look: av.model?.lookCode || null, loaded: av.loaded } : null;
  }, otherId);
  await waitFor(guest, ([id, lk]) => window.LANFPS_ONLINE.view?.avatars?.get(id)?.model?.lookCode === lk, [hostId, hostCode], 60000, 'guest sees host look');
  await waitFor(host, ([id, lk]) => window.LANFPS_ONLINE.view?.avatars?.get(id)?.model?.lookCode === lk, [guestId, guestCode], 60000, 'host sees guest look');
  const g = await seen(guest, hostId), h = await seen(host, guestId);
  assert.deepEqual(g, { char: 'ng-female-tall', look: hostCode, loaded: true });
  assert.deepEqual(h, { char: 'ng-male-short', look: guestCode, loaded: true });
  console.log('guest sees host:', g, '| host sees guest:', h);

  // Put the guest in front of the host camera for a visual check: host-authoritative snapshot
  // positions, so move the guest's player on the host and let snapshots carry it.
  await host.evaluate(([gid, hid]) => {
    const game = window.LANFPS_ONLINE.session.game, me = game.players.get(hid), o = game.players.get(gid);
    o.x = me.x - Math.sin(me.yaw) * 3.2; o.z = me.z - Math.cos(me.yaw) * 3.2; o.y = me.y; o.yaw = me.yaw + Math.PI;
  }, [guestId, hostId]);
  await sleep(1500);
  await host.screenshot({ path: path.join(outDir, '03_host_sees_guest.png') });
  await guest.screenshot({ path: path.join(outDir, '04_guest_in_match.png') });

  // Snapshot-borne look also covers late joiners: a third client joins mid-match
  const late = await mk('late');
  await late.evaluate(c => window.LANFPS_ONLINE.joinOnlineMatch(c), code);
  await waitFor(late, ([id, lk]) => window.LANFPS_ONLINE.view?.avatars?.get(id)?.model?.lookCode === lk, [guestId, guestCode], 60000, 'late joiner sees guest look');
  await waitFor(late, ([id, lk]) => window.LANFPS_ONLINE.view?.avatars?.get(id)?.model?.lookCode === lk, [hostId, hostCode], 60000, 'late joiner sees host look');
  console.log('late joiner sees both looks');

  // Leaving removes the avatar on the other side
  await guest.evaluate(() => window.LANFPS_ONLINE.session?.stop?.());
  await waitFor(host, id => !window.LANFPS_ONLINE.view?.avatars?.has(id), guestId, 30000, 'avatar removed after leave');
  console.log('leave cleanup ok');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('Online upgrade browser smoke test passed. Screenshots:', outDir);
} finally {
  await browser.close();
  await close?.();
  server.close();
}
