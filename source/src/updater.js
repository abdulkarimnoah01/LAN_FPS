/* Live updater for Spectre Orbit Light: checks version.json on GitHub, downloads the new
   Spectre_Orbit_Light.html with a progress bar and rewrites the running file in place
   (File System Access API), then reloads. Same flow as the Classic build. */
const $ = id => document.getElementById(id);
const CURRENT_VERSION = window.LANFPS_VERSION || '0.0.0';
const UPDATE_CONFIG = {
  versionUrl: 'https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/version.json',
  bundleUrl: 'https://raw.githubusercontent.com/abdulkarimnoah01/LAN_FPS/main/Spectre_Orbit_Light.html',
};

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('spectre-orbit-light', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

/* In-place update: the page asks once for its own Spectre_Orbit_Light.html (File System Access API), keeps
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
    suggestedName: 'Spectre_Orbit_Light.html',
    types: [{ description: 'Spectre Orbit game file', accept: { 'text/html': ['.html'] } }],
  });
  idb('readwrite', s => s.put(handle, 'updateTarget')).catch(() => {});  // remembered for next time; never blocks the update
  return handle;
}

// Set after a write; if the reloaded page is still old, the saved file is not the copy being run, so stop retrying.
const lastApplied = () => { try { return localStorage.getItem('updApplied'); } catch { return null; } };

async function hasGrantedTarget() {
  const saved = await idb('readonly', s => s.get('updateTarget')).catch(() => null);
  return !!saved && (await saved.queryPermission({ mode: 'readwrite' }).catch(() => '')) === 'granted';
}

// Streams the bundle and reports percent (or MB when the server sends no length) through setStatus and the banner bar.
async function readWithProgress(res, version, setStatus) {
  const total = Number(res.headers.get('content-length')) || 0;
  let bar = $('update-progress');
  if (!bar && $('update-banner')) {
    bar = document.createElement('progress');
    bar.id = 'update-progress'; bar.max = 100; bar.style.cssText = 'width:100%;height:6px;display:block;margin-top:6px';
    $('update-banner').appendChild(bar);
  }
  if (!res.body) return res.text();
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const mb = (got / 1048576).toFixed(1);
    const pct = total ? Math.min(99, Math.round(got / total * 100)) : 0;
    setStatus(total ? `Downloading v${version}… ${pct}% (${mb} MB)` : `Downloading v${version}… ${mb} MB`);
    if (bar) { bar.hidden = false; if (total) bar.value = pct; else bar.removeAttribute('value'); }
  }
  if (bar) bar.value = 100;
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

async function applyUpdate(info, setStatus) {
  let target = null;
  if (canWriteInPlace()) {
    setStatus('Choose your Spectre_Orbit_Light.html to update it…');
    try { target = await getUpdateTarget(); }
    catch (e) { if (e?.name === 'AbortError') { setStatus('Update cancelled'); return; } }
  }
  setStatus(`Downloading v${info.version}…`);
  try {
    const res = await fetch(UPDATE_CONFIG.bundleUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Status ' + res.status);
    const text = await readWithProgress(res, info.version, setStatus);
    // Never overwrite the game with a truncated page or a stale cached build.
    if (text.length < 1e6 || !/^\s*<!doctype html/i.test(text) || !text.includes('LANFPS_VERSION=' + JSON.stringify(info.version))) {
      setStatus('Build still publishing, try again in a few minutes');
      return;
    }
    if (target) {
      const out = await target.createWritable();
      await out.write(text);
      await out.close();
      try { localStorage.setItem('updApplied', info.version); } catch {}
      setStatus(`Updated ${target.name} to v${info.version}, restarting…`);
      setTimeout(() => location.reload(), 900);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'Spectre_Orbit_Light.html';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setStatus('Downloaded: replace Spectre_Orbit_Light.html with it');
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
      else if (lastApplied() === data.version) setStatus('Saved a different copy. Open the updated Spectre_Orbit_Light.html');
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


export function initUpdater() {
  $('btn-check-update')?.addEventListener('click', () => checkUpdate(true));
  $('btn-dismiss-update')?.addEventListener('click', () => { if ($('update-banner')) $('update-banner').hidden = true; });
  // Served pages (the host server's copy) are replaced by redeploying, not by this updater.
  if (location.protocol === 'file:' && navigator.onLine) checkUpdate(false).catch(() => {});
}
