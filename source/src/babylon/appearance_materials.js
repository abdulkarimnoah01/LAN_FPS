/* Applies a validated AppearanceV1 to a loaded operative model.
   One code path serves the lobby preview, the operative turntable and in-match avatars.

   Ownership rules:
   - Variant atlases are cached per scene + body + outfit + skin and shared by every avatar
     that uses them. Avatars never dispose them; they die with the scene.
   - Each model owns the materials created for it here and disposes them on re-apply/dispose.
   - Geometry, skeleton and animation groups are never touched, so swaps don't restart
     animation or reload the GLB. */

import * as BABYLON from '@babylonjs/core';
import { normalizeAppearance, resolveAccent, transformAtlas, extractGlbImage, encodeLook } from '../appearance.js';
import { hexToColor3 } from './materials.js';
import { ngBody, paintNgAtlas, NG_ATLAS_SIZE } from '../ng_bodies.js';

const atlasCache = new WeakMap();      // scene -> Map(key -> Promise<Texture|null>)
const pixelCache = new Map();          // body name -> Promise<{w,h,data}|null>
const bytesCache = new WeakMap();      // charData -> Uint8Array

export function glbBytes(charData) {
  if (!charData?.glb) return null;
  let bytes = bytesCache.get(charData);
  if (!bytes) {
    const bin = atob(charData.glb);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    bytesCache.set(charData, bytes);
  }
  return bytes;
}

async function decodeBasePixels(charData) {
  const key = charData?.name || '';
  if (!pixelCache.has(key)) {
    pixelCache.set(key, (async () => {
      if (typeof createImageBitmap !== 'function') return null;   // NullEngine / node: keep base texture
      const img = extractGlbImage(glbBytes(charData));
      if (!img) return null;
      const bmp = await createImageBitmap(new Blob([img.bytes], { type: img.mimeType }));
      const w = Math.min(2048, bmp.width), h = Math.min(2048, bmp.height);
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return { w, h, data: ctx.getImageData(0, 0, w, h).data };
    })().catch(err => { console.warn('[appearance] atlas decode failed', err); return null; }));
  }
  return pixelCache.get(key);
}

/* Shared, immutable variant atlas, or null to keep the GLB's own texture. */
export function getVariantTexture(scene, charData, outfitId, skinId) {
  if (outfitId === 'stock' && skinId === 'natural') return Promise.resolve(null);
  let perScene = atlasCache.get(scene);
  if (!perScene) { perScene = new Map(); atlasCache.set(scene, perScene); }
  const key = `${charData?.name}|${outfitId}|${skinId}`;
  if (!perScene.has(key)) {
    // Next Gen bodies have an authored UV layout: repaint exactly. Legacy GLBs: masked recolour.
    const ng = ngBody(charData?.id);
    const source = ng
      ? Promise.resolve({ w: NG_ATLAS_SIZE, h: NG_ATLAS_SIZE, data: paintNgAtlas(ng.id, { outfitId, skinId }), painted: true })
      : decodeBasePixels(charData);
    perScene.set(key, source.then(px => {
      if (!px || scene.isDisposed) return null;
      const data = px.painted ? px.data : transformAtlas(px.data, outfitId, skinId);
      const tex = BABYLON.RawTexture.CreateRGBATexture(data, px.w, px.h, scene, true, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = `look_${key}`;
      tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
      return tex;
    }));
  }
  return perScene.get(key);
}

function disposeOwned(model) {
  for (const m of model.ownedMaterials || []) m.dispose(false, false);   // keep shared textures
  model.ownedMaterials = [];
}

function bodyMeshes(model) {
  return model.root.getChildMeshes(false).filter(m => m.material && !/^nameTag/.test(m.name));
}

/* Applies `app` to `model` (from makeBabylonCharacter). Returns a promise that resolves once
   the look is visible; stale calls (a newer apply started) resolve without changing anything. */
export async function applyAppearance(model, app, team = 'none', { scene = model?.root?.getScene?.(), charData = model?.charData } = {}) {
  if (!model?.root || !scene) return false;
  const look = normalizeAppearance(app, model.bodyId);
  const token = (model._lookToken = (model._lookToken || 0) + 1);
  const meshes = bodyMeshes(model);
  model.baseMaterials ||= new Map();
  for (const m of meshes) if (!model.baseMaterials.has(m.uniqueId)) model.baseMaterials.set(m.uniqueId, m.material);

  const variant = charData ? await getVariantTexture(scene, charData, look.outfitId, look.skinId) : null;
  if (token !== model._lookToken || model.disposed || scene.isDisposed) return false;

  const accent = hexToColor3(resolveAccent(look, team));
  const created = [];
  for (const mesh of meshes) {
    const base = model.baseMaterials.get(mesh.uniqueId);
    const baseTex = base?.albedoTexture || base?.diffuseTexture || null;
    const tex = variant || baseTex;
    let mat;
    if (look.shaderId === 'rim') {
      mat = new BABYLON.StandardMaterial(`lookRim_${mesh.uniqueId}`, scene);
      mat.diffuseTexture = tex;
      mat.specularColor = new BABYLON.Color3(0.06, 0.06, 0.06);
      mat.emissiveColor = BABYLON.Color3.White();
      mat.emissiveFresnelParameters = new BABYLON.FresnelParameters({ leftColor: accent.scale(1.4), rightColor: BABYLON.Color3.Black(), bias: 0.25, power: 1.6 });
      mat.backFaceCulling = base?.backFaceCulling ?? true;
    } else if (variant && base instanceof BABYLON.PBRMaterial) {
      mat = new BABYLON.PBRMaterial(`lookMatte_${mesh.uniqueId}`, scene);
      mat.albedoTexture = tex;
      mat.metallic = base.metallic ?? 0;
      mat.roughness = Math.max(0.6, base.roughness ?? 0.8);
      mat.backFaceCulling = base.backFaceCulling;
    } else if (variant) {
      mat = new BABYLON.StandardMaterial(`lookMatte_${mesh.uniqueId}`, scene);
      mat.diffuseTexture = tex;
      mat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
    } else {
      mat = null;   // stock matte: the GLB's own material, untouched
    }
    if (mat) created.push(mat);
    mesh.material = mat || base;
  }
  disposeOwned(model);
  model.ownedMaterials = created;
  model.look = look;
  model.lookCode = encodeLook(look);
  model.lookTeam = team;
  return true;
}

export function disposeAppearance(model) {
  if (!model) return;
  model.disposed = true;
  model._lookToken = (model._lookToken || 0) + 1;
  disposeOwned(model);
}
