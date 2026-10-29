/* Page wiring: shared-folder lobby, then the match. */
import { Lobby, LinkError, randomHex, cleanName, StorageDirectory } from './net.js';
import { HostSession, GuestSession } from './game.js';
import { View, CharacterPreview, HeroViewer, loadAssets, buildWorld } from './render.js';
import { Hud, Sound } from './hud.js';
import { B } from './sim.js';
import { HERO_ROSTER, getHeroData, SKIN_OF, baseHeroId } from './heroes.js';
import { initInterface, connectedUI, roomCountUI, updateBriefing } from './ui.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem('lanfps.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lanfps.' + k, v); } catch {} },
};

// A fresh id per tab: each tab is its own player.
const myId = randomHex(8);
let lobby = null, session = null, view = null, world = null, assets = null, refreshTimer = null;
const hud = new Hud(), sound = new Sound();

/* ---- online updater & version check ---- */
const CURRENT_VERSION = window.LANFPS_VERSION || '1.4.3';
const UPDATE_CONFIG = {
  versionUrl: 'https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/version.json',
  bundleUrl: 'https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/LAN_FPS.html',
};

/* In-place update: the page asks once for its own LAN_FPS.html (File System Access API), keeps
   that handle, and rewrites the file with the published build, then reloads. Browsers without the
   API fall back to a plain download. */
const canWriteInPlace = () => typeof window.showSaveFilePicker === 'function';

// Needs a user gesture: re-asks permission for the remembered file, or opens the picker the first time.
async function getUpdateTarget() {
  const saved = await idb('readonly', s => s.get('updateTarget')).catch(() => null);
  if (saved) {
    try {
      const opts = { mode: 'readwrite' };
      if ((await saved.queryPermission(opts)) === 'granted' || (await saved.requestPermission(opts)) === 'granted') return saved;
    } catch {}
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: 'LAN_FPS.html',
    types: [{ description: 'LAN_FPS game file', accept: { 'text/html': ['.html'] } }],
  });
  idb('readwrite', s => s.put(handle, 'updateTarget')).catch(() => {});  // remembered for next time; never blocks the update
  return handle;
}

async function hasGrantedTarget() {
  const saved = await idb('readonly', s => s.get('updateTarget')).catch(() => null);
  return !!saved && (await saved.queryPermission({ mode: 'readwrite' }).catch(() => '')) === 'granted';
}

async function applyUpdate(info, setStatus) {
  let target = null;
  if (canWriteInPlace()) {
    setStatus('Choose your LAN_FPS.html to update it…');
    try { target = await getUpdateTarget(); }
    catch (e) { if (e?.name === 'AbortError') { setStatus('Update cancelled'); return; } }
  }
  setStatus(`Downloading v${info.version}…`);
  try {
    const res = await fetch(UPDATE_CONFIG.bundleUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Status ' + res.status);
    const text = await res.text();
    // Never overwrite the game with a truncated page or a stale cached build.
    if (text.length < 1e6 || !/^\s*<!doctype html/i.test(text) || !text.includes('LANFPS_VERSION=' + JSON.stringify(info.version))) {
      setStatus('Build still publishing, try again in a few minutes');
      return;
    }
    if (target) {
      const out = await target.createWritable();
      await out.write(text);
      await out.close();
      setStatus(`Updated to v${info.version}, restarting…`);
      setTimeout(() => location.reload(), 900);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'LAN_FPS.html';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setStatus('Downloaded: replace LAN_FPS.html with it');
  } catch (err) {
    console.warn('Update failed:', err);
    setStatus('Update failed. Try again');
  }
}

// True when version a is newer than b (dotted numbers); a stale or older remote never counts as an update.
function isNewer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkUpdate(manual = false) {
  const btn = $('btn-check-update');
  const banner = $('update-banner');
  if (btn) btn.textContent = 'Checking…';
  try {
    const res = await fetch(UPDATE_CONFIG.versionUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Status ' + res.status);
    const data = await res.json();
    if (data.version && isNewer(data.version, CURRENT_VERSION)) {
      const dlBtn = $('btn-download-update');
      const setStatus = text => { if (dlBtn) dlBtn.textContent = text; if (btn) btn.textContent = text; };
      if (banner) {
        $('update-title').textContent = `New update available: v${data.version}`;
        $('update-notes').textContent = data.notes ? `(${data.notes})` : '';
        if (dlBtn) {
          dlBtn.href = UPDATE_CONFIG.bundleUrl;
          dlBtn.textContent = canWriteInPlace() ? 'Update Now' : 'Download Update';
          dlBtn.onclick = e => { e.preventDefault(); applyUpdate(data, setStatus); };
        }
        banner.hidden = false;
      }
      if (btn) btn.textContent = `Update available (v${data.version})`;
      // Pressing the button means "update me": do it right away, while the click still counts as a gesture.
      if (manual) await applyUpdate(data, setStatus);
      // On launch, update with no click when the remembered file already has write permission.
      else if (await hasGrantedTarget()) await applyUpdate(data, setStatus);
    } else {
      if (btn) {
        btn.textContent = `Up to date (v${CURRENT_VERSION})`;
        setTimeout(() => { if (btn) btn.textContent = 'Check for updates'; }, 4000);
      }
      if (manual && banner) banner.hidden = true;
    }
  } catch (e) {
    console.warn('Update check failed:', e);
    if (btn) {
      btn.textContent = manual ? 'Offline / Unreachable' : 'Check for updates';
      if (manual) setTimeout(() => { if (btn) btn.textContent = 'Check for updates'; }, 4000);
    }
  }
}

/* ---- remembered folder (IndexedDB keeps the handle between visits) ---- */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lanfps', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { const tx = req.result.transaction('kv', mode), r = fn(tx.objectStore('kv')); tx.oncomplete = () => resolve(r?.result); tx.onerror = () => reject(tx.error); };
  });
}
const saveFolder = h => idb('readwrite', s => s.put(h, 'folder')).catch(() => {});
const savedFolder = () => idb('readonly', s => s.get('folder')).catch(() => null);

function message(text, kind = '') {
  const el = $('message'); el.textContent = text; el.className = kind; el.hidden = !text;
}

async function useFolder(handle, label) {
  try {
    lobby = await new Lobby(handle).open();
    $('folder-name').textContent = label;
    $('rooms-panel').hidden = false;
    connectedUI(label);
    message('');
    refreshRooms();
  } catch (e) { message('Cannot use that folder: ' + e.message, 'error'); }
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) return message('This browser cannot open shared folders. Use Chrome or Edge.', 'error');
  try {
    const h = await showDirectoryPicker({ id: 'lanfps', mode: 'readwrite' });
    await saveFolder(h);
    useFolder(h, h.name);
  } catch (e) { if (e.name !== 'AbortError') message(e.message, 'error'); }
}

async function reconnectFolder(h) {
  try {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return message('Permission to use the folder was refused.', 'error');
    useFolder(h, h.name);
  } catch (e) { message(e.message, 'error'); }
}

async function useThisPC() {
  try {
    await useFolder(await navigator.storage.getDirectory(), 'This PC only (browser storage, for testing)');
  } catch (e) {
    try {
      const fallback = new StorageDirectory('_lanfps_storage:');
      await useFolder(fallback, 'This PC only (local storage fallback)');
    } catch (e2) {
      message('Browser storage is not available here: ' + e.message, 'error');
    }
  }
}

/* ---- room list ---- */
async function refreshRooms() {
  clearTimeout(refreshTimer);
  if (!lobby || session) return;
  try {
    const rooms = await lobby.rooms(), list = $('rooms');
    // Rebuild only on change, so a Join button is never swapped out mid-click.
    const sig = JSON.stringify(rooms);
    if (sig !== list.dataset.sig) {
      list.dataset.sig = sig;
      const MAP_LABELS = { aftermath: 'Aftermath', river: 'River Forest', forest: 'Forest', sandbox: 'Sandbox', arena: 'Arena' };
      list.replaceChildren(...rooms.map(r => {
        const li = document.createElement('li');
        const full = r.players >= r.max;
        li.innerHTML = `<div><b></b><span></span></div><button ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>`;
        li.querySelector('b').textContent = r.name;
        const mapTag = MAP_LABELS[r.map] || 'Aftermath';
        const modeTag = r.mode === 'tdm' ? 'TDM' : 'FFA';
        li.querySelector('span').textContent = `${r.host} · ${r.players}/${r.max} players · ${mapTag} · ${modeTag} · ${r.code}`;
        li.querySelector('button').onclick = () => join(r);
        return li;
      }));
    }
    $('no-rooms').hidden = rooms.length > 0;
    roomCountUI(rooms.length);
  } catch (e) { message('Cannot read the shared folder: ' + e.message, 'error'); }
  refreshTimer = setTimeout(refreshRooms, 1000);
}

function playerName() {
  const n = cleanName($('name').value, 20, 'Player');
  store.set('name', n);
  return n;
}

/* ---- hero roster & character viewer (standalone showcase) ---- */
let heroViewer = null;
let currentRosterHeroId = null;
let currentRosterSkinId = null;
// Roster cards list heroes only; extra skin models are chosen with the Outfit buttons.
const rosterChars = () => assets.characters.filter(c => !SKIN_OF[c.id]);
let currentRosterColor = '#f0a640';
let currentRosterAnim = 'idle';

let lobbyPortrait = null;
function drawLobbyPortrait() {
  if (!lobbyPortrait) return;
  const canvas = $('lobby-portrait'), w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  lobbyPortrait.renderer.setSize(w, h, false);
  lobbyPortrait.camera.aspect = w / h;
  lobbyPortrait.camera.position.set(0, 1.6, 1.55);
  lobbyPortrait.camera.lookAt(0, 1.45, 0);
  lobbyPortrait.camera.updateProjectionMatrix();
  lobbyPortrait.renderer.render(lobbyPortrait.scene, lobbyPortrait.camera);
}
function updateLobbyHeroCard() {
  if (!assets || !assets.characters || assets.characters.length === 0) return;
  const activeId = store.get('char', assets.characters[0]?.id || 'abdulkarim');
  const heroChar = assets.characters.find(c => c.id === activeId) || assets.characters[0];
  const hero = getHeroData(activeId, heroChar?.name);
  const shown = rosterChars();
  const heroIdx = shown.findIndex(c => c.id === baseHeroId(heroChar?.id));
  if ($('hero-equipped-avatar')) $('hero-equipped-avatar').textContent = String(Math.max(0, heroIdx) + 1).padStart(2, '0');
  if ($('hero-equipped-name')) $('hero-equipped-name').textContent = hero.name;
  if ($('hero-equipped-badge')) $('hero-equipped-badge').textContent = hero.classType || 'ASSAULT';
  if ($('hero-equipped-role')) $('hero-equipped-role').textContent = `${hero.title} · Signature: ${hero.signatureWeapon}`;
  // A still portrait from the equipped game model; no extra animation loop.
  if ($('lobby-portrait')) {
    if (!lobbyPortrait) {
      lobbyPortrait = new CharacterPreview($('lobby-portrait'), assets);
      new ResizeObserver(drawLobbyPortrait).observe($('lobby-portrait'));
    }
    lobbyPortrait.show(heroChar.id);
    lobbyPortrait.previewModel?.userData?.mixer?.update(0);
    drawLobbyPortrait();
  }
}

function openHeroRoster(selectedHeroId = null) {
  if (!assets) return;
  if (document.pointerLockElement) document.exitPointerLock();
  const modal = $('hero-roster-modal');
  if (!modal) return;

  const chars = rosterChars();
  if (!chars || chars.length === 0) return;

  const activeId = baseHeroId(store.get('char', chars[0].id));
  currentRosterHeroId = baseHeroId(selectedHeroId || activeId || chars[0].id);

  if (!heroViewer) {
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

  // Set up animation buttons
  document.querySelectorAll('#roster-anim-group .anim-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#roster-anim-group .anim-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      currentRosterAnim = btn.dataset.anim;
      heroViewer.playAnimation(currentRosterAnim);
    };
  });

  // Set up spin button
  if ($('roster-btn-spin')) {
    $('roster-btn-spin').onclick = () => {
      const spinning = heroViewer.toggleSpin();
      $('roster-btn-spin').textContent = spinning ? '↻ Spin: ON' : '↻ Spin: OFF';
    };
  }

  // Set up reset view button
  if ($('roster-btn-reset')) {
    $('roster-btn-reset').onclick = () => {
      heroViewer.resetView();
    };
  }

  // Set up equip button
  if ($('btn-roster-equip')) {
    $('btn-roster-equip').onclick = () => {
      equipRosterHero(currentRosterSkinId || currentRosterHeroId);
    };
  }

  selectRosterHero(currentRosterHeroId);

  modal.hidden = false;
  heroViewer.start();

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

function selectRosterHero(id) {
  const chars = rosterChars();
  const hero = chars.find(c => c.id === baseHeroId(id)) || chars[0];
  id = currentRosterHeroId = hero.id;
  const data = getHeroData(hero.id, hero.name);
  const storedId = store.get('char', chars[0].id);
  // Show the equipped outfit when this hero is the equipped one, otherwise the default model.
  const skins = (data.skins || []).filter(k => assets.characters.some(c => c.id === k.id));
  if (!skins.some(k => k.id === currentRosterSkinId) || baseHeroId(currentRosterSkinId) !== id) {
    currentRosterSkinId = baseHeroId(storedId) === id && assets.characters.some(c => c.id === storedId) ? storedId : id;
  }
  const isEquipped = currentRosterSkinId === storedId;

  // Highlight card in sidebar
  document.querySelectorAll('#roster-cards .roster-hero-item').forEach(el => {
    el.classList.toggle('on', el.dataset.id === id);
  });

  // Outfit (skin) buttons, only for heroes that ship more than one model
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
        $('dossier-status-pill').textContent = k.id === store.get('char', '') ? 'EQUIPPED' : 'READY';
        heroViewer.show(k.id, currentRosterColor, currentRosterAnim);
      };
      return btn;
    }));
  }

  // Update overlay badges
  if ($('roster-hero-badge-icon')) $('roster-hero-badge-icon').textContent = String(chars.indexOf(hero) + 1).padStart(2, '0');
  if ($('roster-hero-class')) $('roster-hero-class').textContent = data.classType || 'ASSAULT';

  // Update dossier details
  if ($('dossier-name')) $('dossier-name').textContent = data.name.toUpperCase();
  if ($('dossier-subtitle')) $('dossier-subtitle').textContent = data.title;
  if ($('dossier-status-pill')) {
    $('dossier-status-pill').textContent = isEquipped ? 'EQUIPPED' : 'READY';
    $('dossier-status-pill').className = isEquipped ? 'pill-equipped' : 'pill-equipped off';
  }

  // Update stats
  const stats = data.stats || { mobility: 75, durability: 75, precision: 75, firepower: 75 };
  if ($('stat-mobility')) $('stat-mobility').style.width = stats.mobility + '%';
  if ($('stat-mobility-val')) $('stat-mobility-val').textContent = stats.mobility;
  if ($('stat-durability')) $('stat-durability').style.width = stats.durability + '%';
  if ($('stat-durability-val')) $('stat-durability-val').textContent = stats.durability;
  if ($('stat-precision')) $('stat-precision').style.width = stats.precision + '%';
  if ($('stat-precision-val')) $('stat-precision-val').textContent = stats.precision;
  if ($('stat-firepower')) $('stat-firepower').style.width = stats.firepower + '%';
  if ($('stat-firepower-val')) $('stat-firepower-val').textContent = stats.firepower;

  // Update weapon & perks
  if ($('dossier-weapon')) $('dossier-weapon').textContent = data.signatureWeapon;
  if ($('dossier-weapon-icon')) $('dossier-weapon-icon').textContent = data.signatureIcon || '🔫';
  if ($('dossier-trait')) $('dossier-trait').textContent = data.trait;
  if ($('dossier-trait-desc')) $('dossier-trait-desc').textContent = data.traitDesc;
  if ($('dossier-bio')) $('dossier-bio').textContent = data.bio;

  // Update equip button
  updateRosterEquipButton(isEquipped);

  // Generate color swatches
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
        heroViewer.setColor(s.color);
      };
      return btn;
    }));
  }

  // Update 3D viewport
  heroViewer.show(currentRosterSkinId, currentRosterColor, currentRosterAnim);
}

function updateRosterEquipButton(isEquipped) {
  const btn = $('btn-roster-equip');
  if (!btn) return;
  if (isEquipped) {
    const hadFocus = document.activeElement === btn;
    btn.textContent = '✓ CURRENTLY EQUIPPED';
    btn.className = 'btn-equip-hero equipped';
    btn.disabled = true;
    if (hadFocus) document.querySelector('#roster-cards .roster-hero-item.on')?.focus();
  } else {
    btn.textContent = 'EQUIP AS ACTIVE HERO';
    btn.className = 'btn-equip-hero';
    btn.disabled = false;
  }
}

function equipRosterHero(id) {
  store.set('char', id);
  currentRosterSkinId = id;
  updateLobbyHeroCard();
  selectRosterHero(baseHeroId(id));
  selectEquippedCharacter?.(id);

  // Update sidebar active badge
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

  if (sound) sound.click?.();
}

function closeHeroRoster() {
  const modal = $('hero-roster-modal');
  if (modal) modal.hidden = true;
  if (heroViewer) heroViewer.stop();
  if (window._rosterKeyHandler) {
    window.removeEventListener('keydown', window._rosterKeyHandler);
    window._rosterKeyHandler = null;
  }
}

/* ---- character select (shown before entering the map) ---- */
let preview = null, picking = null, selectEquippedCharacter = null;

function chooseCharacter(subtitle) {
  if (picking) return Promise.resolve(null);
  const chars = assets.characters;
  let i = Math.max(0, chars.findIndex(c => c.id === store.get('char', '')));
  preview ||= new CharacterPreview($('preview'), assets);
  $('select-sub').textContent = subtitle;
  $('char-list').replaceChildren(...chars.map((c, n) => {
    const b = document.createElement('button'); b.textContent = c.name; b.onclick = () => show(n); return b;
  }));
  // Browsing makes no sense with a single character, so hide the arrows then.
  $('char-prev').hidden = $('char-next').hidden = $('char-list').hidden = chars.length < 2;
  const show = n => {
    i = (n + chars.length) % chars.length;
    preview.show(chars[i].id);
    $('char-name').textContent = chars[i].name;
    [...$('char-list').children].forEach((b, k) => b.classList.toggle('on', k === i));
  };
  show(i);
  selectEquippedCharacter = id => { const index = chars.findIndex(c => c.id === id); if (index >= 0) show(index); };
  $('select').hidden = false; preview.start();
  return new Promise(resolve => {
    const done = id => {
      picking = null; selectEquippedCharacter = null; $('select').hidden = true; preview.stop();
      removeEventListener('keydown', keys, true);
      if (id) {
        store.set('char', id);
        updateLobbyHeroCard();
      }
      resolve(id);
    };
    const keys = e => {
      if (!$('hero-roster-modal').hidden) return;
      if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
      if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === 'ArrowRight') show(i + 1);
      else if (e.key === 'Enter') done(chars[i].id); else if (e.key === 'Escape') done(null);
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    addEventListener('keydown', keys, true);
    $('char-prev').onclick = () => show(i - 1);
    $('char-next').onclick = () => show(i + 1);
    $('select-go').onclick = () => done(chars[i].id);
    $('select-back').onclick = () => done(null);
    if ($('select-open-roster')) {
      $('select-open-roster').onclick = () => {
        openHeroRoster(chars[i].id);
      };
    }
    picking = done;
  });
}

/* ---- entering and leaving a match ---- */
function prepareView(w = world) {
  if (!view) view = new View($('view'), w, assets);
  else view.setWorld(w);
  return view;
}

function showGame(on) {
  $('lobby').hidden = on; $('game').hidden = !on;
  if ($('host-bot-controls')) {
    $('host-bot-controls').hidden = !(on && session instanceof HostSession);
  }
  if (on) { view.resize(); requestAnimationFrame(frame); }
}

// `char` skips the select screen (for the debug handle); a click passes an event instead.
async function host(char) {
  if (session || !assets) return;
  const roomName = cleanName($('room-name').value, 32, playerName() + "'s room");
  const map = $('map-select')?.value || 'foundry';
  const mode = $('mode-select')?.value || 'ffa';
  const seed = map === 'sandbox' ? Math.floor(Math.random() * 900000 + 100000) : 0;
  const mapTitle = {
    foundry: 'Foundry Core',
    glowplant: 'Reactor Complex',
    zenith: 'Zenith Atrium',
    aftermath: 'Aftermath (MoH Ruins)',
    river: 'River Forest',
    forest: 'Pine Forest',
    sandbox: 'Random Sandbox',
    arena: 'Classic Arena'
  }[map] || 'Foundry Core';
  const modeTitle = mode === 'tdm' ? 'Team Deathmatch' : 'Free For All';
  if (typeof char !== 'string') char = await chooseCharacter(`Creating "${roomName}" · ${mapTitle} · ${modeTitle}`);
  if (!char || session) return;
  store.set('room', roomName);
  store.set('map', map);
  store.set('mode', mode);
  try {
    world = buildWorld(assets, map, seed);
    prepareView(world);
    session = new HostSession({ lobby, world, id: myId, name: playerName(), char, roomName, map, seed, mode, view, hud, audio: sound, onExit: leave });
    await session.start();
    hud.session = session; showGame(true);
  } catch (e) {
    session = null;
    console.error('Host error:', e);
    message('Could not create the room: ' + e.message, 'error');
  }
}

async function join(room, char) {
  if (session || !assets) return;
  const map = room.map || 'foundry';
  const seed = room.seed || 0;
  const mode = room.mode || 'ffa';
  const mapTitle = {
    foundry: 'Foundry Core',
    glowplant: 'Reactor Complex',
    zenith: 'Zenith Atrium',
    aftermath: 'Aftermath (MoH Ruins)',
    river: 'River Forest',
    forest: 'Pine Forest',
    sandbox: 'Random Sandbox',
    arena: 'Classic Arena'
  }[map] || 'Foundry Core';
  const modeTitle = mode === 'tdm' ? 'Team Deathmatch' : 'Free For All';
  if (typeof char !== 'string') char = await chooseCharacter(`Joining "${room.name}" · ${mapTitle} · ${modeTitle} · hosted by ${room.host}`);
  if (!char || session) return;
  try {
    world = buildWorld(assets, map, seed);
    prepareView(world);
    const s = session = new GuestSession({ lobby, world, id: myId, name: playerName(), char, map, seed, mode, view, hud, audio: sound, onExit: msg => leave(msg) });
    message('Connecting to ' + room.host + '…', 'info');
    await s.join(room, text => message(text, 'info'));
    message('');
    hud.session = s; showGame(true);
  } catch (e) {
    session = null;
    console.error('Join error:', e);
    message(e instanceof LinkError ? e.message : 'Could not join: ' + e.message, 'error');
    refreshRooms();
  }
}

async function leave(reason) {
  const s = session; if (!s) return;
  session = null; hud.session = null;
  if (document.pointerLockElement) document.exitPointerLock();
  try { await s.stop(); } catch {}
  showGame(false);
  message(typeof reason === 'string' ? reason : '', typeof reason === 'string' ? 'error' : '');
  refreshRooms();
}

let lastFrame = 0;
function frame(t) {
  if (!session) return;
  const dt = Math.min(0.1, (t - (lastFrame || t)) / 1000); lastFrame = t;
  session.client.frame(dt);
  requestAnimationFrame(frame);
}

/* ---- Settings & Controls Configuration ---- */
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

function openSettings() {
  if (document.pointerLockElement) document.exitPointerLock();
  syncSettingsUI();
  $('settings-modal').hidden = false;
}

function closeSettings() {
  recordingAction = null;
  $('settings-modal').hidden = true;
}

function toggleSettings() {
  if ($('settings-modal').hidden) openSettings();
  else closeSettings();
}

function syncSettingsUI() {
  const sens = settings.sens || 22;
  const adsSens = settings.adsSens || 80;
  if ($('opt-sens')) {
    $('opt-sens').value = sens;
    $('opt-sens-num').textContent = sens;
  }
  if ($('sens')) $('sens').value = sens;
  $('sens-value').textContent = sens;

  if ($('opt-ads-sens')) {
    $('opt-ads-sens').value = adsSens;
    $('opt-ads-sens-num').textContent = (adsSens / 100).toFixed(2) + 'x';
  }
  if ($('opt-invert-y')) $('opt-invert-y').checked = !!settings.invertY;

  if ($('opt-crouch-hold')) $('opt-crouch-hold').classList.toggle('on', settings.crouchMode === 'hold');
  if ($('opt-crouch-toggle')) $('opt-crouch-toggle').classList.toggle('on', settings.crouchMode === 'toggle');

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
    label.textContent = def.name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bind-btn';
    if (recordingAction === def.id) {
      btn.classList.add('recording');
      btn.textContent = 'Press Key…';
    } else {
      const keys = settings.binds[def.id] || [];
      btn.textContent = keys.length ? keys.map(formatKeyCode).join(' / ') : 'None';
    }

    btn.onclick = e => {
      e.stopPropagation();
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

/* ---- input ---- */
addEventListener('keydown', e => {
  if (recordingAction) {
    e.preventDefault();
    e.stopPropagation();
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

  if ((e.target.matches('input,select,button,a') && !session?.client.active) || !$('settings-modal').hidden || !$('hero-roster-modal').hidden) return;

  if (!session) return;
  const c = session.client;

  const actions = codeMap.get(e.code);
  if (!actions) {
    if (e.code === 'Tab') { hud.showBoard = true; e.preventDefault(); }
    if (e.code === 'KeyO') { toggleSettings(); e.preventDefault(); }
    return;
  }

  for (const act of actions) {
    if (act.bit) {
      if (act.id === 'crouch') {
        if (settings.crouchMode === 'toggle') {
          crouchToggled = !crouchToggled;
          if (crouchToggled) c.input.b |= B.CROUCH;
          else c.input.b &= ~B.CROUCH;
        } else {
          c.input.b |= B.CROUCH;
        }
      } else {
        c.input.b |= act.bit;
      }
      e.preventDefault();
    } else if (act.action === 'melee') {
      c.input.melee = true;
      e.preventDefault();
    } else if (act.action === 'grenade') {
      c.input.grenade = true;
      e.preventDefault();
    } else if (act.action === 'reload') {
      c.input.reload = true;
      e.preventDefault();
    } else if (act.action === 'quickSwitch') {
      c.cycleWeapon(1);
      e.preventDefault();
    } else if (act.action.startsWith('wep')) {
      const w = parseInt(act.action.slice(3), 10) - 1;
      if (w >= 0 && w < 6) c.setWeapon(w);
      e.preventDefault();
    }
  }
});

addEventListener('keyup', e => {
  if (!session) return;
  const c = session.client;
  const actions = codeMap.get(e.code);
  if (!actions) {
    if (e.code === 'Tab') hud.showBoard = false;
    return;
  }

  for (const act of actions) {
    if (act.bit) {
      if (act.id === 'crouch') {
        if (settings.crouchMode !== 'toggle') {
          c.input.b &= ~B.CROUCH;
        }
      } else {
        c.input.b &= ~act.bit;
      }
    }
  }
});

addEventListener('wheel', e => {
  if (!session || !session.client.active) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  session.client.cycleWeapon(dir);
}, { passive: true });

addEventListener('blur', () => {
  if (session) {
    session.client.input.b = 0;
    session.client.aiming = false;
    crouchToggled = false;
  }
  hud.showBoard = false;
});

$('view').addEventListener('contextmenu', e => e.preventDefault());
$('view').addEventListener('mousedown', e => {
  if (!session || !$('settings-modal').hidden) return;
  sound.ensure();
  if (document.pointerLockElement !== $('view')) { $('view').requestPointerLock()?.catch?.(() => {}); return; }
  if (e.button === 0) session.client.input.b |= B.FIRE;
  if (e.button === 2) session.client.aiming = true;
});
addEventListener('mouseup', e => {
  if (!session) return;
  if (e.button === 0) session.client.input.b &= ~B.FIRE;
  if (e.button === 2) session.client.aiming = false;
});
$('center').addEventListener('click', () => {
  if ($('settings-modal').hidden) $('view').requestPointerLock()?.catch?.(() => {});
});
document.addEventListener('pointerlockchange', () => {
  if (!session) return;
  session.client.active = document.pointerLockElement === $('view');
  if (!session.client.active) {
    session.client.input.b = 0;
    session.client.aiming = false;
    crouchToggled = false;
  }
});

addEventListener('mousemove', e => {
  if (!session?.client.active || !$('settings-modal').hidden) return;
  const isSniper = session.client.aiming && (session.client.me?.w === 2);
  const adsMult = (settings.adsSens || 80) / 100;
  const adsScale = session.client.aiming ? (isSniper ? 0.25 * adsMult : 0.6 * adsMult) : 1.0;
  const baseSens = (settings.sens || 22) * 0.0001;
  const invertY = settings.invertY ? -1 : 1;
  const look = session.client.look;
  look.yaw -= e.movementX * baseSens * adsScale;
  look.pitch = Math.max(-1.55, Math.min(1.55, look.pitch - e.movementY * baseSens * adsScale * invertY));
});
$('leave').onclick = () => leave();

/* ---- start-up ---- */
async function boot() {
  $('name').value = store.get('name', '');
  $('room-name').value = store.get('room', '');
  $('sens').value = settings.sens || '22';
  $('sens').oninput = () => {
    const v = Number($('sens').value);
    settings.sens = v;
    store.set('sens', v);
    if ($('opt-sens')) {
      $('opt-sens').value = v;
      $('opt-sens-num').textContent = v;
    }
  };
  if ($('opt-sens')) {
    $('opt-sens').oninput = e => {
      const v = Number(e.target.value);
      settings.sens = v;
      $('opt-sens-num').textContent = v;
      if ($('sens')) $('sens').value = v;
      $('sens-value').textContent = v;
      store.set('sens', v);
    };
  }
  if ($('opt-ads-sens')) {
    $('opt-ads-sens').oninput = e => {
      const v = Number(e.target.value);
      settings.adsSens = v;
      $('opt-ads-sens-num').textContent = (v / 100).toFixed(2) + 'x';
      store.set('adsSens', v);
    };
  }
  if ($('opt-invert-y')) {
    $('opt-invert-y').onchange = e => {
      settings.invertY = e.target.checked;
      store.set('invertY', String(settings.invertY));
    };
  }
  if ($('opt-crouch-hold')) {
    $('opt-crouch-hold').onclick = () => {
      settings.crouchMode = 'hold';
      $('opt-crouch-hold').classList.add('on');
      $('opt-crouch-toggle').classList.remove('on');
      store.set('crouchMode', 'hold');
    };
  }
  if ($('opt-crouch-toggle')) {
    $('opt-crouch-toggle').onclick = () => {
      settings.crouchMode = 'toggle';
      $('opt-crouch-toggle').classList.add('on');
      $('opt-crouch-hold').classList.remove('on');
      store.set('crouchMode', 'toggle');
    };
  }
  if ($('opt-reset-binds')) {
    $('opt-reset-binds').onclick = () => {
      settings.binds = Object.assign({}, DEFAULT_BINDS);
      store.set('binds', JSON.stringify(settings.binds));
      rebuildCodeMap();
      renderBindGrid();
    };
  }
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
  if ($('btn-settings-lobby')) $('btn-settings-lobby').onclick = openSettings;
  if ($('btn-settings-game')) $('btn-settings-game').onclick = openSettings;
  $('btn-scores-game').onclick = () => { hud.showBoard = !hud.showBoard; };
  if ($('settings-close')) $('settings-close').onclick = closeSettings;
  if ($('settings-done')) $('settings-done').onclick = closeSettings;
  if ($('btn-lobby-roster')) $('btn-lobby-roster').onclick = () => openHeroRoster();
  if ($('btn-header-roster')) $('btn-header-roster').onclick = () => openHeroRoster();
  if ($('roster-close')) $('roster-close').onclick = closeHeroRoster;
  $('volume').value = store.get('volume', '50');
  sound.volume = $('volume').value / 100;
  $('volume').oninput = () => { sound.volume = $('volume').value / 100; store.set('volume', $('volume').value); };
  initInterface();
  $('choose').onclick = chooseFolder;
  $('local').onclick = useThisPC;
  $('create').onclick = host;
  $('room-name').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); host(); } };

  if ($('btn-check-update')) $('btn-check-update').onclick = () => checkUpdate(true);
  if ($('btn-dismiss-update')) $('btn-dismiss-update').onclick = () => { if ($('update-banner')) $('update-banner').hidden = true; };
  if (navigator.onLine) checkUpdate(false).catch?.(() => {});

  if ($('btn-add-bot')) {
    $('btn-add-bot').onclick = () => {
      if (session instanceof HostSession) {
        try {
          const bot = session.addBot();
          hud.feed(`Bot ${bot.name} added`, true);
        } catch (e) {
          hud.feed(e.message, true);
        }
      }
    };
  }
  if ($('btn-remove-bot')) {
    $('btn-remove-bot').onclick = () => {
      if (session instanceof HostSession) {
        session.removeBot();
      }
    };
  }

  document.querySelectorAll('#weapons .wep').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const w = parseInt(el.dataset.w, 10);
      if (!isNaN(w) && session?.client) session.client.setWeapon(w);
    });
  });

  assets = await loadAssets();
  const savedMap = store.get('map', 'aftermath');
  if ($('map-select')) {
    $('map-select').value = savedMap;
    $('map-select').onchange = () => store.set('map', $('map-select').value);
  }
  const savedMode = store.get('mode', 'ffa');
  if ($('mode-select')) {
    $('mode-select').value = savedMode;
    $('mode-select').onchange = () => store.set('mode', $('mode-select').value);
  }
  updateBriefing();
  world = buildWorld(assets, savedMap);
  updateLobbyHeroCard();

  const saved = await savedFolder();
  if (saved) {
    const b = $('reconnect'); b.hidden = false; b.textContent = `Use "${saved.name}" again`;
    b.onclick = () => reconnectFolder(saved);
    try { if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') useFolder(saved, saved.name); } catch {}
  }
  if (typeof RTCPeerConnection !== 'function') message('This browser has no WebRTC, so it cannot make the direct link the game needs. Use Chrome or Edge.', 'error');
}
addEventListener('beforeunload', () => { if (session) session.stop(); });

// Debug handle for the console and automated checks.
window.LANFPS = { get session() { return session; }, get lobby() { return lobby; }, get assets() { return assets; }, useThisPC, host, join, leave, B };
boot();
