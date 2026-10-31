/* Babylon.js Operative Turntable Previews & 3D Dossier Hero Viewer */

import * as BABYLON from '@babylonjs/core';
import { createBabylonEngine } from './engine_factory.js';
import { makeBabylonCharacter } from './character_loader.js';
import { hexToColor3 } from './materials.js';

export class BabylonCharacterPreview {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.turnNode = null;
    this.currentModel = null;
    this.running = false;
    this.lastTime = 0;

    this.init();
  }

  async init() {
    const { engine } = await createBabylonEngine(this.canvas, { preferWebGPU: false, antialias: true });
    this.engine = engine;

    const scene = this.scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // Transparent canvas background

    // Lighting
    const hemi = new BABYLON.HemisphericLight('previewHemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.diffuse = hexToColor3('#eaf4ff');
    hemi.groundColor = hexToColor3('#5b5246');
    hemi.intensity = 1.8;

    const sun = new BABYLON.DirectionalLight('previewSun', new BABYLON.Vector3(-2, -4, -3), scene);
    sun.diffuse = hexToColor3('#fff3df');
    sun.intensity = 2.4;

    // Floor Pedestal Disc
    const floor = BABYLON.MeshBuilder.CreateDisc('pedestal', { radius: 0.9, tessellation: 32 }, scene);
    floor.rotation.x = Math.PI / 2;
    const floorMat = new BABYLON.StandardMaterial('floorMat', scene);
    floorMat.diffuseColor = hexToColor3('#36414e');
    floorMat.disableLighting = false;
    floor.material = floorMat;

    this.turnNode = new BABYLON.TransformNode('turnNode', scene);

    // Portrait Camera focused on chest & head
    const cam = this.camera = new BABYLON.FreeCamera('previewCam', new BABYLON.Vector3(0, 1.55, 1.6), scene);
    cam.setTarget(new BABYLON.Vector3(0, 1.4, 0));
    cam.fov = 32 * (Math.PI / 180);

    this.running = true;

    this.engine.runRenderLoop(() => {
      if (!this.running || !this.scene) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - (this.lastTime || now)) / 1000);
      this.lastTime = now;

      const still = typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');
      if (!still && this.turnNode) {
        this.turnNode.rotation.y += dt * 0.4;
      }
      this.scene.render();
    });

    if (this.pendingShow) {
      const { id, colorHex } = this.pendingShow;
      this.pendingShow = null;
      this.show(id, colorHex);
    }
  }

  async show(id, colorHex = '#f0a640') {
    if (!this.scene) {
      this.pendingShow = { id, colorHex };
      return;
    }
    if (this.currentModel) {
      this.currentModel.root.dispose();
      this.currentModel = null;
    }

    const char = await makeBabylonCharacter(this.scene, this.assets, id, colorHex);
    char.root.rotation.y = 0;
    char.root.parent = this.turnNode;
    this.currentModel = char;

    for (const ag of char.animationGroups) {
      if (/idle/i.test(ag.name)) {
        ag.play(true);
      }
    }
    this.running = true;
    this.render();
  }

  render() {
    if (this.scene) this.scene.render();
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
  }

  stop() {
    this.running = false;
  }

  dispose() {
    this.stop();
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
  }
}

/* Interactive 3D Character Showcase & Hero Roster Viewer */
export class BabylonHeroViewer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.turnNode = null;
    this.currentModel = null;
    this.ringMesh = null;

    this.currentCharId = null;
    this.currentColor = '#f0a640';
    this.currentAnimName = 'idle';
    this.autoSpin = false;
    this.running = false;

    // Camera parameters
    this.camDistance = 5.0;
    this.camHeight = 1.15;
    this.camTargetY = 0.95;

    // Interaction state
    this.isDragging = false;
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.startTurnRotY = 0;
    this.startCamHeight = 0;
    this.lastTime = 0;

    this.init();
  }

  async init() {
    const { engine } = await createBabylonEngine(this.canvas, { preferWebGPU: false, antialias: true });
    this.engine = engine;

    const scene = this.scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

    // Cinematic 3-point Hero lighting
    const hemi = new BABYLON.HemisphericLight('dossierHemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.diffuse = hexToColor3('#f8fafc');
    hemi.groundColor = hexToColor3('#334155');
    hemi.intensity = 1.8;

    const sun = new BABYLON.DirectionalLight('dossierSun', new BABYLON.Vector3(-3, -5, -4), scene);
    sun.diffuse = hexToColor3('#fffaf0');
    sun.intensity = 2.6;

    const rim = new BABYLON.DirectionalLight('dossierRim', new BABYLON.Vector3(3, -3, 4), scene);
    rim.diffuse = hexToColor3('#38bdf8');
    rim.intensity = 2.2;

    const fill = new BABYLON.DirectionalLight('dossierFill', new BABYLON.Vector3(-2, -1.5, 2.5), scene);
    fill.diffuse = hexToColor3('#f59e0b');
    fill.intensity = 0.9;

    // Tactical Cyber-Metallic Podium Platform
    const baseMesh = BABYLON.MeshBuilder.CreateCylinder('podiumBase', {
      diameterTop: 2.4,
      diameterBottom: 2.7,
      height: 0.12,
      tessellation: 36
    }, scene);
    baseMesh.position.y = -0.06;
    const baseMat = new BABYLON.StandardMaterial('podiumBaseMat', scene);
    baseMat.diffuseColor = hexToColor3('#1e293b');
    baseMat.specularColor = hexToColor3('#64748b');
    baseMesh.material = baseMat;

    // Accent Glowing Team Ring on Podium
    const ringMesh = BABYLON.MeshBuilder.CreateDisc('podiumRing', {
      radius: 1.15,
      tessellation: 36
    }, scene);
    ringMesh.rotation.x = Math.PI / 2;
    ringMesh.position.y = 0.005;
    const ringMat = new BABYLON.StandardMaterial('podiumRingMat', scene);
    ringMat.diffuseColor = hexToColor3(this.currentColor);
    ringMat.emissiveColor = hexToColor3(this.currentColor);
    ringMat.backFaceCulling = false;
    ringMesh.material = ringMat;
    this.ringMesh = ringMesh;

    this.turnNode = new BABYLON.TransformNode('dossierTurnNode', scene);

    // Camera
    const cam = this.camera = new BABYLON.FreeCamera('dossierCam', new BABYLON.Vector3(0, this.camHeight, this.camDistance), scene);
    cam.setTarget(new BABYLON.Vector3(0, this.camTargetY, 0));
    cam.fov = 28 * (Math.PI / 180);

    this.bindEvents();

    this.engine.runRenderLoop(() => {
      if (!this.running || !this.scene) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - (this.lastTime || now)) / 1000);
      this.lastTime = now;

      const still = typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');
      if (!still && this.autoSpin && !this.isDragging && this.turnNode) {
        this.turnNode.rotation.y += dt * 0.5;
      }

      this.scene.render();
    });

    if (this.pendingLoad) {
      const { id, color, animName } = this.pendingLoad;
      this.pendingLoad = null;
      this.show(id, color, animName);
    }
  }

  updateCamera() {
    if (!this.camera) return;
    this.camera.position.set(0, this.camHeight, this.camDistance);
    this.camera.setTarget(new BABYLON.Vector3(0, this.camTargetY, 0));
  }

  bindEvents() {
    const el = this.canvas;
    el.style.touchAction = 'none';

    el.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.turnNode) {
        if (e.key === 'ArrowLeft') this.turnNode.rotation.y -= 0.2;
        if (e.key === 'ArrowRight') this.turnNode.rotation.y += 0.2;
      }
      if (e.key === 'ArrowUp') this.camHeight = Math.min(2.1, this.camHeight + 0.1);
      if (e.key === 'ArrowDown') this.camHeight = Math.max(0.4, this.camHeight - 0.1);
      if (e.key === '+' || e.key === '=') this.camDistance = Math.max(1.8, this.camDistance - 0.2);
      if (e.key === '-') this.camDistance = Math.min(5.5, this.camDistance + 0.2);
      this.updateCamera();
    });

    el.addEventListener('pointerdown', e => {
      this.isDragging = true;
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.startTurnRotY = this.turnNode ? this.turnNode.rotation.y : 0;
      this.startCamHeight = this.camHeight;
      try { el.setPointerCapture?.(e.pointerId); } catch {}
    });

    el.addEventListener('pointermove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.pointerStartX;
      const dy = e.clientY - this.pointerStartY;
      if (this.turnNode) {
        this.turnNode.rotation.y = this.startTurnRotY + dx * 0.012;
      }
      this.camHeight = Math.max(0.4, Math.min(2.1, this.startCamHeight + dy * 0.005));
      this.updateCamera();
    });

    const endDrag = e => {
      if (!this.isDragging) return;
      this.isDragging = false;
      try { el.releasePointerCapture?.(e.pointerId); } catch {}
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.camDistance = Math.max(1.8, Math.min(5.5, this.camDistance + e.deltaY * 0.003));
      this.updateCamera();
    }, { passive: false });
  }

  async show(id, color = '#f0a640', animName = 'idle') {
    this.currentCharId = id;
    this.currentColor = color;
    this.currentAnimName = animName;

    if (!this.scene) {
      this.pendingLoad = { id, color, animName };
      return;
    }

    if (this.currentModel) {
      this.currentModel.root.dispose();
      this.currentModel = null;
    }

    const char = await makeBabylonCharacter(this.scene, this.assets, id, color);
    char.root.rotation.y = 0;
    char.root.parent = this.turnNode;
    this.currentModel = char;

    this.setColor(color);
    this.playAnimation(animName);
    this.render();
  }

  playAnimation(name) {
    this.currentAnimName = name;
    if (!this.currentModel || !this.currentModel.animationGroups) return;

    const ags = this.currentModel.animationGroups;
    let target = ags.find(ag => new RegExp(name, 'i').test(ag.name));
    if (!target && name !== 'idle') {
      target = ags.find(ag => /idle/i.test(ag.name));
    }
    if (!target && ags.length > 0) target = ags[0];

    for (const ag of ags) {
      if (ag !== target) {
        ag.stop();
      }
    }

    if (target) {
      target.reset();
      const loop = name !== 'die';
      target.play(loop);
    }
  }

  setColor(colorHex) {
    this.currentColor = colorHex;
    const col = hexToColor3(colorHex);

    if (this.ringMesh && this.ringMesh.material) {
      this.ringMesh.material.diffuseColor = col;
      this.ringMesh.material.emissiveColor = col;
    }

    if (this.currentModel && this.currentModel.root) {
      for (const m of this.currentModel.root.getChildMeshes()) {
        if (m.material && /TEAM/i.test(m.material.name || '')) {
          if (m.material instanceof BABYLON.PBRMaterial) {
            m.material.albedoColor = col;
          } else if (m.material instanceof BABYLON.StandardMaterial) {
            m.material.diffuseColor = col;
          }
        }
      }
    }
  }

  toggleSpin() {
    this.autoSpin = !this.autoSpin;
    return this.autoSpin;
  }

  resetView() {
    if (this.turnNode) this.turnNode.rotation.y = 0;
    this.camDistance = 5.0;
    this.camHeight = 1.15;
    this.updateCamera();
  }

  render() {
    if (this.scene) this.scene.render();
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    if (this.engine) this.engine.resize();
  }

  stop() {
    this.running = false;
  }

  dispose() {
    this.stop();
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
  }
}
