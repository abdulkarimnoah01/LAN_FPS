/* Babylon.js Operative Character Loader & Avatar Animation Controller */

import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import { hexToColor3, hexToColor4 } from './materials.js';
import { applyAppearance, disposeAppearance, glbBytes } from './appearance_materials.js';
import { decodeLook } from '../appearance.js';
import { instantiateWorldWeapon } from './weapon_viewmodel.js';
import { WEAPONS } from '../sim.js';

export const PLAYER_COLORS = ['#38bdf8', '#fb7185', '#34d399', '#facc15', '#a78bfa', '#fb923c'];

function createNameTagMesh(scene, text, colorHex) {
  const dynamicTexture = new BABYLON.DynamicTexture('nameTagTex', { width: 256, height: 64 }, scene, false);
  dynamicTexture.hasAlpha = true;

  const ctx = dynamicTexture.getContext();
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = colorHex;
  ctx.fillText(text, 128, 32);
  dynamicTexture.update();

  const plane = BABYLON.MeshBuilder.CreatePlane('nameTag', { width: 1.4, height: 0.35 }, scene);
  const mat = new BABYLON.StandardMaterial('nameTagMat', scene);
  mat.diffuseTexture = dynamicTexture;
  mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  plane.position.y = 2.15;
  plane.isPickable = false;

  return plane;
}

export function createPlaceholderCharacter(scene, colorHex) {
  const root = new BABYLON.TransformNode('placeholder_char', scene);
  const col = hexToColor3(colorHex);

  const mat = new BABYLON.PBRMaterial('placeholderMat', scene);
  mat.albedoColor = col;
  mat.roughness = 0.5;

  const body = BABYLON.MeshBuilder.CreateBox('body', { width: 0.6, height: 0.9, depth: 0.3 }, scene);
  body.position.y = 0.9;
  body.material = mat;
  body.parent = root;

  const head = BABYLON.MeshBuilder.CreateBox('head', { width: 0.35, height: 0.35, depth: 0.35 }, scene);
  head.position.y = 1.55;
  head.material = mat;
  head.parent = root;

  const visorMat = new BABYLON.StandardMaterial('visorMat', scene);
  visorMat.diffuseColor = hexToColor3('#1e293b');
  const visor = BABYLON.MeshBuilder.CreateBox('visor', { width: 0.28, height: 0.1, depth: 0.1 }, scene);
  visor.position.set(0, 1.55, -0.16);
  visor.material = visorMat;
  visor.parent = root;

  return { root, meshes: [body, head, visor], animationGroups: [] };
}

/* instantiateModelsToScene also renames animation groups; this separator lets callers recover the clip name. */
export const INSTANCE_SEP = '__i';
export const clipName = name => String(name || '').split(INSTANCE_SEP)[0];

const containerCache = new WeakMap();   // scene -> Map(char name -> Promise<AssetContainer>)

function loadContainer(scene, charData) {
  let perScene = containerCache.get(scene);
  if (!perScene) { perScene = new Map(); containerCache.set(scene, perScene); }
  if (!perScene.has(charData.name)) {
    const bytes = glbBytes(charData);
    const p = BABYLON.LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: `${charData.id || 'char'}.glb` });
    p.catch(() => perScene.delete(charData.name));
    perScene.set(charData.name, p);
  }
  return perScene.get(charData.name);
}

export function findCharData(assets, charId) {
  const chars = assets?.characters || [];
  return chars.find(c => c.id === charId || c.name?.toLowerCase() === charId?.toLowerCase()) || chars[0] || null;
}

/* The GLB is decoded once per scene; each call instantiates a fresh skeleton/animation set that
   shares geometry and base materials with other instances of the same body. */
export async function makeBabylonCharacter(scene, assets, charId, colorHex = '#38bdf8') {
  const charData = findCharData(assets, charId);

  if (!charData || !charData.glb) {
    return createPlaceholderCharacter(scene, colorHex);
  }

  const container = await loadContainer(scene, charData);

  const root = new BABYLON.TransformNode(`char_${charId}`, scene);
  const instances = container.instantiateModelsToScene(name => `${name}${INSTANCE_SEP}${Math.random().toString(36).slice(2, 6)}`, false);

  for (const rootNode of instances.rootNodes) {
    rootNode.parent = root;
  }

  // Model orientation: glTF characters face +Z, FPS world forward is -Z
  root.rotation.y = Math.PI;

  // Apply custom scale/transform offsets if configured
  const cfg = assets?.config?.characters?.[charData.name] || assets?.config?.player;
  if (cfg) {
    if (cfg.scale) root.scaling.scaleInPlace(cfg.scale);
    if (cfg.position) root.position.addInPlace(new BABYLON.Vector3(...cfg.position));
  }

  // Set team color
  const col = hexToColor3(colorHex);
  for (const m of root.getChildMeshes()) {
    if (m.material && /TEAM/i.test(m.material.name || '')) {
      m.material = m.material.clone(`teamMat_${colorHex}`);
      if (m.material instanceof BABYLON.PBRMaterial) {
        m.material.albedoColor = col;
      } else if (m.material instanceof BABYLON.StandardMaterial) {
        m.material.diffuseColor = col;
      }
    }
  }

  return {
    root,
    charData,
    bodyId: charData.id || charId,
    animationGroups: instances.animationGroups || [],
    skeleton: instances.skeletons?.[0] || null,
    skeletons: instances.skeletons || [],
  };
}

/* Disposes one instantiated model without touching the shared container or cached atlases. */
export function disposeCharacter(model) {
  if (!model) return;
  disposeAppearance(model);
  for (const ag of model.animationGroups || []) ag.dispose();
  for (const sk of model.skeletons || []) sk.dispose();
  model.root?.dispose(false, false);
}

export class BabylonAvatar {
  constructor(scene, assets, id, name, slot, charId, team = 'none', look = '') {
    this.scene = scene;
    this.assets = assets;
    this.id = id;
    this.name = name;
    this.slot = slot;
    this.charId = charId;
    this.team = team;
    this.colorHex = team === 'red' ? '#ef4444' : (team === 'blue' ? '#3b82f6' : PLAYER_COLORS[slot % PLAYER_COLORS.length]);

    this.root = null;
    this.nameTag = null;
    this.animGroups = {};
    this.currentAnim = null;
    this.loaded = false;
    this.disposed = false;
    this.lookCode = typeof look === 'string' ? look : '';
    this.model = null;

    this.init();
  }

  async init() {
    const char = await makeBabylonCharacter(this.scene, this.assets, this.charId, this.colorHex);
    if (this.disposed) { disposeCharacter(char); return; }   // player left while the model loaded
    this.model = char;
    this.root = char.root;
    this.applyLook();

    // Index animation groups
    for (const ag of char.animationGroups) {
      const clean = clipName(ag.name).toLowerCase().replace(/_armature.*$/i, '').trim();
      this.animGroups[clean] = ag;
      this.animGroups[ag.name] = ag;
    }

    // Play default idle
    if (this.animGroups.idle) {
      this.animGroups.idle.play(true);
      this.currentAnim = 'idle';
    }

    this.nameTag = createNameTagMesh(this.scene, this.name, this.colorHex);
    this.nameTag.parent = this.root;
    this.setupHeldWeapon();
    this.loaded = true;
  }

  /* Next Gen bodies (identity rest pose) hold their current weapon: an aim pose is layered on
     the arms after the animation system runs, so legs keep walking/running underneath. */
  setupHeldWeapon() {
    if (!this.model?.charData?.ng) return;
    const nodes = new Map();
    for (const n of this.root.getDescendants(false)) nodes.set(n.name.split('__i')[0], n);
    this.arms = { ua: nodes.get('UpperArm.R'), fa: nodes.get('Forearm.R'), hand: nodes.get('Hand.R'), ual: nodes.get('UpperArm.L'), fal: nodes.get('Forearm.L'), chest: nodes.get('Chest') };
    if (!this.arms.ua || !this.arms.hand) { this.arms = null; return; }
    const Q = (x, y, z) => BABYLON.Quaternion.FromEulerAngles(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180);
    this.aimPose = { ua: Q(-82, 0, 14), fa: Q(-12, 0, 0), ual: Q(-70, 0, -38), fal: Q(-48, 0, 0) };
    this.poseObs = this.scene.onAfterAnimationsObservable.add(() => {
      if (!this.arms || !this.alive || this.disposed) return;
      const a = this.arms, P = this.aimPose;
      a.ua.rotationQuaternion = P.ua; a.fa && (a.fa.rotationQuaternion = P.fa);
      a.ual && (a.ual.rotationQuaternion = P.ual); a.fal && (a.fal.rotationQuaternion = P.fal);
    });
  }

  setHeldWeapon(w) {
    if (!this.arms || w === this.heldW) return;
    this.heldW = w;
    this.heldWeapon?.dispose();
    const id = (WEAPONS[w] || WEAPONS[0]).id;
    const gun = this.heldWeapon = instantiateWorldWeapon(this.scene, id);
    if (!gun) return;
    gun.parent = this.arms.hand;
    // hand space: −Y runs down the arm (forward once raised), +Z faces the body front
    gun.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(Math.PI / 2, Math.PI, 0);
    gun.position.set(0, -0.1, 0.02);
    gun.scaling.setAll(1.05);
  }

  /* Snapshot-driven: called every frame with the host's canonical look code. */
  setLook(code) {
    if (typeof code !== 'string' || code === this.lookCode) return;
    this.lookCode = code;
    this.applyLook();
  }

  applyLook() {
    if (!this.model || this.disposed) return;
    return applyAppearance(this.model, decodeLook(this.lookCode, this.charId), this.team);
  }

  update(p, dt) {
    if (p && p.lk !== undefined) this.setLook(p.lk);
    if (!this.loaded || !this.root) return;
    this.alive = !!p.alive;
    if (this.arms) { this.setHeldWeapon(p.w | 0); if (this.heldWeapon) this.heldWeapon.setEnabled(this.alive); }

    this.root.position.set(p.x, p.y, p.z);
    if (p.__fr) {
      // On a planet the model stands on the local up and faces the transported heading.
      const f = p.__fr, m = this._fm ||= new BABYLON.Matrix();
      BABYLON.Matrix.FromXYZAxesToRef(new BABYLON.Vector3(-f.right[0], -f.right[1], -f.right[2]), new BABYLON.Vector3(...f.up), new BABYLON.Vector3(...f.fwd), m);
      this.root.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(m);
    } else {
      if (this.root.rotationQuaternion) this.root.rotationQuaternion = null;
      this.root.rotation.y = p.yaw + Math.PI;
    }

    // Animation state blending
    const speed = p.__speed ?? Math.hypot(p.vx || 0, p.vz || 0);

    // Rigless models (e.g. Noura) have no clips: fake locomotion with a step bob and a death tip-over
    if (!Object.keys(this.animGroups).length) {
      const bob = p.alive && speed > 0.5 ? Math.abs(Math.sin(performance.now() / (speed > 4.5 ? 90 : 140))) * 0.06 : 0;
      this.root.position.y = p.y + bob;
      this.root.rotation.x = p.alive ? 0 : -Math.PI / 2;
      return;
    }
    let targetAnim = 'idle';

    if (!p.alive) {
      targetAnim = 'death';
    } else if (p.cr) {
      targetAnim = speed > 0.5 ? 'crouch_walk' : 'crouch';
    } else if (speed > 4.5) {
      targetAnim = 'run';
    } else if (speed > 0.5) {
      targetAnim = 'walk';
    }

    if (targetAnim === 'death' && !this.animGroups.death && this.animGroups.die) targetAnim = 'die';
    if (targetAnim === 'crouch_walk' && !this.animGroups.crouch_walk) targetAnim = 'crouch';
    if (this.currentAnim !== targetAnim && (this.animGroups[targetAnim] || this.animGroups['idle'])) {
      const cur = this.animGroups[this.currentAnim];
      const next = this.animGroups[targetAnim] || this.animGroups['idle'];

      if (cur) cur.stop();
      if (next) {
        next.play(targetAnim !== 'death' && targetAnim !== 'die');
        this.currentAnim = targetAnim;
      }
    }
  }

  dispose() {
    this.disposed = true;
    if (this.poseObs) this.scene.onAfterAnimationsObservable.remove(this.poseObs);
    this.heldWeapon?.dispose();
    if (this.nameTag) this.nameTag.dispose(false, true);   // the tag owns its material and canvas texture
    if (this.model) disposeCharacter(this.model);
    else if (this.root) this.root.dispose();
    this.model = null;
    this.root = null;
  }
}
