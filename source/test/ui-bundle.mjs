/* The reference skin must retain the game's single-file/offline distribution. */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('../LAN_FPS.html', root), 'utf8');
for (const name of ['relay-panorama.jpg', 'map-aftermath.jpg', 'map-river.jpg', 'map-forest.jpg', 'map-sandbox.jpg', 'map-arena.jpg']) {
  const jpeg = fs.readFileSync(new URL('assets/ui/' + name, root));
  assert.equal(jpeg[0], 0xff, `${name} must be a packaged JPEG`);
  assert.equal(jpeg[1], 0xd8, `${name} must be a packaged JPEG`);
  assert.ok(html.includes('data:image/jpeg;base64,' + jpeg.toString('base64')), `${name} is missing from the offline bundle`);
}
assert.ok(!/url\(["']?assets\/ui\//.test(html), 'UI artwork must not require external files');
for (const map of ['foundry', 'glowplant', 'zenith']) {
  const jpeg = fs.readFileSync(new URL(`assets/maps/processed/${map}.jpg`, root));
  assert.ok(html.includes('data:image/jpeg;base64,' + jpeg.toString('base64')), `${map} source preview is missing from the offline bundle`);
}
const markup = html.split('<script>')[0];
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs would break UI wiring');
for (const id of ['network-step','match-step','map-thumbnail','lobby-portrait','lamp-identity','lamp-network','lamp-alert','opt-crt']) {
  assert.ok(ids.includes(id), `Missing functional UI element ${id}`);
}
console.log('UI bundle checks passed: 9 offline images, unique IDs, required controls.');
