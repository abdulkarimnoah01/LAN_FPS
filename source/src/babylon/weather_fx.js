/* Weather renderer. Captures the map's own lighting/fog/sky once per world and blends the
   host-supplied weather on top: sun and sky light, fog distance and colour, an overcast layer
   over the sky dome, and rain streaks (GPU-light CPU particles that follow the camera) with a
   soft noise bed for audio. Purely cosmetic; never touches collision or hit detection. */

import * as BABYLON from '@babylonjs/core';
import { decodeWeather, blendLook } from '../weather.js';

function rainTexture(scene) {
  const t = new BABYLON.DynamicTexture('wx_rainTex', { width: 8, height: 64 }, scene, false);
  const ctx = t.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(220,235,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(2, 0, 4, 64);
  t.hasAlpha = true; t.update();
  return t;
}

export class WeatherFX {
  constructor(scene, camera, { quality = 'high', audio = null } = {}) {
    this.scene = scene; this.camera = camera; this.audio = audio;
    this.quality = quality;
    this.base = null;
    this.look = null;
    this.target = null;
    this.rain = null; this.overcast = null; this.noise = null;
  }

  /* Call after each world build: remembers the map's own look as the "sunny" baseline. */
  captureBase() {
    const s = this.scene, sun = s.getLightByName('sun'), hemi = s.getLightByName('hemi');
    this.base = {
      sun: sun?.intensity ?? 1, hemi: hemi?.intensity ?? 1,
      fogStart: s.fogStart, fogEnd: s.fogEnd, fogMode: s.fogMode,
      fogColor: s.fogColor?.clone?.() || new BABYLON.Color3(0.7, 0.75, 0.8),
      clear: s.clearColor?.clone?.() || new BABYLON.Color4(0.6, 0.7, 0.8, 1),
    };
    this.look = blendLook(null, this.base);
  }

  ensureOvercast() {
    if (this.overcast) return;
    const dome = this.overcast = BABYLON.MeshBuilder.CreateSphere('wx_overcast', { diameter: 760, segments: 16, sideOrientation: BABYLON.Mesh.BACKSIDE }, this.scene);
    const m = new BABYLON.StandardMaterial('wx_overcastMat', this.scene);
    m.disableLighting = true; m.emissiveColor = new BABYLON.Color3(0.55, 0.6, 0.66); m.alpha = 0; m.backFaceCulling = false;
    m.fogEnabled = false; m.disableDepthWrite = true;
    dome.material = m; dome.infiniteDistance = true; dome.isPickable = false; dome.applyFog = false;
    dome.alphaIndex = 0;
  }

  ensureRain() {
    if (this.rain) return;
    const cap = this.quality === 'low' ? 700 : this.quality === 'medium' ? 1400 : 2600;
    const ps = this.rain = new BABYLON.ParticleSystem('wx_rain', cap, this.scene);
    ps.particleTexture = rainTexture(this.scene);
    ps.emitter = this.rainEmitter = new BABYLON.Vector3(0, 0, 0);   // follows the camera each frame
    ps.minEmitBox = new BABYLON.Vector3(-18, 10, -18); ps.maxEmitBox = new BABYLON.Vector3(18, 14, 18);
    ps.direction1 = new BABYLON.Vector3(-0.6, -1, 0.3); ps.direction2 = new BABYLON.Vector3(-0.4, -1, 0.5);
    ps.minEmitPower = 16; ps.maxEmitPower = 22; ps.updateSpeed = 1 / 60;
    ps.minLifeTime = 0.6; ps.maxLifeTime = 0.9;
    ps.minSize = 0.1; ps.maxSize = 0.16; ps.minScaleY = 8; ps.maxScaleY = 12;
    ps.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.color1 = new BABYLON.Color4(0.9, 0.95, 1, 0.85); ps.color2 = new BABYLON.Color4(0.82, 0.9, 1, 0.7); ps.colorDead = new BABYLON.Color4(0.8, 0.85, 1, 0);
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0; ps.gravity = new BABYLON.Vector3(0, -9, 0);
    ps.start();
    this.rainCap = cap;
  }

  /* Rain bed: filtered noise through the page's existing AudioContext (if any). */
  ensureNoise() {
    if (this.noise || !this.audio?.ensure) return;
    const ctx = this.audio.ensure();
    if (!ctx) return;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let x = 0x1234567;
    for (let i = 0; i < len; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; d[i] = ((x >>> 0) / 4294967296) * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(hp).connect(lp).connect(gain).connect(ctx.destination); src.start();
    this.noise = { src, gain, ctx };
  }

  /* wx = snapshot array or null (no weather on this map/room). Smoothly eases towards it. */
  update(dt, wx) {
    if (!this.base) return;
    this.lastDt = dt;
    const target = blendLook(wx ? decodeWeather(wx) : null, this.base);
    const e = 1 - Math.exp(-dt * 1.5), L = this.look;
    for (const k of ['sun', 'hemi', 'fogEnd', 'fogStart', 'overcast', 'rain']) L[k] += (target[k] - L[k]) * e;
    for (let i = 0; i < 3; i++) L.tint[i] += (target.tint[i] - L.tint[i]) * e;
    this.apply(L);
  }

  apply(L) {
    const s = this.scene, B = this.base;
    const sun = s.getLightByName('sun'), hemi = s.getLightByName('hemi');
    if (sun) sun.intensity = B.sun * L.sun;
    if (hemi) hemi.intensity = B.hemi * L.hemi;
    const tint = new BABYLON.Color3(...L.tint), grey = new BABYLON.Color3(0.62, 0.66, 0.72);
    s.fogMode = B.fogMode || BABYLON.Scene.FOGMODE_LINEAR;
    s.fogStart = Math.min(L.fogStart, L.fogEnd * 0.5); s.fogEnd = Math.max(s.fogStart + 8, L.fogEnd);
    s.fogColor = BABYLON.Color3.Lerp(B.fogColor, grey, Math.min(1, L.overcast)).multiply(tint);
    const c = BABYLON.Color3.Lerp(new BABYLON.Color3(B.clear.r, B.clear.g, B.clear.b), grey, L.overcast).multiply(tint);
    s.clearColor = new BABYLON.Color4(c.r, c.g, c.b, 1);
    if (L.overcast > 0.01) { this.ensureOvercast(); }
    if (this.overcast) {
      this.overcast.material.alpha = Math.min(0.96, L.overcast);
      this.overcast.material.emissiveColor = grey.multiply(tint);
      this.overcast.setEnabled(L.overcast > 0.01);
    }
    if (L.rain > 0.01) this.ensureRain();
    if (this.rain) {
      // The game renders from its own frame loop, so Babylon's animation ratio is unreliable
      // here; scale the particle step so particles advance by the real frame time.
      const ratio = Math.max(0.001, this.scene.getAnimationRatio());
      this.rain.updateSpeed = Math.min(0.05, this.lastDt || 1 / 60) / ratio;
      this.rain.emitRate = L.rain > 0.02 ? this.rainCap * 1.3 * L.rain : 0;
      this.rainEmitter.copyFrom(this.camera.globalPosition || this.camera.position);
    }
    if (L.rain > 0.05) this.ensureNoise();
    if (this.noise) this.noise.gain.gain.setTargetAtTime(Math.min(0.18, L.rain * 0.16) * (this.audio?.volume ?? 0.5) * 2, this.noise.ctx.currentTime, 0.4);
  }

  setQuality(q) {
    this.quality = q;
    if (this.rain) { this.rain.dispose(); this.rain = null; }
  }

  dispose() {
    this.rain?.dispose(); this.overcast?.dispose();
    try { this.noise?.src.stop(); } catch {}
    this.rain = this.overcast = this.noise = null;
  }
}
