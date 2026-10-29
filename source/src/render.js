/* three.js view: arena, players, first-person weapon and effects.
   Placeholder models are built from primitives; any glTF dropped into
   source/assets (arena.glb, weapon.glb, characters/*.glb) replaces them at build time. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { defaultArena, PALETTE, getMap } from './arena.js';
import { EYE, EYE_STAND, EYE_CROUCH, WEAPONS } from './sim.js';

export const PLAYER_COLORS = ['#e8553e', '#3e8ee8', '#47b347', '#e8c13e', '#a65de8', '#3ed2d2'];
const SKY = '#a9cfe8';

const flat = color => new THREE.MeshLambertMaterial({ color, flatShading: true });

/* ---- glTF assets (embedded by build.mjs as base64) ---- */
export const charId = name => String(name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32);

export async function loadAssets(embedded = globalThis.LANFPS_ASSETS || {}) {
  const loader = new GLTFLoader(), out = { config: embedded.config || {} };
  const parse = async (b64, label) => {
    try {
      const gltf = await loader.parseAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer, '');
      return { scene: gltf.scene, animations: gltf.animations || [] };
    } catch (e) {
      console.warn(`LAN_FPS: could not load ${label}, using the placeholder`, e); return null;
    }
  };
  for (const name of ['arena', 'player', 'weapon']) if (embedded[name]) {
    const res = await parse(embedded[name], name + '.glb');
    if (res) out[name] = res.scene;
  }
  // Processed maps: assets/maps/processed/<id>.glb
  out.maps = {};
  if (embedded.maps) {
    for (const [id, m] of Object.entries(embedded.maps)) {
      out.maps[id] = { ...m };
      if (m.glb) {
        const res = await parse(m.glb, `maps/${id}.glb`);
        if (res) out.maps[id].scene = res.scene;
      }
    }
  }
  // Selectable characters: assets/characters/*.glb, then player.glb, then the built-in robot.
  out.characters = [];
  for (const c of embedded.characters || []) {
    const res = await parse(c.glb, `characters/${c.name}.glb`);
    if (res) out.characters.push({ id: charId(c.name), name: c.name, scene: res.scene, animations: res.animations });
  }
  if (out.player) out.characters.push({ id: 'player', name: 'Player', scene: out.player, animations: [] });
  out.characters.push({ id: 'robot', name: 'Robot', scene: null, animations: [] });
  return out;
}

/* A fresh model of one character, feet at the origin, facing -Z (the game's forward).
   Unknown ids fall back to the first character, so a PC on an older build still sees someone. */
export function makeCharacter(assets, id, color) {
  const c = assets.characters.find(c => c.id === id) || assets.characters[0];
  if (!c.scene) return placeholderPlayer(color);
  const model = cloneSkinned(c.scene);
  // glTF characters face +Z; the game's forward is -Z.
  const wrap = new THREE.Group(); wrap.add(model);
  applyTransform(model, assets.config.characters?.[c.name] || assets.config.player);
  model.rotation.y += Math.PI;
  model.traverse(o => { if (o.isMesh && /TEAM/i.test(o.material?.name || '')) { o.material = o.material.clone(); o.material.color.set(color); } });

  if (c.animations && c.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const clip of c.animations) {
      const act = mixer.clipAction(clip);
      actions[clip.name] = act;
      const clean = clip.name.toLowerCase().replace(/_armature.*$/i, '').trim();
      actions[clean] = act;
    }
    wrap.userData.mixer = mixer;
    wrap.userData.actions = actions;
  }
  return wrap;
}

/* Turntable preview for the character select screen. */
export class CharacterPreview {
  constructor(canvas, assets) {
    this.assets = assets;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = this.scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#eaf4ff', '#5b5246', 1.8));
    const sun = new THREE.DirectionalLight('#fff3df', 2.4); sun.position.set(2, 4, 3); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshLambertMaterial({ color: '#36414e' }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    this.turn = new THREE.Group(); scene.add(this.turn);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.25, 4.4); this.camera.lookAt(0, 0.9, 0);
    this.previewModel = null;
    this.running = false;
  }
  show(id, color = '#f0a640') {
    this.turn.clear();
    const model = makeCharacter(this.assets, id, color);
    // Game models face -Z; inspection cameras look from +Z.
    model.rotation.y += Math.PI;
    this.previewModel = model;
    if (model.userData.actions?.idle) {
      model.userData.actions.idle.play();
    }
    this.turn.add(model);
  }
  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = t => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      const still = document.documentElement.classList.contains('reduce-motion');
      if (!still) this.turn.rotation.y += dt * 0.6;
      last = t;
      if (!still && this.previewModel?.userData?.mixer) {
        this.previewModel.userData.mixer.update(dt);
      }
      const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
      if (w && h && (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
}

/* Interactive 3D Character Showcase & Hero Roster Viewer */
export class HeroViewer {
  constructor(canvas, assets) {
    this.assets = assets;
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene = new THREE.Scene();

    // Cinematic 3-point Hero lighting
    const hemi = new THREE.HemisphereLight('#f8fafc', '#334155', 1.8);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fffaf0', 2.6);
    sun.position.set(3, 5, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    scene.add(sun);

    // Rim/Back Light for crisp hero outline
    const rim = new THREE.DirectionalLight('#38bdf8', 2.2);
    rim.position.set(-3, 3, -4);
    scene.add(rim);

    // Fill Light
    const fill = new THREE.DirectionalLight('#f59e0b', 0.9);
    fill.position.set(2, 1.5, -2.5);
    scene.add(fill);

    // Tactical Cyber-Metallic Podium Platform
    const podium = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(1.2, 1.35, 0.12, 32);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.65 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.06;
    baseMesh.receiveShadow = true;
    podium.add(baseMesh);

    // Accent Glowing Team Ring on Podium
    const ringGeo = new THREE.RingGeometry(0.95, 1.15, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.005;
    this.ringMesh = ringMesh;
    podium.add(ringMesh);

    scene.add(podium);

    // Turntable Pivot
    this.turn = new THREE.Group();
    scene.add(this.turn);

    // Camera
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    this.camDistance = 5;
    this.camHeight = 1.15;
    this.camTargetY = 0.95;
    this.updateCamera();

    this.previewModel = null;
    this.currentCharId = null;
    this.currentColor = '#f0a640';
    this.currentAnimName = 'idle';
    this.autoSpin = false;
    this.running = false;

    // Interaction state
    this.isDragging = false;
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.startTurnRotY = 0;
    this.startCamHeight = 0;

    this.bindEvents();
  }

  updateCamera() {
    this.camera.position.set(0, this.camHeight, this.camDistance);
    this.camera.lookAt(0, this.camTargetY, 0);
  }

  bindEvents() {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'ArrowLeft') this.turn.rotation.y -= 0.2;
      if (e.key === 'ArrowRight') this.turn.rotation.y += 0.2;
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
      this.startTurnRotY = this.turn.rotation.y;
      this.startCamHeight = this.camHeight;
      try { el.setPointerCapture?.(e.pointerId); } catch {}
    });

    el.addEventListener('pointermove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.pointerStartX;
      const dy = e.clientY - this.pointerStartY;
      this.turn.rotation.y = this.startTurnRotY + dx * 0.012;
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

  show(id, color = '#f0a640', animName = 'idle') {
    this.currentCharId = id;
    this.currentColor = color;
    this.turn.clear();

    const model = makeCharacter(this.assets, id, color);
    model.rotation.y += Math.PI;
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.previewModel = model;
    this.setColor(color);
    this.playAnimation(animName);
    this.turn.add(model);
  }

  playAnimation(name) {
    this.currentAnimName = name;
    const actions = this.previewModel?.userData?.actions;
    if (!actions) return;

    const targetAction = actions[name] || actions.idle;
    if (!targetAction) return;

    for (const [key, act] of Object.entries(actions)) {
      if (key !== name && act.isRunning()) {
        act.crossFadeTo(targetAction, 0.25, true);
      }
    }

    if (name === 'die') {
      targetAction.setLoop(THREE.LoopOnce, 1);
      targetAction.clampWhenFinished = true;
    } else {
      targetAction.setLoop(THREE.LoopRepeat, Infinity);
      targetAction.clampWhenFinished = false;
    }

    targetAction.reset().play();
  }

  setColor(colorHex) {
    this.currentColor = colorHex;
    if (this.ringMesh) {
      this.ringMesh.material.color.set(colorHex);
    }
    if (this.previewModel) {
      this.previewModel.traverse(o => {
        if (o.isMesh && /TEAM/i.test(o.material?.name || '')) {
          o.material.color.set(colorHex);
        }
      });
    }
  }

  toggleSpin() {
    this.autoSpin = !this.autoSpin;
    return this.autoSpin;
  }

  resetView() {
    this.turn.rotation.y = 0;
    this.camDistance = 5;
    this.camHeight = 1.15;
    this.updateCamera();
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();

    const loop = t => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;

      const still = document.documentElement.classList.contains('reduce-motion');
      if (!still && this.autoSpin && !this.isDragging) {
        this.turn.rotation.y += dt * 0.5;
      }

      if (!still && this.previewModel?.userData?.mixer) {
        this.previewModel.userData.mixer.update(dt);
      }

      const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
      if (w && h && (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }

      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}

/* Collision boxes and spawns for the match. From arena.glb when present:
   meshes named COL_* are invisible colliders (their world bounding boxes),
   empties named SPAWN_* are spawn points. Without COL_ meshes, every mesh's
   bounding box collides. */
export function buildWorld(assets, mapType = 'foundry', mapSeed = 0) {
  if (assets?.maps?.[mapType]) {
    const base = getMap(mapType, mapSeed);
    const m = assets.maps[mapType];
    const scene = m.scene ? m.scene.clone() : null;
    return {
      ...base,
      gltf: scene,
      preview: m.preview || null,
    };
  }
  if (mapType === 'arena' && assets.arena) {
    const scene = assets.arena;
    scene.updateMatrixWorld(true);
    const cols = [], meshes = [], spawns = [];
    scene.traverse(o => {
      const n = (o.name || '').toUpperCase();
      if (n.startsWith('SPAWN')) { const v = o.getWorldPosition(new THREE.Vector3()); spawns.push({ x: v.x, y: v.y, z: v.z }); }
      else if (o.isMesh) (n.startsWith('COL') ? cols : meshes).push(o);
    });
    for (const o of cols) o.visible = false;
    const boxes = (cols.length ? cols : meshes).map(o => {
      const b = new THREE.Box3().setFromObject(o);
      return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
    });
    if (spawns.length < 2) console.warn('LAN_FPS: arena.glb has fewer than 2 SPAWN_ empties; using built-in spawn points');
    return { boxes, spawns: spawns.length >= 2 ? spawns : defaultArena().spawns, gltf: scene, theme: 'arena' };
  }
  return getMap(mapType, mapSeed);
}

/* ---- Placeholder models ---- */
function placeholderPlayer(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 1.3, 6), flat(color)); body.position.y = 0.68;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), flat(color)); head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), flat('#1d232b')); visor.position.set(0, 1.65, -0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), flat('#2b2f36')); gun.position.set(0.25, 1.15, -0.35);
  g.add(body, head, visor, gun);
  return g;
}
export function buildWeaponModel(id = 'ak47') {
  const g = new THREE.Group();
  const dark = flat('#22262c');
  const steel = flat('#464d57');
  const wood = flat('#633b1e');
  const darkWood = flat('#422612');
  const orange = flat('#b85420');
  const lens = flat('#1b6a7a');

  if (id === 'shotgun') {
    // Shotgun: heavy receiver, twin under-barrel, ribbed pump
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.36), dark); rec.position.z = -0.12;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.35, 8), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025, -0.44);
    const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), dark);
    magTube.rotation.x = Math.PI / 2; magTube.position.set(0, -0.015, -0.42);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8), darkWood);
    pump.rotation.x = Math.PI / 2; pump.position.set(0, -0.015, -0.36);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), darkWood);
    grip.position.set(0, -0.11, 0.02); grip.rotation.x = 0.28;
    g.add(rec, barrel, magTube, pump, grip);
    g.userData.muzzle = new THREE.Vector3(0, 0.025, -0.62);
  } else if (id === 'sniper') {
    // Sniper: long fluted barrel, elevated dual-ring scope, bolt handle, sleek stock
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.09, 0.44), dark); rec.position.z = -0.12;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.55, 8), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.58);
    const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.07), steel);
    muzzleBrake.position.set(0, 0.02, -0.84);
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 8), dark);
    scopeTube.rotation.x = Math.PI / 2; scopeTube.position.set(0, 0.09, -0.16);
    const lensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.04, 8), lens);
    lensFront.rotation.x = Math.PI / 2; lensFront.position.set(0, 0.09, -0.28);
    const lensBack = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.04, 8), dark);
    lensBack.rotation.x = Math.PI / 2; lensBack.position.set(0, 0.09, -0.04);
    const scopeMount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), dark);
    scopeMount.position.set(0, 0.065, -0.16);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), steel);
    bolt.position.set(0.045, 0.035, -0.04);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.26), darkWood);
    stock.position.set(0, -0.07, 0.12); stock.rotation.x = -0.15;
    g.add(rec, barrel, muzzleBrake, scopeTube, lensFront, lensBack, scopeMount, bolt, stock);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.88);
  } else if (id === 'smg') {
    // SMG: compact body, vertical stick mag, front grip, reflex sight
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.085, 0.30), dark); rec.position.z = -0.10;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.18, 8), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.018, -0.32);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.20, 0.05), steel);
    mag.position.set(0, -0.14, -0.08); mag.rotation.x = 0.12;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), dark);
    grip.position.set(0, -0.10, 0.06); grip.rotation.x = 0.25;
    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.04), dark);
    foregrip.position.set(0, -0.09, -0.22);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.07), dark);
    sight.position.set(0, 0.06, -0.14);
    g.add(rec, barrel, mag, grip, foregrip, sight);
    g.userData.muzzle = new THREE.Vector3(0, 0.018, -0.42);
  } else if (id === 'lmg') {
    // LMG: heavy frame, circular drum mag, heat shield, bipod
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.44), dark); rec.position.z = -0.12;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.36, 8), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.025, -0.48);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.22), steel);
    shroud.position.set(0, 0.025, -0.36);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 12), flat('#324030'));
    drum.rotation.z = Math.PI / 2; drum.position.set(-0.06, -0.12, -0.10);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.14, 0.07), dark);
    grip.position.set(0, -0.12, 0.03); grip.rotation.x = 0.22;
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.16), dark);
    bipod.position.set(0, -0.025, -0.52);
    g.add(rec, barrel, shroud, drum, grip, bipod);
    g.userData.muzzle = new THREE.Vector3(0, 0.025, -0.68);
  } else if (id === 'knife') {
    // Combat Knife: tactical Bowie blade with clip point, crossguard, ribbed grip
    const bladeMat = flat('#cbd5e1');
    const bladeDark = flat('#64748b');
    const guardMat = flat('#1e293b');
    const gripMat = flat('#0f172a');

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.055, 0.28), bladeMat);
    blade.position.set(0, 0.01, -0.22);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.09, 4), bladeMat);
    tip.rotation.x = -Math.PI / 2;
    tip.rotation.y = Math.PI / 4;
    tip.position.set(0, 0.01, -0.38);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.16), bladeDark);
    spine.position.set(0, 0.035, -0.18);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.025), guardMat);
    guard.position.set(0, 0.01, -0.07);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.16, 8), gripMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.01, 0.02);
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 8), guardMat);
    pommel.rotation.x = Math.PI / 2;
    pommel.position.set(0, 0.01, 0.11);

    g.add(blade, tip, spine, guard, handle, pommel);
    g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.42);
  } else {
    // AK-47: steel receiver, curved mag, wood stock & handguard, gas tube
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.09, 0.40), dark); rec.position.z = -0.12;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.34, 8), steel);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, -0.46);
    const gasTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 8), steel);
    gasTube.rotation.x = Math.PI / 2; gasTube.position.set(0, 0.045, -0.40);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.18), wood);
    handguard.position.set(0, 0.025, -0.38);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.08), orange);
    mag.position.set(0, -0.13, -0.08); mag.rotation.x = 0.28;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.065), darkWood);
    grip.position.set(0, -0.12, 0.04); grip.rotation.x = 0.28;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.11, 0.24), wood);
    stock.position.set(0, -0.05, 0.16); stock.rotation.x = -0.12;
    const sightFront = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.02), steel);
    sightFront.position.set(0, 0.05, -0.58);
    g.add(rec, barrel, gasTube, handguard, mag, grip, stock, sightFront);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.64);
  }
  g.scale.setScalar(0.78);
  return g;
}

function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.65)'; x.strokeText(text, 128, 32);
  x.fillStyle = color; x.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true }));
  s.scale.set(1.4, 0.35, 1); s.position.y = 2.15;
  return s;
}

function applyTransform(obj, cfg = {}) {
  if (cfg.scale) obj.scale.setScalar(cfg.scale);
  if (cfg.position) obj.position.fromArray(cfg.position);
  if (cfg.rotation) obj.rotation.set(...cfg.rotation.map(d => THREE.MathUtils.degToRad(d)));
}

export class View {
  constructor(canvas, world, assets) {
    this.world = world; this.assets = assets;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    const scene = this.scene = new THREE.Scene();
    // Sky as the clear colour, not scene.background: a colour background would
    // clear the frame again during the separate weapon pass.
    r.setClearColor(world.sky || SKY); scene.fog = new THREE.Fog(world.fog || SKY, 30, 95);
    scene.add(new THREE.HemisphereLight('#eaf4ff', '#5b5246', 1.6));
    const sun = new THREE.DirectionalLight('#fff3df', 2.2);
    sun.position.set(14, 30, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 80 });
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    this.worldGroup = new THREE.Group();
    scene.add(this.worldGroup);

    this.avatars = new Map();
    this.fx = [];
    this.barrelMeshes = new Map();
    this.grenadeObjs = new Map();
    this.weaponModels = new Map();
    this.activeWeaponIndex = -1;

    this.buildVisuals(world);

    const cam = this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    cam.rotation.order = 'YXZ';
    scene.add(cam);
    // First-person weapon.
    const weapon = this.weapon = new THREE.Group();
    weapon.position.set(0.2, -0.2, -0.38);
    cam.add(weapon);
    this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: '#ffe48a', transparent: true, opacity: 0.95 }));
    this.flash.visible = false;
    weapon.add(this.flash);

    this.setWeaponModel(0);

    // The weapon is drawn in its own pass (layer 1) after clearing depth, so it
    // never sinks into walls the player is standing against.
    weapon.traverse(o => o.layers.set(1));
    scene.traverse(o => { if (o.isLight) o.layers.enableAll(); });
    this.kick = 0; this.bob = 0;

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setWeaponModel(wIndex) {
    if (this.activeWeaponIndex === wIndex && this.currentWeaponObj) return;
    this.activeWeaponIndex = wIndex;
    if (this.currentWeaponObj) {
      this.weapon.remove(this.currentWeaponObj);
    }
    const wepDef = WEAPONS[wIndex] || WEAPONS[0];
    let model = this.weaponModels.get(wepDef.id);
    if (!model) {
      if (this.assets.weapon && wIndex === 0) {
        model = this.assets.weapon;
        const m = model.getObjectByName('MUZZLE');
        model.updateMatrixWorld(true);
        model.userData.muzzle = m ? m.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, -0.5);
      } else {
        model = buildWeaponModel(wepDef.id);
      }
      applyTransform(model, this.assets.config?.[wepDef.id] || this.assets.config?.weapon);
      model.traverse(o => o.layers.set(1));
      this.weaponModels.set(wepDef.id, model);
    }
    this.currentWeaponObj = model;
    this.weapon.add(model);
    model.updateMatrix();
    if (this.flash) {
      this.flash.position.copy(model.userData.muzzle || new THREE.Vector3(0, 0.02, -0.6)).applyMatrix4(model.matrix);
    }
  }

  setWorld(world) {
    this.world = world;
    this.buildVisuals(world);
  }

  buildVisuals(world) {
    const g = this.worldGroup;
    this.barrelMeshes.clear();
    while (g.children.length) {
      const child = g.children.pop();
      child.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      g.remove(child);
    }
    const mats = {};
    const flatMat = color => mats[color] ||= flat(PALETTE[color] || color);

    const skyColor = world.sky || SKY;
    this.renderer.setClearColor(skyColor);
    this.scene.fog.color.set(world.fog || skyColor);

    if (world.gltf) {
      world.gltf.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      g.add(world.gltf);

      // Barrels for GLTF maps
      if (world.barrels) {
        for (const b of world.barrels) {
          const r = b.r || 0.42, bh = b.h || 1.1;
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bh, 10), flatMat(b.color || 'barrelRust'));
          barrel.position.set(b.x, (b.y || 0) + bh / 2, b.z);
          barrel.castShadow = true; barrel.receiveShadow = true;
          if (b.id) this.barrelMeshes.set(b.id, barrel);
          g.add(barrel);
        }
      }

      // Jump pad launch platforms
      if (world.jumpPads && world.jumpPads.length) {
        for (const jp of world.jumpPads) {
          const [minX, minY, minZ, maxX, maxY, maxZ] = jp.box;
          const w = Math.max(1.4, maxX - minX), d = Math.max(1.4, maxZ - minZ);
          const padMesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, 0.14, d),
            new THREE.MeshStandardMaterial({
              color: '#0284c7',
              emissive: '#38bdf8',
              emissiveIntensity: 0.8,
              roughness: 0.3,
              metalness: 0.8
            })
          );
          padMesh.position.set((minX + maxX) / 2, minY + 0.07, (minZ + maxZ) / 2);
          padMesh.receiveShadow = true;
          g.add(padMesh);
        }
      }
    } else {
      for (const v of world.visuals) {
        if (v.type === 'tree') {
          const s = v.scale || 1, h = v.h || 6.5;
          const tg = new THREE.Group();
          tg.position.set(v.x, 0, v.z);
          // Trunk
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s, 0.36 * s, h * 0.45, 6), flatMat('bark'));
          trunk.position.y = (h * 0.45) / 2;
          trunk.castShadow = true; trunk.receiveShadow = true;
          tg.add(trunk);
          // 3-tiered low-poly foliage cones
          const colors = ['pine1', 'pine2', 'pine3'];
          for (let i = 0; i < 3; i++) {
            const coneH = (h * 0.48) * (1 - i * 0.15);
            const coneR = (1.9 * s) * (1 - i * 0.22);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 6), flatMat(colors[i]));
            cone.position.y = (h * 0.32) + i * (coneH * 0.58);
            cone.castShadow = true; cone.receiveShadow = true;
            tg.add(cone);
          }
          g.add(tg);
        } else if (v.type === 'bareTree') {
          const s = v.scale || 1, h = v.h || 5.2;
          const tg = new THREE.Group();
          tg.position.set(v.x, 0, v.z);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.28 * s, h, 6), flatMat('burntWood'));
          trunk.position.y = h / 2;
          trunk.castShadow = true; trunk.receiveShadow = true;
          tg.add(trunk);
          const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 2.2 * s, 5), flatMat('burntWood'));
          b1.position.set(0.6 * s, h * 0.72, 0.2 * s);
          b1.rotation.set(0.3, 0.2, 0.85);
          b1.castShadow = true;
          const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.8 * s, 5), flatMat('burntWood'));
          b2.position.set(-0.5 * s, h * 0.8, -0.4 * s);
          b2.rotation.set(-0.4, 0.5, -0.75);
          b2.castShadow = true;
          tg.add(b1, b2);
          g.add(tg);
        } else if (v.type === 'rock') {
          const s = v.scale || 1;
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flatMat(v.color || 'rockDark'));
          rock.position.set(v.x, v.y + s * 0.7, v.z);
          if (v.rx || v.ry || v.rz) rock.rotation.set(v.rx || 0, v.ry || 0, v.rz || 0);
          rock.scale.set(1.15, 0.85, 1.0);
          rock.castShadow = true; rock.receiveShadow = true;
          g.add(rock);
        } else if (v.type === 'barrel') {
          const r = v.r || 0.42, bh = v.h || 1.1;
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bh, 10), flatMat(v.color || 'barrelRust'));
          barrel.position.set(v.x, (v.y || 0) + bh / 2, v.z);
          barrel.castShadow = true; barrel.receiveShadow = true;
          if (v.id) this.barrelMeshes.set(v.id, barrel);
          g.add(barrel);
        } else if (v.type === 'slab') {
          const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(v.w, v.h || 0.25, v.d), flatMat(v.color || 'plasterDamaged'));
          slabMesh.position.set(v.x, v.y, v.z);
          if (v.rx || v.ry || v.rz) slabMesh.rotation.set(v.rx || 0, v.ry || 0, v.rz || 0);
          slabMesh.castShadow = true; slabMesh.receiveShadow = true;
          g.add(slabMesh);
        } else if (v.type === 'water') {
          const waterGeo = new THREE.PlaneGeometry(v.w, v.d, 12, 12);
          const waterMat = new THREE.MeshLambertMaterial({
            color: PALETTE.water || '#3d7ea6',
            transparent: true,
            opacity: 0.82,
          });
          const waterMesh = new THREE.Mesh(waterGeo, waterMat);
          waterMesh.rotation.x = -Math.PI / 2;
          waterMesh.position.set(v.x, v.y || -0.15, v.z);
          waterMesh.receiveShadow = true;
          g.add(waterMesh);
        } else if (v.type === 'antenna') {
          const ant = new THREE.Group();
          ant.position.set(v.x, 0, v.z);
          const th = v.h || 18;
          const mast = new THREE.Mesh(new THREE.ConeGeometry(1.6, th, 4), flatMat('antennaMetal'));
          mast.position.y = th / 2;
          mast.castShadow = true;
          const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 6), flatMat('antennaMetal'));
          spike.position.y = th + 2.25;
          spike.castShadow = true;
          ant.add(mast, spike);
          g.add(ant);
        } else {
          const min = v.min || [v.x - v.w / 2, v.y, v.z - v.d / 2];
          const max = v.max || [v.x + v.w / 2, v.y + v.h, v.z + v.d / 2];
          const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
          const box = new THREE.Mesh(new THREE.BoxGeometry(...size), flatMat(v.color || 'cover'));
          box.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
          box.castShadow = v.color !== 'floor' && v.color !== 'grass' && v.color !== 'dirt' && v.color !== 'moss';
          box.receiveShadow = true;
          g.add(box);
        }
      }
    }
  }

  resize() {
    const c = this.renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  avatar(id, name, slot, char, team = 'none') {
    let a = this.avatars.get(id);
    if (a && a.name === name && a.char === char && a.team === team) return a;
    if (a) this.removeAvatar(id);
    let color = PLAYER_COLORS[slot % PLAYER_COLORS.length];
    if (team === 'red') color = '#ef4444';
    else if (team === 'blue') color = '#3b82f6';
    const model = makeCharacter(this.assets, char, color);
    model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    model.add(nameTag(name, color));
    this.scene.add(model);
    const mixer = model.userData.mixer || null;
    const actions = model.userData.actions || null;
    a = { model, name, char, team, mixer, actions, curAction: null };
    if (actions?.idle) {
      actions.idle.play();
      a.curAction = 'idle';
    }
    this.avatars.set(id, a);
    return a;
  }
  removeAvatar(id) { const a = this.avatars.get(id); if (a) { this.scene.remove(a.model); this.avatars.delete(id); } }

  /* World-space muzzle position of the first-person weapon. */
  muzzle() { this.camera.updateMatrixWorld(true); return this.flash.getWorldPosition(new THREE.Vector3()); }

  shot(from, to, own, wepId = 'ak47') {
    const start = own ? this.muzzle() : new THREE.Vector3(...from);
    if (!own) start.y -= 0.35; // roughly the other player's gun, not their eye
    const geo = new THREE.BufferGeometry().setFromPoints([start, new THREE.Vector3(...to)]);
    const tracerColor = wepId === 'sniper' ? '#d0f8ff' : (wepId === 'shotgun' ? '#ffd066' : (wepId === 'smg' ? '#fffa80' : '#fff2b0'));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: tracerColor, transparent: true, opacity: 0.9 }));
    const sparkSize = wepId === 'sniper' ? 0.16 : (wepId === 'shotgun' ? 0.05 : 0.08);
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(sparkSize, 0), new THREE.MeshBasicMaterial({ color: tracerColor, transparent: true }));
    spark.position.fromArray(to);
    this.scene.add(line, spark);
    this.fx.push({ objs: [line, spark], life: 0.12, max: 0.12 });
    if (own) {
      this.flash.visible = true;
      this.flashLife = 0.05;
      const kickMap = { ak47: 1.0, shotgun: 1.6, sniper: 1.9, smg: 0.55, lmg: 1.3 };
      this.kick = kickMap[wepId] || 1;
    }
  }

  meleeSlash(isQuick = false) {
    this.slashTime = 0.26;
    this.isQuickMelee = isQuick;
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    const start = this.muzzle();
    const swingEnd = start.clone().add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(2.0));
    const arcGeo = new THREE.BufferGeometry().setFromPoints([start, swingEnd]);
    const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.9 }));
    this.scene.add(arcLine);
    this.fx.push({ objs: [arcLine], life: 0.08, max: 0.08 });
  }

  destroyBarrel(id, x, y, z) {
    const bar = this.barrelMeshes.get(id);
    if (bar) bar.visible = false;
    for (let i = 0; i < 8; i++) {
      const chunk = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.22, 0.08),
        new THREE.MeshLambertMaterial({ color: '#683c27' })
      );
      chunk.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4);
      this.scene.add(chunk);
      this.fx.push({
        objs: [chunk],
        vel: [
          (Math.random() - 0.5) * 9,
          Math.random() * 6 + 3,
          (Math.random() - 0.5) * 9,
        ],
        rot: [(Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12],
        life: 0.85,
        max: 0.85,
      });
    }
  }

  spawnGrenade(id, x, y, z, vx, vy, vz) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8),
      new THREE.MeshLambertMaterial({ color: '#4d5c3b' })
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6),
      new THREE.MeshLambertMaterial({ color: '#8c8c8c' })
    );
    cap.position.y = 0.14;
    group.add(body, cap);
    group.position.set(x, y, z);
    this.scene.add(group);

    this.grenadeObjs.set(id, {
      mesh: group,
      x, y, z,
      vx, vy, vz,
      rx: (Math.random() - 0.5) * 14,
      ry: (Math.random() - 0.5) * 14,
      rz: (Math.random() - 0.5) * 14,
      life: 3.5,
    });
  }

  explode(x, y, z, r, kind = 'grenade') {
    for (const [id, g] of this.grenadeObjs) {
      if (Math.hypot(g.x - x, g.y - y, g.z - z) < 2.0) {
        this.scene.remove(g.mesh);
        this.grenadeObjs.delete(id);
      }
    }

    const fbGeo = new THREE.SphereGeometry(1, 10, 8);
    const fbMat = new THREE.MeshBasicMaterial({
      color: kind === 'barrel' ? '#ff5722' : '#ff9800',
      transparent: true,
      opacity: 0.95,
    });
    const fb = new THREE.Mesh(fbGeo, fbMat);
    fb.position.set(x, y, z);
    this.scene.add(fb);

    const ringGeo = new THREE.RingGeometry(0.5, 0.85, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#ffdd77',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.08, z);
    this.scene.add(ring);

    const sparks = [];
    const count = kind === 'barrel' ? 16 : 12;
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.1, 0),
        new THREE.MeshBasicMaterial({ color: Math.random() > 0.4 ? '#ff6f00' : '#444444', transparent: true, opacity: 0.9 })
      );
      sp.position.set(x, y, z);
      this.scene.add(sp);
      sparks.push({
        mesh: sp,
        vx: (Math.random() - 0.5) * 16,
        vy: Math.random() * 12 + 2,
        vz: (Math.random() - 0.5) * 16,
      });
    }

    this.fx.push({
      type: 'explosion',
      fb, ring, sparks,
      r: r || 6,
      life: 0.55, max: 0.55,
    });
  }

  /* me: predicted local player; others: [{id,name,slot,char,x,y,z,yaw,alive}] */
  render(dt, me, others, look, isAiming = false, audio = null, currentW = 0) {
    const cam = this.camera;
    const curW = typeof currentW === 'number' ? currentW : (me.w || 0);
    this.setWeaponModel(curW);
    const wep = WEAPONS[curW] || WEAPONS[0];

    // Landing punch and sound detection
    if (me.g && !this.wasGrounded) {
      this.landPunch = 0.08;
      const surf = this.world.getSurface ? this.world.getSurface(me.x, me.y, me.z) : 'concrete';
      audio?.land?.(0.35, surf);
    }
    this.wasGrounded = me.g;
    this.landPunch = Math.max(0, (this.landPunch || 0) - dt * 5);

    // Smooth crouch eye-height transition
    const targetEye = me.alive ? (me.cr ? EYE_CROUCH : EYE_STAND) : 0.4;
    this.curEye = THREE.MathUtils.lerp(this.curEye ?? targetEye, targetEye, Math.min(1, dt * 14));

    cam.position.set(me.x, me.y + this.curEye - this.landPunch * 0.7, me.z);
    cam.rotation.set(look.pitch, look.yaw, me.alive ? 0 : 0.5);
    this.weapon.visible = me.alive;

    // Smooth ADS interpolation & dynamic FOV
    this.ads = THREE.MathUtils.lerp(this.ads || 0, isAiming && me.alive ? 1 : 0, Math.min(1, dt * 16));
    const targetFov = 75 - this.ads * (75 - wep.fov);
    if (Math.abs(cam.fov - targetFov) > 0.02) { cam.fov = targetFov; cam.updateProjectionMatrix(); }

    // Weapon bob and recoil
    const speed = Math.hypot(me.vx, me.vz);
    this.bob += dt * (me.g ? speed * 1.6 : 0);
    this.kick = Math.max(0, this.kick - dt * 9);

    // Local player footstep audio
    if (me.alive && me.g && speed > 0.8) {
      const stepIdx = Math.floor(this.bob / Math.PI);
      if (stepIdx !== this.lastStepIdx) {
        this.lastStepIdx = stepIdx;
        const surf = this.world.getSurface ? this.world.getSurface(me.x, me.y, me.z) : 'concrete';
        audio?.step?.(0.2, 0, surf);
      }
    }

    const bobDamp = 1 - this.ads * 0.85;
    const bobX = Math.sin(this.bob) * 0.012 * Math.min(1, speed / 6) * bobDamp;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.01 * Math.min(1, speed / 6) * bobDamp;

    // Hipfire vs ADS position
    const wx = THREE.MathUtils.lerp(0.2, 0, this.ads) + bobX;
    const wy = THREE.MathUtils.lerp(-0.2, wep.id === 'sniper' ? -0.19 : -0.155, this.ads) + bobY;
    const wz = THREE.MathUtils.lerp(-0.38, wep.id === 'sniper' ? -0.22 : -0.28, this.ads) + this.kick * (0.06 - this.ads * 0.02);

    // Procedural reload animation
    let reloadY = 0, reloadPitch = 0, reloadRoll = 0;
    if (me.rl > 0) {
      const rlMax = wep.reloadTicks || 70;
      const p = 1 - (me.rl / rlMax); // 0 at start, 1 at end
      const dip = Math.sin(p * Math.PI);
      reloadY = -dip * 0.16;
      reloadPitch = dip * 0.35;
      reloadRoll = Math.sin(p * Math.PI * 2) * 0.14;
    }

    // Melee Slash Animation
    let meleeOffsetX = 0, meleeOffsetY = 0, meleeOffsetZ = 0;
    let meleeRotX = 0, meleeRotY = 0, meleeRotZ = 0;
    if (this.slashTime > 0) {
      this.slashTime = Math.max(0, this.slashTime - dt);
      const progress = 1 - (this.slashTime / 0.26);
      const swing = Math.sin(progress * Math.PI);
      meleeOffsetX = -swing * 0.25;
      meleeOffsetY = swing * 0.14;
      meleeOffsetZ = -swing * 0.28;
      meleeRotX = -swing * 0.75;
      meleeRotY = swing * 1.35;
      meleeRotZ = swing * 0.85;
    }

    this.weapon.position.set(wx + meleeOffsetX, wy + reloadY + meleeOffsetY, wz + meleeOffsetZ);
    this.weapon.rotation.set(this.kick * 0.12 + reloadPitch + meleeRotX, meleeRotY, reloadRoll + meleeRotZ);
    if (this.flashLife > 0 && (this.flashLife -= dt) <= 0) this.flash.visible = false;

    // Remote avatars with skeletal animations (or procedural fallback) & positional footsteps
    const seen = new Set();
    for (const o of others) {
      seen.add(o.id);
      const a = this.avatar(o.id, o.name, o.slot, o.char, o.team);
      a.model.visible = o.alive;

      if (o.alive) {
        const dx = o.x - (a.lastX ?? o.x), dz = o.z - (a.lastZ ?? o.z);
        const v = Math.hypot(dx, dz) / Math.max(0.001, dt);
        a.lastX = o.x; a.lastZ = o.z;

        const moving = v > 0.3;
        a.stride = (a.stride || 0) + dt * Math.min(18, v * (o.cr ? 1.6 : 2.4));

        if (a.mixer && a.actions) {
          let target = 'idle';
          if (o.cr) {
            target = moving ? (a.actions.walk ? 'walk' : 'crouch') : 'crouch';
          } else if (moving) {
            target = (v > 4.2 && a.actions.run) ? 'run' : (a.actions.walk ? 'walk' : 'run');
          }

          if (a.curAction !== target && a.actions[target]) {
            const prev = a.actions[a.curAction];
            const next = a.actions[target];
            if (prev) prev.fadeOut(0.18);
            next.reset().fadeIn(0.18).play();
            a.curAction = target;
          }
          a.mixer.update(dt);
          a.model.scale.set(1, 1, 1);
          a.model.position.set(o.x, o.y, o.z);
          a.model.rotation.set(0, o.yaw, 0);
        } else {
          // Procedural bounce / tilt for unrigged avatars (e.g. Robot fallback)
          const bounce = moving ? Math.abs(Math.sin(a.stride)) * (o.cr ? 0.03 : 0.06) : 0;
          const tiltZ = moving ? Math.sin(a.stride) * 0.05 : 0;
          const tiltX = moving ? Math.min(0.12, v * 0.018) : 0;

          // Visual crouch scaling
          const targetScaleY = o.cr ? 0.68 : 1.0;
          a.scaleY = THREE.MathUtils.lerp(a.scaleY ?? 1, targetScaleY, Math.min(1, dt * 14));
          a.model.scale.set(1, a.scaleY, 1);

          a.model.position.set(o.x, o.y + bounce, o.z);
          a.model.rotation.set(tiltX, o.yaw, tiltZ);
        }

        if (moving) {
          const stepIdx = Math.floor(a.stride / Math.PI);
          if (stepIdx !== a.lastStepIdx) {
            a.lastStepIdx = stepIdx;
            const dist = Math.hypot(o.x - me.x, o.z - me.z);
            if (dist < 35 && audio) {
              const pan = audio.panFor(me.x, me.z, look.yaw, o.x, o.z);
              const surf = this.world.getSurface ? this.world.getSurface(o.x, o.y, o.z) : 'concrete';
              audio.step(Math.max(0.04, (1 - dist / 35) * (o.cr ? 0.16 : 0.28)), pan, surf);
            }
          }
        }
      } else {
        if (a.mixer && a.actions?.die) {
          if (a.curAction !== 'die') {
            const prev = a.actions[a.curAction];
            if (prev) prev.fadeOut(0.12);
            a.actions.die.reset().fadeIn(0.12).setLoop(THREE.LoopOnce, 1);
            a.actions.die.clampWhenFinished = true;
            a.actions.die.play();
            a.curAction = 'die';
          }
          a.mixer.update(dt);
          a.model.position.set(o.x, o.y, o.z);
          a.model.rotation.set(0, o.yaw, 0);
        } else {
          a.model.scale.set(1, 1, 1);
          a.model.position.set(o.x, o.y, o.z);
          a.model.rotation.set(0, o.yaw, 0);
        }
      }
    }
    for (const id of this.avatars.keys()) if (!seen.has(id)) this.removeAvatar(id);

    // Step active grenades in view
    for (const [id, g] of this.grenadeObjs) {
      g.vy -= 18 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      for (const b of this.world.boxes) {
        if (g.x > b[0] - 0.12 && g.x < b[3] + 0.12 && g.y > b[1] - 0.12 && g.y < b[4] + 0.12 && g.z > b[2] - 0.12 && g.z < b[5] + 0.12) {
          g.vy = Math.abs(g.vy) * 0.45;
          g.vx *= 0.65;
          g.vz *= 0.65;
          g.y = b[4] + 0.12;
        }
      }
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += g.rx * dt;
      g.mesh.rotation.y += g.ry * dt;
      g.mesh.rotation.z += g.rz * dt;
      g.life -= dt;
      if (g.life <= 0) {
        this.scene.remove(g.mesh);
        this.grenadeObjs.delete(id);
      }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.type === 'explosion') {
        const progress = 1 - Math.max(0, f.life / f.max);
        const curScale = (f.r * 0.7) * Math.sin(progress * Math.PI);
        f.fb.scale.setScalar(Math.max(0.01, curScale));
        f.fb.material.opacity = (1 - progress) * 0.95;

        const ringScale = 1 + progress * (f.r * 1.1);
        f.ring.scale.set(ringScale, ringScale, 1);
        f.ring.material.opacity = (1 - progress) * 0.75;

        for (const sp of f.sparks) {
          sp.vy -= 22 * dt;
          sp.mesh.position.x += sp.vx * dt;
          sp.mesh.position.y += sp.vy * dt;
          sp.mesh.position.z += sp.vz * dt;
          sp.mesh.material.opacity = (1 - progress) * 0.9;
        }
        if (f.life <= 0) {
          this.scene.remove(f.fb, f.ring);
          f.fb.geometry.dispose(); f.fb.material.dispose();
          f.ring.geometry.dispose(); f.ring.material.dispose();
          for (const sp of f.sparks) {
            this.scene.remove(sp.mesh);
            sp.mesh.geometry.dispose(); sp.mesh.material.dispose();
          }
          this.fx.splice(i, 1);
        }
      } else if (f.vel) {
        f.vel[1] -= 22 * dt;
        f.objs[0].position.x += f.vel[0] * dt;
        f.objs[0].position.y += f.vel[1] * dt;
        f.objs[0].position.z += f.vel[2] * dt;
        if (f.rot) {
          f.objs[0].rotation.x += f.rot[0] * dt;
          f.objs[0].rotation.y += f.rot[1] * dt;
        }
        f.objs[0].material.opacity = Math.max(0, f.life / f.max);
        if (f.life <= 0) {
          for (const o of f.objs) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
          this.fx.splice(i, 1);
        }
      } else {
        for (const o of f.objs) o.material.opacity = Math.max(0, f.life / f.max);
        if (f.life <= 0) { for (const o of f.objs) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } this.fx.splice(i, 1); }
      }
    }
    const r = this.renderer;
    cam.layers.set(0); r.render(this.scene, cam);
    r.autoClear = false; r.clearDepth();
    cam.layers.set(1); r.render(this.scene, cam);
    r.autoClear = true;
  }
}
