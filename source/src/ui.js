/* Presentation-only state, accessible menu shells, and offline map briefings. */
const $ = id => document.getElementById(id);
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

export function updateBriefing() {
  const map = $('map-select').value;
  const data = MAPS[map] || MAPS.foundry;
  $('map-title').textContent = data[0];
  $('map-description').textContent = data[1];
  $('map-index').textContent = `SECTOR ${String(Object.keys(MAPS).indexOf(map) + 1).padStart(2, '0')} / ${String(Object.keys(MAPS).length).padStart(2, '0')}`;
  document.querySelector('.map-briefing').dataset.map = map;
  const sourcePreview = window.LANFPS_ASSETS?.maps?.[map]?.preview;
  const ownCapture = map === 'railyard' || map === 'school';   // preview is a capture of this game's own render, not a source-map image
  $('map-thumbnail').style.backgroundImage = sourcePreview ? `url("${sourcePreview}")` : '';
  $('map-thumbnail').setAttribute('aria-label', sourcePreview && !ownCapture ? `${data[0]}: original source map preview` : `${data[0]}: actual in-game ${map === 'sandbox' ? 'sample; each room generates different terrain' : 'capture'}`);
  $('map-capture-label').textContent = sourcePreview && !ownCapture ? 'SOURCE MAP PREVIEW' : map === 'sandbox' ? 'IN-GAME SAMPLE' : 'IN-GAME CAPTURE';
  $('match-rules').innerHTML = `<b>${$('mode-select').value === 'tdm' ? 25 : 10}</b> kills to win <span> / </span> 2–6 players`;
}

export function connectedUI(label) {
  const local = label.startsWith('This PC only');
  $('network-status').textContent = local ? 'LOCAL PRACTICE' : 'FOLDER CONNECTED';
  $('network-status').classList.add('connected');
  $('network-step').classList.replace('current', 'complete');
  $('network-step').removeAttribute('aria-current');
  $('rail-network-label').textContent = local ? 'This PC · practice' : 'Shared folder ready';
  $('match-step').classList.add('current');
  $('match-step').setAttribute('aria-current', 'step');
  $('empty-title').textContent = 'The field is clear.';
  $('empty-description').textContent = 'No rooms found. Host a match below and let your crew join.';
  $('create').disabled = false;
  $('create-hint').textContent = local ? 'Practice mode uses this browser’s storage. Open a second tab to join.' : 'Your room stays available while the host’s game is open.';
  $('term-uplink').textContent = local ? 'local / practice' : 'shared / mounted';
  $('terminal-session-status').textContent = 'Uplink ready. Join a room or create a match.';
  $('lamp-network').classList.add('lit');
  $('lamp-network').setAttribute('aria-label', local ? 'Local practice uplink configured' : 'Shared folder uplink configured');
}

export function roomCountUI(count) {
  $('room-count').textContent = `${String(count).padStart(2, '0')} ${count === 1 ? 'ROOM' : 'ROOMS'} FOUND`;
  $('room-count').classList.add('connected');
  $('term-roomboard').textContent = `${count} ${count === 1 ? 'room' : 'rooms'} available`;
}

// Cosmetic display preference only. No timers, post-processing, or gameplay filters.
export function setCrtEnabled(enabled) {
  const on = !!enabled;
  document.documentElement.classList.toggle('crt-enabled', on);
  $('btn-crt-toggle').textContent = on ? 'CRT: ON' : 'CRT: OFF';
  $('btn-crt-toggle').setAttribute('aria-pressed', String(on));
  $('opt-crt').checked = on;
  try { localStorage.setItem('lanfps.crt', String(on)); } catch {}
}

function syncPressed(root) {
  root.querySelectorAll('.anim-btn,.swatch,.btn-choice,.roster-hero-item,#char-list button,.tab-btn').forEach(el => {
    el.setAttribute('aria-pressed', String(el.classList.contains('on')));
  });
}

export function initInterface() {
  let crt = false;
  try { crt = localStorage.getItem('lanfps.crt') === 'true'; } catch {}
  setCrtEnabled(crt);
  $('btn-crt-toggle').addEventListener('click', () => setCrtEnabled(!document.documentElement.classList.contains('crt-enabled')));
  $('opt-crt').addEventListener('change', e => setCrtEnabled(e.target.checked));
  const identity = () => {
    const name = $('name').value.trim();
    $('term-operator').textContent = name || 'not assigned';
    $('lamp-identity').classList.toggle('lit', !!name);
    $('lamp-identity').setAttribute('aria-label', name ? 'Callsign assigned' : 'Callsign not assigned');
  };
  $('name').addEventListener('input', identity);
  identity();
  $('network-step').addEventListener('click', () => {
    if ($('create').disabled) $('choose').click();
    else $('network-panel').scrollIntoView({ block:'nearest', behavior:document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
  });
  // Mirror real connection/recovery messages at the top of the terminal.
  // This status region is the single live announcer; the detailed message remains below.
  const message = $('message');
  const sessionStatus = $('terminal-session-status');
  const reflectStatus = () => {
    const hasMessage = !message.hidden && !!message.textContent;
    sessionStatus.textContent = hasMessage ? message.textContent : ($('create').disabled ? 'Select an uplink to begin.' : 'Uplink ready. Join a room or create a match.');
    const error = hasMessage && message.classList.contains('error');
    sessionStatus.parentElement.classList.toggle('terminal-error', error);
    $('lamp-alert').classList.toggle('lit', error);
    $('lamp-alert').setAttribute('aria-label', error ? 'Session error; see status message' : 'No session error');
  };
  new MutationObserver(reflectStatus).observe(message, { childList:true, characterData:true, subtree:true, attributes:true, attributeFilter:['hidden','class'] });
  updateBriefing();
  $('map-select').addEventListener('change', updateBriefing);
  $('mode-select').addEventListener('change', updateBriefing);
  for (const id of ['sens', 'volume']) {
    const update = () => { $(id + '-value').textContent = $(id).value + (id === 'volume' ? '%' : ''); };
    $(id).addEventListener('input', update);
    update();
  }
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    let saved = null;
    try { saved = localStorage.getItem('lanfps.reduceMotion'); } catch {}
    const reduce = systemMotion.matches || saved === 'true';
    document.documentElement.classList.toggle('reduce-motion', reduce);
    $('opt-reduced-motion').checked = reduce;
    $('opt-reduced-motion').disabled = systemMotion.matches;
    $('opt-reduced-motion').title = systemMotion.matches ? 'Enabled by your system’s reduced-motion preference' : 'Pause interface motion and preview playback';
    $('roster-btn-spin').disabled = reduce;
    $('roster-btn-spin').title = reduce ? 'Automatic rotation is paused by reduced motion' : 'Toggle turntable spin';
  };
  $('opt-reduced-motion').addEventListener('change', e => {
    try { localStorage.setItem('lanfps.reduceMotion', String(e.target.checked)); } catch {}
    document.documentElement.classList.toggle('reduce-motion', e.target.checked);
    $('roster-btn-spin').disabled = e.target.checked;
  });
  systemMotion.addEventListener('change', applyMotion);
  applyMotion();

  // The topmost modal owns focus. Inert also stops background shortcuts/clicks.
  const modals = ['select', 'hero-roster-modal', 'settings-modal'].map($);
  const previousFocus = new Map();
  let visible = [];
  const updateModals = () => {
    const next = modals.filter(m => !m.hidden);
    for (const modal of next.filter(m => !visible.includes(m))) previousFocus.set(modal, document.activeElement);
    const top = next.at(-1);
    for (const child of document.body.children) {
      if (child.tagName !== 'SCRIPT') child.inert = !!top && child !== top;
    }
    document.body.style.overflow = top ? 'hidden' : '';
    const closed = visible.filter(m => !next.includes(m));
    if (top && !top.contains(document.activeElement)) {
      const restore = closed.length ? previousFocus.get(closed.at(-1)) : null;
      (restore && top.contains(restore) ? restore : top.querySelector('button.on:not(:disabled),button:not(:disabled),input,canvas[tabindex]'))?.focus();
    } else if (!top && closed.length) {
      const target = previousFocus.get(closed.at(-1));
      if (target?.isConnected && !target.closest('[hidden]')) target.focus();
    }
    visible = next;
  };
  for (const modal of modals) {
    new MutationObserver(updateModals).observe(modal, { attributes:true, attributeFilter:['hidden'] });
    new MutationObserver(() => syncPressed(modal)).observe(modal, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
    syncPressed(modal);
  }
  document.addEventListener('keydown', e => {
    const top = modals.filter(m => !m.hidden).at(-1);
    if (!top || e.key !== 'Tab') return;
    const targets = [...top.querySelectorAll('button:not(:disabled),input:not(:disabled),select,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = targets[0], last = targets.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }, true);
  // Native weapon buttons preserve mouse, Enter, and Space activation.
  document.querySelectorAll('#weapons .wep').forEach(el => el.setAttribute('aria-label', `Equip ${el.querySelector('.wname').textContent}`));
}
