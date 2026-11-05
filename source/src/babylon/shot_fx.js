/* Shot effects: starburst muzzle flashes (own viewmodel + remote shooters) and glowing bullets
   that travel from the muzzle to the impact point while lighting their surroundings.

   Budget: a fixed pool of point lights is reused for bullets (4 on High/Ultra, 2 on Medium,
   0 on Low); bullets beyond the pool glow without casting light. Lights stay in the scene at
   intensity 0 when idle, and materials get enough light slots up front, so firing never
   triggers shader recompiles. Gameplay is unaffected: hits are resolved instantly by the host;
   the bullet is the visual travel of that hit. */

import * as BABYLON from '@babylonjs/core';
import { hexToColor3 } from './materials.js';

export const BULLET_LIGHTS = { low: 0, medium: 2, high: 4, ultra: 4 };
const SPEED = { sniper: 420, ak47: 240, lmg: 230, smg: 200, shotgun: 170 };
const COLOR = { sniper: '#9be8ff', shotgun: '#ffcc66', smg: '#f5a6ff', lmg: '#ffd27a', ak47: '#ffe08a' };
const FLASH_SCALE = { shotgun: 1.9, sniper: 1.7, lmg: 1.5, ak47: 1.35, smg: 1.0 };

function flashTexture(scene) {
  const tex = new BABYLON.DynamicTexture('fx_flashTex', { width: 128, height: 128 }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.18, 'rgba(255,230,150,0.95)');
  g.addColorStop(0.45, 'rgba(255,150,40,0.45)'); g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {   // eight-point star with uneven spikes
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 18 : (i % 4 ? 46 : 62);
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

function glowTexture(scene) {
  const tex = new BABYLON.DynamicTexture('fx_glowTex', { width: 64, height: 64 }, scene, true);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  tex.hasAlpha = true; tex.update();
  return tex;
}

function additive(scene, name, tex, hex = '#ffffff') {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseTexture = tex; m.opacityTexture = tex; m.emissiveColor = hexToColor3(hex);
  m.disableLighting = true; m.backFaceCulling = false; m.alphaMode = BABYLON.Engine.ALPHA_ADD;
  m.disableDepthWrite = true;
  return m;
}

export class ShotFX {
  constructor(scene, preset = 'high') {
    this.scene = scene;
    this.bullets = [];
    this.flashes = [];
    this.mats = new Map();
    try { this.flashTex = flashTexture(scene); this.glowTex = glowTexture(scene); } catch { this.flashTex = this.glowTex = null; }
    this.flashMat = this.flashTex ? additive(scene, 'fx_flashMat', this.flashTex) : null;
    this.lights = [];
    this.setPreset(preset);
    // Every lit material reserves slots for sun, hemi, muzzle light and the bullet pool.
    const want = 3 + BULLET_LIGHTS.ultra + 1;
    const raise = m => { if ('maxSimultaneousLights' in m && m.maxSimultaneousLights < want) m.maxSimultaneousLights = want; };
    for (const m of scene.materials) raise(m);
    this.matObs = scene.onNewMaterialAddedObservable.add(raise);
    this.prewarm();
  }

  /* Compile the flash/bullet shaders up front so the first shot doesn't hitch. */
  prewarm() {
    const probe = BABYLON.MeshBuilder.CreatePlane('fx_prewarm', { size: 0.01 }, this.scene);
    probe.isPickable = false; probe.isVisible = false;
    const jobs = [this.flashMat, ...Object.values(COLOR).map(h => this.glowMat(h))].filter(Boolean)
      .map(m => m.forceCompilationAsync(probe).catch(() => {}));
    Promise.all(jobs).finally(() => probe.dispose());
  }

  setPreset(preset) {
    const n = BULLET_LIGHTS[preset] ?? 2;
    while (this.lights.length < n) {
      const l = new BABYLON.PointLight(`fx_bulletLight${this.lights.length}`, BABYLON.Vector3.Zero(), this.scene);
      l.intensity = 0; l.range = 6; l.specular = BABYLON.Color3.Black();
      this.lights.push({ light: l, busy: false });
    }
    for (let i = 0; i < this.lights.length; i++) this.lights[i].light.setEnabled(i < n);
    this.lightBudget = n;
  }

  glowMat(hex) {
    let m = this.mats.get(hex);
    if (!m) { m = this.glowTex ? additive(this.scene, `fx_glow_${hex}`, this.glowTex, hex) : new BABYLON.StandardMaterial(`fx_glow_${hex}`, this.scene); m.emissiveColor = hexToColor3(hex); m.disableLighting = true; this.mats.set(hex, m); }
    return m;
  }

  /* Starburst at `pos`, facing along `dir`. parent = own viewmodel muzzle (moves with the gun). */
  muzzleFlash(pos, dir, wepId, parent = null) {
    if (!this.flashMat) return;
    const s = (FLASH_SCALE[wepId] || 1.3) * (parent ? 0.16 : 0.5);
    const root = new BABYLON.TransformNode('fx_flash', this.scene);
    if (parent) { root.parent = parent; root.position.setAll(0); } else root.position.copyFrom(pos);
    const planes = [];
    const front = BABYLON.MeshBuilder.CreatePlane('fx_flashFront', { size: s }, this.scene);
    front.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; front.rotation.z = Math.random() * Math.PI * 2;
    planes.push(front);
    // two crossed planes stretched along the barrel
    for (let k = 0; k < 2; k++) {
      const p = BABYLON.MeshBuilder.CreatePlane('fx_flashSide', { width: s * 0.7, height: s * 1.9 }, this.scene);
      p.rotation.x = Math.PI / 2; p.rotation.y = k * Math.PI / 2;
      p.position.z = parent ? -s * 0.8 : 0;
      planes.push(p);
    }
    for (const p of planes) { p.material = this.flashMat; p.parent = root; p.isPickable = false; if (parent) p.renderingGroupId = 1; }
    if (!parent && dir) root.lookAt(pos.add(dir));
    this.flashes.push({ root, planes, life: 0.055, max: 0.055 });
  }

  /* A glowing bullet from start to end; `lit` lets it borrow a pool light. */
  bullet(start, end, wepId, { lit = true, onArrive = null } = {}) {
    const dir = end.subtract(start), dist = dir.length();
    if (dist < 0.5) { onArrive?.(end); return; }
    const n = dir.scale(1 / dist), hex = COLOR[wepId] || '#ffe08a', speed = SPEED[wepId] || 220;
    const bolt = BABYLON.MeshBuilder.CreateCylinder('fx_bolt', { height: 1, diameter: wepId === 'sniper' ? 0.06 : 0.035, tessellation: 4 }, this.scene);
    const axis = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), n), ang = Math.acos(Math.max(-1, Math.min(1, n.y)));
    bolt.rotationQuaternion = axis.lengthSquared() > 1e-8 ? BABYLON.Quaternion.RotationAxis(axis.normalize(), ang) : BABYLON.Quaternion.Identity();
    bolt.material = this.glowMat(hex); bolt.isPickable = false;
    const halo = BABYLON.MeshBuilder.CreatePlane('fx_boltHalo', { size: wepId === 'sniper' ? 0.6 : 0.35 }, this.scene);
    halo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; halo.material = this.glowMat(hex); halo.isPickable = false;
    let slot = null;
    if (lit) {
      for (let i = 0; i < this.lightBudget; i++) if (!this.lights[i].busy) { slot = this.lights[i]; break; }
      if (slot) { slot.busy = true; slot.light.diffuse = hexToColor3(hex); slot.light.intensity = wepId === 'sniper' ? 2.6 : 1.6; }
    }
    this.bullets.push({ start, n, dist, speed, travelled: 0, bolt, halo, slot, onArrive, trail: Math.min(3.2, speed / 70) });
  }

  update(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.travelled = Math.min(b.dist, b.travelled + b.speed * dt);
      const len = Math.min(b.trail, b.travelled);
      const head = b.start.add(b.n.scale(b.travelled));
      b.bolt.scaling.y = Math.max(0.05, len);
      b.bolt.position.copyFrom(head.subtract(b.n.scale(len / 2)));
      b.halo.position.copyFrom(head);
      if (b.slot) b.slot.light.position.copyFrom(head);
      if (b.travelled >= b.dist) {
        b.onArrive?.(head);
        b.bolt.dispose(); b.halo.dispose();
        if (b.slot) { b.slot.light.intensity = 0; b.slot.busy = false; }
        this.bullets.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      for (const p of f.planes) p.visibility = k;
      if (f.life <= 0) { f.root.dispose(); this.flashes.splice(i, 1); }
    }
  }

  dispose() {
    this.scene.onNewMaterialAddedObservable.remove(this.matObs);
    for (const b of this.bullets) { b.bolt.dispose(); b.halo.dispose(); }
    for (const f of this.flashes) f.root.dispose();
    for (const s of this.lights) s.light.dispose();
    this.bullets = []; this.flashes = []; this.lights = [];
  }
}
