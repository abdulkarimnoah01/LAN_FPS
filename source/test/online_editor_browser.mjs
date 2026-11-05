/* Real-browser map editor check: build in the editor UI, preview, host it, and a second
   browser joins and plays on the identical map (layout hash match). Requires
   `npm run build:online`. node test/online_editor_browser.mjs  (env: CHROMIUM_PATH, OUT_DIR) */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '..', '..');
const outDir = process.env.OUT_DIR || path.join(repo, 'dist', 'test-shots');
fs.mkdirSync(outDir, { recursive: true });
const req = createRequire(import.meta.url);
let pw; try { pw = req('playwright'); } catch { try { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); } catch { console.log('SKIP: playwright not installed'); process.exit(0); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (page, fn, arg, label, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 250 }).catch(() => { throw new Error('timed out: ' + label); });

const { server, close } = createServer({ staticDir: path.join(repo, 'dist', 'online') });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const mk = async name => {
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 820 } })).newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.goto(url, { timeout: 240000 });
    await until(page, () => window.LANFPS_ONLINE?.assets?.characters?.length > 0, null, name + ' assets', 150000);
    return page;
  };
  const host = await mk('host');
  await host.evaluate(() => window.LANFPS_ONLINE.go('editor'));
  await host.waitForSelector('.ed-canvas', { timeout: 20000 });
  await sleep(800);
  const count = () => host.evaluate(() => JSON.parse(localStorage.getItem('lanfps.customMap.active')).items.length);
  const before = await count();
  // place a block with the real UI: choose the Block tool and click the canvas
  await host.click('.ed-tools [data-tool="block"]');
  const box = await host.locator('.ed-canvas').boundingBox();
  await host.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.3);
  await sleep(500);
  assert.equal(await count(), before + 1, 'block placed from the canvas');
  await host.fill('.ed-side .field[aria-label="Map name"]', 'Test Yard');
  await sleep(600);
  await until(host, () => /Playable/.test(document.querySelector('.ed-report')?.textContent || ''), null, 'playability report');
  await host.screenshot({ path: path.join(outDir, '10_map_editor.png') });
  // 3D preview opens and closes
  await host.click('.ed-side button:has-text("3D preview")');
  await host.waitForSelector('.ed-preview canvas', { timeout: 30000 });
  await sleep(2500);
  await host.screenshot({ path: path.join(outDir, '11_map_preview.png'), timeout: 120000 });
  await host.click('.ed-preview button');
  await until(host, () => !document.querySelector('.ed-preview'), null, 'preview closed', 10000);

  // Host this map → drawer opens with the custom map selected
  await host.click('.ed-side button:has-text("Host this map")');
  await until(host, () => document.getElementById('map-select').value === 'custom', null, 'custom map selected', 10000);
  const modes = await host.evaluate(() => [...document.querySelectorAll('#mode-select option')].map(o => o.value));
  assert.deepEqual(modes, ['ffa', 'tdm', 'gungame', 'control', 'ctf'], 'starter map supports all five modes');
  await host.evaluate(() => { document.getElementById('mode-select').value = 'ctf'; });
  await host.evaluate(() => window.LANFPS_ONLINE.hostOnlineMatch());
  await until(host, () => window.LANFPS_ONLINE.session?.code, null, 'room code');
  const code = await host.evaluate(() => window.LANFPS_ONLINE.session.code);

  const guest = await mk('guest');
  await guest.evaluate(c => window.LANFPS_ONLINE.joinOnlineMatch(c), code);
  await until(guest, () => window.LANFPS_ONLINE.session?.client?.world?.custom, null, 'guest built the custom map', 120000);
  const [hw, gw] = await Promise.all([host, guest].map(p => p.evaluate(() => { const w = window.LANFPS_ONLINE.session.game?.world || window.LANFPS_ONLINE.session.client.world; return { name: w.custom.name, items: w.custom.items.length, hash: w.layoutHash, boxes: w.boxes.length }; })));
  assert.deepEqual(gw, hw, 'guest map identical to host');
  await until(guest, () => window.LANFPS_ONLINE.session.client.state?.obj?.k === 'ctf', null, 'CTF objective on the custom map');
  await sleep(1500);
  await guest.screenshot({ path: path.join(outDir, '12_custom_map_guest.png'), timeout: 120000 });
  assert.deepEqual(errors, []);
  console.log('Map editor browser test passed:', JSON.stringify(hw));
} finally {
  await browser.close(); await close?.(); server.close();
}
