/* 3D preview for the map editor: renders the compiled custom map with the same procedural
   builder the match uses, in a modal with an orbiting camera. Disposed when closed. */

import * as BABYLON from '@babylonjs/core';
import { createBabylonEngine } from './engine_factory.js';
import { buildProceduralWorld } from './procedural_world.js';
import { hexToColor3 } from './materials.js';

export async function openMapPreview(world) {
  const overlay = document.createElement('div');
  overlay.className = 'ed-preview';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', '3D map preview');
  const canvas = document.createElement('canvas');
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn btn-primary small'; close.textContent = 'Close preview';
  const tip = document.createElement('p');
  tip.className = 'muted-note'; tip.textContent = 'Drag to orbit · wheel to zoom · Esc to close';
  overlay.append(canvas, close, tip);
  document.body.append(overlay);

  const { engine } = await createBabylonEngine(canvas, { preferWebGPU: false, antialias: true });
  const scene = new BABYLON.Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = hexToColor3(world.sky || '#8cc8f5').toColor4(1);
  const size = world.custom?.size || 56;
  const cam = new BABYLON.ArcRotateCamera('edCam', -Math.PI / 3, Math.PI / 3.2, size * 1.1, BABYLON.Vector3.Zero(), scene);
  cam.lowerRadiusLimit = 8; cam.upperRadiusLimit = size * 2.5; cam.upperBetaLimit = Math.PI / 2.05; cam.wheelPrecision = 8;
  cam.attachControl(canvas, true);
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 1.1; hemi.groundColor = hexToColor3('#6b5b4a');
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, -0.35), scene);
  sun.intensity = 2.2;
  buildProceduralWorld(scene, world, null);
  // spawn and objective markers
  const mark = (name, x, y, z, hex, h = 1.8) => {
    const m = BABYLON.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: 0, diameterBottom: 0.9, tessellation: 4 }, scene);
    m.position.set(x, y + h / 2, z);
    const mat = new BABYLON.StandardMaterial(name + 'Mat', scene); mat.emissiveColor = hexToColor3(hex); mat.disableLighting = true; m.material = mat;
  };
  for (const s of world.spawns) mark('spawn', s.x, s.y, s.z, s.team === 'red' ? '#f05d5e' : s.team === 'blue' ? '#4f8ff0' : '#e2e8f0');
  const a = world.objectiveAnchors || {};
  if (a.control) { const r = BABYLON.MeshBuilder.CreateTorus('zone', { diameter: 12, thickness: 0.15, tessellation: 48 }, scene); r.position.set(a.control.x, a.control.y + 0.1, a.control.z); const m = new BABYLON.StandardMaterial('zoneMat', scene); m.emissiveColor = hexToColor3('#fbbf24'); m.disableLighting = true; r.material = m; }
  if (a.ctf) for (const t of ['red', 'blue']) mark('flag', a.ctf[t].x, a.ctf[t].y, a.ctf[t].z, t === 'red' ? '#f05d5e' : '#4f8ff0', 3);
  engine.runRenderLoop(() => { cam.alpha += 0.0015; scene.render(); });
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);
  const done = () => {
    window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey);
    engine.stopRenderLoop(); scene.dispose(); engine.dispose(); overlay.remove();
  };
  const onKey = e => { if (e.key === 'Escape') done(); };
  document.addEventListener('keydown', onKey);
  close.onclick = done;
  close.focus();
  return done;
}
