import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = [
  '--headless=new',
  '--remote-debugging-port=9228',
  '--disable-gpu',
  '--no-sandbox',
  '--window-size=1440,900',
  'file:///X:/Projects/game/LAN_FPS/LAN_FPS.html'
];

const proc = spawn(chromePath, args);
setTimeout(async () => {
  try {
    const list = await fetch('http://localhost:9228/json').then(r => r.json());
    const target = list.find(p => p.url.includes('LAN_FPS.html')) || list[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    let step = 0;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++step, method, params }));

    ws.onopen = () => {
      send('Runtime.enable');
      send('Log.enable');
      send('Page.enable');

      setTimeout(() => {
        send('Runtime.evaluate', {
          expression: `(() => {
            const chars = window.LANFPS?.assets?.characters || [];
            return JSON.stringify({
              charCount: chars.length,
              charNames: chars.map(c => c.name),
              hasAssets: !!window.LANFPS?.assets
            });
          })()`
        });

        // Click "Operative roster" button
        setTimeout(() => {
          send('Runtime.evaluate', {
            expression: `(() => {
              const rosterBtn = document.getElementById('btn-lobby-roster');
              if (rosterBtn) rosterBtn.click();
              return 'clicked roster';
            })()`
          });

          // Wait 1.5s for 3D showcase turntable to spin and inspect roster
          setTimeout(() => {
            send('Runtime.evaluate', {
              expression: `(() => {
                const modal = document.getElementById('hero-roster-modal');
                const cardsContainer = document.getElementById('roster-cards');
                const cards = cardsContainer ? Array.from(cardsContainer.children).map(c => ({
                  id: c.dataset.heroId,
                  text: c.textContent.trim().replace(/\\s+/g, ' ')
                })) : [];
                return JSON.stringify({
                  modalHidden: modal ? modal.hidden : true,
                  heroName: document.getElementById('roster-hero-name')?.textContent,
                  heroClass: document.getElementById('roster-hero-class')?.textContent,
                  cardsCount: cards.length,
                  cards
                });
              })()`
            });

            setTimeout(() => {
              send('Page.captureScreenshot', { format: 'png' });
            }, 500);

          }, 1500);

        }, 1000);

      }, 1500);
    };

    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description);
      } else if (msg.result?.result?.value) {
        console.log('[EVAL]', msg.result.result.value);
      } else if (msg.result?.data) {
        fs.writeFileSync('X:/Projects/game/LAN_FPS/source/test/screenshot_roster8.png', Buffer.from(msg.result.data, 'base64'));
        console.log('[SCREENSHOT SAVED] screenshot_roster8.png');
        setTimeout(() => {
          ws.close();
          proc.kill();
          process.exit(0);
        }, 500);
      }
    };

  } catch (err) {
    console.error(err);
    proc.kill();
    process.exit(1);
  }
}, 1500);
