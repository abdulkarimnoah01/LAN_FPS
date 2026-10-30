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

    // Camera
    const cam = this.camera = new BABYLON.FreeCamera('previewCam', new BABYLON.Vector3(0, 1.25, 4.4), scene);
    cam.setTarget(new BABYLON.Vector3(0, 0.9, 0));
    cam.fov = 30 * (Math.PI / 180);

    this.engine.runRenderLoop(() => {
      if (!this.running || !this.scene) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;

      const still = typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion');
      if (!still && this.turnNode) {
        this.turnNode.rotation.y += dt * 0.6;
      }
      this.scene.render();
    });
  }

  async show(id, colorHex = '#f0a640') {
    if (!this.scene) return;
    if (this.currentModel) {
      this.currentModel.root.dispose();
      this.currentModel = null;
    }

    const char = await makeBabylonCharacter(this.scene, this.assets, id, colorHex);
    // Inspection cameras look from +Z; rotate to face viewer
    char.root.rotation.y = 0;
    char.root.parent = this.turnNode;
    this.currentModel = char;

    // Play idle animation
    for (const ag of char.animationGroups) {
      if (/idle/i.test(ag.name)) {
        ag.play(true);
      }
    }
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

export class BabylonHeroViewer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.turnNode = null;
    this.currentModel = null;
    this.isDragging = false;
    this.prevX = 0;

    this.init();
  }

  async init() {
    const { engine } = await createBabylonEngine(this.canvas, { preferWebGPU: false, antialias: true });
    this.engine = engine;

    const scene = this.scene = new BABYLON.Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

    const hemi = new BABYLON.HemisphericLight('dossierHemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.diffuse = hexToColor3('#eaf4ff');
    hemi.groundColor = hexToColor3('#334155');
    hemi.intensity = 1.9;

    const sun = new BABYLON.DirectionalLight('dossierSun', new BABYLON.Vector3(-3, -5, -2), scene);
    sun.diffuse = hexToColor3('#fed7aa');
    sun.intensity = 2.6;

    const floor = BABYLON.MeshBuilder.CreateDisc('dossierPedestal', { radius: 1.2, tessellation: 36 }, scene);
    floor.rotation.x = Math.PI / 2;
    const floorMat = new BABYLON.StandardMaterial('dossierFloorMat', scene);
    floorMat.diffuseColor = hexToColor3('#1e293b');
    floor.material = floorMat;

    this.turnNode = new BABYLON.TransformNode('dossierTurnNode', scene);

    const cam = this.camera = new BABYLON.FreeCamera('dossierCam', new BABYLON.Vector3(0, 1.2, 3.8), scene);
    cam.setTarget(new BABYLON.Vector3(0, 0.95, 0));
    cam.fov = 34 * (Math.PI / 180);

    // Mouse / touch orbit controls
    this.canvas.addEventListener('pointerdown', e => {
      this.isDragging = true;
      this.prevX = e.clientX;
    });
    window.addEventListener('pointermove', e => {
      if (this.isDragging && this.turnNode) {
        const dx = e.clientX - this.prevX;
        this.prevX = e.clientX;
        this.turnNode.rotation.y += dx * 0.01;
      }
    });
    window.addEventListener('pointerup', () => { this.isDragging = false; });

    this.engine.runRenderLoop(() => {
      if (this.scene) this.scene.render();
    });
  }

  async loadHero(heroId, skinHex = '#38bdf8') {
    if (!this.scene) return;
    if (this.currentModel) {
      this.currentModel.root.dispose();
      this.currentModel = null;
    }

    const char = await makeBabylonCharacter(this.scene, this.assets, heroId, skinHex);
    char.root.rotation.y = 0;
    char.root.parent = this.turnNode;
    this.currentModel = char;

    for (const ag of char.animationGroups) {
      if (/idle/i.test(ag.name)) {
        ag.play(true);
      }
    }
  }

  dispose() {
    if (this.scene) this.scene.dispose();
    if (this.engine) this.engine.dispose();
  }
}
