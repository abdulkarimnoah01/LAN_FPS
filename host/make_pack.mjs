// Assembles release/SpectreOrbit-Host from a finished build (run `npm run build:all` in source/ first).
// Usage: node host/make_pack.mjs   (from the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'release', 'SpectreOrbit-Host');
const need = p => { if (!fs.existsSync(path.join(repo, p))) throw new Error(`missing ${p}; build first`); return path.join(repo, p); };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
fs.mkdirSync(path.join(out, 'public'), { recursive: true });

for (const f of ['Start_Host.bat', 'start_host.ps1', 'README.txt']) fs.copyFileSync(need(`host/${f}`), path.join(out, f));
fs.copyFileSync(need('server/index.mjs'), path.join(out, 'server', 'index.mjs'));
fs.copyFileSync(need('server/package.json'), path.join(out, 'server', 'package.json'));
fs.cpSync(need('server/node_modules'), path.join(out, 'server', 'node_modules'), { recursive: true });
fs.copyFileSync(need('dist/online/index.html'), path.join(out, 'public', 'index.html'));
fs.copyFileSync(need('LAN_FPS_online.html'), path.join(out, 'LAN_FPS_online.html'));

const version = JSON.parse(fs.readFileSync(need('version.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'VERSION.txt'), `Spectre Orbit host pack v${version}\n`);
console.log(`Host pack v${version} -> ${path.relative(repo, out)}`);
