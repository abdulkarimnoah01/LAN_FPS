/* Orbit Crown visuals. Consumes the layout from planet_map.js and never invents collision:
   the deck (boxes, barrels, water) goes through the standard procedural builder; everything
   added here — the planet, its ocean, the crown foundation, surface houses/trees, clouds,
   satellites and deck dressing — is non-pickable decoration outside or above the playable
   space. Bright, saturated, softly lit original art direction. */

import * as BABYLON from '@babylonjs/core';
import { buildProceduralWorld } from './procedural_world.js';
import { createSkyDome, hexToColor3 } from './materials.js';

const DECK_TYPES = new Set(['box', 'barrel', 'water']);

function mat(scene, name, hex, { emissive = 0, rough = 0.85, alpha = 1, unlit = false } = {}) {
  const key = `orbit_${name}`;
  const cached = scene.getMaterialByName(key);
  if (cached) return cached;
  // PBR everywhere so decoration responds to light like the deck (same tone mapping/exposure)
  const m = new BABYLON.PBRMaterial(key, scene);
  const c = hexToColor3(hex);
  m.albedoColor = c; m.metallic = 0; m.roughness = rough;
  if (emissive) m.emissiveColor = c.scale(emissive);
  if (unlit) { m.unlit = true; m.albedoColor = c; }
  if (alpha < 1) m.alpha = alpha;
  return m;
}

/* Small deterministic noise for the planet surface (value noise on a lattice). */
function makeNoise(seed) {
  const h = (x, y, z) => { let n = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t);
  const v = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
  };
  return (x, y, z) => v(x, y, z) * 0.6 + v(x * 2.1, y * 2.1, z * 2.1) * 0.3 + v(x * 4.3, y * 4.3, z * 4.3) * 0.1;
}

function buildPlanet(scene, root, planet, top) {
  const R = planet.radius, centre = new BABYLON.Vector3(0, top - R, 0);
  const noise = makeNoise(planet.seed + 17);
  const sphere = BABYLON.MeshBuilder.CreateIcoSphere('orbitPlanet', { radius: R, subdivisions: 28, flat: true, updatable: true }, scene);
  const pos = sphere.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const colors = new Float32Array((pos.length / 3) * 4);
  const pal = { deep: '#1e6fd9', sand: '#e9b96e', grass: '#4fb06a', meadow: '#8cc63f', forest: '#2e8b57', rock: '#a08a76', snow: '#eef2f7' };
  const C = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, hexToColor3(v)]));
  for (let i = 0; i < pos.length; i += 3) {
    const n = new BABYLON.Vector3(pos[i], pos[i + 1], pos[i + 2]).normalize();
    let e = noise(n.x * 2.2 + 5, n.y * 2.2 + 5, n.z * 2.2 + 5);
    const crown = Math.max(0, (n.y - 0.9) / 0.1);          // flatten under the crown
    e = e * (1 - crown) + 0.62 * crown;
    const height = (e - 0.48) * 9;                         // −4 … +5 m around sea level
    const r = R + height;
    pos[i] = n.x * r; pos[i + 1] = n.y * r; pos[i + 2] = n.z * r;
    const c = e < 0.47 ? C.deep : e < 0.5 ? C.sand : e < 0.6 ? C.grass : e < 0.68 ? C.meadow : e < 0.76 ? C.forest : e < 0.84 ? C.rock : C.snow;
    const k = i / 3 * 4; colors[k] = c.r; colors[k + 1] = c.g; colors[k + 2] = c.b; colors[k + 3] = 1;
  }
  // flat shading: give every face the colour of its first vertex
  const idx = sphere.getIndices();
  for (let f = 0; f < idx.length; f += 3) for (let j = 1; j < 3; j++) for (let c = 0; c < 4; c++) colors[idx[f + j] * 4 + c] = colors[idx[f] * 4 + c];
  sphere.updateVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  sphere.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
  const normals = [];
  BABYLON.VertexData.ComputeNormals(pos, idx, normals);
  sphere.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
  const pm = new BABYLON.PBRMaterial('orbit_planetMat', scene);
  pm.albedoColor = BABYLON.Color3.White(); pm.metallic = 0; pm.roughness = 0.92;
  sphere.material = pm;
  sphere.position.copyFrom(centre);
  sphere.parent = root;

  const ocean = BABYLON.MeshBuilder.CreateIcoSphere('orbitOcean', { radius: R - 0.15, subdivisions: 12, flat: true }, scene);
  const om = mat(scene, 'ocean', '#38bdf8', { alpha: 0.82, rough: 0.2 });
  om.roughness = 0.18;
  ocean.material = om; ocean.position.copyFrom(centre); ocean.parent = root;

  return { centre, noise, R, sphere, ocean, surfaceAt: n => {
    let e = noise(n.x * 2.2 + 5, n.y * 2.2 + 5, n.z * 2.2 + 5);
    const crown = Math.max(0, (n.y - 0.9) / 0.1); e = e * (1 - crown) + 0.62 * crown;
    return { e, r: R + (e - 0.48) * 9 };
  } };
}

/* Terraced foundation under the square deck: two stepped square frustums into the planet. */
function buildCrown(scene, root, half) {
  const tiers = [
    { top: -1, h: 3.2, dTop: half * 2 * Math.SQRT2 + 1.2, dBot: half * 2 * Math.SQRT2 + 3, color: '#c7a882' },
    { top: -4.2, h: 2, dTop: half * 2 * Math.SQRT2 + 6, dBot: half * 2 * Math.SQRT2 + 6, color: '#6fbf4a' },
    { top: -6.2, h: 9, dTop: half * 2 * Math.SQRT2 + 6, dBot: half * 2 * Math.SQRT2 - 14, color: '#9c7b5a' },
  ];
  for (const [i, t] of tiers.entries()) {
    const m = BABYLON.MeshBuilder.CreateCylinder(`orbitCrown${i}`, { height: t.h, diameterTop: t.dTop, diameterBottom: t.dBot, tessellation: 4 }, scene);
    m.rotation.y = Math.PI / 4;
    m.position.y = t.top - t.h / 2;
    m.material = mat(scene, `crown${i}`, t.color);
    m.parent = root;
    m.convertToFlatShadedMesh();
  }
}

function orientOnSphere(centre, n, r, scale, yaw) {
  const q = BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), n, new BABYLON.Quaternion());
  q.multiplyInPlace(BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), yaw));
  return BABYLON.Matrix.Compose(new BABYLON.Vector3(scale, scale, scale), q, centre.add(n.scale(r)));
}

/* Houses and trees on the curved surface around the crown (thin instances, deterministic). */
function buildSurfaceDressing(scene, root, P, seed) {
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const make = (name, mesh, hex) => { mesh.material = mat(scene, name, hex); mesh.parent = root; mesh.isPickable = false; mesh.convertToFlatShadedMesh(); return mesh; };
  const houseColors = ['#f4c95d', '#f28ab2', '#5fb8f0', '#9bd45a', '#f39c5b'];
  const houses = houseColors.map((c, i) => {
    const b = BABYLON.MeshBuilder.CreateBox(`orbitHouse${i}`, { width: 4, height: 3.2, depth: 4 }, scene);
    b.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 1.6, 0));
    return make(`house${i}`, b, c);
  });
  const roofColors = ['#d9443f', '#e8743b', '#3b6fd9'];
  const roofs = roofColors.map((c, i) => {
    const r = BABYLON.MeshBuilder.CreateCylinder(`orbitRoof${i}`, { height: 2, diameterTop: 0, diameterBottom: 6.4, tessellation: 4 }, scene);
    r.bakeTransformIntoVertices(BABYLON.Matrix.RotationY(Math.PI / 4).multiply(BABYLON.Matrix.Translation(0, 4.2, 0)));
    return make(`roof${i}`, r, c);
  });
  const trunk = BABYLON.MeshBuilder.CreateCylinder('orbitTrunk', { height: 2, diameter: 0.5, tessellation: 5 }, scene);
  trunk.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 1, 0)); make('trunk', trunk, '#92400e');
  const crowns = ['#22c55e', '#4ade80', '#16a34a'].map((c, i) => {
    const t = BABYLON.MeshBuilder.CreateIcoSphere(`orbitCrownTree${i}`, { radius: 1.8, subdivisions: 1 }, scene);
    t.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 3, 0));
    return make(`treeTop${i}`, t, c);
  });
  let houseN = 0, treeN = 0;
  for (let i = 0; i < 900 && (houseN < 140 || treeN < 320); i++) {
    // polar angle 22°–80° from the crown, any azimuth
    const th = (22 + rnd() * 58) * Math.PI / 180, ph = rnd() * Math.PI * 2;
    const n = new BABYLON.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    const surf = P.surfaceAt(n);
    if (surf.e < 0.505 || surf.e > 0.82) continue;   // dry land only, no peaks
    const yaw = rnd() * Math.PI * 2;
    if (surf.e < 0.66 && houseN < 140 && rnd() < 0.45) {
      const m = orientOnSphere(P.centre, n, surf.r - 0.2, 0.8 + rnd() * 0.5, yaw);
      houses[houseN % houses.length].thinInstanceAdd(m);
      roofs[(houseN + Math.floor(rnd() * 3)) % roofs.length].thinInstanceAdd(m);
      houseN++;
    } else if (treeN < 320) {
      const m = orientOnSphere(P.centre, n, surf.r - 0.2, 0.8 + rnd() * 0.8, yaw);
      trunk.thinInstanceAdd(m); crowns[treeN % crowns.length].thinInstanceAdd(m);
      treeN++;
    }
  }
}

function buildSky(scene, root, seed) {
  const sunDir = new BABYLON.Vector3(-0.45, -1, -0.35).normalize();
  const dome = createSkyDome(scene, '#2f7fe0', '#9fd3fb', '#f6cfa8', sunDir.scale(-1));
  dome.parent = root;
  // puffy low-poly clouds drifting around the planet
  const cloudRoot = new BABYLON.TransformNode('orbitClouds', scene); cloudRoot.parent = root;
  const cm = mat(scene, 'cloud', '#f8fbff', { emissive: 0.25 });
  let s = seed + 3;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3, d = 70 + rnd() * 120, y = 22 + rnd() * 34;
    const c = new BABYLON.TransformNode(`cloud${i}`, scene); c.parent = cloudRoot;
    c.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
    for (let k = 0; k < 4; k++) {
      const b = BABYLON.MeshBuilder.CreateIcoSphere(`cloudPuff${i}_${k}`, { radius: 4 + rnd() * 4, subdivisions: 1, flat: true }, scene);
      b.position.set((k - 1.5) * 4.5, rnd() * 2, rnd() * 3); b.scaling.y = 0.6; b.material = cm; b.parent = c; b.isPickable = false;
    }
  }
  // satellites: a ringed planet and a moon
  const sat = BABYLON.MeshBuilder.CreateIcoSphere('orbitSatellite', { radius: 30, subdivisions: 3, flat: true }, scene);
  sat.material = mat(scene, 'satellite', '#f472b6', { emissive: 0.25 }); sat.position.set(-210, 120, -230); sat.parent = root;
  const ring = BABYLON.MeshBuilder.CreateTorus('orbitSatRing', { diameter: 100, thickness: 5, tessellation: 48 }, scene);
  ring.material = mat(scene, 'satRing', '#fde68a', { emissive: 0.35 }); ring.parent = sat; ring.rotation.x = 1.2; ring.rotation.z = 0.3; ring.scaling.y = 0.15;
  const moon = BABYLON.MeshBuilder.CreateIcoSphere('orbitMoon', { radius: 12, subdivisions: 2, flat: true }, scene);
  moon.material = mat(scene, 'moon', '#e0e7ff', { emissive: 0.3 }); moon.position.set(230, 90, 170); moon.parent = root;
  for (const m of [sat, ring, moon]) m.isPickable = false;
  return { sunDir, cloudRoot, sat, moon };
}

function dressDeck(scene, root, world) {
  const deco = new BABYLON.TransformNode('orbitDeckDeco', scene); deco.parent = root;
  const add = m => { m.parent = deco; m.isPickable = false; return m; };
  for (const v of world.visuals) {
    if (v.type === 'orbitRoad') {
      const w = v.outer - v.inner, mid = (v.inner + v.outer) / 2;
      for (const [x, z, sx, sz] of [[0, mid, v.outer * 2, w], [0, -mid, v.outer * 2, w], [mid, 0, w, v.inner * 2], [-mid, 0, w, v.inner * 2]]) {
        const g = add(BABYLON.MeshBuilder.CreateGround('orbitRoadStrip', { width: sx, height: sz }, scene));
        g.position.set(x, v.y, z); g.material = mat(scene, 'road', v.color, { rough: 0.95 }); g.receiveShadows = true;
      }
      const lm = mat(scene, 'roadLine', v.line, { emissive: 0.4 });
      for (let t = -v.outer + 2; t < v.outer - 1; t += 4) {
        for (const [x, z, sx, sz] of [[t, mid, 2, 0.18], [t, -mid, 2, 0.18], [mid, t, 0.18, 2], [-mid, t, 0.18, 2]]) {
          if (Math.abs(x) < v.inner - 0.5 && Math.abs(z) < v.inner - 0.5) continue;
          const d = add(BABYLON.MeshBuilder.CreateGround('orbitDash', { width: sx, height: sz }, scene));
          d.position.set(x, v.y + 0.01, z); d.material = lm;
        }
      }
    } else if (v.type === 'orbitBase') {
      const pad = add(BABYLON.MeshBuilder.CreateDisc('orbitBasePad', { radius: 3.2, tessellation: 6 }, scene));
      pad.rotation.x = Math.PI / 2; pad.position.set(v.x, 0.03, v.z);
      pad.material = mat(scene, `basePad_${v.team}`, v.color, { emissive: 0.45 });
      const banner = add(BABYLON.MeshBuilder.CreatePlane('orbitBanner', { width: 6, height: 2 }, scene));
      banner.position.set(v.x, 3.0, v.z + (v.z < 0 ? -4.75 : 4.75)); banner.rotation.y = v.z < 0 ? 0 : Math.PI;
      banner.material = mat(scene, `banner_${v.team}`, v.color, { emissive: 0.7 }); banner.material.backFaceCulling = false;
    } else if (v.type === 'orbitBeacon') {
      const gem = add(BABYLON.MeshBuilder.CreatePolyhedron('orbitBeaconGem', { type: 1, size: 1.1 }, scene));
      gem.position.set(v.x, v.y + 0.6, v.z); gem.material = mat(scene, 'beaconGem', '#22d3ee', { unlit: true });
      const halo = add(BABYLON.MeshBuilder.CreateTorus('orbitBeaconHalo', { diameter: 3.4, thickness: 0.12, tessellation: 40 }, scene));
      halo.position.set(v.x, v.y + 0.6, v.z); halo.material = mat(scene, 'beaconHalo', '#e879f9', { unlit: true });
      deco.metadata = { ...(deco.metadata || {}), spin: [gem, halo] };
    } else if (v.type === 'orbitTowerTop') {
      const cap = add(BABYLON.MeshBuilder.CreateCylinder('orbitTowerCap', { height: 2.4, diameterTop: 0, diameterBottom: 4.6, tessellation: 4 }, scene));
      cap.rotation.y = Math.PI / 4; cap.position.set(v.x, v.y + 1.2, v.z); cap.material = mat(scene, 'towerCap', v.color);
      const band = add(BABYLON.MeshBuilder.CreateBox('orbitTowerBand', { width: 3.1, height: 0.35, depth: 3.1 }, scene));
      band.position.set(v.x, v.y - 0.6, v.z); band.material = mat(scene, 'towerBand', '#22d3ee', { emissive: 0.8 });
    } else if (v.type === 'orbitAwning') {
      const aw = add(BABYLON.MeshBuilder.CreateBox('orbitAwning', { width: v.w, height: 0.12, depth: 1.4 }, scene));
      aw.position.set(v.x, v.y + 0.2, v.z); aw.rotation.x = v.z > 0 ? -0.35 : 0.35;
      aw.material = mat(scene, `awning_${v.color}`, v.color, { emissive: 0.15 });
    } else if (v.type === 'orbitTree') {
      const t = new BABYLON.TransformNode('orbitTree', scene); t.parent = deco; t.position.set(v.x, v.y, v.z); t.scaling.setAll(v.s);
      const tr = BABYLON.MeshBuilder.CreateCylinder('orbitTreeTrunk', { height: 1.6, diameter: 0.32, tessellation: 5 }, scene);
      tr.position.y = 0.8; tr.material = mat(scene, 'deckTrunk', '#92400e'); tr.parent = t; tr.isPickable = false;
      const greens = ['#22c55e', '#84cc16', '#10b981'];
      for (let k = 0; k < 2; k++) {
        const f = BABYLON.MeshBuilder.CreateIcoSphere('orbitTreeTop', { radius: 1.15 - k * 0.3, subdivisions: 1, flat: true }, scene);
        f.position.set(k * 0.4, 2.1 + k * 0.8, k * 0.2); f.material = mat(scene, `deckTree${(v.hue + k) % 3}`, greens[(v.hue + k) % 3]); f.parent = t; f.isPickable = false;
      }
    }
  }
  return deco;
}

export function buildPlanetWorld(scene, world, shadowGenerator = null) {
  const deckWorld = { ...world, visuals: world.visuals.filter(v => DECK_TYPES.has(v.type)) };
  const { root, barrelMeshes } = buildProceduralWorld(scene, deckWorld, shadowGenerator);
  root.name = 'orbit_root';
  const planet = world.planet || { radius: 150, seed: 1, half: 36 };

  // Lighting and atmosphere: warm sun, sky-blue fill, light haze that keeps the planet visible
  const sun = scene.getLightByName('sun'), hemi = scene.getLightByName('hemi');
  const sky = buildSky(scene, root, planet.seed);
  if (sun) { sun.direction = sky.sunDir; sun.diffuse = hexToColor3('#ffe8c7'); sun.intensity = 2.6; }
  if (hemi) { hemi.direction = new BABYLON.Vector3(0, 1, 0); hemi.diffuse = hexToColor3('#bcdcff'); hemi.groundColor = hexToColor3('#d9b38c'); hemi.intensity = 0.95; }
  scene.clearColor = hexToColor3('#8cc8f5').toColor4(1);
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor = hexToColor3('#a7d4f5');
  scene.fogStart = 120; scene.fogEnd = 700;

  buildCrown(scene, root, planet.half || 36);
  const P = buildPlanet(scene, root, planet, -1.2);
  buildSurfaceDressing(scene, root, P, planet.seed);
  const deco = dressDeck(scene, root, world);

  // Gentle motion (disabled under reduced motion); removed with the world
  const spin = deco.metadata?.spin || [];
  const obs = scene.onBeforeRenderObservable.add(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (const m of spin) m.rotation.y += dt * 0.8;
    sky.cloudRoot.rotation.y += dt * 0.006;
    sky.sat.rotation.y += dt * 0.02;
  });
  root.onDisposeObservable.add(() => scene.onBeforeRenderObservable.remove(obs));

  // Static decoration never moves: freeze it so the renderer skips its matrices each frame
  const moving = /^(cloudPuff|orbitSatellite|orbitSatRing|orbitBeacon)/;
  for (const m of root.getChildMeshes()) if (!moving.test(m.name)) m.freezeWorldMatrix();
  return { root, barrelMeshes };
}
