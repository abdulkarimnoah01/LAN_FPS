/* Host-owned objective rules. Pure: state in, state out, counted in fixed simulation ticks
   (never client wall clocks), so packet loss/duplication cannot double-score and the whole
   state serialises into snapshots for late joiners. */

export const TICK_HZ = 60;
export const CONTROL = Object.freeze({ radius: 6, captureTicks: 5 * TICK_HZ, scoreEveryTicks: TICK_HZ, target: 100, timeLimitTicks: 300 * TICK_HZ, height: 4 });

/* Central zone anchor: the spawn closest to the centroid of all spawns (always walkable). */
export function controlAnchor(world) {
  if (world?.objectiveAnchors?.control) return { ...world.objectiveAnchors.control };
  const sp = world?.spawns || [];
  if (!sp.length) return { x: 0, y: 0, z: 0 };
  const cx = sp.reduce((s, p) => s + p.x, 0) / sp.length, cz = sp.reduce((s, p) => s + p.z, 0) / sp.length;
  let best = sp[0], bd = Infinity;
  for (const p of sp) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; best = p; } }
  return { x: best.x, y: best.y, z: best.z };
}

export function newControlState(world) {
  return { kind: 'control', zone: { ...controlAnchor(world), r: CONTROL.radius }, owner: null, capTeam: null, capTicks: 0,
    scoreTicks: 0, score: { red: 0, blue: 0 }, contested: false, elapsed: 0, done: false };
}

const other = t => (t === 'red' ? 'blue' : 'red');

export function zoneOccupants(state, players) {
  const z = state.zone, occ = { red: 0, blue: 0 };
  for (const p of players) {
    if (!p.alive || (p.team !== 'red' && p.team !== 'blue')) continue;
    // On a globe the zone is a ball around its anchor; on flat maps it is a disc with a height band.
    if (z.s ? Math.hypot(p.x - z.x, p.y - z.y, p.z - z.z) <= z.r + 1.2 : Math.hypot(p.x - z.x, p.z - z.z) <= z.r && Math.abs(p.y - z.y) <= CONTROL.height) occ[p.team]++;
  }
  return occ;
}

/* Advances one tick. Returns { state, events, result } where result is null or
   { winner: 'red' | 'blue' | 'draw' } exactly once (state.done guards repeats). */
export function stepControl(prev, players) {
  const s = { ...prev, score: { ...prev.score }, zone: prev.zone };
  const events = [];
  if (s.done) return { state: s, events, result: null };

  const list = [...players];
  const teamsPresent = list.some(p => p.team === 'red') && list.some(p => p.team === 'blue');
  if (!teamsPresent) { s.contested = false; return { state: s, events, result: null }; }   // practice: no competitive clock

  s.elapsed++;
  const occ = zoneOccupants(s, list);
  s.contested = occ.red > 0 && occ.blue > 0;
  const solo = !s.contested && (occ.red > 0 || occ.blue > 0) ? (occ.red > 0 ? 'red' : 'blue') : null;

  if (solo) {
    if (s.owner === solo) {
      // owners standing alone push back any enemy neutralise progress, and score
      if (s.capTicks > 0 && s.capTeam !== solo) s.capTicks--;
      if (++s.scoreTicks >= CONTROL.scoreEveryTicks) { s.scoreTicks = 0; s.score[solo]++; }
    } else if (s.owner === null) {
      if (s.capTeam === solo || s.capTicks === 0) {
        s.capTeam = solo;
        if (++s.capTicks >= CONTROL.captureTicks) {
          s.owner = solo; s.capTeam = null; s.capTicks = 0; s.scoreTicks = 0;
          events.push({ t: 'zone', owner: solo });
        }
      } else s.capTicks--;   // reverse the other team's partial capture first
    } else {   // enemy-owned: neutralise first
      s.capTeam = solo;
      if (++s.capTicks >= CONTROL.captureTicks) {
        events.push({ t: 'zone', owner: null, by: solo });
        s.owner = null; s.capTicks = 0; s.scoreTicks = 0;
      }
    }
  }
  // empty or contested: retain ownership/progress, no scoring

  let result = null;
  if (s.score.red >= CONTROL.target || s.score.blue >= CONTROL.target) result = { winner: s.score.red >= CONTROL.target ? 'red' : 'blue' };
  else if (s.elapsed >= CONTROL.timeLimitTicks) result = { winner: s.score.red === s.score.blue ? 'draw' : (s.score.red > s.score.blue ? 'red' : 'blue') };
  if (result) s.done = true;
  return { state: s, events, result };
}

/* Snapshot form (small, plain numbers). */
export function controlSnapshot(s) {
  return { k: 'control', ...(s.zone.s ? { s: 1 } : {}), x: s.zone.x, y: s.zone.y, z: s.zone.z, r: s.zone.r, own: s.owner, ct: s.capTeam, cp: +(s.capTicks / CONTROL.captureTicks).toFixed(3),
    con: s.contested, sr: s.score.red, sb: s.score.blue, tl: Math.max(0, Math.ceil((CONTROL.timeLimitTicks - s.elapsed) / TICK_HZ)), tgt: CONTROL.target };
}

/* ---- Capture the Flag ----
   Two fixed bases on each team's spawn cluster. Touch the enemy flag (1.5 m) to carry it;
   one flag per carrier; reach your own base (2 m) with your own flag home to score.
   Death/disconnect drops at the carrier's last grounded position, a void drop returns home,
   a teammate touch returns a dropped flag, and a dropped flag auto-returns after 15 s. */
export const CTF = Object.freeze({ touch: 1.5, capture: 2, returnTicks: 15 * TICK_HZ, target: 3, timeLimitTicks: 300 * TICK_HZ, height: 2.5 });

function teamAnchor(world, team) {
  if (world?.objectiveAnchors?.ctf?.[team]) return { ...world.objectiveAnchors.ctf[team] };
  const sp = (world?.spawns || []).filter(s => s.team === team);
  if (!sp.length) return null;
  const cx = sp.reduce((s, p) => s + p.x, 0) / sp.length, cz = sp.reduce((s, p) => s + p.z, 0) / sp.length;
  let best = sp[0], bd = Infinity;
  for (const p of sp) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; best = p; } }
  return { x: best.x, y: best.y, z: best.z };
}

export const ctfSupported = world => !!(teamAnchor(world, 'red') && teamAnchor(world, 'blue'));

export function newCtfState(world) {
  const flag = team => { const home = teamAnchor(world, team); return { team, home, state: 'home', pos: { ...home }, carrier: null, ret: 0 }; };
  return { kind: 'ctf', flags: { red: flag('red'), blue: flag('blue') }, caps: { red: 0, blue: 0 }, ground: {}, elapsed: 0, killY: world?.killY ?? -20, done: false };
}

const near = (p, q, r, h) => Math.hypot(p.x - q.x, p.z - q.z) <= r && Math.abs(p.y - q.y) <= h;

export function stepCtf(prev, playersIter) {
  const s = { ...prev, caps: { ...prev.caps }, ground: { ...prev.ground },
    flags: { red: { ...prev.flags.red, pos: { ...prev.flags.red.pos } }, blue: { ...prev.flags.blue, pos: { ...prev.flags.blue.pos } } } };
  const events = [];
  if (s.done) return { state: s, events, result: null };
  const players = [...playersIter].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // stable host-tick order
  const byId = new Map(players.map(p => [p.id, p]));
  for (const p of players) if (p.alive && p.g) s.ground[p.id] = { x: p.x, y: p.y, z: p.z };
  for (const id of Object.keys(s.ground)) if (!byId.has(id)) delete s.ground[id];
  if (!(players.some(p => p.team === 'red') && players.some(p => p.team === 'blue'))) return { state: s, events, result: null };
  s.elapsed++;

  const home = f => { f.state = 'home'; f.carrier = null; f.ret = 0; f.pos = { ...f.home }; };
  for (const team of ['red', 'blue']) {
    const f = s.flags[team];
    if (f.state === 'carried') {
      const c = byId.get(f.carrier);
      if (!c || !c.alive) {
        const g = prevGround(prev, s, f.carrier, c);
        if (!g || g.y < s.killY + 1) { home(f); events.push({ t: 'flag', team, act: 'return', why: 'void' }); }
        else { f.state = 'dropped'; f.carrier = null; f.pos = g; f.ret = CTF.returnTicks; events.push({ t: 'flag', team, act: 'drop', by: c?.id || null }); }
      } else if (c.y < s.killY + 1) { home(f); events.push({ t: 'flag', team, act: 'return', why: 'void' }); }
      else f.pos = { x: c.x, y: c.y, z: c.z };
    }
    if (f.state === 'dropped' && --f.ret <= 0) { home(f); events.push({ t: 'flag', team, act: 'return', why: 'timeout' }); }
  }
  const carrying = new Set(['red', 'blue'].map(t => s.flags[t].carrier).filter(Boolean));
  for (const p of players) {
    if (!p.alive || (p.team !== 'red' && p.team !== 'blue')) continue;
    for (const team of ['red', 'blue']) {
      const f = s.flags[team];
      if (f.state === 'carried' || !near(p, f.pos, CTF.touch, CTF.height)) continue;
      if (p.team !== team && !carrying.has(p.id)) {
        f.state = 'carried'; f.carrier = p.id; f.ret = 0; f.pos = { x: p.x, y: p.y, z: p.z }; carrying.add(p.id);
        events.push({ t: 'flag', team, act: 'take', by: p.id });
      } else if (p.team === team && f.state === 'dropped') { home(f); events.push({ t: 'flag', team, act: 'return', by: p.id }); }
    }
  }
  for (const team of ['red', 'blue']) {
    const enemy = s.flags[other(team)], own = s.flags[team];
    const c = enemy.state === 'carried' ? byId.get(enemy.carrier) : null;
    if (c && c.team === team && own.state === 'home' && near(c, own.home, CTF.capture, CTF.height)) {
      s.caps[team]++; home(enemy); events.push({ t: 'flag', team: other(team), act: 'capture', by: c.id, scorer: team });
    }
  }
  let result = null;
  if (s.caps.red >= CTF.target || s.caps.blue >= CTF.target) result = { winner: s.caps.red >= CTF.target ? 'red' : 'blue' };
  else if (s.elapsed >= CTF.timeLimitTicks) result = { winner: s.caps.red === s.caps.blue ? 'draw' : (s.caps.red > s.caps.blue ? 'red' : 'blue') };
  if (result) s.done = true;
  return { state: s, events, result };
}

function prevGround(prev, s, id, c) {
  return prev.ground[id] || (c ? { x: c.x, y: c.y, z: c.z } : null);
}

export function ctfSnapshot(s) {
  const f = t => { const x = s.flags[t]; return { st: x.state, c: x.carrier, x: +x.pos.x.toFixed(2), y: +x.pos.y.toFixed(2), z: +x.pos.z.toFixed(2), hx: x.home.x, hy: x.home.y, hz: x.home.z, rt: Math.ceil(x.ret / TICK_HZ) }; };
  return { k: 'ctf', red: f('red'), blue: f('blue'), cr: s.caps.red, cb: s.caps.blue, tgt: CTF.target, tl: Math.max(0, Math.ceil((CTF.timeLimitTicks - s.elapsed) / TICK_HZ)) };
}

/* Dispatch used by HostGame. */
export function newObjective(mode, world) {
  if (mode === 'control') return newControlState(world);
  if (mode === 'ctf') return ctfSupported(world) ? newCtfState(world) : null;
  return null;
}
export const stepObjective = (s, players) => (s.kind === 'ctf' ? stepCtf(s, players) : stepControl(s, players));
export const objectiveSnapshot = s => (s.kind === 'ctf' ? ctfSnapshot(s) : controlSnapshot(s));
