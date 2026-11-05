/* Host-owned objective rules. Pure: state in, state out, counted in fixed simulation ticks
   (never client wall clocks), so packet loss/duplication cannot double-score and the whole
   state serialises into snapshots for late joiners. */

export const TICK_HZ = 60;
export const CONTROL = Object.freeze({ radius: 6, captureTicks: 5 * TICK_HZ, scoreEveryTicks: TICK_HZ, target: 100, timeLimitTicks: 300 * TICK_HZ, height: 4 });

/* Central zone anchor: the spawn closest to the centroid of all spawns (always walkable). */
export function controlAnchor(world) {
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
    if (Math.hypot(p.x - z.x, p.z - z.z) <= z.r && Math.abs(p.y - z.y) <= CONTROL.height) occ[p.team]++;
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
  return { k: 'control', x: s.zone.x, y: s.zone.y, z: s.zone.z, r: s.zone.r, own: s.owner, ct: s.capTeam, cp: +(s.capTicks / CONTROL.captureTicks).toFixed(3),
    con: s.contested, sr: s.score.red, sb: s.score.blue, tl: Math.max(0, Math.ceil((CONTROL.timeLimitTicks - s.elapsed) / TICK_HZ)), tgt: CONTROL.target };
}
