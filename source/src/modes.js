/* One catalog for game modes: lobby selector, host rules, HUD and docs read from here.
   Only modes with `ready: true` are offered in the public selector. */

export const MODE_CATALOG = {
  ffa: { id: 'ffa', name: 'Free-for-All', short: 'FFA', team: false, ready: true, target: 10, unit: 'kills', timeLimit: 0,
    brief: 'Every operative for themselves. First to 10 eliminations wins the round.' },
  tdm: { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', team: true, ready: true, target: 25, unit: 'team kills', timeLimit: 0,
    brief: 'Red vs Blue, no friendly fire. First team to 25 eliminations wins.' },
  gungame: { id: 'gungame', name: 'Gun Game', short: 'GUN', team: false, ready: true, target: 6, unit: 'rungs', timeLimit: 0,
    brief: 'Every kill promotes your weapon: AK-47 → SMG → LMG → Shotgun → Sniper → Knife. A knife kill on the last rung wins.' },
  control: { id: 'control', name: 'Control', short: 'CTRL', team: true, ready: true, target: 100, unit: 'points', timeLimit: 300,
    maps: null,
    brief: 'Hold the central zone. Capture takes 5 s uncontested; an owned zone scores 1 point/s while your team holds it alone. 100 points or the higher score after 5 minutes wins. Bots fight but do not play the objective.' },
  ctf: { id: 'ctf', name: 'Capture the Flag', short: 'CTF', team: true, ready: true, target: 3, unit: 'captures', timeLimit: 300,
    maps: ['zenith', 'railyard', 'school'],
    brief: 'Take the enemy flag from their base and bring it to yours while your own flag is home. 3 captures or the most after 5 minutes wins. Dropped flags return after 15 s or when a teammate touches them. Bots fight but do not run flags.' },
};

export const MODE_IDS = Object.keys(MODE_CATALOG);
export const isTeamMode = mode => !!MODE_CATALOG[mode]?.team;
export const isKnownMode = mode => Object.prototype.hasOwnProperty.call(MODE_CATALOG, mode);
export const publicModes = () => MODE_IDS.filter(id => MODE_CATALOG[id].ready).map(id => MODE_CATALOG[id]);
/* Modes with authored anchors list their maps; others run anywhere. */
export const modeSupportsMap = (mode, map) => !!MODE_CATALOG[mode] && (!MODE_CATALOG[mode].maps || MODE_CATALOG[mode].maps.includes(map));
