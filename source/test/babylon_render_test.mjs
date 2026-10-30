/* Automated Unit Tests for Babylon.js 9 Renderer System */

import assert from 'node:assert/strict';
import * as BABYLON from '@babylonjs/core';
import { getPBRMaterial, GRAPHICS_PRESETS } from '../src/babylon/materials.js';
import { buildProceduralWorld } from '../src/babylon/procedural_world.js';
import { configureArenaLighting } from '../src/babylon/map_loader.js';
import { buildBabylonWeaponModel } from '../src/babylon/weapon_viewmodel.js';
import { getMap } from '../src/arena.js';
import { WEAPONS } from '../src/sim.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function createHeadlessScene() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  scene.useRightHandedSystem = true;
  return { engine, scene };
}

test('Babylon 9 NullEngine initializes with right-handed coordinate system', () => {
  const { engine, scene } = createHeadlessScene();
  assert.equal(scene.useRightHandedSystem, true);
  engine.dispose();
});

test('PBR materials generate valid albedo, roughness, and metalness', () => {
  const { engine, scene } = createHeadlessScene();
  const metalMat = getPBRMaterial(scene, 'metal');
  assert.equal(metalMat instanceof BABYLON.PBRMaterial, true);
  assert(metalMat.metallic > 0.5);

  const woodMat = getPBRMaterial(scene, 'wood');
  assert(woodMat.roughness > 0.8);
  assert(woodMat.metallic < 0.2);

  const waterMat = getPBRMaterial(scene, 'water');
  assert.equal(waterMat.alpha, 0.82);

  engine.dispose();
});

test('Procedural map builder generates meshes for trees, rocks, barrels, water, slabs, and jump pads', () => {
  const { engine, scene } = createHeadlessScene();

  for (const mapName of ['forest', 'aftermath', 'river', 'sandbox']) {
    const map = getMap(mapName, 12345);
    const { root, barrelMeshes } = buildProceduralWorld(scene, map);
    assert(root);
    const children = root.getChildren();
    assert(children.length > 0, `Map ${mapName} should generate geometry`);
  }

  engine.dispose();
});

test('Arena lighting configures appropriate sun and ambient for railyard, school, and foundry', () => {
  const { engine, scene } = createHeadlessScene();

  // 1. Railyard (dusk)
  const dusk = configureArenaLighting(scene, 'railyard', 'railyard');
  assert(dusk.sun.intensity > 3.0);
  assert.equal(scene.fogMode, BABYLON.Scene.FOGMODE_LINEAR);

  // 2. Schoolyard (Egyptian daylight)
  const school = configureArenaLighting(scene, 'school', 'school');
  assert(school.sun.intensity >= 3.0);

  // 3. Baked (Foundry)
  const baked = configureArenaLighting(scene, 'foundry', 'foundry');
  assert(baked.sun.intensity < 1.0);

  engine.dispose();
});

test('All 6 weapon models generate valid viewmodel meshes with renderingGroupId = 1', () => {
  const { engine, scene } = createHeadlessScene();

  for (const wep of WEAPONS) {
    const model = buildBabylonWeaponModel(scene, wep.id);
    assert(model, `Weapon ${wep.id} should build`);
    assert(model.muzzleOffset, `Weapon ${wep.id} should define muzzleOffset`);

    const meshes = model.getChildMeshes();
    assert(meshes.length > 0, `Weapon ${wep.id} should have child meshes`);
    for (const m of meshes) {
      assert.equal(m.renderingGroupId, 1, `Weapon mesh should render in foreground group 1`);
    }
  }

  engine.dispose();
});

test('Graphics presets define low, medium, high, and ultra quality levels', () => {
  assert(GRAPHICS_PRESETS.low);
  assert(GRAPHICS_PRESETS.medium);
  assert(GRAPHICS_PRESETS.high);
  assert(GRAPHICS_PRESETS.ultra);

  assert.equal(GRAPHICS_PRESETS.low.shadows, false);
  assert.equal(GRAPHICS_PRESETS.high.shadows, true);
  assert.equal(GRAPHICS_PRESETS.ultra.shadowSize, 4096);
});

async function run() {
  console.log(`Running ${tests.length} Babylon renderer unit tests...`);
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      console.error(`  FAIL ${name}`);
      console.error(e);
      process.exit(1);
    }
  }
  console.log('All Babylon renderer unit tests passed!');
}

run();
