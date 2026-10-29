// Read-only development preview. Serves only the compiled game on loopback.
import http from 'node:http';
import fs from 'node:fs';
const game = new URL('../../LAN_FPS.html', import.meta.url);
const server = http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/LAN_FPS.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
  fs.createReadStream(game).pipe(res);
});
server.listen(4173, '127.0.0.1', () => console.log('LAN_FPS preview: http://127.0.0.1:4173'));
