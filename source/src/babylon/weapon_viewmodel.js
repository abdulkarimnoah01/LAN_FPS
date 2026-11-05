/* Babylon.js First-Person Weapon Viewmodels & Combat Visual Effects */

import * as BABYLON from '@babylonjs/core';
import { WEAPONS } from '../sim.js';
import { hexToColor3 } from './materials.js';

/* Authored weapon models (tools/blender/build_weapons.py → assets/weapons/*.glb), decoded once
   per scene. Instances share geometry and materials; disposing an instance keeps the cache. */
const weaponCache = new WeakMap();
const VIEWMODEL_SCALE = 0.85;

export async function preloadWeaponModels(scene, assets) {
  const src = assets?.weapons;
  if (!src) return 0;
  const map = new Map();
  weaponCache.set(scene, map);
  await Promise.all(Object.entries(src).map(async ([id, b64]) => {
    try {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      map.set(id, await BABYLON.LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: `${id}.glb` }));
    } catch (e) { console.warn(`[weapons] ${id}.glb failed to load; using the procedural model`, e); }
  }));
  return map.size;
}

function instantiateWeapon(scene, container, id) {
  const root = new BABYLON.TransformNode(`wep_${id}`, scene);
  const inst = container.instantiateModelsToScene(n => `${n}_vm`, false);
  for (const n of inst.rootNodes) n.parent = root;
  root.scaling.setAll(VIEWMODEL_SCALE);
  for (const m of root.getChildMeshes()) { m.renderingGroupId = 1; m.isPickable = false; }
  // muzzle offset in the viewmodel root's space (root has no parent yet, so world = local)
  const muzzle = root.getDescendants(false).find(n => /^muzzle/.test(n.name));
  root.computeWorldMatrix(true);
  if (muzzle) { muzzle.computeWorldMatrix(true); root.muzzleOffset = muzzle.getAbsolutePosition().clone(); }
  else root.muzzleOffset = new BABYLON.Vector3(0, 0.015, -0.55);
  root.authored = true;
  return root;
}

export function buildBabylonWeaponModel(scene, id = 'ak47') {
  const cached = weaponCache.get(scene)?.get(id);
  if (cached) return instantiateWeapon(scene, cached, id);
  const root = new BABYLON.TransformNode(`wep_${id}`, scene);

  const dark = new BABYLON.PBRMaterial(`mat_dark_${id}`, scene);
  dark.albedoColor = hexToColor3('#22262c'); dark.roughness = 0.45; dark.metallic = 0.8;

  const steel = new BABYLON.PBRMaterial(`mat_steel_${id}`, scene);
  steel.albedoColor = hexToColor3('#464d57'); steel.roughness = 0.3; steel.metallic = 0.85;

  const wood = new BABYLON.PBRMaterial(`mat_wood_${id}`, scene);
  wood.albedoColor = hexToColor3('#633b1e'); wood.roughness = 0.9; wood.metallic = 0.05;

  const darkWood = new BABYLON.PBRMaterial(`mat_darkWood_${id}`, scene);
  darkWood.albedoColor = hexToColor3('#422612'); darkWood.roughness = 0.9; darkWood.metallic = 0.05;

  const orange = new BABYLON.PBRMaterial(`mat_orange_${id}`, scene);
  orange.albedoColor = hexToColor3('#b85420'); orange.roughness = 0.6; orange.metallic = 0.1;

  const lens = new BABYLON.PBRMaterial(`mat_lens_${id}`, scene);
  lens.albedoColor = hexToColor3('#1b6a7a'); lens.roughness = 0.1; lens.metallic = 0.9;

  let muzzleOffset = new BABYLON.Vector3(0, 0.015, -0.64);

  if (id === 'shotgun') {
    const rec = BABYLON.MeshBuilder.CreateBox('rec', { width: 0.075, height: 0.095, depth: 0.36 }, scene);
    rec.position.z = -0.12; rec.material = dark; rec.parent = root;

    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { height: 0.35, diameter: 0.044, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025, -0.44); barrel.material = steel; barrel.parent = root;

    const magTube = BABYLON.MeshBuilder.CreateCylinder('magTube', { height: 0.32, diameter: 0.036, tessellation: 8 }, scene);
    magTube.rotation.x = Math.PI / 2; magTube.position.set(0, -0.015, -0.42); magTube.material = dark; magTube.parent = root;

    const pump = BABYLON.MeshBuilder.CreateCylinder('pump', { height: 0.14, diameter: 0.056, tessellation: 8 }, scene);
    pump.rotation.x = Math.PI / 2; pump.position.set(0, -0.015, -0.36); pump.material = darkWood; pump.parent = root;

    const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.06, height: 0.14, depth: 0.07 }, scene);
    grip.position.set(0, -0.11, 0.02); grip.rotation.x = 0.28; grip.material = darkWood; grip.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.025, -0.62);
  } else if (id === 'sniper') {
    const rec = BABYLON.MeshBuilder.CreateBox('rec', { width: 0.065, height: 0.09, depth: 0.44 }, scene);
    rec.position.z = -0.12; rec.material = dark; rec.parent = root;

    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { height: 0.55, diameterTop: 0.036, diameterBottom: 0.044, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.58); barrel.material = steel; barrel.parent = root;

    const brake = BABYLON.MeshBuilder.CreateBox('brake', { width: 0.035, height: 0.035, depth: 0.07 }, scene);
    brake.position.set(0, 0.02, -0.84); brake.material = steel; brake.parent = root;

    const scopeTube = BABYLON.MeshBuilder.CreateCylinder('scopeTube', { height: 0.26, diameter: 0.044, tessellation: 8 }, scene);
    scopeTube.rotation.x = Math.PI / 2; scopeTube.position.set(0, 0.09, -0.16); scopeTube.material = dark; scopeTube.parent = root;

    const lensF = BABYLON.MeshBuilder.CreateCylinder('lensF', { height: 0.04, diameter: 0.056, tessellation: 8 }, scene);
    lensF.rotation.x = Math.PI / 2; lensF.position.set(0, 0.09, -0.28); lensF.material = lens; lensF.parent = root;

    const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.055, height: 0.12, depth: 0.26 }, scene);
    stock.position.set(0, -0.07, 0.12); stock.rotation.x = -0.15; stock.material = darkWood; stock.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.02, -0.88);
  } else if (id === 'smg') {
    const rec = BABYLON.MeshBuilder.CreateBox('rec', { width: 0.06, height: 0.085, depth: 0.30 }, scene);
    rec.position.z = -0.10; rec.material = dark; rec.parent = root;

    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { height: 0.18, diameterTop: 0.032, diameterBottom: 0.036, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.018, -0.32); barrel.material = steel; barrel.parent = root;

    const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.035, height: 0.20, depth: 0.05 }, scene);
    mag.position.set(0, -0.14, -0.08); mag.rotation.x = 0.12; mag.material = steel; mag.parent = root;

    const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.05, height: 0.13, depth: 0.06 }, scene);
    grip.position.set(0, -0.10, 0.06); grip.rotation.x = 0.25; grip.material = dark; grip.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.018, -0.42);
  } else if (id === 'lmg') {
    const rec = BABYLON.MeshBuilder.CreateBox('rec', { width: 0.085, height: 0.11, depth: 0.44 }, scene);
    rec.position.z = -0.12; rec.material = dark; rec.parent = root;

    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { height: 0.36, diameterTop: 0.048, diameterBottom: 0.052, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025, -0.48); barrel.material = steel; barrel.parent = root;

    const drum = BABYLON.MeshBuilder.CreateCylinder('drum', { height: 0.09, diameter: 0.14, tessellation: 12 }, scene);
    drum.rotation.z = Math.PI / 2; drum.position.set(-0.06, -0.12, -0.10); drum.material = orange; drum.parent = root;

    const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.065, height: 0.14, depth: 0.07 }, scene);
    grip.position.set(0, -0.12, 0.03); grip.rotation.x = 0.22; grip.material = dark; grip.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.025, -0.68);
  } else if (id === 'knife') {
    const bladeMat = new BABYLON.PBRMaterial('bladeMat', scene);
    bladeMat.albedoColor = hexToColor3('#cbd5e1'); bladeMat.roughness = 0.2; bladeMat.metallic = 0.95;

    const blade = BABYLON.MeshBuilder.CreateBox('blade', { width: 0.015, height: 0.055, depth: 0.28 }, scene);
    blade.position.set(0, 0.01, -0.22); blade.material = bladeMat; blade.parent = root;

    const guard = BABYLON.MeshBuilder.CreateBox('guard', { width: 0.045, height: 0.08, depth: 0.025 }, scene);
    guard.position.set(0, 0.01, -0.07); guard.material = dark; guard.parent = root;

    const handle = BABYLON.MeshBuilder.CreateCylinder('handle', { height: 0.16, diameter: 0.046, tessellation: 8 }, scene);
    handle.rotation.x = Math.PI / 2; handle.position.set(0, 0.01, 0.02); handle.material = darkWood; handle.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.01, -0.42);
  } else {
    // Default AK-47
    const rec = BABYLON.MeshBuilder.CreateBox('rec', { width: 0.065, height: 0.09, depth: 0.40 }, scene);
    rec.position.z = -0.12; rec.material = dark; rec.parent = root;

    const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', { height: 0.34, diameterTop: 0.032, diameterBottom: 0.036, tessellation: 8 }, scene);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, -0.46); barrel.material = steel; barrel.parent = root;

    const handguard = BABYLON.MeshBuilder.CreateBox('handguard', { width: 0.06, height: 0.07, depth: 0.18 }, scene);
    handguard.position.set(0, 0.025, -0.38); handguard.material = wood; handguard.parent = root;

    const mag = BABYLON.MeshBuilder.CreateBox('mag', { width: 0.045, height: 0.22, depth: 0.08 }, scene);
    mag.position.set(0, -0.13, -0.08); mag.rotation.x = 0.28; mag.material = orange; mag.parent = root;

    const grip = BABYLON.MeshBuilder.CreateBox('grip', { width: 0.055, height: 0.14, depth: 0.065 }, scene);
    grip.position.set(0, -0.12, 0.04); grip.rotation.x = 0.28; grip.material = darkWood; grip.parent = root;

    const stock = BABYLON.MeshBuilder.CreateBox('stock', { width: 0.055, height: 0.11, depth: 0.24 }, scene);
    stock.position.set(0, -0.05, 0.16); stock.rotation.x = -0.12; stock.material = wood; stock.parent = root;

    muzzleOffset = new BABYLON.Vector3(0, 0.015, -0.64);
  }

  root.scaling.scaleInPlace(0.78);

  // Set renderingGroupId = 1 so weapon renders in foreground without wall clipping
  for (const m of root.getChildMeshes()) {
    m.renderingGroupId = 1;
    m.isPickable = false;
  }

  root.muzzleOffset = muzzleOffset;
  return root;
}
