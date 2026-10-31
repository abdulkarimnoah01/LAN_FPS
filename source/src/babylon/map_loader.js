/* Babylon.js GLTF/GLB Map Loader & Environment Configurator */

import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import { createSkyDome, createRidge, hexToColor3 } from './materials.js';

export async function decompressGzip(base64Data) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const resp = new Response(ds.readable);
    return await resp.arrayBuffer();
  }
  return bytes.buffer;
}

export async function loadBabylonMap(scene, mapId, assets, shadowGenerator = null) {
  const mapData = assets?.maps?.[mapId];
  const root = new BABYLON.TransformNode(`map_${mapId}`, scene);
  let loadedMeshes = [];

  if (mapData) {
    let arrayBuffer = null;
    if (mapData.glbz) {
      arrayBuffer = await decompressGzip(mapData.glbz);
    } else if (mapData.glb) {
      const binary = atob(mapData.glb);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    }

    if (arrayBuffer) {
      const file = new File([arrayBuffer], `${mapId}.glb`, { type: 'model/gltf-binary' });
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync('', file, scene, null, '.glb');
      container.addAllToScene();

      for (const m of container.meshes) {
        if (!m.parent) m.parent = root;
        loadedMeshes.push(m);
        m.receiveShadows = true;
        if (shadowGenerator && m.getTotalVertices() > 0 && mapId !== 'foundry' && mapId !== 'glowplant' && mapId !== 'zenith') {
          shadowGenerator.addShadowCaster(m);
        }
      }
    }
  }

  return { root, meshes: loadedMeshes };
}

export function configureArenaLighting(scene, mapId, theme) {
  const baked = ['foundry', 'glowplant', 'zenith'].includes(mapId) || ['foundry', 'glowplant', 'zenith'].includes(theme);
  const yard = mapId === 'railyard' || theme === 'railyard';
  const school = mapId === 'school' || theme === 'school';

  // Sunlight / Directional Light
  let sun = scene.getLightByName('sun');
  if (!sun) {
    sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -1), scene);
  }

  // Ambient / Hemispheric Fill Light
  let hemi = scene.getLightByName('hemi');
  if (!hemi) {
    hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  }

  // Shadow generator setup
  let shadowGen = scene.shadowGenerators && scene.shadowGenerators[0];
  const wantShadowMap = yard || school ? 4096 : 2048;

  if (yard) {
    // Hadota Rail Yard: Dusk lighting
    sun.direction = new BABYLON.Vector3(85, -62, -48).normalize();
    sun.diffuse = hexToColor3('#ffb675');
    sun.intensity = 3.6;

    hemi.direction = new BABYLON.Vector3(0, 1, 0);
    hemi.diffuse = hexToColor3('#8ea4d4');
    hemi.groundColor = hexToColor3('#4d3b30');
    hemi.intensity = 1.8;

    scene.clearColor = hexToColor3('#2a374a').toColor4(1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = hexToColor3('#50464d');
    scene.fogStart = 60;
    scene.fogEnd = 420;

    // Sky Dome and ridges for rail yard
    createSkyDome(scene, '#35527f', '#f0a56c', '#9a6a55', sun.direction.scale(-1));
    createRidge(scene, 300, 26, 22, '#6f5a66', 1.3);
    createRidge(scene, 240, 30, 18, '#3b3550', 4.1);
  } else if (school) {
    // Schoolyard: Egyptian courtyard daylight
    sun.direction = new BABYLON.Vector3(-26, -58, 18).normalize();
    sun.diffuse = hexToColor3('#fff3df');
    sun.intensity = 3.0;

    hemi.direction = new BABYLON.Vector3(0, 1, 0);
    hemi.diffuse = hexToColor3('#eaf4ff');
    hemi.groundColor = hexToColor3('#6d6153');
    hemi.intensity = 1.6;

    scene.clearColor = hexToColor3('#d8c29d').toColor4(1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = hexToColor3('#d8c29d');
    scene.fogStart = 35;
    scene.fogEnd = 160;
  } else if (baked) {
    // Baked arenas: unlit vertex colors
    sun.direction = new BABYLON.Vector3(-14, -30, -8).normalize();
    sun.diffuse = hexToColor3('#fff3df');
    sun.intensity = 0.5;

    hemi.direction = new BABYLON.Vector3(0, 1, 0);
    hemi.diffuse = hexToColor3('#eaf4ff');
    hemi.groundColor = hexToColor3('#3a3530');
    hemi.intensity = 1.25;

    const skyHex = mapId === 'zenith' ? '#080811' : (mapId === 'foundry' ? '#231b18' : '#141e24');
    const fogHex = mapId === 'zenith' ? '#0c0c18' : (mapId === 'foundry' ? '#2c221c' : '#1c2830');
    scene.clearColor = hexToColor3(skyHex).toColor4(1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = hexToColor3(fogHex);
    scene.fogStart = 40;
    scene.fogEnd = 170;

    if (mapId === 'zenith') {
      createStarField(scene);
    }
  } else {
    // Procedural maps (forest, river, aftermath, sandbox, arena)
    sun.direction = new BABYLON.Vector3(-14, -30, -8).normalize();
    sun.diffuse = hexToColor3('#fff3df');
    sun.intensity = 2.2;

    hemi.direction = new BABYLON.Vector3(0, 1, 0);
    hemi.diffuse = hexToColor3('#eaf4ff');
    hemi.groundColor = hexToColor3('#5b5246');
    hemi.intensity = 1.6;

    scene.clearColor = hexToColor3('#8ea4b9').toColor4(1);
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = hexToColor3('#8ea4b9');
    scene.fogStart = 30;
    scene.fogEnd = 110;
  }

  return { sun, hemi };
}

function createStarField(scene) {
  const pcs = new BABYLON.PointsCloudSystem('stars', 900, scene);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  pcs.addPoints(900, (particle, i) => {
    const u = rnd() * Math.PI * 2, v = Math.acos(rnd() * 0.92 + 0.04);
    const r = 200;
    particle.position = new BABYLON.Vector3(
      Math.cos(u) * Math.sin(v) * r,
      Math.cos(v) * r,
      Math.sin(u) * Math.sin(v) * r
    );
    particle.color = new BABYLON.Color4(0.81, 0.89, 1.0, 1.0);
  });
  pcs.buildMeshAsync();
  return pcs;
}
