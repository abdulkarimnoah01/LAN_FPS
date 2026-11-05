/* Renders the Orbit Crown lobby thumbnail (assets/ui/map-orbit.jpg) from the built online
   game: starts a practice match on Orbit, then frames the whole planet with fog off.
   Requires `npm run build:online` and Playwright (local or global npm). */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '..', '..');
const req = createRequire(import.meta.url);
let pw; try { pw = req('playwright'); } catch { pw = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
const { server, close } = createServer({ staticDir: path.join(repo, 'dist', 'online') });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const b = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto(`http://127.0.0.1:${server.address().port}/`, { timeout: 240000 });
  await p.waitForFunction(() => window.LANFPS_ONLINE?.assets?.characters?.length > 0, null, { timeout: 120000 });
  await p.evaluate(() => { const m = document.getElementById('map-select'); m.value = 'orbit'; m.dispatchEvent(new Event('change')); });
  await p.evaluate(() => window.LANFPS_ONLINE.startPracticeMatch());
  await p.waitForFunction(() => window.LANFPS_ONLINE.view?.worldRoot?.name === 'orbit_root', null, { timeout: 120000 });
  await p.evaluate(() => {
    const v = window.LANFPS_ONLINE.view, c = v.camera, V = c.position.constructor;
    v.render = function () { this.scene.render(); };
    v.scene.fogEnabled = false;
    c.position.set(86, 64, 96); c.setTarget(new V(0, -14, 0)); c.fov = 0.95; c.maxZ = 2000;
    v.weaponRoot?.setEnabled?.(false);
    document.querySelectorAll('#game > :not(canvas)').forEach(e => { e.style.display = 'none'; });
  });
  await new Promise(r => setTimeout(r, 2000));
  const out = path.join(repo, 'source', 'assets', 'ui', 'map-orbit.jpg');
  await p.locator('#view').screenshot({ path: out, type: 'jpeg', quality: 82 });
  console.log('wrote', path.relative(repo, out), fs.statSync(out).size, 'bytes');
} finally { await b.close(); await close?.(); server.close(); }
