import { spawn } from 'node:child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = [
  '--headless=new',
  '--remote-debugging-port=9232',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  'file:///X:/Projects/game/LAN_FPS/LAN_FPS.html'
];

const proc = spawn(chromePath, args);
setTimeout(async () => {
  try {
    const list = await fetch('http://localhost:9232/json').then(r => r.json());
    const target = list.find(p => p.url.includes('LAN_FPS.html')) || list[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

    ws.onopen = () => {
      send('Runtime.enable');
      setTimeout(() => {
        send('Runtime.evaluate', {
          expression: `(async () => {
            const localBtn = document.getElementById('local');
            if (localBtn) localBtn.click();
            await new Promise(r => setTimeout(r, 600));
            const createBtn = document.getElementById('create');
            if (createBtn) createBtn.click();
            await new Promise(r => setTimeout(r, 800));
            const selectGo = document.getElementById('select-go');
            if (selectGo) selectGo.click();
            await new Promise(r => setTimeout(r, 1500));

            const hud = document.getElementById('hud');
            const inGame = hud && !hud.hidden;
            const memory = performance.memory ? {
              usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
              totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576)
            } : null;
            return JSON.stringify({
              inGame,
              url: location.href,
              memory,
              domNodes: document.querySelectorAll('*').length
            });
          })()`,
          awaitPromise: true
        });
      }, 1000);
    };

    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.result?.result?.value) {
        console.log('MATCH_INFO:' + msg.result.result.value);
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
}, 1200);
