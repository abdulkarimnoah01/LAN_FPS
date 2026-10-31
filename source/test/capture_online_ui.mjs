/* Captures screenshots of the new Retro-Futuristic Terminal UI, 3D Hero Viewer Turntable, and Settings Modal */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\gamer\\.gemini\\antigravity\\brain\\5dfd4edf-a23c-42e8-a24d-553fe783414a';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('[1/4] Launching Chrome headless...');
  const port = 9265;
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-extensions',
    '--enable-webgl',
    '--window-size=1600,1050',
    'http://127.0.0.1:8080'
  ]);

  await sleep(3000);

  console.log('[2/4] Connecting to Chrome CDP...');
  const list = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const target = list.find(p => p.type === 'page' && p.url.includes('127.0.0.1:8080')) || list.find(p => p.type === 'page') || list[0];
  console.log('  Target URL:', target.url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let msgId = 0;
  const send = (method, params = {}) => {
    return new Promise((resolve) => {
      const curId = ++msgId;
      const handler = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.id === curId) {
          ws.removeEventListener('message', handler);
          resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  };

  await new Promise((resolve) => { ws.onopen = resolve; });
  await send('Runtime.enable');
  await send('Page.enable');

  ws.addEventListener('message', ev => {
    const data = JSON.parse(ev.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = (data.params.args || []).map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
      console.log(`  [Browser Console]`, args);
    } else if (data.method === 'Runtime.exceptionThrown') {
      console.error(`  [Browser Exception]`, data.params.exceptionDetails?.text, data.params.exceptionDetails?.exception?.description);
    }
  });

  await send('Page.reload');
  console.log('  Waiting 3.5s for Babylon assets, terminal layout, and lobby portrait...');
  await sleep(3500);

  // 1. Capture Lobby Terminal Screenshot
  console.log('[3/4] Capturing Lobby Terminal UI...');
  const lobbyShot = await send('Page.captureScreenshot', { format: 'png' });
  const lobbyPng = Buffer.from(lobbyShot.data, 'base64');
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_terminal_lobby.png'), lobbyPng);
  console.log(`  Saved screenshot_online_terminal_lobby.png (${(lobbyPng.length / 1024).toFixed(0)} KB)`);

  // 2. Open Hero Roster Modal and capture 3D Turntable
  console.log('  Opening Operative Roster & 3D Turntable...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.LANFPS_ONLINE.openHeroRoster('abdulkarim');
    })()`
  });

  await sleep(2500);

  console.log('  Capturing 3D Turntable Roster...');
  const rosterShot = await send('Page.captureScreenshot', { format: 'png' });
  const rosterPng = Buffer.from(rosterShot.data, 'base64');
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_turntable_roster.png'), rosterPng);
  console.log(`  Saved screenshot_online_turntable_roster.png (${(rosterPng.length / 1024).toFixed(0)} KB)`);

  // 3. Switch to another operative (e.g. Robot / Heavy Support)
  console.log('  Switching to Robot operative in turntable...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.LANFPS_ONLINE.openHeroRoster('robot');
    })()`
  });

  await sleep(2000);

  const robotShot = await send('Page.captureScreenshot', { format: 'png' });
  const robotPng = Buffer.from(robotShot.data, 'base64');
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_turntable_robot.png'), robotPng);
  console.log(`  Saved screenshot_online_turntable_robot.png (${(robotPng.length / 1024).toFixed(0)} KB)`);

  // 4. Open Settings Modal
  console.log('[4/4] Opening Station Settings Modal...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.LANFPS_ONLINE.closeHeroRoster();
      window.LANFPS_ONLINE.openSettings();
    })()`
  });

  await sleep(1500);

  const settingsShot = await send('Page.captureScreenshot', { format: 'png' });
  const settingsPng = Buffer.from(settingsShot.data, 'base64');
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_settings_modal.png'), settingsPng);
  console.log(`  Saved screenshot_online_settings_modal.png (${(settingsPng.length / 1024).toFixed(0)} KB)`);

  ws.close();
  chromeProc.kill('SIGKILL');
  console.log('Verification captures complete!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
