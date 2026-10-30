/* Babylon.js PBR Materials, Palettes, Sky Dome, and Graphics Presets */

import * as BABYLON from '@babylonjs/core';
import { PALETTE } from '../arena.js';

export { PALETTE };

export const GRAPHICS_PRESETS = {
  low: {
    name: 'LOW',
    dpr: 0.8,
    shadowSize: 1024,
    shadows: false,
    bloom: false,
    fxaa: false,
    pbrQuality: 'low',
  },
  medium: {
    name: 'MEDIUM',
    dpr: 1.0,
    shadowSize: 2048,
    shadows: true,
    bloom: false,
    fxaa: true,
    pbrQuality: 'medium',
  },
  high: {
    name: 'HIGH',
    dpr: 1.25,
    shadowSize: 2048,
    shadows: true,
    bloom: true,
    fxaa: true,
    pbrQuality: 'high',
  },
  ultra: {
    name: 'ULTRA',
    dpr: 1.5,
    shadowSize: 4096,
    shadows: true,
    bloom: true,
    fxaa: true,
    pbrQuality: 'ultra',
  },
};

export function hexToColor3(hex) {
  return BABYLON.Color3.FromHexString(hex.startsWith('#') ? hex : '#' + hex);
}

export function hexToColor4(hex, alpha = 1) {
  const c = BABYLON.Color3.FromHexString(hex.startsWith('#') ? hex : '#' + hex);
  return new BABYLON.Color4(c.r, c.g, c.b, alpha);
}

const materialCache = new WeakMap();

export function getPBRMaterial(scene, colorKey, isUnlit = false) {
  let cache = materialCache.get(scene);
  if (!cache) {
    cache = new Map();
    materialCache.set(scene, cache);
  }

  const key = `${colorKey}_${isUnlit ? 'unlit' : 'pbr'}`;
  if (cache.has(key)) return cache.get(key);

  const hex = PALETTE[colorKey] || colorKey;
  const col = hexToColor3(hex);

  if (isUnlit) {
    const mat = new BABYLON.StandardMaterial(`mat_${key}`, scene);
    mat.diffuseColor = col;
    mat.emissiveColor = col;
    mat.disableLighting = true;
    cache.set(key, mat);
    return mat;
  }

  const mat = new BABYLON.PBRMaterial(`mat_${key}`, scene);
  mat.albedoColor = col;

  // Material surface characteristics
  if (colorKey.includes('metal') || colorKey.includes('steel') || colorKey.includes('hazard')) {
    mat.roughness = 0.35;
    mat.metallic = 0.75;
  } else if (colorKey.includes('wood') || colorKey.includes('dirt') || colorKey.includes('bark')) {
    mat.roughness = 0.92;
    mat.metallic = 0.05;
  } else if (colorKey.includes('rock') || colorKey.includes('concrete') || colorKey.includes('slab')) {
    mat.roughness = 0.85;
    mat.metallic = 0.15;
  } else if (colorKey.includes('water')) {
    mat.roughness = 0.1;
    mat.metallic = 0.1;
    mat.alpha = 0.82;
    mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
  } else {
    mat.roughness = 0.65;
    mat.metallic = 0.2;
  }

  cache.set(key, mat);
  return mat;
}

export function createSkyDome(scene, topHex, midHex, botHex, sunPosition) {
  const top = hexToColor3(topHex);
  const mid = hexToColor3(midHex);
  const bot = hexToColor3(botHex);

  const dome = BABYLON.MeshBuilder.CreateSphere('skyDome', {
    diameter: 800,
    segments: 32,
    sideOrientation: BABYLON.Mesh.BACKSIDE,
  }, scene);

  dome.isPickable = false;
  dome.infiniteDistance = true;

  // Custom shader for atmospheric gradient and sun glow
  BABYLON.Effect.ShadersStore['skyDomeVertexShader'] = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 vPosition;
    void main(void) {
      vPosition = normalize(position);
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  BABYLON.Effect.ShadersStore['skyDomeFragmentShader'] = `
    precision highp float;
    varying vec3 vPosition;
    uniform vec3 topColor;
    uniform vec3 midColor;
    uniform vec3 botColor;
    uniform vec3 sunDir;

    void main(void) {
      vec3 d = normalize(vPosition);
      float h = d.y;
      vec3 c = h > 0.0 ? mix(midColor, topColor, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(midColor, botColor, clamp(-h * 5.0, 0.0, 1.0));
      float s = max(dot(d, normalize(sunDir)), 0.0);
      c += vec3(1.0, 0.55, 0.22) * pow(s, 10.0) * 0.5 + vec3(1.0, 0.78, 0.45) * pow(s, 60.0) * 0.6 + vec3(1.0, 0.95, 0.8) * pow(s, 900.0) * 3.0;
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  const mat = new BABYLON.ShaderMaterial('skyMat', scene, {
    vertex: 'skyDome',
    fragment: 'skyDome',
  }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'topColor', 'midColor', 'botColor', 'sunDir'],
  });

  mat.setColor3('topColor', top);
  mat.setColor3('midColor', mid);
  mat.setColor3('botColor', bot);
  mat.setVector3('sunDir', sunPosition.clone().normalize());
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;

  dome.material = mat;
  return dome;
}

export function createRidge(scene, radius, base, amp, colorHex, seed) {
  const seg = 128;
  const positions = [];
  const indices = [];

  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const h = base + amp * (0.55 * Math.sin(a * 3 + seed) + 0.3 * Math.sin(a * 7 + seed * 2.1) + 0.15 * Math.sin(a * 17 + seed * 0.7));
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    positions.push(x, -6, z);
    positions.push(x, Math.max(4, h), z);
    if (i < seg) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2);
      indices.push(k + 1, k + 3, k + 2);
    }
  }

  const customMesh = new BABYLON.Mesh(`ridge_${seed}`, scene);
  const vertexData = new BABYLON.VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.applyToMesh(customMesh);

  const mat = new BABYLON.StandardMaterial(`ridgeMat_${seed}`, scene);
  mat.diffuseColor = hexToColor3(colorHex);
  mat.emissiveColor = hexToColor3(colorHex);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  customMesh.material = mat;
  customMesh.isPickable = false;

  return customMesh;
}
