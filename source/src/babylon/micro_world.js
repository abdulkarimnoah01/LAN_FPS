/* Operation Microverse visuals. Builds the whole planet from the pure world data in micro_planet.js:
   one displaced low-poly icosphere (the same heightfield the collision uses) plus every prop as a
   GPU thin instance, bucketed by spatial sector and base mesh so Babylon can frustum-cull sectors.
   Nothing here invents collision; it only draws what sphere_sim.js already treats as solid. */

import * as BABYLON from '@babylonjs/core';
import { terrainHeight } from '../sphere_sim.js';
import { terrainColor } from '../micro_planet.js';
import { hexToColor3 } from './materials.js';

const TERRAIN_SUBDIV = { low: 40, medium: 56, high: 72, ultra: 80 };
const SUN_DIR = new BABYLON.Vector3(-0.55, -0.72, -0.42).normalize();

/* Cube-face + 3x3 grid sector id for a world position (keeps sectors compact for culling). */
function sectorOf(c, R) {
  const ax = Math.abs(c[0]), ay = Math.abs(c[1]), az = Math.abs(c[2]);
  const face = ax >= ay && ax >= az ? (c[0] > 0 ? 0 : 1) : ay >= az ? (c[1] > 0 ? 2 : 3) : (c[2] > 0 ? 4 : 5);
  const [u, v] = face < 2 ? [c[1], c[2]] : face < 4 ? [c[0], c[2]] : [c[0], c[1]];
  const q = t => Math.max(0, Math.min(2, Math.floor((t / (R * 1.2) + 1) * 1.5)));
  return face * 9 + q(u) * 3 + q(v);
}

function starTexture(scene, seed = 1) {
  const tex = new BABYLON.DynamicTexture('microStars', { width: 1024, height: 512 }, scene, false);
  const ctx = tex.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#05061a'); g.addColorStop(0.5, '#0b0a26'); g.addColorStop(1, '#05061a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 900; i++) {
    const a = 0.25 + rnd() * 0.75, r = rnd() < 0.06 ? 1.2 : 0.6;
    ctx.fillStyle = `rgba(${rnd() < 0.2 ? '255,170,230' : rnd() < 0.5 ? '170,220,255' : '255,255,255'},${a})`;
    ctx.beginPath(); ctx.arc(rnd() * 1024, rnd() * 512, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 6; i++) {   // soft nebula smears
    const x = rnd() * 1024, y = 60 + rnd() * 380, rad = 90 + rnd() * 140;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, i % 2 ? 'rgba(255,60,200,0.16)' : 'rgba(60,200,255,0.14)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  tex.update();
  return tex;
}

export function buildMicroWorld(scene, world, shadowGenerator, quality = 'medium') {
  const t0 = performance.now();
  const sph = world.sphere, R = sph.R;
  const root = new BABYLON.TransformNode('microRoot', scene);
  const stats = { terrainTris: 0, instances: 0, sectorMeshes: 0, buildMs: 0 };

  /* ---- lighting: a key sun, a cool counter-fill so no hemisphere is black, ambient everywhere ---- */
  const sun = scene.getLightByName('sun'), hemi = scene.getLightByName('hemi');
  if (sun) { sun.direction = SUN_DIR.clone(); sun.diffuse = hexToColor3('#fff0d6'); sun.specular = hexToColor3('#fff0d6'); sun.intensity = 2.5; }
  if (hemi) { hemi.diffuse = hexToColor3('#cfd8ff'); hemi.groundColor = hexToColor3('#8a93d8'); hemi.intensity = 1.55; }
  scene.ambientColor = new BABYLON.Color3(0.42, 0.44, 0.56);
  scene.clearColor = hexToColor3('#05061a').toColor4(1);
  scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
  const fill = new BABYLON.DirectionalLight('microFill', SUN_DIR.scale(-1), scene);
  fill.intensity = 0.55; fill.diffuse = hexToColor3('#8ea6ff'); fill.specular = BABYLON.Color3.Black(); fill.parent = root;

  /* ---- star dome ---- */
  const dome = BABYLON.MeshBuilder.CreateSphere('microSky', { diameter: 900, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  const skyMat = new BABYLON.StandardMaterial('microSkyMat', scene);
  skyMat.disableLighting = true; skyMat.emissiveTexture = starTexture(scene, sph.seed); skyMat.diffuseColor = BABYLON.Color3.Black();
  skyMat.backFaceCulling = false;
  dome.material = skyMat; dome.infiniteDistance = true; dome.isPickable = false; dome.parent = root;

  /* ---- terrain: icosphere displaced by the shared heightfield, vertex-coloured by district/road ---- */
  const sub = TERRAIN_SUBDIV[quality] || TERRAIN_SUBDIV.medium;
  const ground = BABYLON.MeshBuilder.CreateIcoSphere('microTerrain', { radius: 1, subdivisions: sub, flat: false, updatable: true }, scene);
  const pos = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind), idx = ground.getIndices();
  const col = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length; i += 3) {
    const l = Math.hypot(pos[i], pos[i + 1], pos[i + 2]), d = [pos[i] / l, pos[i + 1] / l, pos[i + 2] / l];
    const r = R + terrainHeight(sph, d);
    pos[i] = d[0] * r; pos[i + 1] = d[1] * r; pos[i + 2] = d[2] * r;
    const c = terrainColor(sph, d), j = (i / 3) * 4, shade = 0.94 + ((d[0] * 12.9898 + d[1] * 78.233 + d[2] * 37.719) % 1 + 1) % 1 * 0.1;
    col[j] = c[0] * shade; col[j + 1] = c[1] * shade; col[j + 2] = c[2] * shade; col[j + 3] = 1;
  }
  const nrm = new Float32Array(pos.length);
  BABYLON.VertexData.ComputeNormals(pos, idx, nrm);
  ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  ground.updateVerticesData(BABYLON.VertexBuffer.NormalKind, nrm);
  ground.setVerticesData(BABYLON.VertexBuffer.ColorKind, col, false, 4);
  ground.refreshBoundingInfo();
  const terrainMat = new BABYLON.StandardMaterial('microTerrainMat', scene);
  terrainMat.diffuseColor = BABYLON.Color3.White(); terrainMat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.05);
  terrainMat.ambientColor = BABYLON.Color3.White();
  ground.material = terrainMat; ground.receiveShadows = true; ground.isPickable = false; ground.parent = root;
  ground.freezeWorldMatrix(); stats.terrainTris = idx.length / 3;

  /* ---- props: thin instances per (kind, sector) ---- */
  const mk = (name, lit) => {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = BABYLON.Color3.White(); m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.1); m.ambientColor = BABYLON.Color3.White();
    if (!lit) { m.disableLighting = true; m.emissiveColor = BABYLON.Color3.Black(); }
    return m;
  };
  const mats = { lit: mk('microLit', true), glow: mk('microGlow', false) };
  const protos = {
    box: () => BABYLON.MeshBuilder.CreateBox('p_box', { size: 1 }, scene),
    glow: () => BABYLON.MeshBuilder.CreateBox('p_glow', { size: 1 }, scene),
    cyl: () => BABYLON.MeshBuilder.CreateCylinder('p_cyl', { diameter: 1, height: 1, tessellation: 10 }, scene),
    cone: () => BABYLON.MeshBuilder.CreateCylinder('p_cone', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 8 }, scene),
    ico: () => BABYLON.MeshBuilder.CreateIcoSphere('p_ico', { radius: 0.5, subdivisions: 1, flat: true }, scene),
  };
  const groups = new Map();
  for (const it of world.instances) {
    const key = it.k + '|' + sectorOf(it.c, R);
    let g = groups.get(key); if (!g) groups.set(key, g = { k: it.k, items: [] });
    g.items.push(it);
  }
  const casters = [];
  if (globalThis.LANFPS_MICRO_BASELINE) {
    // Measurement baseline only: one mesh and one material per colour, no instancing, no sectors.
    const matByCol = new Map();
    for (const it of world.instances) {
      const proto = protos[it.k]();
      const key = (it.k === 'glow' ? 'g' : 'l') + it.col;
      let mt = matByCol.get(key);
      if (!mt) { mt = mk('base_' + key, it.k !== 'glow'); mt.diffuseColor = hexToColor3(it.col); matByCol.set(key, mt); }
      proto.material = mt; proto.parent = root; proto.isPickable = false;
      const [x, y, z] = it.ax, m = BABYLON.Matrix.FromValues(x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1);
      proto.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(m);
      proto.scaling.set(it.s[0], it.s[1], it.s[2]); proto.position.set(it.c[0], it.c[1], it.c[2]);
      if (it.k !== 'glow') casters.push(proto);
      stats.instances++;
    }
    groups.clear();
  }
  for (const [key, g] of groups) {
    const mesh = protos[g.k]();
    mesh.name = 'micro_' + key;
    mesh.material = g.k === 'glow' ? mats.glow : mats.lit;
    const n = g.items.length, mat = new Float32Array(n * 16), colors = new Float32Array(n * 4);
    g.items.forEach((it, i) => {
      const o = i * 16, [x, y, z] = it.ax, s = it.s;
      mat.set([x[0] * s[0], x[1] * s[0], x[2] * s[0], 0, y[0] * s[1], y[1] * s[1], y[2] * s[1], 0, z[0] * s[2], z[1] * s[2], z[2] * s[2], 0, it.c[0], it.c[1], it.c[2], 1], o);
      const c = hexToColor3(it.col); colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    mesh.thinInstanceSetBuffer('matrix', mat, 16, true);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = false; mesh.parent = root;
    if (g.k !== 'glow') { mesh.receiveShadows = true; casters.push(mesh); }
    stats.instances += n; stats.sectorMeshes++;
  }
  if (shadowGenerator) for (const m of casters) shadowGenerator.addShadowCaster(m);
  if (!globalThis.LANFPS_MICRO_BASELINE) for (const k of Object.keys(protos)) scene.getMeshByName('p_' + k)?.dispose();

  stats.buildMs = Math.round(performance.now() - t0);
  // Scene-level materials, the star texture and lights are not owned by the node tree: free them explicitly.
  root.metadata = {
    stats,
    dispose: () => { mats.lit.dispose(); if (globalThis.LANFPS_MICRO_BASELINE) scene.materials.filter(m => m.name.startsWith('base_')).forEach(m => m.dispose()); mats.glow.dispose(); terrainMat.dispose(false, true); skyMat.dispose(false, true); },
  };
  return { root, stats, groundMesh: ground };
}

/* ---------- developer overlays (sandbox): collision boxes and gravity vectors ---------- */

export function buildCollisionDebug(scene, world) {
  const root = new BABYLON.TransformNode('microDebugCollision', scene);
  const mat = new BABYLON.StandardMaterial('microDebugMat', scene);
  mat.wireframe = true; mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(1, 0.2, 0.2);
  const box = BABYLON.MeshBuilder.CreateBox('dbgBoxProto', { size: 1 }, scene);
  const mats = new Float32Array(world.sphere.obbs.length * 16);
  world.sphere.obbs.forEach((o, i) => {
    const [x, y, z] = o.ax, h = o.he;
    mats.set([x[0] * h[0] * 2, x[1] * h[0] * 2, x[2] * h[0] * 2, 0, y[0] * h[1] * 2, y[1] * h[1] * 2, y[2] * h[1] * 2, 0, z[0] * h[2] * 2, z[1] * h[2] * 2, z[2] * h[2] * 2, 0, o.c[0], o.c[1], o.c[2], 1], i * 16);
  });
  box.material = mat; box.thinInstanceSetBuffer('matrix', mats, 16, true); box.thinInstanceRefreshBoundingInfo(false);
  box.isPickable = false; box.alwaysSelectAsActiveMesh = true; box.parent = root;
  return root;
}

export function buildGravityDebug(scene, world, count = 120) {
  const sph = world.sphere, lines = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * ga, d = [Math.cos(a) * r, y, Math.sin(a) * r];
    const p = d.map(v => v * (sph.R + terrainHeight(sph, d)));
    lines.push([new BABYLON.Vector3(p[0], p[1], p[2]), new BABYLON.Vector3(p[0] * 0.9, p[1] * 0.9, p[2] * 0.9)]);
  }
  const ls = BABYLON.MeshBuilder.CreateLineSystem('microDebugGravity', { lines }, scene);
  ls.color = new BABYLON.Color3(0.3, 1, 0.6); ls.isPickable = false;
  return ls;
}

/* Spawn and objective markers for the sandbox: tall coloured posts standing on the local up. */
export function buildMarkerDebug(scene, world) {
  const root = new BABYLON.TransformNode('microDebugMarkers', scene);
  const post = (p, up, h, hex) => {
    const m = BABYLON.MeshBuilder.CreateCylinder('dbgMarker', { diameter: 0.35, height: h, tessellation: 6 }, scene);
    const mat = new BABYLON.StandardMaterial('dbgMarkerMat', scene); mat.disableLighting = true; mat.emissiveColor = hexToColor3(hex);
    m.material = mat; m.isPickable = false; m.parent = root;
    m.position.set(p[0] + up[0] * h / 2, p[1] + up[1] * h / 2, p[2] + up[2] * h / 2);
    m.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), new BABYLON.Vector3(...up), new BABYLON.Quaternion());
  };
  for (const s of world.spawns) post([s.x, s.y, s.z], s.dir, 5, s.team === 'red' ? '#ff4d4d' : s.team === 'blue' ? '#4d7dff' : '#ffffff');
  for (const o of world.markers.objectives) post(o.p, o.dir, 22, '#ffd23c');
  return root;
}
