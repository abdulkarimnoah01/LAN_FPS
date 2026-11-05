/* Spectre Orbit — Babylon.js 9 Main Game View
   High-performance WebGPU / WebGL 2 Renderer with full gameplay parity,
   PBR materials, dynamic shadows, weapon viewmodels, and cinematic effects. */

import * as BABYLON from '@babylonjs/core';
import { WEAPONS, DT, H_STAND, H_CROUCH, EYE_STAND, EYE_CROUCH, GRENADE, stepGrenadeBody } from '../sim.js';
import { createBabylonEngine } from './engine_factory.js';
import { getPBRMaterial, hexToColor3 } from './materials.js';
import { buildProceduralWorld } from './procedural_world.js';
import { buildPlanetWorld } from './planet_world.js';
import { ShotFX } from './shot_fx.js';
import { loadBabylonMap, configureArenaLighting } from './map_loader.js';
import { BabylonAvatar } from './character_loader.js';
import { buildBabylonWeaponModel, preloadWeaponModels } from './weapon_viewmodel.js';
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
    // Reused muzzle light: always present (intensity 0 between shots) so firing never recompiles shaders
    const ml = this.muzzleLight = new BABYLON.PointLight('muzzleLight', BABYLON.Vector3.Zero(), scene);
    ml.parent = flash; ml.diffuse = hexToColor3('#ffd27a'); ml.specular = BABYLON.Color3.Black(); ml.range = 7; ml.intensity = 0;
    this.shotFx = new ShotFX(scene, this.activePreset);

    // Build map visuals
    await this.buildVisuals(this.world);

    // Default weapon (authored GLBs when bundled, procedural otherwise)
    await preloadWeaponModels(scene, this.assets);
    this.setWeaponModel(0);
    this.warmupFx();

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

    if (world.theme === 'orbit') {
      const { root, barrelMeshes } = buildPlanetWorld(scene, world, this.shadowGenerator);
      this.worldRoot = root;
      this.barrelMeshes = barrelMeshes;
    } else if (world.gltf || this.assets?.maps?.[mapId]) {
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

  shot(from, to, own, wepId = 'ak47', shooterId = null) {
    if (!this.scene) return;
    const end = new BABYLON.Vector3(...to);
    let start;
    if (own) start = this.muzzlePosition();
    else start = this.remoteMuzzle(shooterId) || new BABYLON.Vector3(from[0], from[1] - 0.35, from[2]);
    const tracerColor = wepId === 'sniper' ? '#9be8ff' : (wepId === 'shotgun' ? '#ffd066' : (wepId === 'smg' ? '#f5a6ff' : '#fff2b0'));
    const mat = this.fxMaterial(tracerColor);
    const sparkSize = wepId === 'sniper' ? 0.16 : (wepId === 'shotgun' ? 0.06 : 0.09);

    // Glowing bullet travels to the impact (shotgun pellets glow but do not take lights)
    const job = { mat, sparkSize };
    if (this.shotFx) this.shotFx.bullet(start, end, wepId, { lit: wepId !== 'shotgun' || Math.random() < 0.2, onArrive: head => this.impact(head, job) });
    else this.impact(end, job);

    // Muzzle flash: own one rides the viewmodel, remote ones sit at the shooter's weapon
    const dir = end.subtract(start).normalize();
    if (own) {
      if (this.flashMesh) this.shotFx?.muzzleFlash(null, null, wepId, this.flashMesh);
      this.flashLife = 0.05;
      if (this.muzzleLight) this.muzzleLight.intensity = wepId === 'shotgun' || wepId === 'sniper' ? 3 : 1.8;
      const kickMap = { ak47: 1.0, shotgun: 1.6, sniper: 1.9, smg: 0.55, lmg: 1.3 };
      this.kick = kickMap[wepId] || 1.0;
    } else if (!this.lastRemoteFlash || this.lastRemoteFlash !== `${shooterId}:${this.frameNo}`) {
      this.lastRemoteFlash = `${shooterId}:${this.frameNo}`;   // one flash per shooter per frame (pellets)
      this.shotFx?.muzzleFlash(start, dir, wepId);
    }
  }

  /* Muzzle of the weapon a remote avatar is holding, in world space. */
  remoteMuzzle(id) {
    const gun = id && this.avatars.get(id)?.heldWeapon;
    if (!gun || !gun.isEnabled()) return null;
    gun.computeWorldMatrix(true);
    const m = gun.metadata?.muzzle || (gun.metadata = { muzzle: gun.getDescendants(false).find(n => /^muzzle/.test(n.name)) }).muzzle;
    if (!m) return null;
    m.computeWorldMatrix(true);
    return m.getAbsolutePosition().clone();
  }

  /* Renders one microscopic shot in front of the camera while the map loads, so the shader
     variants used by flashes, bullets, impacts and the lit muzzle compile during loading
     instead of hitching the first real shot. */
  warmupFx() {
    if (!this.scene || !this.camera || !this.shotFx) return;
    const c = this.camera, f = c.getForwardRay(1).direction;
    const at = c.position.add(f.scale(3)), to = at.add(f.scale(0.6));
    const before = new Set(this.scene.meshes);
    this.shotFx.bullet(at, to, 'ak47', { lit: true, onArrive: h => this.impact(h, { mat: this.fxMaterial('#fff2b0'), sparkSize: 0.001 }) });
    this.shotFx.muzzleFlash(at, f, 'ak47');
    if (this.flashMesh) this.shotFx.muzzleFlash(null, null, 'ak47', this.flashMesh);
    if (this.muzzleLight) this.muzzleLight.intensity = 0.01;
    for (const m of this.scene.meshes) if (!before.has(m)) m.scaling.scaleInPlace(0.001);
  }

  /* Impact pop when a bullet arrives. */
  impact(head, job) {
    const spark = BABYLON.MeshBuilder.CreatePolyhedron('spark', { type: 1, size: job.sparkSize }, this.scene);
    spark.position.copyFrom(head);
    spark.material = job.mat; spark.isPickable = false;
    this.fx.push({ meshes: [spark], life: 0.14, max: 0.14, update(dt) { this.life -= dt; const k = Math.max(0, this.life / this.max); spark.visibility = k; spark.scaling.setAll(1 + (1 - k) * 1.8); return this.life <= 0; } });
  }

  /* Cached unlit materials for transient effects (never created per shot). */
  fxMaterial(hex) {
    this.fxMats ||= new Map();
    let m = this.fxMats.get(hex);
    if (!m) {
      m = new BABYLON.StandardMaterial(`fx_${hex}`, this.scene);
      m.emissiveColor = hexToColor3(hex); m.diffuseColor = BABYLON.Color3.Black(); m.disableLighting = true;
      this.fxMats.set(hex, m);
    }
    return m;
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
    if (!this.grenadeMats) {
      const body = new BABYLON.PBRMaterial('grenadeMat', this.scene);
      body.albedoColor = hexToColor3('#3f5232'); body.roughness = 0.55; body.metallic = 0.35;
      const band = new BABYLON.StandardMaterial('grenadeBandMat', this.scene);
      band.emissiveColor = hexToColor3('#ffb020'); band.disableLighting = true;
      this.grenadeMats = { body, band };
    }
    const gRoot = new BABYLON.TransformNode(`grenade_${id}`, this.scene);
    gRoot.position.set(x, y, z);
    const body = BABYLON.MeshBuilder.CreateSphere('grenadeBody', { diameter: 0.2, segments: 6 }, this.scene);
    body.scaling.y = 1.2; body.material = this.grenadeMats.body; body.parent = gRoot; body.isPickable = false;
    const band = BABYLON.MeshBuilder.CreateTorus('grenadeBand', { diameter: 0.2, thickness: 0.035, tessellation: 12 }, this.scene);
    band.material = this.grenadeMats.band; band.parent = gRoot; band.isPickable = false;
    // Same body state the host simulates; advanced in fixed steps by updateGrenades().
    this.grenades.set(id, { root: gRoot, x, y, z, vx, vy, vz, life: GRENADE.fuse + 0.6, acc: 0 });
  }

  /* Visual grenade flight: replays the host's physics (stepGrenadeBody) against this world's
     boxes at the simulation rate, so what players see is where the grenade really is. */
  updateGrenades(dt) {
    const boxes = this.world?.boxes || [];
    for (const [id, g] of this.grenades) {
      g.acc += dt;
      while (g.acc >= DT) { stepGrenadeBody(g, boxes, DT); g.acc -= DT; }
      g.life -= dt;
      g.root.position.set(g.x, g.y, g.z);
      const spin = Math.hypot(g.vx, g.vz) * dt * 2.2;
      g.root.rotation.x += spin; g.root.rotation.z += spin * 0.6;
      if (g.life <= 0) { g.root.dispose(); this.grenades.delete(id); }
    }
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
      sp.material = this.fxMaterial(Math.random() > 0.4 ? '#ff6f00' : '#ffa000');
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
          this.fb.dispose(false, true);     // fireball/ring own their fading materials
          this.ring.dispose(false, true);
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

    if (this.muzzleLight && this.muzzleLight.intensity > 0) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
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

    this.updateObjectiveVisual(dt);
    this.updateGrenades(dt);
    this.frameNo = (this.frameNo || 0) + 1;
    this.shotFx?.update(dt);

    // Update active visual effects
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const effect = this.fx[i];
      if (effect.update(dt)) {
        if (effect.meshes) {
          // dispose per-effect materials too; cached fx_* materials are shared and kept
          for (const m of effect.meshes) m.dispose(false, !!m.material && !m.material.name.startsWith('fx_'));
        }
        this.fx.splice(i, 1);
      }
    }

    // Render frame
    this.scene.render();
  }

  /* Control zone: a ground ring + soft column tinted by owner (amber when contested).
     Purely visual and non-pickable; gameplay uses the host's objective state. */
  updateObjectiveVisual(dt) {
    const o = this.objective;
    this.updateFlagVisuals(o);
    if (!o || o.k !== 'control') { if (this.zoneRoot) this.zoneRoot.setEnabled(false); return; }
    if (!this.zoneRoot) {
      const root = this.zoneRoot = new BABYLON.TransformNode('controlZone', this.scene);
      const ring = BABYLON.MeshBuilder.CreateTorus('zoneRing', { diameter: o.r * 2, thickness: 0.12, tessellation: 64 }, this.scene);
      const col = BABYLON.MeshBuilder.CreateCylinder('zoneColumn', { diameter: o.r * 2, height: 3, tessellation: 48, cap: BABYLON.Mesh.NO_CAP }, this.scene);
      col.position.y = 1.5;
      const ringMat = this.zoneRingMat = new BABYLON.StandardMaterial('zoneRingMat', this.scene);
      ringMat.disableLighting = true;
      const colMat = this.zoneColMat = new BABYLON.StandardMaterial('zoneColMat', this.scene);
      colMat.disableLighting = true; colMat.alpha = 0.12; colMat.backFaceCulling = false;
      ring.material = ringMat; col.material = colMat;
      for (const m of [ring, col]) { m.parent = root; m.isPickable = false; }
      this.zonePulse = 0;
    }
    this.zoneRoot.setEnabled(true);
    this.zoneRoot.position.set(o.x, o.y + 0.05, o.z);
    const still = typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');
    this.zonePulse += dt;
    const hex = o.con ? '#fbbf24' : o.own === 'red' ? '#ef4444' : o.own === 'blue' ? '#3b82f6' : (o.ct === 'red' ? '#fca5a5' : o.ct === 'blue' ? '#93c5fd' : '#e2e8f0');
    const c = BABYLON.Color3.FromHexString(hex);
    this.zoneRingMat.emissiveColor = c;
    this.zoneColMat.emissiveColor = c;
    this.zoneColMat.alpha = o.con && !still ? 0.1 + 0.06 * Math.abs(Math.sin(this.zonePulse * 4)) : 0.12;
  }

  /* CTF: base ring at each home and a pole + cloth that follows the host's flag position. */
  updateFlagVisuals(o) {
    if (!o || o.k !== 'ctf') { for (const f of Object.values(this.flagViz || {})) { f.flag.setEnabled(false); f.base.setEnabled(false); } return; }
    this.flagViz ||= {};
    for (const team of ['red', 'blue']) {
      let v = this.flagViz[team];
      const c = BABYLON.Color3.FromHexString(team === 'red' ? '#ef4444' : '#3b82f6');
      if (!v) {
        const mat = new BABYLON.StandardMaterial(`flagMat_${team}`, this.scene); mat.emissiveColor = c; mat.disableLighting = true;
        const flag = new BABYLON.TransformNode(`flag_${team}`, this.scene);
        const pole = BABYLON.MeshBuilder.CreateCylinder(`flagPole_${team}`, { height: 2.2, diameter: 0.06 }, this.scene); pole.position.y = 1.1;
        const cloth = BABYLON.MeshBuilder.CreateBox(`flagCloth_${team}`, { width: 0.7, height: 0.45, depth: 0.03 }, this.scene); cloth.position.set(0.36, 1.95, 0);
        const poleMat = new BABYLON.StandardMaterial(`flagPoleMat_${team}`, this.scene); poleMat.diffuseColor = new BABYLON.Color3(0.85, 0.87, 0.9);
        pole.material = poleMat; cloth.material = mat;
        const base = BABYLON.MeshBuilder.CreateTorus(`flagBase_${team}`, { diameter: 4, thickness: 0.1, tessellation: 48 }, this.scene); base.material = mat;
        for (const m of [pole, cloth]) { m.parent = flag; m.isPickable = false; }
        base.isPickable = false;
        v = this.flagViz[team] = { flag, base, cloth };
      }
      const f = o[team];
      v.flag.setEnabled(true); v.base.setEnabled(true);
      v.base.position.set(f.hx, f.hy + 0.05, f.hz);
      v.flag.position.set(f.x, f.y + (f.st === 'carried' ? 0.4 : 0), f.z);
      v.cloth.scaling.y = f.st === 'dropped' ? 0.6 : 1;
    }
  }

  applyGraphicsSettings(presetKey) {
    this.activePreset = presetKey;
    this.shotFx?.setPreset(presetKey);
    applyGraphicsPreset(this.engine, this.scene, this.pipeline, this.shadowGenerator, presetKey);
  }

  resize() {
    if (this.engine) this.engine.resize();
  }

  dispose() {
    window.removeEventListener('resize', this._resizeHandler);
    for (const [, av] of this.avatars) av.dispose();
    this.avatars.clear();
    this.shotFx?.dispose();
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
    this.ready = false;
  }
}
