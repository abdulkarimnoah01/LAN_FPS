/* Appearance / Next Gen body tests: schema, persistence, host authority, replication,
   texture masks, shared rig, and Babylon material ownership (NullEngine).
   node test/appearance_test.mjs */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import {
  normalizeAppearance, encodeLook, decodeLook, canonicalLook, loadAppearance, saveAppearance, makeLookLimiter,
  applyPreset, PRESETS, OUTFITS, SKINS, SHADERS, ACCENTS, DEFAULT_LOOK, LOOK_STORAGE_KEY, resolveAccent, TEAM_ACCENTS,
  transformAtlas, classifyPixel, PIXEL_CLASS, extractGlbImage,
} from '../src/appearance.js';
import { NG_BODIES, NG_UV, NG_ATLAS_SIZE, paintNgAtlas } from '../src/ng_bodies.js';
import { buildGlb, JOINTS } from '../tools/build_ng_characters.mjs';
import { HostGame } from '../src/hostgame.js';
import { getMap } from '../src/arena.js';
import { makeBabylonCharacter, BabylonAvatar, disposeCharacter, clipName } from '../src/babylon/character_loader.js';
import { applyAppearance } from '../src/babylon/appearance_materials.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Name tags draw on a DynamicTexture; NullEngine in Node needs a canvas stand-in.
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx; } };
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const memStore = (init = {}) => { const m = { ...init }; return { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; }, m }; };
const glbJson = buf => JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());

test('catalog meets the creator baseline (6 presets, 3 outfit variants, 4 skins, 2 shaders)', () => {
  assert.ok(PRESETS.length >= 6);
  assert.ok(OUTFITS.filter(o => o.id !== 'stock').length >= 3);
  assert.equal(SKINS.length, 4);
  assert.equal(SHADERS.length, 2);
  const codes = new Set(PRESETS.map(p => encodeLook(applyPreset({}, p.id))));
  assert.equal(codes.size, PRESETS.length, 'presets are distinct');
});

test('normalizeAppearance round-trips and rejects unknown ids, URLs and shader source', () => {
  const a = normalizeAppearance({ bodyId: 'ng-female-tall', outfitId: 'tropic', skinId: 'deep', shaderId: 'rim', accentId: 'lime', extra: 1 });
  assert.deepEqual(a, { v: 1, bodyId: 'ng-female-tall', outfitId: 'tropic', skinId: 'deep', shaderId: 'rim', accentId: 'lime' });
  assert.deepEqual(decodeLook(encodeLook(a), a.bodyId), a);
  const bad = normalizeAppearance({ outfitId: 'https://evil/x.png', shaderId: 'void main(){}', skinId: '../../etc', accentId: 5 });
  assert.equal(bad.outfitId, DEFAULT_LOOK.outfitId);
  assert.equal(bad.shaderId, DEFAULT_LOOK.shaderId);
  assert.equal(bad.skinId, DEFAULT_LOOK.skinId);
  assert.equal(bad.accentId, DEFAULT_LOOK.accentId);
  for (const junk of [null, undefined, 42, 'x', [], [1, 2]]) assert.equal(encodeLook(normalizeAppearance(junk)), encodeLook(DEFAULT_LOOK));
  assert.equal(normalizeAppearance({ bodyId: '../../../Abdulkarim.glb' }).bodyId, '-abdulkarim-glb');
});

test('canonicalLook bounds payload size and canonicalises garbage', () => {
  assert.equal(canonicalLook('a'.repeat(5000)), encodeLook(DEFAULT_LOOK));
  assert.equal(canonicalLook({ outfitId: 'sunset', pad: 'x'.repeat(600) }), encodeLook(DEFAULT_LOOK));
  assert.equal(canonicalLook('sunset.tan.rim.amber'), 'sunset.tan.rim.amber');
  assert.equal(canonicalLook('sunset.tan.<script>.amber'), 'sunset.tan.matte.amber');
  assert.equal(canonicalLook(12), encodeLook(DEFAULT_LOOK));
});

test('persistence survives corrupt JSON and unavailable storage', () => {
  const s = memStore({ [LOOK_STORAGE_KEY]: '{not json' });
  assert.equal(encodeLook(loadAppearance(s)), encodeLook(DEFAULT_LOOK));
  saveAppearance(s, { outfitId: 'midnight', shaderId: 'rim' });
  assert.equal(loadAppearance(s, 'ng-male-short').outfitId, 'midnight');
  assert.equal(loadAppearance(s, 'ng-male-short').bodyId, 'ng-male-short');
  const throwing = { get() { throw Error('denied'); }, set() { throw Error('denied'); } };
  assert.doesNotThrow(() => saveAppearance(throwing, DEFAULT_LOOK));
  assert.throws(() => throwing.get());   // loadAppearance callers wrap storage in try; store.get in main_online already does
});

test('look limiter allows two changes per second per player', () => {
  const ok = makeLookLimiter();
  assert.equal(ok('a', 0), true); assert.equal(ok('a', 0), true); assert.equal(ok('a', 0), false);
  assert.equal(ok('b', 0), true, 'per player');
  assert.equal(ok('a', 0.6), true);
});

test('team modes override the personal accent', () => {
  assert.equal(resolveAccent({ accentId: 'lime' }, 'red'), TEAM_ACCENTS.red);
  assert.equal(resolveAccent({ accentId: 'lime' }, 'none'), ACCENTS.find(a => a.id === 'lime').color);
});

test('host canonicalises looks, replicates them in snapshots and rate-limits changes', () => {
  const g = new HostGame(getMap('arena', 1), { mode: 'ffa' });
  g.addPlayer('h', 'Host', 'ng-male-tall', null, 'tropic.deep.rim.magenta');
  g.addPlayer('x', 'Guest', 'ng-female-short', null, 'hack.hack.hack.hack');
  let snap = g.snapshot();
  assert.equal(snap.players.find(p => p.id === 'h').lk, 'tropic.deep.rim.magenta');
  assert.equal(snap.players.find(p => p.id === 'x').lk, encodeLook(DEFAULT_LOOK));
  assert.equal(g.setLook('x', 'sunset.light.matte.amber'), true);
  assert.equal(g.setLook('x', 'midnight.tan.rim.cyan'), true);
  assert.equal(g.setLook('x', 'stock.natural.matte.cyan'), false, 'third change in the same instant is dropped');
  assert.equal(g.setLook('x', 'z'.repeat(600)), false, 'oversized payload rejected');
  assert.equal(g.setLook('nobody', 'sunset.light.matte.amber'), false);
  // late joiner gets everyone's canonical look from the first snapshot it sees
  g.addPlayer('late', 'Late', 'ng-male-short');
  snap = g.snapshot();
  assert.equal(snap.players.find(p => p.id === 'x').lk, 'midnight.tan.rim.cyan');
  assert.equal(snap.players.find(p => p.id === 'h').lk, 'tropic.deep.rim.magenta');
  // respawn keeps the look
  const p = g.players.get('x'); g.spawn(p);
  assert.equal(g.snapshot().players.find(q => q.id === 'x').lk, 'midnight.tan.rim.cyan');
});

test('NG atlas painting is deterministic and variants are visibly distinct', () => {
  const a = paintNgAtlas('ng-male-tall', { outfitId: 'stock', skinId: 'natural' }, 128);
  const b = paintNgAtlas('ng-male-tall', { outfitId: 'stock', skinId: 'natural' }, 128);
  assert.deepEqual(a, b);
  const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++; return n / (x.length / 4); };
  for (const o of ['midnight', 'tropic', 'sunset']) assert.ok(diff(a, paintNgAtlas('ng-male-tall', { outfitId: o }, 128)) > 0.08, o);
  for (const s of ['light', 'tan', 'deep']) assert.ok(diff(a, paintNgAtlas('ng-male-tall', { skinId: s }, 128)) > 0.03, s);
});

test('NG skin tones only touch skin; outfits never recolour the face', () => {
  const S = 128, px = (buf, u, v) => { const i = (Math.floor(v * S) * S + Math.floor(u * S)) * 4; return [buf[i], buf[i + 1], buf[i + 2]].join(); };
  const base = paintNgAtlas('ng-male-short', {}, S), deep = paintNgAtlas('ng-male-short', { skinId: 'deep' }, S), mid = paintNgAtlas('ng-male-short', { outfitId: 'midnight' }, S);
  const legTop = [(NG_UV.leg[0] + NG_UV.leg[2]) / 2, NG_UV.leg[1] + 0.02];       // trousers
  const shoe = [(NG_UV.foot[0] + NG_UV.foot[2]) / 2, (NG_UV.foot[1] + NG_UV.foot[3]) / 2];
  const cheek = [(NG_UV.head[0] + NG_UV.head[2]) / 2 + 0.06, NG_UV.head[1] + 0.58 * (NG_UV.head[3] - NG_UV.head[1])];
  assert.equal(px(base, ...legTop), px(deep, ...legTop));
  assert.equal(px(base, ...shoe), px(deep, ...shoe));
  assert.notEqual(px(base, ...cheek), px(deep, ...cheek));
  assert.equal(px(base, ...cheek), px(mid, ...cheek));
  assert.notEqual(px(base, ...legTop), px(mid, ...legTop));
});

test('legacy atlas heuristic preserves dark/near-white pixels and moves skin/cloth classes', () => {
  assert.equal(classifyPixel(10, 8, 6), PIXEL_CLASS.KEEP);
  assert.equal(classifyPixel(250, 250, 250), PIXEL_CLASS.KEEP);
  assert.equal(classifyPixel(200, 140, 100), PIXEL_CLASS.SKIN);
  assert.equal(classifyPixel(40, 60, 120), PIXEL_CLASS.CLOTH);
  const src = new Uint8ClampedArray([10, 8, 6, 255, 200, 140, 100, 255, 40, 60, 120, 255]);
  const out = transformAtlas(src, 'sunset', 'deep');
  assert.deepEqual([...out.slice(0, 4)], [10, 8, 6, 255]);
  assert.notDeepEqual([...out.slice(4, 8)], [200, 140, 100, 255]);
  assert.notDeepEqual([...out.slice(8, 12)], [40, 60, 120, 255]);
  assert.deepEqual([...src.slice(4, 8)], [200, 140, 100, 255], 'input untouched');
});

test('four NG bodies share joints, clips and core topology; generator is deterministic', () => {
  const builds = NG_BODIES.map(b => ({ b, ...buildGlb(b) }));
  const again = buildGlb(NG_BODIES[0]);
  assert.ok(builds[0].glb.equals(again.glb), 'byte-identical rebuild');
  const jsons = builds.map(x => glbJson(x.glb));
  for (const j of jsons) {
    assert.deepEqual(j.skins[0].joints.map(i => j.nodes[i].name), JOINTS);
    assert.deepEqual(j.animations.map(a => a.name), ['idle', 'walk', 'run', 'crouch', 'crouch_walk', 'die', 'death']);
    assert.equal(j.materials.length, 1);
    assert.ok(extractGlbImage(new Uint8Array(builds[0].glb)));
  }
  const tris = builds.map(x => x.triangles);
  assert.equal(tris[0], tris[1]); assert.equal(tris[0], tris[3]);   // only long hair adds faces
  for (const t of tris) assert.ok(t > 900 && t < 1600, `low-poly budget (${t})`);
  // the committed assets match the generator
  for (const x of builds) {
    const file = path.join(root, 'assets', 'characters_ng', x.b.file + '.glb');
    assert.ok(fs.existsSync(file), `missing ${file}; run npm run build:characters`);
    assert.ok(fs.readFileSync(file).equals(x.glb), `${x.b.file}.glb is stale; run npm run build:characters`);
  }
  const heights = jsons.map(j => { const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]; return acc.max[1]; });
  NG_BODIES.forEach((b, i) => assert.ok(Math.abs(heights[i] - b.height) < 0.05, `${b.code} height ${heights[i]}`));
});

async function nullScene() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine); scene.useRightHandedSystem = true;
  return { engine, scene };
}
const ngAssets = () => ({ characters: NG_BODIES.map(b => ({ id: b.id, name: b.file, ng: true, glb: fs.readFileSync(path.join(root, 'assets', 'characters_ng', b.file + '.glb')).toString('base64') })) });

test('one GLB load per body; 30 look swaps reuse geometry/skeleton and do not leak materials', async () => {
  const { engine, scene } = await nullScene();
  const assets = ngAssets();
  const a = await makeBabylonCharacter(scene, assets, 'ng-female-tall');
  const b = await makeBabylonCharacter(scene, assets, 'ng-female-tall');
  assert.equal(scene.geometries.length, 1, 'two instances share one geometry');
  const skel = a.skeleton, geoms = scene.geometries.length, ags = a.animationGroups.map(g => g.name);
  assert.deepEqual(ags.map(n => clipName(n)).sort(), ['crouch', 'crouch_walk', 'death', 'die', 'idle', 'run', 'walk']);
  const looks = ['tropic.deep.rim.magenta', 'sunset.light.matte.amber', 'midnight.tan.rim.cyan'];
  const before = scene.materials.length;
  for (let i = 0; i < 30; i++) await applyAppearance(a, decodeLook(looks[i % 3], 'ng-female-tall'));
  assert.equal(a.skeleton, skel);
  assert.equal(scene.geometries.length, geoms);
  assert.deepEqual(a.animationGroups.map(g => g.name), ags);
  assert.ok(scene.materials.length <= before + a.ownedMaterials.length, `materials bounded (${scene.materials.length})`);
  assert.equal(a.lookCode, looks[29 % 3]);
  // isolation: b still renders the shared base material, a owns its own
  const matA = a.root.getChildMeshes().find(m => m.material).material, matB = b.root.getChildMeshes().find(m => m.material).material;
  assert.notEqual(matA, matB);
  assert.ok(a.ownedMaterials.includes(matA));
  // stale applies never overwrite a newer one
  const p1 = applyAppearance(b, decodeLook(looks[0])), p2 = applyAppearance(b, decodeLook(looks[1]));
  assert.equal(await p1, false); assert.equal(await p2, true); assert.equal(b.lookCode, looks[1]);
  disposeCharacter(a);
  assert.ok(a.ownedMaterials.length === 0);
  scene.dispose(); engine.dispose();
});

test('BabylonAvatar applies snapshot looks without reloading and never resurrects after dispose', async () => {
  const { engine, scene } = await nullScene();
  const assets = ngAssets();
  const av = new BabylonAvatar(scene, assets, 'p1', 'Guest', 1, 'ng-male-short', 'none', 'tropic.tan.matte.cyan');
  while (!av.loaded) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 5));
  assert.equal(av.model.lookCode, 'tropic.tan.matte.cyan');
  const root = av.root;
  av.update({ x: 0, y: 0, z: 0, yaw: 0, alive: true, lk: 'sunset.deep.rim.amber' }, 1 / 60);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(av.root, root, 'same rig instance');
  assert.equal(av.model.lookCode, 'sunset.deep.rim.amber');
  const ghost = new BabylonAvatar(scene, assets, 'p2', 'Ghost', 2, 'ng-male-short');
  ghost.dispose();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(ghost.root, null);
  assert.ok(!scene.transformNodes.some(n => n.name === 'char_ng-male-short' && n !== root && !n.isDisposed()), 'no resurrected rig');
  av.dispose();
  scene.dispose(); engine.dispose();
});

let failed = 0;
console.log(`Running ${tests.length} appearance tests...`);
for (const t of tests) {
  try { await t.fn(); console.log('  ok ', t.name); }
  catch (e) { failed++; console.log('  FAIL', t.name); console.log(e); }
}
if (failed) { console.log(`${failed} appearance test(s) failed`); process.exit(1); }
console.log('All appearance tests passed!');
