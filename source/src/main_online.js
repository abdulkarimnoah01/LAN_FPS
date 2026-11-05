/* Spectre Orbit Online — Main Client Entry Point
   Babylon.js 9 (WebGPU / WebGL 2) Engine with Netrunner Command Hub & 3D Operative Turntable */

import { initUpdater } from './updater.js';
import { attachMicroSandbox } from './micro_sandbox.js';
import { FolderSignalingClient, pickFolder, rememberedFolder, forgetFolderHandle } from './net_folder.js';
import { OnlineSignalingClient, OnlineNetHost, LocalNetHost, OnlineNetGuest, LinkError } from './net_online.js';
import { HostSession, GuestSession } from './game.js';
import { View, CharacterPreview, HeroViewer, loadAssets, buildWorld } from './render_babylon.js';
import { Sound } from './hud.js';
import { OnlineHud } from './hud_online.js';
import { publicModes, MODE_CATALOG, modeSupportsMap } from './modes.js';
import { PLANET_GENERATOR_VERSION } from './planet_map.js';
import { MICRO_MAP_ID, MICRO_GENERATOR_VERSION } from './micro_planet.js';
import { WEATHER_OPTIONS, WEATHER_LABELS, weatherAllowed } from './weather.js';
import { MapEditor, getActiveCustomMap, setActiveCustomMap } from './editor_online.js';
import { validateCustomMap, CUSTOM_MAP_ID } from './custom_map.js';
import { openMapPreview } from './babylon/editor_preview.js';
import { B } from './sim.js';
import { initPalette } from './palette.js';
import { HERO_ROSTER, getHeroData as legacyHeroData, SKIN_OF, baseHeroId } from './heroes.js';
import { CATALOG, loadAppearance, saveAppearance, normalizeAppearance, applyPreset, encodeLook, sameLook, DEFAULT_LOOK, PRESETS } from './appearance.js';
import { ngHeroData, NG_BODIES } from './ng_bodies.js';

/* Next Gen bodies describe themselves; legacy roster entries keep their dossiers. */
const getHeroData = (id, name) => ngHeroData(id) || legacyHeroData(id, name);

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
const hud = new OnlineHud(), sound = new Sound();

/* Public mode selector comes from the catalog, so only finished modes are offered. */
function populateModeSelect() {
  const sel = $('mode-select');
  if (!sel) return;
  const prev = sel.value;
  const map = $('map-select')?.value;
  if ($('map-select') && !$('map-select').dataset.modeSync) { $('map-select').dataset.modeSync = '1'; $('map-select').addEventListener('change', populateModeSelect); }
  const customModes = map === CUSTOM_MAP_ID ? (validateCustomMap(getActiveCustomMap()).modes || []) : null;
  sel.replaceChildren(...publicModes().filter(m => customModes ? customModes.includes(m.id) : (!map || modeSupportsMap(m.id, map))).map(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.name} (${m.short})`; o.title = m.brief; return o; }));
  if (MODE_CATALOG[prev]?.ready && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  const note = $('mode-brief');
  const sync = () => { if (note) note.textContent = MODE_CATALOG[sel.value]?.brief || ''; };
  sel.onchange = sync; sync();
  populateWeatherSelect();
}

/* Weather choice for the host; indoor/space maps have none. */
function populateWeatherSelect() {
  const sel = $('weather-select');
  if (!sel) return;
  const map = $('map-select')?.value, allowed = weatherAllowed(map);
  const prev = sel.value || store.get('weather', 'dynamic');
  sel.replaceChildren(...(allowed ? WEATHER_OPTIONS : ['off']).map(id => { const o = document.createElement('option'); o.value = id; o.textContent = id === 'off' && !allowed ? 'None (indoor arena)' : WEATHER_LABELS[id]; return o; }));
  sel.value = allowed && WEATHER_OPTIONS.includes(prev) ? prev : (allowed ? 'dynamic' : 'off');
  sel.disabled = !allowed;
  sel.onchange = () => store.set('weather', sel.value);
  if ($('weather-note')) $('weather-note').textContent = allowed ? 'Dynamic cycles sunny, cloudy, fog and rain every few minutes. Cosmetic only.' : 'This arena is indoors or in orbit, so it has no weather.';
}
const chosenWeather = map => (weatherAllowed(map) ? ($('weather-select')?.value || 'dynamic') : 'off');

/* ---- Map Briefings & Presentation Data ---- */
const MAPS = {
  custom: ['Custom Map', 'A map built in the Map Editor and sent to every player when they join.'],
  microverse: ['Microverse', 'The whole planet is the arena. Walk the globe, fight on every side, and use the curve: ring road, neon city, industrial ridge, forest belt, outpost and two spires.'],
  orbit: ['Orbit Crown', 'A seeded tiny-planet arena: a terraced crown district on top of a little world. Plaza, ring road, covered flanks and two team stations.'],
  foundry: ['Foundry Core', 'Molten industrial casting pit. Elevated catwalks. Fast CQB encounters.'],
  glowplant: ['Reactor Complex', 'Sub-orbital nuclear facility with pulsating blue plasma cores and dual jump pads.'],
  zenith: ['Zenith Atrium', 'High-altitude vertical multi-tier sky arena with velocity jump pads and vertigo sightlines.'],
  railyard: ['Hadota Rail Yard', 'A rail yard at dusk. A 150 m freight train down the middle, roof lanes, container canyons.'],
  school: ['Schoolyard', 'An Egyptian school courtyard in full sun. Two storeys of pointed arcades, a gallery ring, and a diesel locomotive.'],
  aftermath: ['Aftermath', 'Ruined streets. Tight corners. Urban combat.'],
  river: ['River Forest', 'A river valley divided by bridges and sightlines.'],
  forest: ['Pine Forest', 'Pine cover and open ground. Watch your flanks.'],
  sandbox: ['Random Sandbox', 'A fresh procedural battlefield for every room.'],
  arena: ['Classic Arena', 'Compact geometry. Fast encounters. Pure deathmatch.'],
};

const MAP_CATALOG = [
  { id: 'microverse', sector: '00', cqb: 'A true micro planet: radial gravity, a ring road around the globe, five districts, two spires on opposite poles. Walk all the way round, fight on the underside. Seeded per room.' },
  { id: 'orbit', sector: '0A', cqb: 'Planet arena. Central plaza with a beacon, a ring road loop, covered colonnades and team stations. A new layout seed for every room; the crown plays on flat ground (not walk-around gravity).' },
  { id: 'foundry', sector: '01', cqb: 'Molten industrial casting pit. Elevated catwalks. Fast CQB encounters.' },
  { id: 'glowplant', sector: '02', cqb: 'Sub-orbital nuclear facility with pulsating blue plasma cores and dual jump pads.' },
  { id: 'zenith', sector: '03', cqb: 'High-altitude vertical multi-tier sky arena with velocity jump pads and vertigo sightlines.' },
  { id: 'railyard', sector: '04', cqb: 'A rail yard at dusk. A 150 m freight train down the middle, roof lanes, container canyons.' },
  { id: 'school', sector: '05', cqb: 'An Egyptian school courtyard in full sun. Two storeys of pointed arcades, gallery ring and locomotive.' },
  { id: 'aftermath', sector: '06', cqb: 'Ruined city streets. Tight corners. Urban CQB combat.' },
  { id: 'river', sector: '07', cqb: 'A river valley divided by bridges and sightlines. Rapid crossings.' },
  { id: 'forest', sector: '08', cqb: 'Pine cover and open ground. Classic deathmatch terrain. Watch your flanks.' },
  { id: 'sandbox', sector: '09', cqb: 'A fresh procedural battlefield for every match. Dynamic geometry.' },
  { id: 'arena', sector: '10', cqb: 'Compact geometry. Fast encounters. Pure retro deathmatch arena.' },
];

function updateBriefing() {
  const mapSelect = $('map-select');
  const map = mapSelect?.value || 'foundry';
  const data = MAPS[map] || MAPS.foundry;

  if ($('map-title')) $('map-title').textContent = data[0];
  if ($('map-description')) $('map-description').textContent = data[1];

  const sourcePreview = assets?.maps?.[map]?.preview || window.LANFPS_ASSETS?.maps?.[map]?.preview;
  const thumb = $('map-thumbnail');
  if (thumb) {
    thumb.style.backgroundImage = sourcePreview ? `url("${sourcePreview}")` : '';
    const keys = Object.keys(MAPS);
    const idx = keys.indexOf(map);
    thumb.dataset.sector = `${String(idx >= 0 ? idx + 1 : 1).padStart(2, '0')} / 10`;
    thumb.setAttribute('aria-label', `${data[0]}: battlefield preview`);
  }

  const mode = $('mode-select')?.value || 'ffa';
  if ($('match-rules')) {
    $('match-rules').innerHTML = `<b>${mode === 'tdm' ? 25 : 10}</b> kills to win <span> / </span> 2–12 players`;
  }
}

/* ---- CRT Screen Simulation Filter ---- */
function setCrtEnabled(enabled) {
  const on = !!enabled;
  document.documentElement.classList.toggle('crt-enabled', on);
  if ($('btn-crt-toggle')) {
    $('btn-crt-toggle').textContent = on ? 'CRT: ON' : 'CRT: OFF';
    $('btn-crt-toggle').setAttribute('aria-pressed', String(on));
  }
  if ($('opt-crt')) $('opt-crt').checked = on;
  store.set('crtfx', String(on));
}

/* ---- Toast Notifications ---- */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

/* ---- View Router ---- */
const PAGE_NAMES = {
  play: 'DEPLOY',
  operative: 'OPERATIVE',
  loadout: 'LOADOUT',
  maps: 'BATTLEFIELDS',
  editor: 'MAP EDITOR',
  settings: 'SETTINGS',
};

/* ---- Map editor & custom maps ---- */
let mapEditor = null;
function openEditor() {
  if (!mapEditor && $('editor-root')) {
    mapEditor = new MapEditor($('editor-root'), {
      toast,
      createPreview: world => openMapPreview(world),
      onPlay: () => { refreshCustomMapOption(); const sel = $('map-select'); sel.value = CUSTOM_MAP_ID; populateModeSelect(); startPracticeMatch(); },
      onHost: () => { refreshCustomMapOption(); go('play'); const sel = $('map-select'); sel.value = CUSTOM_MAP_ID; populateModeSelect(); openDrawer('host'); },
    });
  }
  requestAnimationFrame(() => mapEditor?.draw());
}

/* Keeps a "Custom" entry in the map picker for the editor's active map. */
function refreshCustomMapOption() {
  const sel = $('map-select');
  if (!sel) return;
  const m = getActiveCustomMap();
  let opt = sel.querySelector(`option[value="${CUSTOM_MAP_ID}"]`);
  if (!m) { opt?.remove(); return; }
  if (!opt) { opt = document.createElement('option'); opt.value = CUSTOM_MAP_ID; sel.prepend(opt); }
  opt.textContent = `Custom · ${m.name} (${m.size} m)`;
}

/* World for the host's chosen map; custom maps must pass validation first. */
function hostWorld(map, seed) {
  if (map !== CUSTOM_MAP_ID) return buildWorld(assets, map, seed);
  const v = validateCustomMap(getActiveCustomMap());
  if (!v.ok) throw new Error('Your custom map is not playable yet: ' + (v.errors[0] || 'open the Map Editor to fix it.'));
  return buildWorld(assets, CUSTOM_MAP_ID, 0, getActiveCustomMap());
}
let activePage = 'play';

function go(page) {
  if (!PAGE_NAMES[page]) return;
  activePage = page;
  closeDrawer();

  document.querySelectorAll('.view').forEach(p => {
    p.classList.toggle('active', p.id === 'page-' + page);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });

  if ($('breadcrumb')) $('breadcrumb').textContent = PAGE_NAMES[page];
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (page === 'operative') {
    openOperativeView();
  } else {
    heroViewer?.stop();
  }
  if (page === 'settings') {
    syncSettingsUI();
  }
  if (page === 'editor') openEditor();
  if (page === 'maps') {
    renderMapsCatalog();
  }
}

/* ---- Drawers System ---- */
let activeDrawer = null;
function openDrawer(type) {
  activeDrawer = type;
  const overlay = $('overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  const hostContent = $('drawer-content-host');
  const joinContent = $('drawer-content-join');
  const browserContent = $('drawer-content-browser');

  if (hostContent) hostContent.hidden = (type !== 'host');
  if (joinContent) joinContent.hidden = (type !== 'join');
  if (browserContent) browserContent.hidden = (type !== 'browser');

  const drawerConfig = {
    host: ['Host Match', '/ 02 ROOM SETUP', 'DEPLOYMENT CONFIGURATION', 'Deploy Match ↗'],
    join: ['Join Match', '/ 03 DIRECT CONNECTION', 'INVITE CODE REQUIRED', 'Join Room ↗'],
    browser: ['Room Browser', '/ 04 PUBLIC DIRECTORY', 'LIVE NETWORK DIRECTORY', 'Host a Room ↗'],
  };
  const c = drawerConfig[type] || drawerConfig.host;
  if ($('drawerTitle')) $('drawerTitle').textContent = c[0];
  if ($('drawerIndex')) $('drawerIndex').textContent = c[1];
  if ($('drawerFoot')) $('drawerFoot').textContent = c[2];
  if ($('drawerSubmit')) $('drawerSubmit').textContent = c[3];

  if (type === 'join') {
    setTimeout(() => $('input-join-code')?.focus(), 120);
  }
  if (type === 'browser') {
    renderDrawerRooms();
  }
}

function closeDrawer() {
  activeDrawer = null;
  const overlay = $('overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function submitDrawer() {
  if (activeDrawer === 'host') {
    closeDrawer();
    hostOnlineMatch();
  } else if (activeDrawer === 'join') {
    const code = $('input-join-code')?.value?.trim();
    if (!code) {
      toast('Enter an invitation code first.');
      $('input-join-code')?.focus();
      return;
    }
    closeDrawer();
    joinOnlineMatch(code);
  } else if (activeDrawer === 'browser') {
    openDrawer('host');
  }
}

/* ---- Battlefields Catalog ---- */
function renderMapsCatalog() {
  const grid = $('maps-catalog-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (const m of MAP_CATALOG) {
    const mapData = MAPS[m.id] || [m.id, m.cqb];
    const preview = assets?.maps?.[m.id]?.preview || window.LANFPS_ASSETS?.maps?.[m.id]?.preview;
    const card = document.createElement('div');
    card.className = 'map-card';
    card.innerHTML = `
      <div class="map-card-thumb" style="${preview ? `background-image:url('${preview}');` : ''}">
        <span class="sector-badge">SECTOR ${m.sector} / 10</span>
      </div>
      <div class="map-card-body">
        <h3>${mapData[0]}</h3>
        <p>${m.cqb}</p>
        <div class="map-card-footer">
          <span class="small-cap">${m.id === 'sandbox' ? 'PROCEDURAL' : 'TACTICAL'}</span>
          <button class="btn btn-primary small btn-host-this-map" type="button" data-map="${m.id}">Host on this map ↗</button>
        </div>
      </div>
    `;
    card.querySelector('.btn-host-this-map').onclick = () => {
      if ($('map-select')) $('map-select').value = m.id;
      updateBriefing();
      openDrawer('host');
    };
    grid.appendChild(card);
  }
}

/* ---- Keybindings & Input Mappings ---- */
const BIND_DEFS = [
  { id: 'forward', name: 'Move Forward', bit: B.FWD },
  { id: 'back', name: 'Move Backward', bit: B.BACK },
  { id: 'left', name: 'Move Left', bit: B.LEFT },
  { id: 'right', name: 'Move Right', bit: B.RIGHT },
  { id: 'jump', name: 'Jump', bit: B.JUMP },
  { id: 'crouch', name: 'Crouch', bit: B.CROUCH },
  { id: 'melee', name: 'Quick Melee / Knife', action: 'melee' },
  { id: 'grenade', name: 'Throw Grenade', action: 'grenade' },
  { id: 'reload', name: 'Reload', action: 'reload' },
  { id: 'quickSwitch', name: 'Quick Weapon Switch', action: 'quickSwitch' },
  { id: 'wep1', name: 'Weapon 1 (AK-47)', action: 'wep1' },
  { id: 'wep2', name: 'Weapon 2 (Shotgun)', action: 'wep2' },
  { id: 'wep3', name: 'Weapon 3 (Sniper)', action: 'wep3' },
  { id: 'wep4', name: 'Weapon 4 (SMG)', action: 'wep4' },
  { id: 'wep5', name: 'Weapon 5 (LMG)', action: 'wep5' },
  { id: 'wep6', name: 'Weapon 6 (Combat Knife)', action: 'wep6' },
];

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

function formatKeyCode(code) {
  if (!code) return 'None';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

const settings = {
  sens: Number(store.get('sens', '22')),
  adsSens: Number(store.get('adsSens', '80')),
  invertY: store.get('invertY', 'false') === 'true',
  crouchMode: store.get('crouchMode', 'hold'),
  preset: store.get('graphicsPreset', 'high'),
  binds: (() => {
    try {
      const s = JSON.parse(store.get('binds', '{}'));
      return Object.assign({}, DEFAULT_BINDS, s);
    } catch {
      return Object.assign({}, DEFAULT_BINDS);
    }
  })(),
};

let codeMap = new Map();
function rebuildCodeMap() {
  codeMap.clear();
  for (const def of BIND_DEFS) {
    const keys = settings.binds[def.id] || [];
    for (const k of keys) {
      if (!codeMap.has(k)) codeMap.set(k, []);
      codeMap.get(k).push(def);
    }
  }
}
rebuildCodeMap();

let recordingAction = null;
let crouchToggled = false;

/* ---- Server Connection URL ---- */
/* Accepts a join code ("boutique-boxed-makes-hash"), a host[:port], or a full ws/wss/http(s) address. */
function normalizeServer(input) {
  const v = (input || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (/^wss?:\/\//i.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v.replace(/^http/i, 'ws');
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(v)) return `wss://${v.toLowerCase()}.trycloudflare.com`;
  return /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(v) ? `ws://${v}` : `wss://${v}`;
}

function determineServerUrl() {
  const fromQuery = normalizeServer(new URLSearchParams(window.location.search).get('server'));
  if (fromQuery) { store.set('serverUrl', fromQuery); return fromQuery; }
  // A page served by the matchmaker talks to the server it came from; a saved address only applies to a local file.
  const host = window.location.host;
  if (host) return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`;
  return store.get('serverUrl', '') || 'ws://localhost:8080';
}

const serverUrl = determineServerUrl();

function updateServerStatus(status, isOk = false) {
  const lamp = $('lamp-network');
  const dot = $('server-status-dot');
  const netLabel = $('network-status');
  const proto = $('protocol-status');
  const sessionStatus = $('terminal-session-status');
  const uplink = $('term-uplink');
  const teleTag = $('tele-status-tag');
  const folder = $('folder-name');

  if (lamp) {
    lamp.classList.toggle('lit', isOk);
  }
  if (dot) {
    dot.className = 'dot' + (isOk ? '' : (status.includes('Reconnecting') ? ' reconnecting' : ' offline'));
  }
  if (netLabel) {
    netLabel.textContent = isOk ? 'Uplink connected' : (status.includes('Reconnecting') ? 'Reconnecting...' : 'Not connected');
  }
  if (proto) {
    proto.textContent = isOk ? 'NETWORK LINK STABLE' : (status.includes('Reconnecting') ? 'SIGNAL RECONNECTING' : 'OFFLINE / LOCAL');
  }
  if (sessionStatus) {
    sessionStatus.textContent = status;
  }
  if (uplink) {
    uplink.textContent = isOk ? 'CONNECTED' : 'OFFLINE';
    uplink.className = isOk ? 'online' : '';
  }
  if (teleTag) {
    teleTag.textContent = isOk ? 'ONLINE' : 'STANDBY';
  }
  if (folder) {
    folder.textContent = serverUrl;
  }
}

function updateBackendBadge(backend) {
  const badge = $('backend-badge');
  if (badge) {
    badge.textContent = `BABYLON 9 · ${backend.toUpperCase()}`;
    badge.title = `Active rendering pipeline: ${backend}`;
  }
  if ($('term-engine')) {
    $('term-engine').textContent = `BABYLON 9 ${backend.toUpperCase()}`;
  }
}

function playerName() {
  return cleanName($('name')?.value || store.get('name', 'Ghost'), 18, 'Ghost');
}

/* ---- Operative Roster & 3D Interactive Turntable ---- */
let lobbyPortrait = null;
let heroViewer = null;

let currentRosterHeroId = null;
let currentRosterSkinId = null;
let currentRosterColor = '#f0a640';
let currentRosterAnim = 'idle';

const defaultChar = () => (assets?.characters || []).find(c => c.ng)?.id || assets?.characters?.[0]?.id || 'abdulkarim';
const equippedChar = () => {
  const id = store.get('char', '');
  return (assets?.characters || []).some(c => c.id === id) ? id : defaultChar();
};
/* Saved appearance code sent to the host when joining/hosting. */
const equippedLookCode = () => encodeLook(loadAppearance(store, equippedChar()));
let draftLook = null;   // creator edits, applied to the turntable until saved

const rosterChars = () => {
  if (assets?.characters && assets.characters.length > 0) {
    return assets.characters.filter(c => !SKIN_OF[c.id]);
  }
  return Object.values(HERO_ROSTER);
};

function updateLobbyHeroCard() {
  const chars = rosterChars();
  if (!chars || chars.length === 0) return;

  const activeId = equippedChar();
  const heroChar = (assets?.characters || []).find(c => c.id === activeId) || chars[0];
  const hero = getHeroData(activeId, heroChar?.name);
  const heroIdx = chars.findIndex(c => c.id === baseHeroId(heroChar?.id));

  if ($('hero-equipped-avatar')) $('hero-equipped-avatar').textContent = String(Math.max(0, heroIdx) + 1).padStart(2, '0');
  if ($('hero-equipped-name')) $('hero-equipped-name').textContent = hero.name;
  if ($('hero-equipped-badge')) $('hero-equipped-badge').textContent = hero.classType || hero.badge || 'ASSAULT';
  if ($('hero-equipped-role')) $('hero-equipped-role').textContent = `${hero.title}`;
  if ($('hero-equipped-wep')) $('hero-equipped-wep').textContent = hero.signatureWeapon || 'Standard Issue';

  const callsign = playerName();
  if ($('chipCallsign')) $('chipCallsign').textContent = callsign.toUpperCase();
  if ($('chipInitial')) $('chipInitial').textContent = callsign.charAt(0).toUpperCase();

  if ($('lobby-portrait') && assets) {
    if (!lobbyPortrait) {
      lobbyPortrait = new CharacterPreview($('lobby-portrait'), assets);
    }
    lobbyPortrait.show(heroChar.id, hero.defaultColor || '#f0a640', loadAppearance(store, heroChar.id));
  }
}

function openOperativeView(selectedHeroId = null) {
  const chars = rosterChars();
  if (!chars || chars.length === 0) return;

  const activeId = baseHeroId(equippedChar());
  draftLook = loadAppearance(store, equippedChar());
  currentRosterHeroId = baseHeroId(selectedHeroId || activeId || chars[0].id);

  if (!heroViewer && assets && $('roster-canvas')) {
    heroViewer = new HeroViewer($('roster-canvas'), assets);
  }

  // Populate hero cards
  const cardsContainer = $('roster-cards');
  if (cardsContainer) {
    cardsContainer.replaceChildren(...chars.map(c => {
      const data = getHeroData(c.id, c.name);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'roster-hero-item' + (c.id === currentRosterHeroId ? ' on' : '');
      item.dataset.id = c.id;

      const isEquipped = c.id === activeId;
      item.innerHTML = `
        <div class="roster-item-icon" aria-hidden="true">${String(chars.indexOf(c) + 1).padStart(2, '0')}</div>
        <div class="roster-item-info">
          <span class="roster-item-name">${data.name}</span>
          <span class="roster-item-role">${data.title}</span>
        </div>
        ${isEquipped ? '<span class="pill-active-mini">ACTIVE</span>' : ''}
      `;
      item.onclick = () => selectRosterHero(c.id);
      return item;
    }));
  }

  if ($('roster-count')) {
    $('roster-count').textContent = `${chars.length} / ${chars.length}`;
  }

  // Animation buttons toolbar
  document.querySelectorAll('#roster-anim-group .anim-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#roster-anim-group .anim-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      currentRosterAnim = btn.dataset.anim;
      heroViewer?.playAnimation(currentRosterAnim);
    };
  });

  // Spin button
  if ($('roster-btn-spin')) {
    $('roster-btn-spin').onclick = () => {
      const spinning = heroViewer?.toggleSpin() || false;
      $('roster-btn-spin').textContent = spinning ? '↻ Spin: ON' : '↻ Spin: OFF';
    };
  }

  // Reset view button
  if ($('roster-btn-reset')) {
    $('roster-btn-reset').onclick = () => {
      heroViewer?.resetView();
    };
  }

  // Equip button
  if ($('btn-roster-equip')) {
    $('btn-roster-equip').onclick = () => {
      equipRosterHero(currentRosterSkinId || currentRosterHeroId);
    };
  }

  selectRosterHero(currentRosterHeroId);
  heroViewer?.start();
}

function selectRosterHero(id) {
  const chars = rosterChars();
  const hero = chars.find(c => c.id === baseHeroId(id)) || chars[0];
  id = currentRosterHeroId = hero.id;
  const data = getHeroData(hero.id, hero.name);
  const storedId = equippedChar();

  const availableChars = assets?.characters || [];
  const skins = (data.skins || []).filter(k => availableChars.some(c => c.id === k.id));
  if (!skins.some(k => k.id === currentRosterSkinId) || baseHeroId(currentRosterSkinId) !== id) {
    currentRosterSkinId = baseHeroId(storedId) === id && availableChars.some(c => c.id === storedId) ? storedId : id;
  }
  const isEquipped = currentRosterSkinId === storedId && sameLook(draftLook, loadAppearance(store));

  // Highlight active sidebar card
  document.querySelectorAll('#roster-cards .roster-hero-item').forEach(el => {
    el.classList.toggle('on', el.dataset.id === id);
  });

  // Outfits / Skins toolbar
  const skinSection = $('roster-skin-section'), skinsEl = $('roster-skins');
  if (skinSection && skinsEl) {
    skinSection.hidden = skins.length < 2;
    skinsEl.replaceChildren(...skins.map(k => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'anim-btn' + (k.id === currentRosterSkinId ? ' on' : '');
      btn.textContent = k.name;
      btn.onclick = () => {
        currentRosterSkinId = k.id;
        skinsEl.querySelectorAll('.anim-btn').forEach(b => b.classList.toggle('on', b === btn));
        refreshCreatorState();
        heroViewer?.show(k.id, currentRosterColor, currentRosterAnim, draftLook);
      };
      return btn;
    }));
  }

  // Update badges & role in viewport overlay
  if ($('roster-hero-badge-icon')) $('roster-hero-badge-icon').textContent = String(chars.indexOf(hero) + 1).padStart(2, '0');
  if ($('roster-hero-class')) $('roster-hero-class').textContent = data.classType || 'ASSAULT';

  // Update dossier details
  if ($('dossier-name')) $('dossier-name').textContent = data.name.toUpperCase();
  if ($('dossier-subtitle')) $('dossier-subtitle').textContent = data.title;
  if ($('dossier-status-pill')) {
    $('dossier-status-pill').textContent = isEquipped ? 'EQUIPPED' : 'READY';
    $('dossier-status-pill').className = isEquipped ? 'pill-equipped' : 'pill-equipped off';
  }

  // Tactical stats
  const stats = data.stats || { mobility: 75, durability: 75, precision: 75, firepower: 75 };
  if ($('stat-mobility')) $('stat-mobility').style.width = stats.mobility + '%';
  if ($('stat-mobility-val')) $('stat-mobility-val').textContent = stats.mobility;
  if ($('stat-durability')) $('stat-durability').style.width = stats.durability + '%';
  if ($('stat-durability-val')) $('stat-durability-val').textContent = stats.durability;
  if ($('stat-precision')) $('stat-precision').style.width = stats.precision + '%';
  if ($('stat-precision-val')) $('stat-precision-val').textContent = stats.precision;
  if ($('stat-firepower')) $('stat-firepower').style.width = stats.firepower + '%';
  if ($('stat-firepower-val')) $('stat-firepower-val').textContent = stats.firepower;

  // Signature loadout & bio
  if ($('dossier-weapon')) $('dossier-weapon').textContent = data.signatureWeapon;
  if ($('dossier-weapon-icon')) $('dossier-weapon-icon').textContent = data.signatureIcon || '🔫';
  if ($('dossier-trait')) $('dossier-trait').textContent = data.trait;
  if ($('dossier-trait-desc')) $('dossier-trait-desc').textContent = data.traitDesc;
  if ($('dossier-bio')) $('dossier-bio').textContent = data.bio;

  updateRosterEquipButton(isEquipped);

  currentRosterColor = data.defaultColor || '#22d3ee';
  renderCreator();

  heroViewer?.show(currentRosterSkinId, currentRosterColor, currentRosterAnim, draftLook);
}

function updateRosterEquipButton(isEquipped) {
  const btn = $('btn-roster-equip');
  if (!btn) return;
  if (isEquipped) {
    btn.textContent = '✓ SAVED & EQUIPPED';
    btn.disabled = true;
  } else {
    btn.textContent = '✓ Save & Equip Operative';
    btn.disabled = false;
  }
}

function equipRosterHero(id) {
  store.set('char', id);
  store.set('equippedHero', id);
  saveAppearance(store, { ...draftLook, bodyId: id });
  currentRosterSkinId = id;
  updateLobbyHeroCard();
  selectRosterHero(baseHeroId(id));
  toast('Saved operative: ' + getHeroData(id).name);
}

/* ---- Appearance creator: one draft look, previewed on the live turntable rig ---- */
function setDraft(next, status = '') {
  draftLook = normalizeAppearance(next, currentRosterSkinId);
  renderCreator();
  if ($('creator-status')) $('creator-status').textContent = status || 'Previewing — press Save to keep it';
  const st = $('creator-status');
  heroViewer?.setLook(draftLook).catch(() => { if (st) st.textContent = 'Could not apply that look; using the default.'; });
}

function choiceButtons(el, items, selectedId, onPick, swatch = false) {
  if (!el) return;
  el.replaceChildren(...items.map(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (swatch ? 'swatch-btn' : 'anim-btn') + (item.id === selectedId ? ' on' : '');
    btn.setAttribute('aria-pressed', String(item.id === selectedId));
    if (swatch) { btn.style.backgroundColor = item.color; btn.title = item.name; btn.setAttribute('aria-label', item.name + ' accent'); }
    else btn.textContent = item.name;
    btn.onclick = () => onPick(item.id);
    return btn;
  }));
}

function renderCreator() {
  if (!draftLook) draftLook = loadAppearance(store, currentRosterSkinId);
  const L = draftLook;
  const preset = PRESETS.find(p => p.outfitId === L.outfitId && p.skinId === L.skinId && p.shaderId === L.shaderId && p.accentId === L.accentId);
  choiceButtons($('creator-presets'), CATALOG.presets, preset?.id, id => setDraft(applyPreset(draftLook, id)));
  choiceButtons($('creator-outfits'), CATALOG.outfits, L.outfitId, id => setDraft({ ...draftLook, outfitId: id }));
  choiceButtons($('creator-skins'), CATALOG.skins, L.skinId, id => setDraft({ ...draftLook, skinId: id }));
  choiceButtons($('creator-shaders'), CATALOG.shaders, L.shaderId, id => setDraft({ ...draftLook, shaderId: id }));
  choiceButtons($('creator-accents'), CATALOG.accents, L.accentId, id => setDraft({ ...draftLook, accentId: id }), true);
  if ($('creator-reset')) $('creator-reset').onclick = () => setDraft({ ...DEFAULT_LOOK }, 'Default look — press Save to keep it');
  if ($('creator-revert')) $('creator-revert').onclick = () => setDraft(loadAppearance(store), 'Reverted to your saved look');
  refreshCreatorState();
}

function refreshCreatorState() {
  const equipped = currentRosterSkinId === equippedChar() && sameLook(draftLook, loadAppearance(store));
  updateRosterEquipButton(equipped);
  if ($('dossier-status-pill')) {
    $('dossier-status-pill').textContent = equipped ? 'EQUIPPED' : 'READY';
    $('dossier-status-pill').className = equipped ? 'pill-equipped' : 'pill-equipped off';
  }
}

function applyCallsign() {
  const nameInput = $('name');
  if (!nameInput) return;
  const cleaned = cleanName(nameInput.value, 18, 'Ghost');
  nameInput.value = cleaned;
  store.set('name', cleaned);
  updateLobbyHeroCard();
  toast('Callsign assigned: ' + cleaned.toUpperCase());
}

/* ---- Settings & Controls Configuration ---- */
function syncSettingsUI() {
  const sens = settings.sens || 22;
  const adsSens = settings.adsSens || 80;

  if ($('opt-sens')) {
    $('opt-sens').value = sens;
    if ($('opt-sens-num')) $('opt-sens-num').textContent = sens;
  }
  if ($('opt-ads-sens')) {
    $('opt-ads-sens').value = adsSens;
    if ($('opt-ads-sens-num')) $('opt-ads-sens-num').textContent = (adsSens / 100).toFixed(2) + 'x';
  }
  if ($('opt-invert-y')) $('opt-invert-y').checked = settings.invertY;

  if ($('opt-crouch-hold') && $('opt-crouch-toggle')) {
    const isHold = settings.crouchMode !== 'toggle';
    $('opt-crouch-hold').classList.toggle('on', isHold);
    $('opt-crouch-toggle').classList.toggle('on', !isHold);
  }

  if ($('preset-select')) {
    $('preset-select').value = settings.preset;
  }
  if ($('volume')) {
    $('volume').value = store.get('volume', '50');
    if ($('volume-value')) $('volume-value').textContent = $('volume').value + '%';
  }

  renderBindGrid();
}

function renderBindGrid() {
  const container = $('bind-grid');
  if (!container) return;
  container.innerHTML = '';

  for (const def of BIND_DEFS) {
    const item = document.createElement('div');
    item.className = 'bind-item';

    const label = document.createElement('span');
    label.textContent = def.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (recordingAction === def.id ? 'listening' : '');

    const currentKeys = settings.binds[def.id] || [];
    btn.textContent = recordingAction === def.id ? 'PRESS KEY' : (currentKeys.map(formatKeyCode).join(' / ') || 'None');

    btn.onclick = () => {
      recordingAction = recordingAction === def.id ? null : def.id;
      renderBindGrid();
    };

    item.appendChild(label);
    item.appendChild(btn);
    container.appendChild(item);
  }
}

function setupSettingsListeners() {
  $('opt-sens')?.addEventListener('input', e => {
    settings.sens = Number(e.target.value);
    store.set('sens', settings.sens);
    if ($('opt-sens-num')) $('opt-sens-num').textContent = settings.sens;
  });

  $('opt-ads-sens')?.addEventListener('input', e => {
    settings.adsSens = Number(e.target.value);
    store.set('adsSens', settings.adsSens);
    if ($('opt-ads-sens-num')) $('opt-ads-sens-num').textContent = (settings.adsSens / 100).toFixed(2) + 'x';
  });

  $('opt-invert-y')?.addEventListener('change', e => {
    settings.invertY = e.target.checked;
    store.set('invertY', String(settings.invertY));
  });

  $('opt-crouch-hold')?.addEventListener('click', () => {
    settings.crouchMode = 'hold';
    store.set('crouchMode', 'hold');
    $('opt-crouch-hold').classList.add('on');
    $('opt-crouch-toggle').classList.remove('on');
  });

  $('opt-crouch-toggle')?.addEventListener('click', () => {
    settings.crouchMode = 'toggle';
    store.set('crouchMode', 'toggle');
    $('opt-crouch-toggle').classList.add('on');
    $('opt-crouch-hold').classList.remove('on');
  });

  $('preset-select')?.addEventListener('change', e => {
    settings.preset = e.target.value;
    store.set('graphicsPreset', settings.preset);
    view?.applyGraphicsSettings?.(settings.preset);
    toast('Graphics preset updated: ' + settings.preset.toUpperCase());
  });

  $('volume')?.addEventListener('input', e => {
    const val = e.target.value;
    if ($('volume-value')) $('volume-value').textContent = val + '%';
    store.set('volume', val);
  });

  $('opt-crt')?.addEventListener('change', e => {
    setCrtEnabled(e.target.checked);
  });

  $('opt-reduced-motion')?.addEventListener('change', e => {
    document.documentElement.classList.toggle('reduced-motion', e.target.checked);
    store.set('reducedMotion', String(e.target.checked));
  });

  $('opt-reset-binds')?.addEventListener('click', () => {
    settings.binds = Object.assign({}, DEFAULT_BINDS);
    store.set('binds', JSON.stringify(settings.binds));
    rebuildCodeMap();
    renderBindGrid();
    toast('Keybindings reset to defaults');
  });

  $('settings-done')?.addEventListener('click', () => {
    toast('Preferences applied successfully');
    go('play');
  });
}

/* ---- Game Viewport Setup ---- */
async function prepareView(w = world) {
  $('lobby').hidden = true;
  $('game').hidden = false;

  if (!view) {
    view = new View($('view'), w, assets, { preset: settings.preset });
    await view.initPromise;
    updateBackendBadge(view.backend || 'WebGL 2');
  } else {
    await view.setWorld(w);
  }
  view?.resize();
  return view;
}

function showGame(on) {
  $('lobby').hidden = on;
  $('game').hidden = !on;
  if (on) {
    $('toast')?.classList.remove('show');
    view?.resize();
    requestAnimationFrame(frame);
  }
}

/* ---- Match Hosting & Joining ---- */
async function startPracticeMatch() {
  if (session || !assets) return;
  const roomName = cleanName($('room-name')?.value, 32, playerName() + "'s Arena");
  const map = $('map-select')?.value || 'foundry';
  const mode = $('mode-select')?.value || 'ffa';
  const seed = map === 'sandbox' || map === 'orbit' || map === MICRO_MAP_ID ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const char = equippedChar();
  const look = equippedLookCode();

  toast('Deploying offline practice match with bots...');
  try {
    world = hostWorld(map, seed);
    await prepareView(world);

    session = new HostSession({
      signaling: null,
      NetHostClass: LocalNetHost,
      world,
      id: myId,
      name: playerName(),
      char,
      look,
      roomName,
      map,
      seed,
      mode,
      weather: chosenWeather(map),
      view,
      hud,
      audio: sound,
      onExit: leaveMatch,
    });

    await session.start();
    const ng = (assets.characters || []).filter(c => c.ng);
    const botChar = i => ng.length ? ng[(i + 1) % ng.length].id : '';
    session.addBot('Recon-Alpha', botChar(1) || 'mina', 'medium', encodeLook(applyPreset({}, PRESETS[2].id)));
    session.addBot('Heavy-Bravo', botChar(2) || 'robot', 'medium', encodeLook(applyPreset({}, PRESETS[4].id)));
    hud.session = session;
    showGame(true);
  } catch (e) {
    session = null;
    console.error('Practice match error:', e);
    toast('Could not start practice match: ' + e.message);
  }
}

async function hostOnlineMatch() {
  if (session || !assets) return;
  const roomName = cleanName($('room-name')?.value, 32, playerName() + "'s Arena");
  const map = $('map-select')?.value || 'foundry';
  const mode = $('mode-select')?.value || 'ffa';
  const maxPlayers = parseInt($('max-players-select')?.value || '6', 10);
  const isPrivate = $('is-private-checkbox')?.checked || false;
  const seed = map === 'sandbox' || map === 'orbit' || map === MICRO_MAP_ID ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const char = equippedChar();
  const look = equippedLookCode();

  if (!signaling || !signaling.connected) {
    toast('Connecting to matchmaking server on port 8080...');
    try {
      await signaling.connect(2000);
    } catch {
      toast('Matchmaking server offline. Launching practice match with bots...');
      await new Promise(r => setTimeout(r, 600));
      return await startPracticeMatch();
    }
  }

  toast('Creating match on online server...');
  try {
    world = hostWorld(map, seed);
    await prepareView(world);

    session = new HostSession({
      signaling,
      NetHostClass: OnlineNetHost,
      world,
      id: myId,
      name: playerName(),
      char,
      look,
      roomName,
      map,
      seed,
      mode,
      weather: chosenWeather(map),
      view,
      hud,
      audio: sound,
      onExit: leaveMatch,
    });

    const code = await session.start();
    hud.session = session;
    showGame(true);
    console.log(`[Spectre Orbit] Match hosted. Code: ${code}`);
  } catch (e) {
    session = null;
    console.error('Host error:', e);
    toast('Could not create online room: ' + e.message);
  }
}

async function joinOnlineMatch(code) {
  if (session || !assets) return;
  const char = equippedChar();
  const look = equippedLookCode();
  const cleanCode = (code || '').trim().toUpperCase();

  if (!cleanCode) {
    toast('Please enter an invitation code');
    return;
  }

  toast(`Connecting to match [${cleanCode}]...`);
  let s = null;
  try {
    s = session = new GuestSession({
      signaling,
      NetGuestClass: OnlineNetGuest,
      world: buildWorld(assets, 'foundry', 0),
      id: myId,
      name: playerName(),
      char,
      look,
      view,
      hud,
      audio: sound,
      onExit: msg => leaveMatch(msg),
    });

    await s.join({ code: cleanCode }, statusText => toast(statusText));
    const init = await s.waitForInit();
    const expectGen = s.map === MICRO_MAP_ID ? MICRO_GENERATOR_VERSION : PLANET_GENERATOR_VERSION;
    if (init?.gen && init.gen !== expectGen) throw new Error(`This room uses planet generator v${init.gen}; your build has v${expectGen}. Update the game to join.`);

    world = buildWorld(assets, s.map, s.seed, s.map === CUSTOM_MAP_ID ? init?.custom : null);
    if (init?.hash && world.layoutHash !== init.hash) throw new Error('Map mismatch: your copy of this map differs from the host\'s, so the match would play on different collision. Update both games to the same version.');
    await prepareView(world);
    s.client.world = world;
    s.client.view = view;   // the view may not have existed when the session was created

    hud.session = s;
    showGame(true);
  } catch (e) {
    session = null;
    try { s?.stop(); } catch {}       // never leave a half-joined player on the host
    showGame(false);
    console.error('Join error:', e);
    toast(e instanceof LinkError ? e.message : 'Could not join match: ' + e.message);
  }
}

async function quickMatch() {
  if (!signaling) return;
  toast('Finding best available public match...');
  signaling.send({ t: 'list_rooms' });

  const unList = signaling.on('room_list', async msg => {
    unList();
    const rooms = (msg.rooms || []).filter(r => r.players < r.max);
    if (rooms.length > 0) {
      rooms.sort((a, b) => b.players - a.players);
      await joinOnlineMatch(rooms[0].code);
    } else {
      toast('No open public matches found. Deploying new match...');
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
  if (reason) toast(typeof reason === 'string' ? reason : 'Left match');
  refreshRoomList();
}

function refreshRoomList() {
  if (signaling && signaling.connected) {
    signaling.send({ t: 'list_rooms' });
  }
}

let latestRooms = [];
function renderRoomList(rooms = []) {
  latestRooms = rooms;
  const ul = $('rooms');
  const empty = $('no-rooms');
  const countLabel = $('room-count');
  const termRoomboard = $('term-roomboard');

  if (countLabel) {
    countLabel.textContent = `${String(rooms.length).padStart(2, '0')} ONLINE`;
  }
  if (termRoomboard) {
    termRoomboard.textContent = `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} active`;
  }

  if (ul) {
    ul.innerHTML = '';
    if (rooms.length === 0) {
      if (empty) empty.hidden = false;
    } else {
      if (empty) empty.hidden = true;
      for (const r of rooms) {
        const li = document.createElement('li');
        li.className = 'room-card';
        li.innerHTML = `
          <div class="room-card-info">
            <h4>${r.name}</h4>
            <div class="room-card-meta">
              <span>${(r.map || 'FOUNDRY').toUpperCase()}</span>
              <span>${(r.mode || 'FFA').toUpperCase()}</span>
              <span>HOST: ${r.host}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="small-cap">${r.players}/${r.max} PLAYERS</span>
            <button class="btn btn-primary small btn-join-room" type="button" data-code="${r.code}">Join ↗</button>
          </div>
        `;
        li.querySelector('.btn-join-room').onclick = () => joinOnlineMatch(r.code);
        ul.appendChild(li);
      }
    }
  }

  renderDrawerRooms();
}

function renderDrawerRooms() {
  const container = $('drawer-rooms-list');
  if (!container) return;
  container.innerHTML = '';

  if (latestRooms.length === 0) {
    container.innerHTML = `
      <div class="room-empty">
        <svg width="36" height="36" stroke="currentColor" fill="none" stroke-width="1.4" viewBox="0 0 24 24"><use href="#i-monitor"/></svg>
        <strong style="margin:8px 0 4px;">NO ACTIVE ROOMS FOUND</strong>
        <span>No public matches on the directory. Create a room or invite friends by direct code.</span>
      </div>
    `;
    return;
  }

  for (const r of latestRooms) {
    const row = document.createElement('div');
    row.className = 'room-card';
    row.innerHTML = `
      <div class="room-card-info">
        <h4>${r.name}</h4>
        <div class="room-card-meta">
          <span>${(r.map || 'FOUNDRY').toUpperCase()}</span>
          <span>${r.players}/${r.max} PLAYERS</span>
        </div>
      </div>
      <button class="btn btn-primary small btn-drawer-join" type="button">Join ↗</button>
    `;
    row.querySelector('.btn-drawer-join').onclick = () => {
      closeDrawer();
      joinOnlineMatch(r.code);
    };
    container.appendChild(row);
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

/* ---- Input Controls & Keybindings Handler ---- */
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
  });

  window.addEventListener('mousemove', e => {
    if (!session || document.pointerLockElement !== canvas) return;
    const isSniper = session.client.aiming && (session.client.me?.w === 2);
    const adsMult = (settings.adsSens || 80) / 100;
    const adsScale = session.client.aiming ? (isSniper ? 0.25 * adsMult : 0.6 * adsMult) : 1.0;
    const baseSens = (settings.sens || 22) * 0.0001;
    const invertY = settings.invertY ? -1 : 1;

    session.client.look.yaw -= e.movementX * baseSens * adsScale;
    session.client.look.pitch = Math.max(-1.55, Math.min(1.55, session.client.look.pitch - e.movementY * baseSens * adsScale * invertY));
  });

  window.addEventListener('mousedown', e => {
    if (!session) return;
    sound.ensure();
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()?.catch?.(() => {});
      return;
    }
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
    // Key recording for settings
    if (recordingAction) {
      e.preventDefault();
      if (e.code === 'Escape') {
        recordingAction = null;
        renderBindGrid();
        return;
      }
      settings.binds[recordingAction] = [e.code];
      store.set('binds', JSON.stringify(settings.binds));
      rebuildCodeMap();
      recordingAction = null;
      renderBindGrid();
      return;
    }

    if (e.code === 'Escape') {
      if (activeDrawer) {
        closeDrawer();
        return;
      }
      if (activePage !== 'play' && !session) {
        go('play');
        return;
      }
    }

    if (!session || document.pointerLockElement !== canvas) {
      return;
    }

    const actions = codeMap.get(e.code);
    if (!actions) {
      if (e.code === 'Tab') { hud.showBoard = true; e.preventDefault(); }
      return;
    }

    for (const def of actions) {
      if (def.bit) {
        if (def.bit === B.CROUCH && settings.crouchMode === 'toggle') {
          crouchToggled = !crouchToggled;
          if (crouchToggled) session.client.input.b |= B.CROUCH;
          else session.client.input.b &= ~B.CROUCH;
        } else {
          session.client.input.b |= def.bit;
        }
      }
      if (def.action === 'reload') session.client.input.reload = true;
      if (def.action === 'melee') session.client.input.melee = true;
      if (def.action === 'grenade') session.client.input.grenade = true;
      if (def.action === 'quickSwitch') session.client.quickSwitchWeapon();
      if (def.action?.startsWith('wep')) {
        const num = parseInt(def.action.slice(3), 10) - 1;
        if (num >= 0 && num <= 5) session.client.setWeapon(num);
      }
    }
  });

  window.addEventListener('keyup', e => {
    if (!session) return;
    if (e.code === 'Tab') { hud.showBoard = false; e.preventDefault(); }

    const actions = codeMap.get(e.code);
    if (!actions) return;

    for (const def of actions) {
      if (def.bit) {
        if (def.bit === B.CROUCH && settings.crouchMode === 'toggle') {
          // Keep toggle state
        } else {
          session.client.input.b &= ~def.bit;
        }
      }
    }
  });
}

/* ---- Client Bootstrap ---- */
let wsSignaling = null, folderSignaling = null, folderTimer = 0;

/* Shared-folder transport: rooms and WebRTC offers travel through a folder both PCs can open. */
async function useFolder(interactive) {
  if (session) { toast('Leave the current match first'); return false; }
  try {
    let dir = await rememberedFolder(interactive), f = null;
    // A remembered folder can vanish (drive unplugged, share offline): forget it and ask again once.
    for (let attempt = 0; attempt < 2 && !f; attempt++) {
      if (!dir) { if (!interactive) return false; dir = await pickFolder(); }
      const c = new FolderSignalingClient(dir);
      try { await c.connect(); f = c; }
      catch (e) {
        if (e?.name !== 'NotFoundError') throw e;
        forgetFolderHandle();
        if (attempt) throw new Error(`Cannot open folder "${dir.name}". Check that the drive or share is online and writable.`);
        dir = null;
        if (!interactive) return false;
        toast('Saved folder is unavailable. Pick it again.');
      }
    }
    f.on('room_list', msg => { if (signaling === f) renderRoomList(msg.rooms || []); });
    f.on('error', msg => toast(msg.message || 'Shared folder error'));
    if (folderSignaling && folderSignaling !== f) folderSignaling.close();
    wsSignaling?.close();
    folderSignaling = signaling = f;
    store.set('transport', 'folder');
    updateServerStatus(`Local folder · ${dir.name}`, true);
    $('btn-use-folder')?.classList.add('on'); $('btn-use-server')?.classList.remove('on');
    refreshRoomList();
    clearInterval(folderTimer);
    folderTimer = setInterval(refreshRoomList, 3000);
    toast(`Using shared folder "${dir.name}". Everyone on this LAN picks the same folder.`);
    return true;
  } catch (e) {
    if (e?.name !== 'AbortError') toast(e?.message || 'Could not open the folder');
    return false;
  }
}

async function useServer() {
  if (session) { toast('Leave the current match first'); return; }
  clearInterval(folderTimer);
  folderSignaling?.close();
  folderSignaling = null;
  signaling = wsSignaling;
  store.set('transport', 'server');
  $('btn-use-server')?.classList.add('on'); $('btn-use-folder')?.classList.remove('on');
  updateServerStatus('Connecting to matchmaking server...', false);
  try {
    await signaling.connect();
    updateServerStatus('Online · Connected to Matchmaking', true);
    refreshRoomList();
  } catch {
    updateServerStatus('Offline (Port 8080) · Practice Mode available', false);
  }
}

async function bootstrap() {
  initPalette([['orbit', 'Orbit']], 'orbit');
  refreshCustomMapOption();
  populateModeSelect();
  const serverInput = $('opt-server');
  if (serverInput) {
    serverInput.value = store.get('serverUrl', '');
    $('opt-server-current').textContent = serverUrl;
    $('btn-server-save').addEventListener('click', () => {
      store.set('serverUrl', normalizeServer(serverInput.value));
      window.location.href = window.location.href.split(/[?#]/)[0];
    });
  }
  // Load saved preferences
  let crt = false;
  try { crt = store.get('crtfx', 'true') === 'true'; } catch {}
  setCrtEnabled(crt);

  // Setup view routing delegation
  document.addEventListener('click', e => {
    const pageEl = e.target.closest('[data-page]');
    if (pageEl) {
      e.preventDefault();
      go(pageEl.dataset.page);
      return;
    }
    const drawerEl = e.target.closest('[data-drawer]');
    if (drawerEl) {
      e.preventDefault();
      openDrawer(drawerEl.dataset.drawer);
      return;
    }
  });

  // Drawer events
  $('drawerClose')?.addEventListener('click', closeDrawer);
  $('overlay')?.addEventListener('mousedown', e => {
    if (e.target === $('overlay')) closeDrawer();
  });
  $('drawerSubmit')?.addEventListener('click', submitDrawer);

  $('input-join-code')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitDrawer();
  });

  // Callsign apply
  $('btn-apply-callsign')?.addEventListener('click', applyCallsign);
  $('name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') applyCallsign();
  });

  // Briefing listeners
  updateBriefing();
  $('map-select')?.addEventListener('change', updateBriefing);
  $('mode-select')?.addEventListener('change', updateBriefing);

  setupInputHandlers();
  setupSettingsListeners();

  // Load 3D assets
  assets = await loadAssets();

  // Initialize lobby character preview & load catalog
  updateLobbyHeroCard();
  renderMapsCatalog();

  // Button bindings
  $('btn-quick-match')?.addEventListener('click', quickMatch);
  $('btn-host-match')?.addEventListener('click', hostOnlineMatch);
  $('btn-practice-match')?.addEventListener('click', startPracticeMatch);
  $('btn-refresh-rooms')?.addEventListener('click', () => {
    refreshRoomList();
    toast('Refreshing public rooms directory...');
  });
  $('btn-refresh-rooms-drawer')?.addEventListener('click', () => {
    refreshRoomList();
    toast('Refreshing public rooms directory...');
  });
  $('btn-join-code')?.addEventListener('click', () => {
    const code = $('input-join-code')?.value;
    if (code) joinOnlineMatch(code);
  });

  $('leave')?.addEventListener('click', () => leaveMatch('Left match'));
  $('btn-scores-game')?.addEventListener('click', () => { hud.showBoard = !hud.showBoard; });
  $('btn-settings-game')?.addEventListener('click', () => {
    leaveMatch();
    go('settings');
  });

  $('btn-add-bot')?.addEventListener('click', () => {
    if (session instanceof HostSession) {
      const b = session.addBot();
      if (b) hud?.feed(`Bot ${b.name} joined`);
    }
  });
  $('btn-remove-bot')?.addEventListener('click', () => {
    if (session instanceof HostSession) {
      session.removeBot();
    }
  });

  // Weapon click bindings in HUD
  document.querySelectorAll('#weapons .wep').forEach((wepEl, idx) => {
    wepEl.onclick = () => {
      if (session) session.client.setWeapon(idx);
    };
  });

  // Matchmaking server connection
  const ws = wsSignaling = signaling = new OnlineSignalingClient(serverUrl);

  // Ignore events from the server link while the shared folder is the active transport.
  ws.on('status', text => { if (signaling === ws) updateServerStatus(text, true); });
  ws.on('room_list', msg => { if (signaling === ws) renderRoomList(msg.rooms || []); });
  ws.on('close', () => { if (signaling === ws) updateServerStatus('Disconnected from server. Reconnecting...', false); });
  ws.on('error', err => { if (signaling === ws) updateServerStatus('Server offline (Port 8080)', false); });

  $('btn-use-folder')?.addEventListener('click', () => useFolder(true));
  $('btn-use-server')?.addEventListener('click', useServer);

  updateServerStatus('Connecting to matchmaking server...', false);

  // Last session used the shared folder and its permission is still valid: go straight back to it.
  if (store.get('transport', '') === 'folder' && await useFolder(false)) return finishBootstrap();

  try {
    await signaling.connect();
    updateServerStatus('Online · Connected to Matchmaking', true);
    refreshRoomList();
    setInterval(refreshRoomList, 8000);
  } catch (err) {
    updateServerStatus('Offline (Port 8080) · Practice Mode available', false);
    console.warn('[Spectre Orbit] Matchmaking connect failed:', err);
  }

  finishBootstrap();
}

function finishBootstrap() {
  initUpdater();
  // Developer tool: open the page with ?sandbox=1 for the Planet Sandbox panel.
  if (new URLSearchParams(location.search).has('sandbox')) {
    attachMicroSandbox({
      getView: () => view, getSession: () => session, leaveMatch,
      startMatch: async () => { const sel = $('map-select'); if (sel) sel.value = MICRO_MAP_ID; await startPracticeMatch(); },
    });
  }
  // Auto-join if ?join=CODE in URL
  const urlParams = new URLSearchParams(window.location.search);
  const autoJoinCode = urlParams.get('join') || window.location.hash.replace('#join=', '');
  if (autoJoinCode && autoJoinCode.length === 5) {
    setTimeout(() => joinOnlineMatch(autoJoinCode), 500);
  }
}

// Global handle for automation & tests
window.LANFPS_ONLINE = {
  get session() { return session; },
  get view() { return view; },
  get assets() { return assets; },
  get signaling() { return signaling; },
  hostOnlineMatch,
  startPracticeMatch,
  joinOnlineMatch,
  quickMatch,
  go,
  openDrawer,
  closeDrawer,
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
