import fs from 'node:fs';
import path from 'node:path';

const outDir = 'X:/Projects/game/LAN_FPS/source/assets/maps/sources';
const baseUrl = 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps';

const maps = ['boil', 'glowplant', 'dance', 'stormkeep'];
const extensions = ['.map', '.mapinfo', '.jpg'];

async function fetchFile(name, ext) {
  const filename = name + ext;
  const target = path.join(outDir, filename);
  if (fs.existsSync(target) && fs.statSync(target).size > 100) {
    console.log(`[EXISTS] ${filename}`);
    return;
  }
  const url = `${baseUrl}/${filename}`;
  console.log(`[FETCHING] ${url}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[FAILED ${res.status}] ${url}`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(target, buf);
    console.log(`[SAVED] ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`[ERROR] ${filename}:`, err.message);
  }
}

async function main() {
  for (const m of maps) {
    for (const ext of extensions) {
      await fetchFile(m, ext);
    }
  }
}

main();
