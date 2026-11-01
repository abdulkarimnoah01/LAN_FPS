/* Hub shell for the LAN build: sidebar pages, host drawer, battlefield catalog. Presentation only. */
const $ = id => document.getElementById(id);
const PAGES = { play: 'DEPLOY', loadout: 'LOADOUT', maps: 'BATTLEFIELDS' };
const SECTORS = [
  ['foundry', 'Foundry Core', 'Molten industrial casting pit. Elevated catwalks. Fast CQB encounters.'],
  ['glowplant', 'Reactor Complex', 'Sub-orbital nuclear facility with pulsating blue plasma cores and dual jump pads.'],
  ['zenith', 'Zenith Atrium', 'High-altitude vertical multi-tier sky arena with velocity jump pads.'],
  ['railyard', 'Hadota Rail Yard', 'A rail yard at dusk. A 150 m freight train down the middle and roof lanes.'],
  ['school', 'Schoolyard', 'An Egyptian school courtyard in full sun with a locomotive halfway out of a tunnel.'],
  ['aftermath', 'Aftermath', 'Ruined city streets. Tight corners. Urban CQB combat.'],
  ['river', 'River Forest', 'A river valley divided by bridges and sightlines. Rapid crossings.'],
  ['forest', 'Pine Forest', 'Pine cover and open ground. Classic deathmatch terrain.'],
  ['sandbox', 'Random Sandbox', 'A fresh procedural battlefield for every room.'],
  ['arena', 'Classic Arena', 'Compact geometry. Fast encounters. Pure deathmatch.'],
];

function openDrawer() { $('overlay').classList.add('open'); $('overlay').setAttribute('aria-hidden', 'false'); setTimeout(() => $('room-name').focus(), 120); }
function closeDrawer() { $('overlay').classList.remove('open'); $('overlay').setAttribute('aria-hidden', 'true'); }

function go(page) {
  closeDrawer();
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'page-' + page));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('breadcrumb').textContent = PAGES[page];
  window.scrollTo({ top: 0 });
}

function renderCatalog() {
  const grid = $('maps-catalog-grid');
  SECTORS.forEach(([id, name, text], i) => {
    const preview = window.LANFPS_ASSETS?.maps?.[id]?.preview;
    const card = document.createElement('div');
    card.className = 'map-card';
    card.innerHTML = `<div class="map-card-thumb"${preview ? ` style="background-image:url('${preview}')"` : ''}><span class="sector-badge">SECTOR ${String(i + 1).padStart(2, '0')} / ${SECTORS.length}</span></div>
      <div class="map-card-body"><h3></h3><p></p><div class="map-card-footer"><span class="small-cap">${id === 'sandbox' ? 'PROCEDURAL' : 'TACTICAL'}</span><button class="btn btn-primary small" type="button">Host on this map ↗</button></div></div>`;
    card.querySelector('h3').textContent = name;
    card.querySelector('p').textContent = text;
    card.querySelector('button').onclick = () => {
      $('map-select').value = id;
      $('map-select').dispatchEvent(new Event('change'));
      go('play');
      openDrawer();
    };
    grid.append(card);
  });
}

export function initHub() {
  document.addEventListener('click', e => {
    const page = e.target.closest('[data-page]');
    if (page) { e.preventDefault(); go(page.dataset.page); return; }
    if (e.target.closest('[data-drawer]')) { e.preventDefault(); openDrawer(); }
  });
  $('drawerClose').addEventListener('click', closeDrawer);
  $('overlay').addEventListener('mousedown', e => { if (e.target === $('overlay')) closeDrawer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  $('create').addEventListener('click', closeDrawer);
  // Dot colour follows the uplink state set by connectedUI().
  new MutationObserver(() => $('server-status-dot').classList.toggle('offline', !$('network-status').classList.contains('connected')))
    .observe($('network-status'), { attributes: true, attributeFilter: ['class'] });
  renderCatalog();
}
