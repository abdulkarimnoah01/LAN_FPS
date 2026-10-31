/* Starts Matchmaking Server, launches Chrome, enters match, and captures screenshots */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../../server/index.mjs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\gamer\\.gemini\\antigravity\\brain\\5dfd4edf-a23c-42e8-a24d-553fe783414a';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('[1/4] Starting Matchmaking & Static Web Server on port 8080...');
  const staticDir = path.resolve('X:/Projects/game/LAN_FPS/dist/online');
  const { server, close } = createServer({ staticDir });
  await new Promise(r => server.listen(8080, '127.0.0.1', r));
  console.log('  Server listening on http://127.0.0.1:8080');

  console.log('[2/4] Launching Chrome...');
  const port = 9260;
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-extensions',
    '--enable-webgl',
    '--window-size=1600,1000',
    'http://127.0.0.1:8080'
  ]);

  await sleep(2500);

  console.log('[3/4] Connecting to Chrome DevTools Protocol...');
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
      console.log(`  [Browser Console ${data.params.type}]`, args);
    } else if (data.method === 'Runtime.exceptionThrown') {
      console.error(`  [Browser Exception]`, data.params.exceptionDetails?.text, data.params.exceptionDetails?.exception?.description);
    }
  });

  await send('Page.reload');
  console.log('  Waiting 3s for lobby operative turntable & server status...');
  await sleep(3500);

  // Capture Lobby Screenshot
  const lobbyShot = await send('Page.captureScreenshot', { format: 'png' });
  const lobbyPng = Buffer.from(lobbyShot.data, 'base64');
  fs.writeFileSync('X:/Projects/game/LAN_FPS/source/test/screenshot_online_lobby.png', lobbyPng);
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_lobby.png'), lobbyPng);
  console.log(`  Saved Lobby Screenshot: ${(lobbyPng.length / 1024).toFixed(0)} KB`);

  console.log('[4/4] Deploying online match (Schoolyard arena)...');
  const deployRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      console.log('Configuring arena match...');
      const banner = document.getElementById('match-status-banner');
      console.log('Initial banner:', banner ? banner.textContent : 'none');
      const mapSel = document.getElementById('map-select');
      if (mapSel) { mapSel.value = 'school'; mapSel.dispatchEvent(new Event('change')); }
      const hostBtn = document.getElementById('btn-host-match');
      if (hostBtn) {
        console.log('Clicking Deploy Match button...');
        hostBtn.click();
      }
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        const gameEl = document.getElementById('game');
        const bannerText = document.getElementById('match-status-banner')?.textContent;
        console.log(\`Poll \${i}: gameEl.hidden=\${gameEl?.hidden}, banner="\${bannerText}"\`);
        if (gameEl && !gameEl.hidden) {
          return { inGame: true, attempts: i };
        }
      }
      return {
        inGame: !document.getElementById('game').hidden,
        banner: document.getElementById('match-status-banner')?.textContent,
        serverStatus: document.getElementById('server-status-label')?.textContent
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });

  console.log('  Deploy result:', deployRes?.result?.value);

  // Spawn AI bots into match and activate client
  await send('Runtime.evaluate', {
    expression: `(() => {
      if (window.LANFPS_ONLINE?.session) {
        window.LANFPS_ONLINE.session.addBot('Recon-Alpha', 'mina');
        window.LANFPS_ONLINE.session.addBot('Heavy-Bravo', 'robot');
        if (window.LANFPS_ONLINE.session.client) {
          window.LANFPS_ONLINE.session.client.active = true;
        }
      }
    })()`,
  });

  await sleep(3500);

  // Capture Match Screenshot
  const matchShot = await send('Page.captureScreenshot', { format: 'png' });
  const matchPng = Buffer.from(matchShot.data, 'base64');
  fs.writeFileSync('X:/Projects/game/LAN_FPS/source/test/screenshot_online_match.png', matchPng);
  fs.writeFileSync(path.join(artifactDir, 'screenshot_online_match.png'), matchPng);
  console.log(`  Saved Match Screenshot: ${(matchPng.length / 1024).toFixed(0)} KB`);

  // Cleanup
  ws.close();
  chromeProc.kill();
  close();
  console.log('Match capture complete!');
}

main().catch(err => {
  console.error('Error during match capture:', err);
  process.exit(1);
});
