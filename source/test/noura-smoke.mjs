import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'noura-smoke-'));
const port = 9237;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1440,1000', new URL('../../LAN_FPS.html', import.meta.url).href,
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let tabs;
  for (let i = 0; i < 40; i++) {
    try { tabs = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); if (tabs.some(t => t.url.includes('LAN_FPS.html'))) break; } catch {}
    await delay(500);
  }
  const target = tabs.find(t => t.url.includes('LAN_FPS.html'));
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); };
  const call = (method, params = {}) => new Promise(r => { const key = ++id; pending.set(key, r); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.result?.exceptionDetails, JSON.stringify(r)); return r.result.result.value; };
  await call('Runtime.enable'); await call('Page.enable');
  let found;
  for (let i = 0; i < 90; i++) { found = await evaluate(`!!window.LANFPS?.assets?.characters?.find(c=>c.id==='noura')`); if (found) break; await delay(500); }
  assert.ok(found, 'Noura must load from the standalone bundle');
  const result = await evaluate(`(()=>{const c=LANFPS.assets.characters.find(c=>c.id==='noura'); let meshes=0, maps=0, triangles=0; c.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3; for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)maps++;}}); document.getElementById('btn-lobby-roster').click();return {name:c.name,meshes,maps,triangles,animations:c.animations.length,version:LANFPS_VERSION};})()`);
  assert.equal(result.triangles, 9512); assert.ok(result.meshes >= 6); assert.ok(result.maps >= 6); assert.equal(result.animations, 0);
  await delay(1000);
  const selected = await evaluate(`(()=>{const card=[...document.querySelectorAll('#roster-cards .roster-hero-item')].find(e=>/Noura/.test(e.textContent)); if(!card)return false;card.click();return true;})()`);
  assert.ok(selected, 'Noura must be selectable in the roster');
  await delay(1500);
  assert.equal(await evaluate(`document.getElementById('dossier-name').textContent.trim().toLowerCase()`), 'noura');
  const shot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(root, 'source/test/screenshot_noura.png'), Buffer.from(shot.result.data, 'base64'));
  assert.equal(errors.length, 0, JSON.stringify(errors)); console.log(JSON.stringify({ ...result, rosterSelection: true, browserErrors: errors.length }));
} finally { ws?.close(); try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
