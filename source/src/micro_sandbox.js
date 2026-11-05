/* Planet Sandbox: developer-only panel for Operation Microverse (open the game with ?sandbox=1).
   Change the seed and densities, regenerate, look at the globe from orbit, show collision boxes,
   gravity vectors and spawn/objective markers, and read live render and collision statistics.
   Kept separate from the production HUD; nothing here ships in a normal session. */

export function attachMicroSandbox({ getView, getSession, startMatch, leaveMatch }) {
  if (document.getElementById('micro-sandbox')) return;
  const box = document.createElement('div');
  box.id = 'micro-sandbox';
  box.style.cssText = 'position:fixed;top:64px;right:12px;z-index:9999;width:292px;max-height:calc(100vh - 90px);overflow:auto;padding:12px;border:1px solid #2ee6ff88;border-radius:12px;background:#080b1cee;color:#dfe8ff;font:12px/1.45 ui-monospace,Consolas,monospace;backdrop-filter:blur(6px)';
  const preset = { low: ['0.7', '0.5', '0.7'], medium: ['1', '1', '1'], high: ['1.15', '1.4', '1.15'] };
  box.innerHTML = `
    <b style="letter-spacing:.14em;color:#2ee6ff">PLANET SANDBOX</b>
    <div style="margin:8px 0;display:grid;grid-template-columns:90px 1fr;gap:6px;align-items:center">
      <label>Seed</label><input id="sb-seed" type="number" value="1234" style="width:100%">
      <label>Preset</label><select id="sb-preset"><option>low</option><option selected>medium</option><option>high</option></select>
      <label>Radius m</label><input id="sb-radius" type="number" min="55" max="110" value="72">
      <label>Buildings</label><input id="sb-b" type="range" min="0.3" max="1.6" step="0.05" value="1">
      <label>Vegetation</label><input id="sb-v" type="range" min="0" max="2" step="0.05" value="1">
      <label>Cover</label><input id="sb-c" type="range" min="0.3" max="1.6" step="0.05" value="1">
      <label>Roughness</label><input id="sb-r" type="range" min="0" max="2" step="0.05" value="1">
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button id="sb-regen">Regenerate + play</button><button id="sb-leave">Leave</button>
    </div>
    <hr style="border-color:#ffffff22">
    <label><input type="checkbox" id="sb-orbit"> Orbit camera (drag / wheel)</label><br>
    <label><input type="checkbox" id="sb-collision"> Collision boxes</label><br>
    <label><input type="checkbox" id="sb-gravity"> Gravity vectors</label><br>
    <label><input type="checkbox" id="sb-markers"> Spawn + objective markers</label>
    <pre id="sb-stats" style="margin:10px 0 0;white-space:pre-wrap;color:#9be8ff"></pre>`;
  document.body.appendChild(box);
  const $ = id => box.querySelector('#' + id);
  for (const b of box.querySelectorAll('button')) b.style.cssText = 'padding:4px 8px;border:1px solid #2ee6ff88;background:#10183a;color:#fff;border-radius:6px;cursor:pointer';

  $('sb-preset').onchange = () => { const p = preset[$('sb-preset').value]; $('sb-b').value = p[0]; $('sb-v').value = p[1]; $('sb-c').value = p[2]; };
  $('sb-regen').onclick = async () => {
    globalThis.LANFPS_MICRO_CFG = {
      seed: +$('sb-seed').value, radius: +$('sb-radius').value, preset: $('sb-preset').value,
      buildings: +$('sb-b').value, vegetation: +$('sb-v').value, cover: +$('sb-c').value, roughness: +$('sb-r').value,
    };
    if (getSession()) await leaveMatch('Regenerating planet');
    const t0 = performance.now();
    await startMatch();
    const w = getSession()?.world;
    if (w) w.genMs = Math.round(performance.now() - t0);
    for (const k of ['orbit', 'collision', 'gravity', 'markers']) $('sb-' + k).dispatchEvent(new Event('change'));
  };
  $('sb-leave').onclick = () => leaveMatch('Left sandbox');

  let drag = null;
  const orb = () => getView()?.orbit;
  $('sb-orbit').onchange = () => getView()?.setOrbitCamera($('sb-orbit').checked ? { yaw: 0.6, pitch: 0.4, dist: 170 } : null);
  for (const k of ['collision', 'gravity', 'markers']) $('sb-' + k).onchange = () => getView()?.setDebugOverlay(k, $('sb-' + k).checked);
  document.addEventListener('mousedown', e => { if (orb() && !box.contains(e.target)) drag = [e.clientX, e.clientY]; });
  document.addEventListener('mouseup', () => { drag = null; });
  document.addEventListener('mousemove', e => {
    const o = orb(); if (!o || !drag) return;
    o.yaw -= (e.clientX - drag[0]) * 0.006; o.pitch = Math.max(-1.45, Math.min(1.45, o.pitch + (e.clientY - drag[1]) * 0.006)); drag = [e.clientX, e.clientY];
  });
  document.addEventListener('wheel', e => { const o = orb(); if (o) o.dist = Math.max(90, Math.min(600, o.dist + e.deltaY * 0.2)); }, { passive: true });

  setInterval(() => {
    const v = getView(), s = getSession(), st = v?.getRenderStats?.();
    if (!st) { $('sb-stats').textContent = 'No match running. Press "Regenerate + play".'; return; }
    const w = s?.world, ms = v.microStats || {}, m = w?.metrics || {};
    $('sb-stats').textContent = [
      `FPS ${st.fps}  frame ${st.frameMs} ms  render ${st.renderMs} ms`,
      `draw calls ${st.drawCalls}  active meshes ${st.activeMeshes}`,
      `visible instances ${st.visibleInstances} / ${ms.instances ?? '?'}  tris ${st.triangles}`,
      `meshes ${st.totalMeshes}  materials ${st.materials}  textures ${st.textures}`,
      `JS heap ${st.heapMB ?? '?'} MB  visuals build ${ms.buildMs ?? '?'} ms  gen ${w?.genMs ?? '?'} ms`,
      `collision: ${m.obbs ?? '?'} boxes  spawns ${m.spawns ?? '?'}  reach ${m.reachRatio ?? '?'} (${m.unreachable ?? '?'} unreachable)`,
      `seed ${w?.planet?.seed ?? '?'}  hash ${w?.layoutHash ?? '?'}`,
    ].join('\n');
  }, 500);
}
