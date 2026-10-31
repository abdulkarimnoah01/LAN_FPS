/* Spectre Orbit Online — Main Client Entry Point
   Babylon.js 9 (WebGPU / WebGL 2) Engine with Retro-Futuristic Terminal UI & 3D Operative Turntable */

import { OnlineSignalingClient, OnlineNetHost, LocalNetHost, OnlineNetGuest, LinkError } from './net_online.js';
import { HostSession, GuestSession } from './game.js';
import { View, CharacterPreview, HeroViewer, loadAssets, buildWorld } from './render_babylon.js';
import { Hud, Sound } from './hud.js';
import { B } from './sim.js';
import { HERO_ROSTER, getHeroData, SKIN_OF, baseHeroId } from './heroes.js';

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

/* ---- Map Briefings & Presentation Data ---- */
const MAPS = {
  foundry: ['Foundry Core', 'Molten industrial casting pit. Elevated catwalks. Fast CQB encounters.'],
  glowplant: ['Reactor Complex', 'Sub-orbital nuclear facility with pulsating blue plasma cores and dual jump pads.'],
  zenith: ['Zenith Atrium', 'High-altitude vertical multi-tier sky arena with velocity jump pads and vertigo sightlines.'],
  railyard: ['Hadota Rail Yard', 'A rail yard at dusk. A 150 m freight train down the middle, roof lanes, container canyons and signal gantries.'],
  school: ['Schoolyard', 'An Egyptian school courtyard in full sun. Two storeys of pointed arcades, a gallery ring and a diesel locomotive halfway out of a tunnel.'],
  aftermath: ['Aftermath', 'Ruined streets. Tight corners. Urban combat.'],
  river: ['River Forest', 'A river valley divided by bridges and sightlines.'],
  forest: ['Pine Forest', 'Pine cover and open ground. Watch your flanks.'],
  sandbox: ['Random Sandbox', 'A fresh procedural battlefield for every room.'],
  arena: ['Classic Arena', 'Compact geometry. Fast encounters. Pure deathmatch.'],
};

function updateBriefing() {
  const mapSelect = $('map-select');
  if (!mapSelect) return;
  const map = mapSelect.value || 'foundry';
  const data = MAPS[map] || MAPS.foundry;

  if ($('map-title')) $('map-title').textContent = data[0];
  if ($('map-description')) $('map-description').textContent = data[1];
  if ($('map-index')) {
    const keys = Object.keys(MAPS);
    $('map-index').textContent = `SECTOR ${String(keys.indexOf(map) + 1).padStart(2, '0')} / ${String(keys.length).padStart(2, '0')}`;
  }

  const briefing = document.querySelector('.map-briefing');
  if (briefing) briefing.dataset.map = map;

  const sourcePreview = assets?.maps?.[map]?.preview || window.LANFPS_ASSETS?.maps?.[map]?.preview;
  const ownCapture = map === 'railyard' || map === 'school';
  const thumb = $('map-thumbnail');
  if (thumb) {
    thumb.style.backgroundImage = sourcePreview ? `url("${sourcePreview}")` : '';
    thumb.setAttribute('aria-label', `${data[0]}: ${sourcePreview && !ownCapture ? 'source map preview' : 'in-game capture'}`);
  }
  if ($('map-capture-label')) {
    $('map-capture-label').textContent = sourcePreview && !ownCapture ? 'SOURCE MAP PREVIEW' : (map === 'sandbox' ? 'IN-GAME SAMPLE' : 'IN-GAME CAPTURE');
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
  store.set('crt', String(on));
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
function determineServerUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('server')) return params.get('server');
  const saved = store.get('serverUrl', '');
  if (saved) return saved;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return host ? `${proto}//${host}` : 'ws://localhost:8080';
}

const serverUrl = determineServerUrl();

function updateServerStatus(status, isOk = false) {
  const lamp = $('lamp-network');
  const netLabel = $('network-status');
  const sessionStatus = $('terminal-session-status');
  const uplink = $('term-uplink');
  const folder = $('folder-name');

  if (lamp) {
    lamp.classList.toggle('lit', isOk);
    lamp.setAttribute('aria-label', isOk ? 'Matchmaking uplink active' : 'Matchmaking uplink disconnected');
  }
  if (netLabel) {
    netLabel.textContent = isOk ? 'ONLINE' : 'CONNECTING';
    netLabel.classList.toggle('connected', isOk);
  }
  if (sessionStatus) {
    sessionStatus.textContent = status;
  }
  if (uplink) {
    uplink.textContent = isOk ? 'online / active' : 'connecting...';
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
}

function playerName() {
  return cleanName($('name')?.value, 18, 'Operative');
}

/* ---- Operative Roster & 3D Interactive Turntable ---- */
let lobbyPortrait = null;
let heroViewer = null;

let currentRosterHeroId = null;
let currentRosterSkinId = null;
let currentRosterColor = '#f0a640';
let currentRosterAnim = 'idle';

const rosterChars = () => {
  if (assets?.characters && assets.characters.length > 0) {
    return assets.characters.filter(c => !SKIN_OF[c.id]);
  }
  return Object.values(HERO_ROSTER);
};

function updateLobbyHeroCard() {
  const chars = rosterChars();
  if (!chars || chars.length === 0) return;

  const activeId = store.get('char', chars[0]?.id || 'abdulkarim');
  const heroChar = (assets?.characters || []).find(c => c.id === activeId) || chars[0];
  const hero = getHeroData(activeId, heroChar?.name);
  const heroIdx = chars.findIndex(c => c.id === baseHeroId(heroChar?.id));

  if ($('hero-equipped-avatar')) $('hero-equipped-avatar').textContent = String(Math.max(0, heroIdx) + 1).padStart(2, '0');
  if ($('hero-equipped-name')) $('hero-equipped-name').textContent = hero.name;
  if ($('hero-equipped-badge')) $('hero-equipped-badge').textContent = hero.classType || hero.badge || 'ASSAULT';
  if ($('hero-equipped-role')) $('hero-equipped-role').textContent = `${hero.title} · Signature: ${hero.signatureWeapon}`;

  if ($('lobby-portrait') && assets) {
    if (!lobbyPortrait) {
      lobbyPortrait = new CharacterPreview($('lobby-portrait'), assets);
    }
    lobbyPortrait.show(heroChar.id, hero.defaultColor || '#f0a640');
  }
}

function openHeroRoster(selectedHeroId = null) {
  if (document.pointerLockElement) document.exitPointerLock();
  const modal = $('hero-roster-modal');
  if (!modal) return;

  const chars = rosterChars();
  if (!chars || chars.length === 0) return;

  const activeId = baseHeroId(store.get('char', chars[0].id));
  currentRosterHeroId = baseHeroId(selectedHeroId || activeId || chars[0].id);

  if (!heroViewer && assets) {
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
  modal.hidden = false;
  heroViewer?.start();

  const handleRosterKey = e => {
    if (e.target === $('roster-canvas') && e.key !== 'Escape') return;
    if (e.key === 'Escape') {
      closeHeroRoster();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const idx = chars.findIndex(c => c.id === currentRosterHeroId);
      const prevIdx = (idx - 1 + chars.length) % chars.length;
      selectRosterHero(chars[prevIdx].id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const idx = chars.findIndex(c => c.id === currentRosterHeroId);
      const nextIdx = (idx + 1) % chars.length;
      selectRosterHero(chars[nextIdx].id);
    }
  };
  window._rosterKeyHandler = handleRosterKey;
  window.addEventListener('keydown', handleRosterKey);
}

function closeHeroRoster() {
  const modal = $('hero-roster-modal');
  if (modal) modal.hidden = true;
  heroViewer?.stop();
  if (window._rosterKeyHandler) {
    window.removeEventListener('keydown', window._rosterKeyHandler);
    window._rosterKeyHandler = null;
  }
}

function selectRosterHero(id) {
  const chars = rosterChars();
  const hero = chars.find(c => c.id === baseHeroId(id)) || chars[0];
  id = currentRosterHeroId = hero.id;
  const data = getHeroData(hero.id, hero.name);
  const storedId = store.get('char', chars[0].id);

  const availableChars = assets?.characters || [];
  const skins = (data.skins || []).filter(k => availableChars.some(c => c.id === k.id));
  if (!skins.some(k => k.id === currentRosterSkinId) || baseHeroId(currentRosterSkinId) !== id) {
    currentRosterSkinId = baseHeroId(storedId) === id && availableChars.some(c => c.id === storedId) ? storedId : id;
  }
  const isEquipped = currentRosterSkinId === storedId;

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
        updateRosterEquipButton(k.id === store.get('char', ''));
        if ($('dossier-status-pill')) {
          $('dossier-status-pill').textContent = k.id === store.get('char', '') ? 'EQUIPPED' : 'READY';
        }
        heroViewer?.show(k.id, currentRosterColor, currentRosterAnim);
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

  // Swatches
  currentRosterColor = data.defaultColor || '#f0a640';
  const swatchesEl = $('roster-swatches');
  if (swatchesEl) {
    swatchesEl.replaceChildren(...(data.swatches || [
      { name: 'Default', color: currentRosterColor },
      { name: 'Red', color: '#ef4444' },
      { name: 'Blue', color: '#3b82f6' }
    ]).map((s, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (idx === 0 ? ' on' : '');
      btn.style.setProperty('--c', s.color);
      btn.title = s.name;
      btn.setAttribute('aria-label', s.name + ' team shader');
      btn.onclick = () => {
        swatchesEl.querySelectorAll('.swatch').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        currentRosterColor = s.color;
        heroViewer?.setColor(s.color);
      };
      return btn;
    }));
  }

  heroViewer?.show(currentRosterSkinId, currentRosterColor, currentRosterAnim);
}

function updateRosterEquipButton(isEquipped) {
  const btn = $('btn-roster-equip');
  if (!btn) return;
  if (isEquipped) {
    btn.textContent = '✓ CURRENTLY EQUIPPED';
    btn.className = 'btn-equip-hero equipped';
    btn.disabled = true;
  } else {
    btn.textContent = 'EQUIP AS ACTIVE HERO';
    btn.className = 'btn-equip-hero';
    btn.disabled = false;
  }
}

function equipRosterHero(id) {
  store.set('char', id);
  store.set('equippedHero', id);
  currentRosterSkinId = id;
  updateLobbyHeroCard();
  selectRosterHero(baseHeroId(id));

  document.querySelectorAll('#roster-cards .roster-hero-item').forEach(el => {
    const isNowActive = el.dataset.id === baseHeroId(id);
    let badge = el.querySelector('.pill-active-mini');
    if (isNowActive && !badge) {
      badge = document.createElement('span');
      badge.className = 'pill-active-mini';
      badge.textContent = 'ACTIVE';
      el.appendChild(badge);
    } else if (!isNowActive && badge) {
      badge.remove();
    }
  });
}

/* ---- Settings & Controls Configuration Modal ---- */
function openSettings() {
  if (document.pointerLockElement) document.exitPointerLock();
  syncSettingsUI();
  const modal = $('settings-modal');
  if (modal) modal.hidden = false;
}

function closeSettings() {
  recordingAction = null;
  const modal = $('settings-modal');
  if (modal) modal.hidden = true;
}

function toggleSettings() {
  const modal = $('settings-modal');
  if (modal && modal.hidden) openSettings();
  else closeSettings();
}

function syncSettingsUI() {
  const sens = settings.sens || 22;
  const adsSens = settings.adsSens || 80;

  if ($('opt-sens')) {
    $('opt-sens').value = sens;
    if ($('opt-sens-num')) $('opt-sens-num').textContent = sens;
  }
  if ($('sens')) $('sens').value = sens;
  if ($('sens-value')) $('sens-value').textContent = sens;

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

  renderBindGrid();
}

function renderBindGrid() {
  const container = $('bind-grid');
  if (!container) return;
  container.innerHTML = '';

  for (const def of BIND_DEFS) {
    const row = document.createElement('div');
    row.className = 'bind-row';

    const label = document.createElement('span');
    label.className = 'bind-label';
    label.textContent = def.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bind-btn' + (recordingAction === def.id ? ' recording' : '');

    const currentKeys = settings.binds[def.id] || [];
    btn.textContent = recordingAction === def.id ? 'PRESS ANY KEY...' : (currentKeys.map(formatKeyCode).join(' / ') || 'Unbound');

    btn.onclick = () => {
      if (recordingAction === def.id) {
        recordingAction = null;
      } else {
        recordingAction = def.id;
      }
      renderBindGrid();
    };

    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function setupSettingsModal() {
  // Tab buttons
  document.querySelectorAll('#settings-modal .tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#settings-modal .tab-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const tabId = btn.dataset.tab;
      document.querySelectorAll('#settings-modal .tab-content').forEach(tc => {
        tc.hidden = tc.id !== tabId;
      });
    };
  });

  // Settings values change handlers
  $('opt-sens')?.addEventListener('input', e => {
    settings.sens = Number(e.target.value);
    store.set('sens', settings.sens);
    if ($('opt-sens-num')) $('opt-sens-num').textContent = settings.sens;
    if ($('sens')) $('sens').value = settings.sens;
    if ($('sens-value')) $('sens-value').textContent = settings.sens;
  });

  $('sens')?.addEventListener('input', e => {
    settings.sens = Number(e.target.value);
    store.set('sens', settings.sens);
    if ($('opt-sens')) $('opt-sens').value = settings.sens;
    if ($('opt-sens-num')) $('opt-sens-num').textContent = settings.sens;
    if ($('sens-value')) $('sens-value').textContent = settings.sens;
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
  });

  $('opt-reset-binds')?.addEventListener('click', () => {
    settings.binds = Object.assign({}, DEFAULT_BINDS);
    store.set('binds', JSON.stringify(settings.binds));
    rebuildCodeMap();
    renderBindGrid();
  });

  $('settings-close')?.addEventListener('click', closeSettings);
  $('settings-done')?.addEventListener('click', closeSettings);
  $('btn-settings-lobby')?.addEventListener('click', openSettings);
  $('btn-settings-lobby-link')?.addEventListener('click', openSettings);
  $('btn-settings-game')?.addEventListener('click', openSettings);
}

/* ---- Status Messages & Notifications ---- */
function message(text, type = '') {
  const m = $('message');
  if (!m) return;
  if (!text) {
    m.hidden = true;
    m.textContent = '';
    return;
  }
  m.hidden = false;
  m.className = type;
  m.textContent = text;

  const sessionStatus = $('terminal-session-status');
  if (sessionStatus) sessionStatus.textContent = text;
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
  const seed = map === 'sandbox' ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const char = store.get('char', 'abdulkarim');

  message('Deploying offline practice match with bots...');
  try {
    world = buildWorld(assets, map, seed);
    await prepareView(world);

    session = new HostSession({
      signaling: null,
      NetHostClass: LocalNetHost,
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

    await session.start();
    session.addBot('Recon-Alpha', 'mina', 'medium');
    session.addBot('Heavy-Bravo', 'robot', 'medium');
    hud.session = session;
    message('');
    showGame(true);
  } catch (e) {
    session = null;
    console.error('Practice match error:', e);
    message('Could not start practice match: ' + e.message, 'error');
  }
}

async function hostOnlineMatch() {
  if (session || !assets) return;
  const roomName = cleanName($('room-name')?.value, 32, playerName() + "'s Arena");
  const map = $('map-select')?.value || 'foundry';
  const mode = $('mode-select')?.value || 'ffa';
  const maxPlayers = parseInt($('max-players-select')?.value || '6', 10);
  const isPrivate = $('is-private-checkbox')?.checked || false;
  const seed = map === 'sandbox' ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const char = store.get('char', 'abdulkarim');

  if (!signaling || !signaling.connected) {
    message('Connecting to matchmaking server on port 8080...');
    try {
      await signaling.connect(2000);
    } catch {
      message('Matchmaking server offline. Launching practice match with bots...');
      await new Promise(r => setTimeout(r, 600));
      return await startPracticeMatch();
    }
  }

  message('Creating match on online server...');
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
    message('');
    showGame(true);
    console.log(`[Spectre Orbit] Match hosted. Code: ${code}`);
  } catch (e) {
    session = null;
    console.error('Host error:', e);
    message('Could not create online room: ' + e.message, 'error');
  }
}

async function joinOnlineMatch(code) {
  if (session || !assets) return;
  const char = store.get('char', 'abdulkarim');
  const cleanCode = (code || '').trim().toUpperCase();

  if (!cleanCode) {
    message('Please enter a 5-character match code', 'error');
    return;
  }

  message(`Connecting to match [${cleanCode}]...`);
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

    await s.join({ code: cleanCode }, statusText => message(statusText));

    world = buildWorld(assets, s.map, s.seed);
    await prepareView(world);
    s.client.world = world;

    message('');
    hud.session = s;
    showGame(true);
  } catch (e) {
    session = null;
    console.error('Join error:', e);
    message(e instanceof LinkError ? e.message : 'Could not join match: ' + e.message, 'error');
  }
}

async function quickMatch() {
  if (!signaling) return;
  message('Finding best available public match...');
  signaling.send({ t: 'list_rooms' });

  const unList = signaling.on('room_list', async msg => {
    unList();
    const rooms = (msg.rooms || []).filter(r => r.players < r.max);
    if (rooms.length > 0) {
      rooms.sort((a, b) => b.players - a.players);
      await joinOnlineMatch(rooms[0].code);
    } else {
      message('No public matches found. Creating a new match...');
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
  message(typeof reason === 'string' ? reason : '', typeof reason === 'string' ? 'error' : '');
  refreshRoomList();
}

function refreshRoomList() {
  if (signaling && signaling.connected) {
    signaling.send({ t: 'list_rooms' });
  }
}

function renderRoomList(rooms = []) {
  const ul = $('rooms');
  const empty = $('no-rooms');
  const countLabel = $('room-count');
  const termRoomboard = $('term-roomboard');

  if (countLabel) {
    countLabel.textContent = `${String(rooms.length).padStart(2, '0')} ${rooms.length === 1 ? 'ROOM' : 'ROOMS'} FOUND`;
    countLabel.classList.toggle('connected', rooms.length > 0);
  }
  if (termRoomboard) {
    termRoomboard.textContent = `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} active`;
  }

  if (!ul) return;
  ul.innerHTML = '';

  if (rooms.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  for (const r of rooms) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="room-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div>
          <b>${r.name}</b>
          <span class="hint" style="margin-left:8px;">${r.map.toUpperCase()} · ${r.mode.toUpperCase()} · Host: ${r.host}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="micro-label">${r.players}/${r.max} PLAYERS</span>
          <button class="ghost small-btn btn-join-room" data-code="${r.code}">JOIN →</button>
        </div>
      </div>
    `;
    li.querySelector('.btn-join-room').onclick = () => joinOnlineMatch(r.code);
    ul.appendChild(li);
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
    if (session && document.pointerLockElement !== canvas && $('settings-modal').hidden && $('hero-roster-modal').hidden) {
      canvas.requestPointerLock();
    }
  };

  document.addEventListener('pointerlockchange', () => {
    const active = document.pointerLockElement === canvas;
    if (session) session.client.active = active;
  });

  window.addEventListener('mousemove', e => {
    if (!session || document.pointerLockElement !== canvas || !$('settings-modal').hidden) return;
    const isSniper = session.client.aiming && (session.client.me?.w === 2);
    const adsMult = (settings.adsSens || 80) / 100;
    const adsScale = session.client.aiming ? (isSniper ? 0.25 * adsMult : 0.6 * adsMult) : 1.0;
    const baseSens = (settings.sens || 22) * 0.0001;
    const invertY = settings.invertY ? -1 : 1;

    session.client.look.yaw -= e.movementX * baseSens * adsScale;
    session.client.look.pitch = Math.max(-1.55, Math.min(1.55, session.client.look.pitch - e.movementY * baseSens * adsScale * invertY));
  });

  window.addEventListener('mousedown', e => {
    if (!session || !$('settings-modal').hidden) return;
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

    if (e.code === 'Escape' && !$('settings-modal').hidden) {
      closeSettings();
      return;
    }

    if (!session || document.pointerLockElement !== canvas) {
      if (e.code === 'KeyO' && session) { toggleSettings(); e.preventDefault(); }
      return;
    }

    const actions = codeMap.get(e.code);
    if (!actions) {
      if (e.code === 'Tab') { hud.showBoard = true; e.preventDefault(); }
      if (e.code === 'KeyO') { toggleSettings(); e.preventDefault(); }
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
async function bootstrap() {
  // Load saved preferences
  let crt = false;
  try { crt = store.get('crt', 'false') === 'true'; } catch {}
  setCrtEnabled(crt);

  $('btn-crt-toggle')?.addEventListener('click', () => {
    setCrtEnabled(!document.documentElement.classList.contains('crt-enabled'));
  });

  // Name identity sync
  const nameInput = $('name');
  if (nameInput) {
    const savedName = store.get('name', 'Ghost');
    nameInput.value = savedName;
    const syncName = () => {
      const n = nameInput.value.trim();
      if ($('term-operator')) $('term-operator').textContent = n || 'not assigned';
      if ($('lamp-identity')) {
        $('lamp-identity').classList.toggle('lit', !!n);
        $('lamp-identity').setAttribute('aria-label', n ? 'Callsign assigned' : 'Callsign not assigned');
      }
      store.set('name', n);
    };
    nameInput.addEventListener('input', syncName);
    syncName();
  }

  // Volume slider
  const volInput = $('volume');
  if (volInput) {
    volInput.value = store.get('volume', '50');
    if ($('volume-value')) $('volume-value').textContent = volInput.value + '%';
    volInput.addEventListener('input', () => {
      if ($('volume-value')) $('volume-value').textContent = volInput.value + '%';
      store.set('volume', volInput.value);
    });
  }

  // Briefing listeners
  updateBriefing();
  $('map-select')?.addEventListener('change', updateBriefing);
  $('mode-select')?.addEventListener('change', updateBriefing);

  setupInputHandlers();
  setupSettingsModal();

  // Load 3D assets
  assets = await loadAssets();

  // Initialize lobby character preview
  updateLobbyHeroCard();

  // Button bindings
  $('btn-quick-match')?.addEventListener('click', quickMatch);
  $('btn-host-match')?.addEventListener('click', hostOnlineMatch);
  $('btn-practice-match')?.addEventListener('click', startPracticeMatch);
  $('btn-refresh-rooms')?.addEventListener('click', refreshRoomList);
  $('btn-join-code')?.addEventListener('click', () => {
    const code = $('input-join-code')?.value;
    if (code) joinOnlineMatch(code);
  });
  $('btn-header-roster')?.addEventListener('click', () => openHeroRoster(store.get('char', 'abdulkarim')));
  $('btn-lobby-roster')?.addEventListener('click', () => openHeroRoster(store.get('char', 'abdulkarim')));
  $('roster-close')?.addEventListener('click', closeHeroRoster);

  $('leave')?.addEventListener('click', () => leaveMatch('Left match'));
  $('btn-scores-game')?.addEventListener('click', () => { hud.showBoard = !hud.showBoard; });

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
  signaling = new OnlineSignalingClient(serverUrl);

  signaling.on('status', text => updateServerStatus(text, true));
  signaling.on('room_list', msg => renderRoomList(msg.rooms || []));
  signaling.on('close', () => updateServerStatus('Disconnected from server. Reconnecting...', false));
  signaling.on('error', err => updateServerStatus('Server error: ' + (err.message || 'unreachable'), false));

  updateServerStatus('Connecting to matchmaking server...', false);

  try {
    await signaling.connect();
    updateServerStatus('Online · Connected to Matchmaking', true);
    refreshRoomList();
    setInterval(refreshRoomList, 8000);
  } catch (err) {
    updateServerStatus('Offline (Port 8080) · Practice Mode available', false);
    console.warn('[Spectre Orbit] Matchmaking connect failed:', err);
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
  openHeroRoster,
  closeHeroRoster,
  openSettings,
  closeSettings,
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
