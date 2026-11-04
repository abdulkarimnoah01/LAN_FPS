/* Spectre Orbit — Babylon.js 9 Main Game View
   High-performance WebGPU / WebGL 2 Renderer with full gameplay parity,
   PBR materials, dynamic shadows, weapon viewmodels, and cinematic effects. */

import * as BABYLON from '@babylonjs/core';
import { WEAPONS, DT, H_STAND, H_CROUCH, EYE_STAND, EYE_CROUCH } from '../sim.js';
import { createBabylonEngine } from './engine_factory.js';
import { getPBRMaterial, hexToColor3 } from './materials.js';
import { buildProceduralWorld } from './procedural_world.js';
import { loadBabylonMap, configureArenaLighting } from './map_loader.js';
import { BabylonAvatar } from './character_loader.js';
import { buildBabylonWeaponModel } from './weapon_viewmodel.js';
import { createRenderingPipeline, applyGraphicsPreset } from './postprocess.js';

export class BabylonView {
  constructor(canvas, world, assets, options = {}) {
    this.canvas = canvas;
    this.world = world;
    this.assets = assets;
    this.options = options;

    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.sun = null;
    this.hemi = null;
    this.shadowGenerator = null;
    this.pipeline = null;

    this.worldRoot = null;
    this.barrelMeshes = new Map();
    this.avatars = new Map();
    this.weaponRoot = null;
    this.currentWeaponModel = null;
    this.activeWeaponIndex = -1;

    this.fx = [];
    this.grenades = new Map();

    this.kick = 0;
    this.bob = 0;
    this.flashLife = 0;
    this.wasGrounded = true;
    this.activePreset = options.preset || 'high';

    this.ready = false;
    this.initPromise = this.init();
  }

  async init() {
    const { engine, backend } = await createBabylonEngine(this.canvas, this.options);
    this.engine = engine;
    this.backend = backend;

    const scene = this.scene = new BABYLON.Scene(engine);
    // Crucial: Use right-handed system to match glTF and our simulation
    scene.useRightHandedSystem = true;

    // Viewmodel layer: renderingGroupId 1 clears depth stencil to avoid wall clipping
    scene.setRenderingAutoClearDepthStencil(1, true, false, false);

    // Camera setup
    const cam = this.camera = new BABYLON.FreeCamera('playerCam', new BABYLON.Vector3(0, EYE_STAND, 0), scene);
    cam.fov = 75 * (Math.PI / 180);
    cam.minZ = 0.05;
    cam.maxZ = 700;

    // Lighting & Shadows
    const { sun, hemi } = configureArenaLighting(scene, this.world.theme || 'foundry', this.world.theme);
    this.sun = sun;
    this.hemi = hemi;

    const shadowSize = this.activePreset === 'ultra' ? 4096 : 2048;
    this.shadowGenerator = new BABYLON.ShadowGenerator(shadowSize, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 16;
    this.shadowGenerator.bias = 0.0004;

    // Post-processing
    this.pipeline = createRenderingPipeline(scene, cam, this.activePreset);

    // First-person viewmodel root
    const wepRoot = this.weaponRoot = new BABYLON.TransformNode('viewmodel_root', scene);
    wepRoot.parent = cam;
    wepRoot.position.set(0.2, -0.2, -0.38);

    // Muzzle flash mesh
    const flashMat = new BABYLON.StandardMaterial('flashMat', scene);
    flashMat.emissiveColor = hexToColor3('#ffe48a');
    flashMat.diffuseColor = hexToColor3('#ffe48a');
    flashMat.disableLighting = true;
    const flash = this.flashMesh = BABYLON.MeshBuilder.CreatePolyhedron('flash', { type: 1, size: 0.07 }, scene);
    flash.material = flashMat;
    flash.parent = wepRoot;
    flash.renderingGroupId = 1;
    flash.isVisible = false;
    flash.isPickable = false;

    // Build map visuals
    await this.buildVisuals(this.world);

    // Default weapon
    this.setWeaponModel(0);

    // Resize listener
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);

    this.ready = true;
  }

  async buildVisuals(world) {
    if (this.worldRoot) {
      this.worldRoot.dispose();
      this.worldRoot = null;
    }
    this.barrelMeshes.clear();

    const scene = this.scene;
    const mapId = world.id || world.theme || 'foundry';

    configureArenaLighting(scene, mapId, world.theme);

    if (world.gltf || this.assets?.maps?.[mapId]) {
      const { root } = await loadBabylonMap(scene, mapId, this.assets, this.shadowGenerator);
      this.worldRoot = root;
    } else {
      const { root, barrelMeshes } = buildProceduralWorld(scene, world, this.shadowGenerator);
      this.worldRoot = root;
      this.barrelMeshes = barrelMeshes;
    }
  }

  async setWorld(world) {
    this.world = world;
    await this.buildVisuals(world);
  }

  setWeaponModel(wIndex) {
    if (!this.scene) return;
    if (this.activeWeaponIndex === wIndex && this.currentWeaponModel) return;
    this.activeWeaponIndex = wIndex;

    if (this.currentWeaponModel) {
      this.currentWeaponModel.dispose();
      this.currentWeaponModel = null;
    }

    const wep = WEAPONS[wIndex] || WEAPONS[0];
    const model = buildBabylonWeaponModel(this.scene, wep.id);
    model.parent = this.weaponRoot;
    this.currentWeaponModel = model;

    if (this.flashMesh && model.muzzleOffset) {
      this.flashMesh.position.copyFrom(model.muzzleOffset);
    }
  }

  muzzlePosition() {
    if (!this.flashMesh) return new BABYLON.Vector3(0, 1.6, 0);
    this.flashMesh.computeWorldMatrix(true);
    return this.flashMesh.getAbsolutePosition();
  }

  shot(from, to, own, wepId = 'ak47') {
    if (!this.scene) return;
    const start = own ? this.muzzlePosition() : new BABYLON.Vector3(from[0], from[1] - 0.35, from[2]);
    const end = new BABYLON.Vector3(...to);

    const tracerColor = wepId === 'sniper' ? '#d0f8ff' : (wepId === 'shotgun' ? '#ffd066' : (wepId === 'smg' ? '#fffa80' : '#fff2b0'));

    // Bullet Tracer
    const line = BABYLON.MeshBuilder.CreateLines('tracer', {
      points: [start, end],
      updatable: false,
    }, this.scene);
    line.color = hexToColor3(tracerColor);
    line.isPickable = false;

    // Impact Spark
    const sparkSize = wepId === 'sniper' ? 0.16 : (wepId === 'shotgun' ? 0.05 : 0.08);
    const spark = BABYLON.MeshBuilder.CreatePolyhedron('spark', { type: 1, size: sparkSize }, this.scene);
    spark.position.copyFrom(end);
    const sparkMat = new BABYLON.StandardMaterial('sparkMat', this.scene);
    sparkMat.emissiveColor = hexToColor3(tracerColor);
    sparkMat.disableLighting = true;
    spark.material = sparkMat;
    spark.isPickable = false;

    this.fx.push({
      meshes: [line, spark],
      life: 0.12,
      max: 0.12,
      update(dt) {
        this.life -= dt;
        return this.life <= 0;
      },
    });

    if (own) {
      if (this.flashMesh) this.flashMesh.isVisible = true;
      this.flashLife = 0.05;
      const kickMap = { ak47: 1.0, shotgun: 1.6, sniper: 1.9, smg: 0.55, lmg: 1.3 };
      this.kick = kickMap[wepId] || 1.0;
    }
  }

  meleeSlash(isQuick = false) {
    if (!this.scene) return;
    const cam = this.camera;
    const forward = cam.getForwardRay(2.0).direction;
    const start = this.muzzlePosition();
    const end = start.add(forward.scale(2.0));

    const slash = BABYLON.MeshBuilder.CreateLines('meleeSlash', {
      points: [start, end],
      updatable: false,
    }, this.scene);
    slash.color = hexToColor3('#f8fafc');
    slash.isPickable = false;

    this.fx.push({
      meshes: [slash],
      life: 0.08,
      update(dt) {
        this.life -= dt;
        return this.life <= 0;
      },
    });
    this.kick = 0.8;
  }

  spawnGrenade(id, x, y, z, vx, vy, vz) {
    if (!this.scene) return;
    const gRoot = new BABYLON.TransformNode(`grenade_${id}`, this.scene);
    gRoot.position.set(x, y, z);

    const bodyMat = new BABYLON.PBRMaterial('grenadeMat', this.scene);
    bodyMat.albedoColor = hexToColor3('#4d5c3b');
    bodyMat.roughness = 0.6;
    bodyMat.metallic = 0.5;

    const body = BABYLON.MeshBuilder.CreateCylinder('grenadeBody', { height: 0.22, diameter: 0.2, tessellation: 8 }, this.scene);
    body.material = bodyMat;
    body.parent = gRoot;

    this.grenades.set(id, {
      root: gRoot,
      x, y, z, vx, vy, vz,
      life: 3.5,
    });
  }

  explode(x, y, z, r = 6, kind = 'grenade') {
    if (!this.scene) return;

    // Clean up close grenade meshes
    for (const [id, g] of this.grenades) {
      if (Math.hypot(g.x - x, g.y - y, g.z - z) < 2.0) {
        g.root.dispose();
        this.grenades.delete(id);
      }
    }

    // Fireball
    const fb = BABYLON.MeshBuilder.CreateSphere('fireball', { diameter: 2, segments: 12 }, this.scene);
    fb.position.set(x, y, z);
    const fbMat = new BABYLON.StandardMaterial('fbMat', this.scene);
    fbMat.emissiveColor = hexToColor3(kind === 'barrel' ? '#ff5722' : '#ff9800');
    fbMat.disableLighting = true;
    fbMat.alpha = 0.95;
    fb.material = fbMat;
    fb.isPickable = false;

    // Shockwave Ring
    const ring = BABYLON.MeshBuilder.CreateTorus('ring', { diameter: 1.5, thickness: 0.12, tessellation: 24 }, this.scene);
    ring.position.set(x, y + 0.1, z);
    const ringMat = new BABYLON.StandardMaterial('ringMat', this.scene);
    ringMat.emissiveColor = hexToColor3('#ffdd77');
    ringMat.disableLighting = true;
    ringMat.alpha = 0.85;
    ring.material = ringMat;
    ring.isPickable = false;

    // Sparks
    const sparkMeshes = [];
    const count = kind === 'barrel' ? 16 : 12;
    for (let i = 0; i < count; i++) {
      const sp = BABYLON.MeshBuilder.CreatePolyhedron('expSpark', { type: 1, size: 0.15 }, this.scene);
      sp.position.set(x, y, z);
      const spMat = new BABYLON.StandardMaterial('expSparkMat', this.scene);
      spMat.emissiveColor = hexToColor3(Math.random() > 0.4 ? '#ff6f00' : '#ffa000');
      spMat.disableLighting = true;
      sp.material = spMat;
      sp.isPickable = false;

      sparkMeshes.push({
        mesh: sp,
        vx: (Math.random() - 0.5) * 16,
        vy: Math.random() * 12 + 2,
        vz: (Math.random() - 0.5) * 16,
      });
    }

    this.fx.push({
      fb, ring, sparkMeshes,
      r: r || 6,
      life: 0.55,
      max: 0.55,
      update(dt) {
        this.life -= dt;
        const progress = 1 - this.life / this.max;
        const scale = 1 + progress * (this.r * 0.8);
        this.fb.scaling.set(scale, scale, scale);
        this.ring.scaling.set(scale * 1.3, 1, scale * 1.3);

        this.fb.material.alpha = Math.max(0, 1 - progress);
        this.ring.material.alpha = Math.max(0, 1 - progress);

        for (const s of this.sparkMeshes) {
          s.mesh.position.x += s.vx * dt;
          s.mesh.position.y += s.vy * dt;
          s.mesh.position.z += s.vz * dt;
          s.vy -= 20 * dt;
        }

        if (this.life <= 0) {
          this.fb.dispose();
          this.ring.dispose();
          for (const s of this.sparkMeshes) s.mesh.dispose();
          return true;
        }
        return false;
      },
    });
  }

  destroyBarrel(id, x, y, z) {
    if (!this.scene) return;
    const bar = this.barrelMeshes.get(id);
    if (bar) bar.isVisible = false;

    // Chunks
    for (let i = 0; i < 8; i++) {
      const chunk = BABYLON.MeshBuilder.CreateBox('chunk', { width: 0.18, height: 0.22, depth: 0.08 }, this.scene);
      chunk.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4);
      chunk.material = getPBRMaterial(this.scene, 'barrelRust');
      chunk.isPickable = false;

      const vx = (Math.random() - 0.5) * 9, vy = Math.random() * 6 + 3, vz = (Math.random() - 0.5) * 9;
      this.fx.push({
        meshes: [chunk],
        life: 0.85,
        update(dt) {
          this.life -= dt;
          chunk.position.x += vx * dt;
          chunk.position.y += vy * dt;
          chunk.position.z += vz * dt;
          chunk.rotation.x += dt * 8;
          chunk.rotation.y += dt * 8;
          if (this.life <= 0) {
            chunk.dispose();
            return true;
          }
          return false;
        },
      });
    }
  }

  render(dt, me, others, look, isAiming = false, audio = null, currentW = 0) {
    if (!this.ready || !this.scene) return;

    const cam = this.camera;
    const eyeH = me.cr ? EYE_CROUCH : EYE_STAND;
    cam.position.set(me.x, me.y + eyeH, me.z);

    // Rotation: yaw around Y, pitch around X
    cam.rotation.y = look.yaw;
    cam.rotation.x = look.pitch;
    cam.rotation.z = 0;

    // Active weapon model sync
    const curW = typeof currentW === 'number' ? currentW : (me.w || 0);
    this.setWeaponModel(curW);
    const wep = WEAPONS[curW] || WEAPONS[0];

    // FOV handling (ADS Zoom)
    const targetFov = isAiming ? (wep.fov || 50) : 75;
    const targetRad = targetFov * (Math.PI / 180);
    cam.fov = BABYLON.Scalar.Lerp(cam.fov, targetRad, Math.min(1, dt * 18));

    // Weapon sway, bob, and recoil
    const speed = Math.hypot(me.vx || 0, me.vz || 0);
    if (me.g && speed > 0.5) {
      this.bob += dt * (speed > 4.5 ? 14 : 9);
    } else {
      this.bob = 0;
    }

    const bobX = Math.cos(this.bob) * 0.008 * (isAiming ? 0.2 : 1.0);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.008 * (isAiming ? 0.2 : 1.0);

    // Recoil spring recovery
    this.kick = Math.max(0, this.kick - dt * 6.5);
    const kickZ = this.kick * 0.055;
    const kickPitch = this.kick * 0.08;

    // Viewmodel position
    if (isAiming) {
      // Centered ADS
      this.weaponRoot.position.set(
        BABYLON.Scalar.Lerp(this.weaponRoot.position.x, 0, dt * 20),
        BABYLON.Scalar.Lerp(this.weaponRoot.position.y, -0.13 + bobY, dt * 20),
        BABYLON.Scalar.Lerp(this.weaponRoot.position.z, -0.28 + kickZ, dt * 20)
      );
    } else {
      // Hipfire offset
      this.weaponRoot.position.set(
        BABYLON.Scalar.Lerp(this.weaponRoot.position.x, 0.2 + bobX, dt * 16),
        BABYLON.Scalar.Lerp(this.weaponRoot.position.y, -0.2 + bobY, dt * 16),
        BABYLON.Scalar.Lerp(this.weaponRoot.position.z, -0.38 + kickZ, dt * 16)
      );
    }
    this.weaponRoot.rotation.x = -kickPitch;

    // Muzzle flash visibility timer
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0 && this.flashMesh) {
        this.flashMesh.isVisible = false;
      }
    }

    // Remote avatars sync
    const seenPids = new Set();
    for (const p of others) {
      seenPids.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) {
        av = new BabylonAvatar(this.scene, this.assets, p.id, p.name, p.slot || 0, p.char || 'abdulkarim', p.team || 'none', p.lk || '');
        this.avatars.set(p.id, av);
      }
      av.update(p, dt);
    }

    // Remove avatars that left
    for (const [id, av] of this.avatars) {
      if (!seenPids.has(id)) {
        av.dispose();
        this.avatars.delete(id);
      }
    }

    // Update active visual effects
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const effect = this.fx[i];
      if (effect.update(dt)) {
        if (effect.meshes) {
          for (const m of effect.meshes) m.dispose();
        }
        this.fx.splice(i, 1);
      }
    }

    // Render frame
    this.scene.render();
  }

  applyGraphicsSettings(presetKey) {
    this.activePreset = presetKey;
    applyGraphicsPreset(this.engine, this.scene, this.pipeline, this.shadowGenerator, presetKey);
  }

  resize() {
    if (this.engine) this.engine.resize();
  }

  dispose() {
    window.removeEventListener('resize', this._resizeHandler);
    for (const [, av] of this.avatars) av.dispose();
    this.avatars.clear();
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
    this.ready = false;
  }
}
