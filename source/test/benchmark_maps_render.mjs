import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = [
  '--headless=new',
  '--remote-debugging-port=9236',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  'file:///X:/Projects/game/LAN_FPS/LAN_FPS.html'
];

const proc = spawn(chromePath, args);
setTimeout(async () => {
  try {
    const list = await fetch('http://localhost:9236/json').then(r => r.json());
    const target = list.find(p => p.url.includes('LAN_FPS.html')) || list[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

    ws.onopen = () => {
      send('Runtime.enable');
      send('Page.enable');

      setTimeout(async () => {
        // Expose helper to evaluate match stats
        const evalCode = `(async () => {
          const results = {};
          
          async function testMap(mapKey) {
            // Leave if currently in game
            const leaveBtn = document.getElementById('leave');
            if (leaveBtn && !leaveBtn.hidden) {
              leaveBtn.click();
              await new Promise(r => setTimeout(r, 600));
            }
            // Select practice mode
            document.getElementById('local').click();
            await new Promise(r => setTimeout(r, 300));
            
            // Choose map
            const sel = document.getElementById('map-select');
            sel.value = mapKey;
            sel.dispatchEvent(new Event('change'));
            await new Promise(r => setTimeout(r, 300));
            
            // Host match
            document.getElementById('create').click();
            await new Promise(r => setTimeout(r, 600));
            document.getElementById('select-go').click();
            await new Promise(r => setTimeout(r, 1500));
            
            const hud = document.getElementById('hud');
            const canvas = document.getElementById('c');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            
            return {
              map: mapKey,
              inGame: hud && !hud.hidden,
              hudMode: document.getElementById('hud-mode')?.textContent,
              heapUsedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
              canvasSize: [canvas.width, canvas.height]
            };
          }

          results.foundry = await testMap('foundry');
          results.glowplant = await testMap('glowplant');
          results.zenith = await testMap('zenith');
          
          return JSON.stringify(results);
        })()`;

        send('Runtime.evaluate', { expression: evalCode, awaitPromise: true });

      }, 1500);
    };

    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      } else if (msg.result?.result?.value) {
        console.log('[BENCHMARK_RESULTS]:\n' + JSON.stringify(JSON.parse(msg.result.result.value), null, 2));
        ws.close();
        proc.kill();
        process.exit(0);
      }
    };
  } catch (err) {
    console.error(err);
    proc.kill();
    process.exit(1);
  }
}, 1500);
