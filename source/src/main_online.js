/* Spectre Orbit Online — Main Client Entry Point
   Powered by Babylon.js 9 (WebGPU / WebGL 2) and Internet WebRTC Matchmaking. */

import { OnlineSignalingClient, OnlineNetHost, OnlineNetGuest, LinkError } from './net_online.js';
import { HostSession, GuestSession } from './game.js';
import { View, CharacterPreview, HeroViewer, loadAssets, buildWorld } from './render_babylon.js';
import { Hud, Sound } from './hud.js';
import { B } from './sim.js';
import { HERO_ROSTER, getHeroData, SKIN_OF, baseHeroId } from './heroes.js';
import { GRAPHICS_PRESETS } from './babylon/materials.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem('lanfps.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lanfps.' + k, v); } catch {} },
};

function randomHex(n = 8) {
  let s = '';
  while (s.length < n) s += Math.random().toString(16).slice(2);
  return s.slice(0, n);
}

function cleanName(s, max = 20, fallback = 'Operative') {
  const c = (s || '').replace(/[^\w\s\-\.\#]/gi, '').trim().slice(0, max);
  return c || fallback;
}

const myId = randomHex(8);
let signaling = null, session = null, view = null, world = null, assets = null;
const hud = new Hud(), sound = new Sound();

// Graphics preset state
let currentPreset = store.get('graphicsPreset', 'high');

function determineServerUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('server')) return params.get('server');
  const saved = store.get('serverUrl', '');
  if (saved) return saved;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return host ? `${proto}//${host}` : 'ws://localhost:8080';
}

let serverUrl = determineServerUrl();

function updateServerStatus(status, isOk = false) {
  const lamp = $('lamp-network');
  const label = $('server-status-label');
  if (lamp) {
    lamp.className = 'status-lamp ' + (isOk ? 'lamp-active' : 'lamp-warn');
  }
  if (label) label.textContent = status;
}

function updateBackendBadge(backend) {
  const badge = $('backend-badge');
  if (badge) {
    badge.textContent = `BABYLON 9 · ${backend.toUpperCase()}`;
    badge.title = `Active rendering pipeline: ${backend}`;
  }
}

function playerName() {
  return cleanName($('name')?.value, 18, 'Operative');
}

/* ---- Operative Briefing & Turntable ---- */
let lobbyPortrait = null;
let heroViewer = null;

function equipHero(heroId) {
  const hero = getHeroData(heroId);
  store.set('equippedHero', hero.id);
  const nameEl = $('hero-equipped-name');
  const roleEl = $('hero-equipped-role');
  const badgeEl = $('hero-equipped-badge');
  if (nameEl) nameEl.textContent = (hero.name || hero.id || 'OPERATIVE').toUpperCase();
  if (roleEl) roleEl.textContent = (hero.classType || hero.title || hero.role || 'OPERATIVE').toUpperCase();
  if (badgeEl) badgeEl.textContent = hero.badge || '★';

  if (lobbyPortrait && assets) {
    lobbyPortrait.show(hero.id);
    lobbyPortrait.start();
  }
}

function openHeroRoster(selectedHeroId = 'abdulkarim') {
  const screen = $('roster-screen');
  if (!screen) return;
  screen.hidden = false;

  if (!heroViewer && assets) {
    heroViewer = new HeroViewer($('roster-canvas'), assets);
  }
  heroViewer?.loadHero(selectedHeroId);
}

function closeHeroRoster() {
  const screen = $('roster-screen');
  if (screen) screen.hidden = true;
}

/* ---- Message Banners ---- */
function showBanner(text, type = 'info') {
  const b = $('match-status-banner');
  if (!b) return;
  if (!text) {
    b.hidden = true;
    b.textContent = '';
    return;
  }
  b.hidden = false;
  b.className = `status-banner banner-${type}`;
  b.textContent = text;
}

/* ---- Game Viewport Setup ---- */
async function prepareView(w = world) {
  if (!view) {
    view = new View($('view'), w, assets, { preset: currentPreset });
    await view.initPromise;
    updateBackendBadge(view.backend || 'WebGL 2');
  } else {
    await view.setWorld(w);
  }
  return view;
}

function showGame(on) {
  $('lobby').hidden = on;
  $('game').hidden = !on;
  if (on) {
    view?.resize();
    requestAnimationFrame(frame);
  }
}

/* ---- Match Hosting & Joining ---- */
async function hostOnlineMatch() {
  if (session || !assets) return;
  const roomName = cleanName($('room-name')?.value, 32, playerName() + "'s Arena");
  const map = $('map-select')?.value || 'foundry';
  const mode = $('mode-select')?.value || 'ffa';
  const maxPlayers = parseInt($('max-players-select')?.value || '6', 10);
  const isPrivate = $('is-private-checkbox')?.checked || false;
  const seed = map === 'sandbox' ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const char = store.get('equippedHero', 'abdulkarim');

  showBanner('Creating match on online server...', 'info');
  try {
    world = buildWorld(assets, map, seed);
    await prepareView(world);

    session = new HostSession({
      signaling,
      NetHostClass: OnlineNetHost,
      world,
      id: myId,
      name: playerName(),
      char,
      roomName,
      map,
      seed,
      mode,
      view,
      hud,
      audio: sound,
      onExit: leaveMatch,
    });

    const code = await session.start();
    hud.session = session;
    showBanner('');
    showGame(true);

    const shareUrl = `${window.location.origin}${window.location.pathname}?join=${code}`;
    console.log(`[Spectre Orbit] Match hosted. Code: ${code} Share: ${shareUrl}`);
  } catch (e) {
    session = null;
    console.error('Host error:', e);
    showBanner('Could not create room: ' + e.message, 'error');
  }
}

async function joinOnlineMatch(code) {
  if (session || !assets) return;
  const char = store.get('equippedHero', 'abdulkarim');
  const cleanCode = (code || '').trim().toUpperCase();

  if (!cleanCode) {
    showBanner('Please enter a 5-character match code', 'error');
    return;
  }

  showBanner(`Connecting to match [${cleanCode}]...`, 'info');
  try {
    const s = session = new GuestSession({
      signaling,
      NetGuestClass: OnlineNetGuest,
      world: buildWorld(assets, 'foundry', 0),
      id: myId,
      name: playerName(),
      char,
      view,
      hud,
      audio: sound,
      onExit: msg => leaveMatch(msg),
    });

    await s.join({ code: cleanCode }, statusText => showBanner(statusText, 'info'));

    // Rebuild view with host's actual map
    world = buildWorld(assets, s.map, s.seed);
    await prepareView(world);
    s.client.world = world;

    showBanner('');
    hud.session = s;
    showGame(true);
  } catch (e) {
    session = null;
    console.error('Join error:', e);
    showBanner(e instanceof LinkError ? e.message : 'Could not join match: ' + e.message, 'error');
  }
}

async function quickMatch() {
  if (!signaling) return;
  showBanner('Finding best available public match...', 'info');
  signaling.send({ t: 'list_rooms' });

  const unList = signaling.on('room_list', async msg => {
    unList();
    const rooms = (msg.rooms || []).filter(r => r.players < r.max);
    if (rooms.length > 0) {
      // Pick room with highest player count that isn't full
      rooms.sort((a, b) => b.players - a.players);
      await joinOnlineMatch(rooms[0].code);
    } else {
      // No open rooms: automatically host a public match!
      showBanner('No public matches found. Creating a new match...', 'info');
      await hostOnlineMatch();
    }
  });
}

async function leaveMatch(reason) {
  const s = session;
  if (!s) return;
  session = null;
  hud.session = null;
  if (document.pointerLockElement) document.exitPointerLock();

  try { await s.stop(); } catch {}
  showGame(false);
  showBanner(typeof reason === 'string' ? reason : '', typeof reason === 'string' ? 'error' : '');
  refreshRoomList();
}

function refreshRoomList() {
  if (signaling && signaling.connected) {
    signaling.send({ t: 'list_rooms' });
  }
}

function renderRoomList(rooms = []) {
  const container = $('room-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (rooms.length === 0) {
    container.innerHTML = '<div class="no-rooms-msg">No active public rooms found. Create one or click Quick Match!</div>';
    return;
  }

  for (const r of rooms) {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
      <div class="room-info">
        <div class="room-title">${r.name}</div>
        <div class="room-sub">${r.map.toUpperCase()} · ${r.mode.toUpperCase()} · Host: ${r.host}</div>
      </div>
      <div class="room-capacity">${r.players}/${r.max} PLAYERS</div>
      <button class="btn btn-join-room" data-code="${r.code}">JOIN</button>
    `;
    card.querySelector('.btn-join-room').onclick = () => joinOnlineMatch(r.code);
    container.appendChild(card);
  }
}

/* ---- In-game Frame Loop ---- */
let lastFrame = 0;
function frame(t) {
  if (!session) return;
  const dt = Math.min(0.1, (t - (lastFrame || t)) / 1000);
  lastFrame = t;
  session.client.frame(dt);
  requestAnimationFrame(frame);
}

/* ---- Input Controls & Keybindings ---- */
const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  melee: ['KeyV', 'KeyF'],
  grenade: ['KeyG'],
  reload: ['KeyR'],
  quickSwitch: ['KeyQ'],
  wep1: ['Digit1'],
  wep2: ['Digit2'],
  wep3: ['Digit3'],
  wep4: ['Digit4'],
  wep5: ['Digit5'],
  wep6: ['Digit6'],
};

const settings = {
  sens: Number(store.get('sens', '22')),
  adsSens: Number(store.get('adsSens', '80')),
  invertY: store.get('invertY', 'false') === 'true',
};

function setupInputHandlers() {
  const canvas = $('view');

  canvas.onclick = () => {
    if (session && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  };

  document.addEventListener('pointerlockchange', () => {
    const active = document.pointerLockElement === canvas;
    if (session) session.client.active = active;
    const overlay = $('pause-overlay');
    if (overlay) overlay.hidden = active || !session;
  });

  window.addEventListener('mousemove', e => {
    if (!session || document.pointerLockElement !== canvas) return;
    const sensFactor = 0.0022 * (settings.sens / 20) * (session.client.aiming ? (settings.adsSens / 100) : 1.0);
    session.client.look.yaw -= e.movementX * sensFactor;
    const dy = e.movementY * sensFactor * (settings.invertY ? -1 : 1);
    session.client.look.pitch = Math.max(-1.55, Math.min(1.55, session.client.look.pitch - dy));
  });

  window.addEventListener('mousedown', e => {
    if (!session || document.pointerLockElement !== canvas) return;
    if (e.button === 0) session.client.input.b |= B.FIRE;
    if (e.button === 2) session.client.aiming = true;
  });

  window.addEventListener('mouseup', e => {
    if (!session) return;
    if (e.button === 0) session.client.input.b &= ~B.FIRE;
    if (e.button === 2) session.client.aiming = false;
  });

  window.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('wheel', e => {
    if (!session || document.pointerLockElement !== canvas) return;
    session.client.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  });

  window.addEventListener('keydown', e => {
    if (!session || document.pointerLockElement !== canvas) return;
    const code = e.code;
    if (code === 'KeyW') session.client.input.b |= B.FWD;
    if (code === 'KeyS') session.client.input.b |= B.BACK;
    if (code === 'KeyA') session.client.input.b |= B.LEFT;
    if (code === 'KeyD') session.client.input.b |= B.RIGHT;
    if (code === 'Space') session.client.input.b |= B.JUMP;
    if (code === 'KeyC' || code === 'ControlLeft') session.client.input.b |= B.CROUCH;
    if (code === 'KeyR') session.client.input.reload = true;
    if (code === 'KeyV' || code === 'KeyF') session.client.input.melee = true;
    if (code === 'KeyG') session.client.input.grenade = true;

    if (code.startsWith('Digit')) {
      const num = parseInt(code.slice(5), 10) - 1;
      if (num >= 0 && num <= 5) session.client.setWeapon(num);
    }
  });

  window.addEventListener('keyup', e => {
    if (!session) return;
    const code = e.code;
    if (code === 'KeyW') session.client.input.b &= ~B.FWD;
    if (code === 'KeyS') session.client.input.b &= ~B.BACK;
    if (code === 'KeyA') session.client.input.b &= ~B.LEFT;
    if (code === 'KeyD') session.client.input.b &= ~B.RIGHT;
    if (code === 'Space') session.client.input.b &= ~B.JUMP;
    if (code === 'KeyC' || code === 'ControlLeft') session.client.input.b &= ~B.CROUCH;
  });
}

/* ---- Graphics Settings Modal ---- */
function setupGraphicsModal() {
  const modal = $('graphics-modal');
  const btnOpen = $('btn-open-graphics');
  const btnClose = $('btn-close-graphics');
  const presetSelect = $('preset-select');

  if (btnOpen) btnOpen.onclick = () => { if (modal) modal.hidden = false; };
  if (btnClose) btnClose.onclick = () => { if (modal) modal.hidden = true; };

  if (presetSelect) {
    presetSelect.value = currentPreset;
    presetSelect.onchange = () => {
      currentPreset = presetSelect.value;
      store.set('graphicsPreset', currentPreset);
      view?.applyGraphicsSettings(currentPreset);
    };
  }
}

/* ---- Client Bootstrap ---- */
async function bootstrap() {
  updateServerStatus('Connecting to matchmaking server...', false);
  setupInputHandlers();
  setupGraphicsModal();

  // Load 3D assets (characters, maps, configs)
  assets = await loadAssets();

  // Initialize lobby operative preview
  const savedHero = store.get('equippedHero', 'abdulkarim');
  lobbyPortrait = new CharacterPreview($('lobby-portrait'), assets);
  equipHero(savedHero);

  // Button bindings
  $('btn-quick-match')?.addEventListener('click', quickMatch);
  $('btn-host-match')?.addEventListener('click', hostOnlineMatch);
  $('btn-refresh-rooms')?.addEventListener('click', refreshRoomList);
  $('btn-join-code')?.addEventListener('click', () => {
    const code = $('input-join-code')?.value;
    if (code) joinOnlineMatch(code);
  });
  $('btn-roster-close')?.addEventListener('click', closeHeroRoster);
  $('btn-lobby-roster')?.addEventListener('click', () => openHeroRoster(store.get('equippedHero', 'abdulkarim')));

  // Connect WebSocket to matchmaking server
  signaling = new OnlineSignalingClient(serverUrl);

  signaling.on('status', text => updateServerStatus(text, true));
  signaling.on('room_list', msg => renderRoomList(msg.rooms || []));
  signaling.on('close', () => updateServerStatus('Disconnected from server. Reconnecting...', false));
  signaling.on('error', err => updateServerStatus('Server error: ' + (err.message || 'unreachable'), false));

  try {
    await signaling.connect();
    updateServerStatus('Online · Connected to Matchmaking', true);
    refreshRoomList();
    setInterval(refreshRoomList, 8000);
  } catch (err) {
    updateServerStatus('Offline · Matchmaking server unreachable', false);
    console.warn('[Spectre Orbit] Matchmaking connect failed:', err);
  }

  // Auto-join if URL parameter ?join=CODE is provided
  const urlParams = new URLSearchParams(window.location.search);
  const autoJoinCode = urlParams.get('join') || window.location.hash.replace('#join=', '');
  if (autoJoinCode && autoJoinCode.length === 5) {
    setTimeout(() => joinOnlineMatch(autoJoinCode), 500);
  }
}

// Global debug and test automation handle
window.LANFPS_ONLINE = {
  get session() { return session; },
  get view() { return view; },
  get assets() { return assets; },
  get signaling() { return signaling; },
  hostOnlineMatch,
  joinOnlineMatch,
  quickMatch,
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
