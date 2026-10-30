/* Builds ../LAN_FPS.html: one self-contained file with three.js, the game, the
   styles and any glTF models from ./assets inlined. Needs no server or internet.

   Usage (from this folder):  npm install   (once)
                              npm run build */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, '..', 'LAN_FPS.html');

const bundle = await build({
  entryPoints: [path.join(root, 'src', 'main.js')], bundle: true, minify: true, format: 'iife',
  target: 'es2022', write: false, legalComments: 'eof',
});
const js = bundle.outputFiles[0].text;

// Optional models. Every PC must run the same build so collisions match.
const assets = {};
for (const name of ['arena', 'player', 'weapon']) {
  const file = path.join(root, 'assets', name + '.glb');
  if (fs.existsSync(file)) { assets[name] = fs.readFileSync(file).toString('base64'); console.log(`  + assets/${name}.glb`); }
}
// Selectable characters: every assets/characters/<Name>.glb, listed by file name.
const charDir = path.join(root, 'assets', 'characters');
if (fs.existsSync(charDir)) {
  assets.characters = fs.readdirSync(charDir).filter(f => /\.glb$/i.test(f)).sort()
    .map(f => { console.log(`  + assets/characters/${f}`); return { name: f.replace(/\.glb$/i, ''), glb: fs.readFileSync(path.join(charDir, f)).toString('base64') }; });
}
// Processed multiplayer maps: assets/maps/processed/<id>.glb
const mapsDir = path.join(root, 'assets', 'maps', 'processed');
if (fs.existsSync(mapsDir)) {
  assets.maps = {};
  for (const id of ['foundry', 'glowplant', 'zenith', 'railyard']) {
    const glbFile = path.join(mapsDir, id + '.glb');
    const imgFile = path.join(mapsDir, id + '.jpg');
    assets.maps[id] = {};
    if (fs.existsSync(glbFile)) {
      // Map vertex data is large and compresses well; the game unpacks it with DecompressionStream.
      const raw = fs.readFileSync(glbFile), packed = zlib.gzipSync(raw, { level: 9 });
      assets.maps[id].glbz = packed.toString('base64');
      console.log(`  + assets/maps/${id}.glb (${(raw.length / 1024).toFixed(0)} KB, ${(packed.length / 1024).toFixed(0)} KB packed)`);
    }
    if (fs.existsSync(imgFile)) {
      assets.maps[id].preview = 'data:image/jpeg;base64,' + fs.readFileSync(imgFile).toString('base64');
    }
  }
}
const cfg = path.join(root, 'assets', 'assets.json');
if (fs.existsSync(cfg)) assets.config = JSON.parse(fs.readFileSync(cfg, 'utf8'));

const verFile = path.join(root, '..', 'version.json');
let version = '1.4.2';
if (fs.existsSync(verFile)) {
  try { version = JSON.parse(fs.readFileSync(verFile, 'utf8')).version || version; } catch {}
}

const script = s => '<script>' + s.replace(/<\/script/gi, '<\\/script') + '</script>';
// Allow raw.githubusercontent.com for online update checks and downloads
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob: https://raw.githubusercontent.com; media-src data: blob:; base-uri 'none'; form-action 'none'">`;

// Bundle the local UI artwork as data URLs, preserving single-file offline play.
const css = ['style.css', 'reference.css'].map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
  .replace(/url\(["']?assets\/ui\/([^"')]+)["']?\)/g, (_, name) => {
    const mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
    return `url("data:${mime};base64,${fs.readFileSync(path.join(root, 'assets', 'ui', name)).toString('base64')}")`;
  });

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">' + csp)
  .replace(/id="game-version"([^>]*)>v[^<]*</, `id="game-version"$1>v${version}<`)
  .replace('<!--STYLE-->', () => '<style>' + css + '</style>')
  .replace('<!--SCRIPT-->', () => script(`window.LANFPS_VERSION=${JSON.stringify(version)};window.LANFPS_ASSETS=` + JSON.stringify(assets) + ';') + '\n' + script(js));

fs.writeFileSync(out, html);
console.log(`Built ${path.relative(process.cwd(), out)}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB (v${version})`);
