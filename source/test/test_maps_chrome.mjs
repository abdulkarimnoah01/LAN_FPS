import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runMapTest(mapKey, screenshotName) {
  return new Promise((resolve, reject) => {
    const port = 9240 + Math.floor(Math.random() * 50);
    const args = [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
      'file:///X:/Projects/game/LAN_FPS/LAN_FPS.html'
    ];
    const proc = spawn(chromePath, args);

    setTimeout(async () => {
      try {
        const list = await fetch(`http://localhost:${port}/json`).then(r => r.json());
        const target = list.find(p => p.url.includes('LAN_FPS.html')) || list[0];
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        let id = 0;
        const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

        ws.onopen = () => {
          send('Runtime.enable');
          send('Page.enable');

          setTimeout(() => {
            // Select local practice, choose map, host, and pick hero
            send('Runtime.evaluate', {
              expression: `(async () => {
                document.getElementById('local').click();
                await new Promise(r => setTimeout(r, 400));
                const sel = document.getElementById('map-select');
                sel.value = '${mapKey}';
                sel.dispatchEvent(new Event('change'));
                await new Promise(r => setTimeout(r, 400));
                document.getElementById('create').click();
                await new Promise(r => setTimeout(r, 600));
                document.getElementById('select-go').click();
                await new Promise(r => setTimeout(r, 1500));

                const hud = document.getElementById('hud');
                const canvas = document.getElementById('c');
                return JSON.stringify({
                  map: '${mapKey}',
                  inGame: hud && !hud.hidden,
                  spawns: window.__LANFPS_WORLD?.spawns?.length || 0,
                  boxes: window.__LANFPS_WORLD?.boxes?.length || 0,
                  heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576)
                });
              })()`,
              awaitPromise: true
            });

            // Capture screenshot after 2s
            setTimeout(() => {
              send('Page.captureScreenshot', { format: 'png' });
            }, 2000);

          }, 1200);
        };

        ws.onmessage = m => {
          const msg = JSON.parse(m.data);
          if (msg.result?.result?.value) {
            console.log(`[EVAL ${mapKey}]`, msg.result.result.value);
          } else if (msg.result?.data) {
            const outPath = `X:/Projects/game/LAN_FPS/source/test/${screenshotName}`;
            fs.writeFileSync(outPath, Buffer.from(msg.result.data, 'base64'));
            console.log(`[SCREENSHOT] ${screenshotName} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
            ws.close();
            proc.kill();
            resolve();
          }
        };
      } catch (e) {
        proc.kill();
        reject(e);
      }
    }, 1200);
  });
}

async function main() {
  console.log('Testing Foundry Core...');
  await runMapTest('foundry', 'screenshot_foundry.png');
  console.log('Testing Reactor Complex (glowplant)...');
  await runMapTest('glowplant', 'screenshot_reactor.png');
  console.log('Testing Zenith Atrium...');
  await runMapTest('zenith', 'screenshot_zenith.png');
  console.log('All 3 map browser tests completed successfully!');
}

main().catch(console.error);
