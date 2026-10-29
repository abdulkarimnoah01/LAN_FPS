/* Built-in arena maps:
   1. defaultArena(): The classic blocky arena (unchanged for tests and legacy builds).
   2. forestMap(): Low-poly pine forest with timber watchtower, lumber cabins, trees, and boulders.
   3. sandboxMap(seed): Procedurally generated random sandbox map using a deterministic PRNG.
   4. getMap(type, seed): Factory returning { boxes, visuals, spawns, sky, fog }. */

export const PALETTE = {
  // Classic Arena
  floor: '#5d6a78', wall: '#cdb999', cover: '#8ea4b9', crate: '#cf8a48', deck: '#79a07f', pillar: '#a8695a', trim: '#e4dccb',
  // Forest & River
  grass: '#3b5433', grassLight: '#4d6d42', dirt: '#483726', moss: '#556338', bark: '#3a271c',
  pine1: '#1b3b22', pine2: '#254e2f', pine3: '#31613b', rockDark: '#444a50', rockLight: '#626972',
  wood: '#593e2b', woodDeck: '#75543b',
  water: '#3d7ea6', waterDeep: '#235372', riverbed: '#4f5548', sandWet: '#6b634d',
  // Sandbox / Industrial
  metal: '#485058', rust: '#8a482b', hazard: '#c99128', concrete: '#606872', slab: '#7d8792', sand: '#baa98b',
  // Aftermath / War-torn European Ruins (Medal of Honor)
  aftermathGround: '#968369', aftermathRubble: '#a89c89', plasterLight: '#ccc5b8', plasterDamaged: '#8f887b',
  brickRed: '#7d4536', burntWood: '#29221d', barrelOlive: '#434e3a', barrelRust: '#7e3d26',
  antennaMetal: '#363d47', debrisWhite: '#ded7c8',
};

// Deterministic PRNG for procedural generation across host and peers
function mulberry32(seed) {
  let s = (seed || 1) | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MapBuilder {
  constructor() {
    this.boxes = [];
    this.visuals = [];
    this.barrels = [];
  }
  box(x, z, w, d, h, y = 0, color = 'cover') {
    const min = [x - w / 2, y, z - d / 2], max = [x + w / 2, y + h, z + d / 2];
    this.boxes.push([...min, ...max]);
    this.visuals.push({ type: 'box', min, max, color });
  }
  tree(x, z, scale = 1, h = 6.5) {
    this.visuals.push({ type: 'tree', x, z, scale, h });
    const r = 0.38 * scale;
    this.boxes.push([x - r, 0, z - r, x + r, h * 0.85, z + r]);
  }
  bareTree(x, z, scale = 1, h = 5.2) {
    this.visuals.push({ type: 'bareTree', x, z, scale, h });
    const r = 0.32 * scale;
    this.boxes.push([x - r, 0, z - r, x + r, h * 0.9, z + r]);
  }
  rock(x, y, z, scale = 1, color = 'rockDark', rx = 0, ry = 0, rz = 0) {
    this.visuals.push({ type: 'rock', x, y, z, scale, color, rx, ry, rz });
    const r = scale * 0.75;
    this.boxes.push([x - r, y, z - r, x + r, y + scale * 1.3, z + r]);
  }
  barrel(x, z, h = 1.1, r = 0.42, y = 0, color = 'barrelRust') {
    const id = 'barrel_' + this.barrels.length;
    const boxIdx = this.boxes.length;
    this.barrels.push({ id, x, y, z, h, r, hp: 45, alive: true, boxIdx });
    this.visuals.push({ type: 'barrel', id, x, y, z, h, r, color });
    this.boxes.push([x - r, y, z - r, x + r, y + h, z + r]);
  }
  slab(x, y, z, w, d, h = 0.25, rx = 0, ry = 0, rz = 0, color = 'plasterDamaged') {
    this.visuals.push({ type: 'slab', x, y, z, w, d, h, rx, ry, rz, color });
    const hw = Math.max(0.4, (Math.abs(Math.cos(ry) * w) + Math.abs(Math.sin(ry) * d)) / 2);
    const hd = Math.max(0.4, (Math.abs(Math.sin(ry) * w) + Math.abs(Math.cos(ry) * d)) / 2);
    const hh = Math.max(0.6, Math.abs(Math.sin(rx || rz)) * Math.max(w, d) * 0.85 + h);
    this.boxes.push([x - hw, y, z - hd, x + hw, y + hh, z + hd]);
  }
  ramp(x, z, w, d, totalH, steps = 4, axis = 'z', dir = 1, y = 0, color = 'slab') {
    const stepH = totalH / steps;
    const stepD = (axis === 'z' ? d : w) / steps;
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const offset = (i - (steps - 1) / 2) * stepD * dir;
      if (axis === 'z') {
        this.box(x, z + offset, w, stepD + 0.08, h, y, color);
      } else {
        this.box(x + offset, z, stepD + 0.08, d, h, y, color);
      }
    }
  }
  water(x, z, w, d, y = -0.15) {
    this.visuals.push({ type: 'water', x, y, z, w, d });
  }
  antenna(x, z, h = 18) {
    this.visuals.push({ type: 'antenna', x, z, h });
    this.boxes.push([x - 1.2, 0, z - 1.2, x + 1.2, h, z + 1.2]);
  }
  stairs(x, z, w, d, totalH, steps = 3, axis = 'z', dir = 1, color = 'trim') {
    const stepH = totalH / steps;
    const stepD = (axis === 'z' ? d : w) / steps;
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const offset = (i - (steps - 1) / 2) * stepD * dir;
      if (axis === 'z') {
        this.box(x, z + offset, w, stepD + 0.05, h, 0, color);
      } else {
        this.box(x + offset, z, stepD + 0.05, d, h, 0, color);
      }
    }
  }
}

/* ---- 1. Classic Arena (Original placeholder level) ---- */
const classicBoxes = [];
function cbox(x, z, w, d, h, y = 0, color = 'cover') {
  classicBoxes.push({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], color });
}
const S = 22;
cbox(0, 0, S * 2 + 2, S * 2 + 2, 1, -1, 'floor');
cbox(0, -S - 0.5, S * 2 + 2, 1, 5, 0, 'wall');
cbox(0, S + 0.5, S * 2 + 2, 1, 5, 0, 'wall');
cbox(-S - 0.5, 0, 1, S * 2, 5, 0, 'wall');
cbox(S + 0.5, 0, 1, S * 2, 5, 0, 'wall');
cbox(0, 0, 8, 8, 1.5, 0, 'deck');
for (const dir of [-1, 1]) for (let i = 0; i < 3; i++) cbox(0, dir * (4.5 + (2 - i)), 3, 1, 0.5 * (i + 1), 0, 'trim');
cbox(0, 0, 1.2, 1.2, 1.4, 1.5, 'pillar');
for (const x of [-10, 10]) for (const z of [-10, 10]) cbox(x, z, 1.6, 1.6, 5, 0, 'pillar');
cbox(0, -13, 9, 0.6, 1.3); cbox(0, 13, 9, 0.6, 1.3);
cbox(-13, 0, 0.6, 9, 1.3); cbox(13, 0, 0.6, 9, 1.3);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const cx = sx * 18, cz = sz * 18;
  cbox(cx, cz, 6, 6, 1.5, 0, 'deck');
  for (let i = 0; i < 2; i++) cbox(cx - sx * (3.5 + (1 - i)), cz, 1, 2.4, 0.5 * (i + 1), 0, 'trim');
}
for (const [x, z, s, y] of [[-6, 6, 1.4, 0], [-6, 6, 1, 1.4], [6, -6, 1.4, 0], [7.4, -6, 1.2, 0], [6, 7, 1.2, 0],
  [-7, -7, 1.2, 0], [-16, 7, 1.4, 0], [16, -7, 1.4, 0], [9, 17, 1.2, 0], [-9, -17, 1.2, 0], [-17, -9, 1, 0], [17, 9, 1, 0]])
  cbox(x, z, s, s, s, y, 'crate');

const classicSpawns = [
  [-19, 0, 0], [19, 0, 0], [0, 0, -19], [0, 0, 19], [-12, 0, -16], [12, 0, 16], [16, 0, -12], [-16, 0, 12],
].map(([x, y, z]) => ({ x, y, z }));

export function defaultArena() {
  const barrels = [
    { id: 'barrel_0', x: 4, y: 0, z: 9, h: 1.1, r: 0.42, hp: 45, alive: true, boxIdx: classicBoxes.length },
    { id: 'barrel_1', x: -8, y: 0, z: -8, h: 1.1, r: 0.42, hp: 45, alive: true, boxIdx: classicBoxes.length + 1 },
    { id: 'barrel_2', x: -14, y: 0, z: 8, h: 1.1, r: 0.42, hp: 45, alive: true, boxIdx: classicBoxes.length + 2 },
    { id: 'barrel_3', x: 14, y: 0, z: -8, h: 1.1, r: 0.42, hp: 45, alive: true, boxIdx: classicBoxes.length + 3 },
  ];
  const barrelBoxes = barrels.map(b => [b.x - b.r, b.y, b.z - b.r, b.x + b.r, b.y + b.h, b.z + b.r]);
  const barrelVisuals = barrels.map(b => ({ type: 'barrel', id: b.id, x: b.x, y: b.y, z: b.z, h: b.h, r: b.r, color: 'barrelRust' }));
  return {
    boxes: [...classicBoxes.map(b => [...b.min, ...b.max]), ...barrelBoxes],
    visuals: [...classicBoxes, ...barrelVisuals],
    spawns: classicSpawns,
    barrels,
    sky: '#a9cfe8',
    fog: '#a9cfe8',
    theme: 'arena',
    getSurface: (x, y, z) => (y >= 1.4 ? 'wood' : 'concrete'),
  };
}

/* ---- 2. Low-Poly Pine Forest Map ---- */
export function forestMap() {
  const m = new MapBuilder();
  const FS = 24;

  // Ground and forest paths
  m.box(0, 0, FS * 2 + 2, FS * 2 + 2, 1, -1, 'grass');
  m.box(0, 0, 4.5, 42, 0.04, 0, 'dirt');  // North-South dirt path
  m.box(0, 0, 42, 4.5, 0.04, 0, 'dirt');  // East-West dirt path
  m.box(-10, 10, 10, 10, 0.05, 0, 'moss');
  m.box(10, -10, 10, 10, 0.05, 0, 'moss');

  // Outer Cliff Perimeter
  m.box(0, -FS - 0.5, FS * 2 + 2, 1.5, 6.5, 0, 'rockDark');
  m.box(0, FS + 0.5, FS * 2 + 2, 1.5, 6.5, 0, 'rockDark');
  m.box(-FS - 0.5, 0, 1.5, FS * 2, 6.5, 0, 'rockLight');
  m.box(FS + 0.5, 0, 1.5, FS * 2, 6.5, 0, 'rockLight');

  // Center Forest Watchtower (Lookout)
  const twH = 1.8;
  m.box(0, 0, 7.4, 7.4, 0.35, twH, 'woodDeck');
  // 4 corner support posts
  for (const cx of [-3, 3]) for (const cz of [-3, 3]) m.box(cx, cz, 0.6, 0.6, twH, 0, 'bark');
  // Stairs to deck
  m.stairs(0, -5.2, 3.2, 3.0, twH, 3, 'z', 1, 'wood');
  m.stairs(0, 5.2, 3.2, 3.0, twH, 3, 'z', -1, 'wood');
  // Protective low railings on lookout deck
  m.box(-3.5, 0, 0.4, 7.4, 1.1, twH + 0.35, 'wood');
  m.box(3.5, 0, 0.4, 7.4, 1.1, twH + 0.35, 'wood');
  m.box(0, 0, 1.4, 1.4, 1.3, twH + 0.35, 'crate'); // cover crate on deck

  // North-West Lumber Cabin
  m.box(-12, -12, 8, 8, 0.3, 0, 'woodDeck');
  m.box(-12, -15.8, 8, 0.4, 2.8, 0, 'wood'); // North wall
  m.box(-15.8, -12, 0.4, 8, 2.8, 0, 'wood'); // West wall
  m.box(-8.2, -12, 0.4, 8, 2.8, 0, 'wood');  // East wall
  m.box(-14.3, -8.2, 3.4, 0.4, 2.8, 0, 'wood'); // South wall left
  m.box(-9.7, -8.2, 3.4, 0.4, 2.8, 0, 'wood');  // South wall right (center doorway open)
  m.box(-12, -12, 1.4, 1.4, 1.3, 0.3, 'crate'); // inside crate

  // South-East Ranger Camp & Log Depot
  m.box(12, 12, 7.5, 6, 0.9, 0, 'woodDeck');
  m.stairs(8.7, 12, 2.4, 1.8, 0.9, 2, 'x', 1, 'wood');
  m.box(12, 13.5, 5, 1.2, 1.3, 0.9, 'wood');  // Log stack cover
  m.box(14, 10.5, 1.3, 1.3, 1.2, 0.9, 'crate');

  // Fallen Log Barricades (low jumpable cover)
  m.box(-6, 5, 5.5, 1.0, 1.2, 0, 'wood');
  m.box(5, -6, 1.0, 5.5, 1.2, 0, 'wood');
  m.box(-14, 6, 4.5, 0.9, 1.1, 0, 'wood');
  m.box(6, 14, 0.9, 4.5, 1.1, 0, 'wood');

  // Low-poly Pine Trees (distributed groves and cover)
  const treeCoords = [
    // North-East Grove
    [7, -8, 1.1, 7], [11, -7, 1.3, 8], [9, -12, 1.0, 6.5], [14, -13, 1.4, 8.5], [17, -8, 1.0, 6], [16, -17, 1.2, 7.5], [8, -17, 0.9, 5.8],
    // South-West Grove
    [-8, 8, 1.2, 7.5], [-12, 12, 1.4, 8.5], [-16, 8, 1.0, 6.2], [-8, 15, 1.3, 8], [-14, 16, 1.1, 7], [-18, 14, 0.9, 5.5], [-17, 19, 1.2, 7],
    // North & West Glades
    [-5, -17, 1.2, 7], [-19, -6, 1.3, 8], [-18, -18, 1.1, 6.8], [-6, -9, 0.95, 6], [-19, 2, 1.0, 6.2],
    // South & East Glades
    [18, 5, 1.2, 7.5], [18, 18, 1.3, 8], [6, 19, 1.0, 6.5], [20, -2, 1.1, 6.8], [-2, 18, 1.2, 7],
    // Perimeter Depth
    [-10, 21, 1.4, 8.5], [10, 21, 1.3, 8], [-21, 10, 1.2, 7.5], [21, -12, 1.2, 7.5], [-21, -12, 1.3, 8],
  ];
  for (const [tx, tz, ts, th] of treeCoords) m.tree(tx, tz, ts, th);

  // Faceted Rocks & Boulders
  const rockCoords = [
    [-6, -6, 1.6, 'rockDark', 0.2, 0.5, 0], [7, 6, 1.8, 'rockLight', 0.4, 1.2, 0.1],
    [-14, 0, 1.5, 'rockDark', 0, 0.8, 0.3], [14, 0, 1.7, 'rockDark', 0.3, 0.2, 0.4],
    [0, -13, 1.4, 'rockLight', 0.5, 0, 0.2], [0, 13, 1.5, 'rockDark', 0.1, 0.9, 0.5],
    [-11, 4, 1.2, 'rockLight', 0.3, 0.4, 0], [12, -4, 1.3, 'rockDark', 0.2, 0.7, 0.1],
    [-4, 11, 1.1, 'rockDark', 0, 0.3, 0.2], [4, -11, 1.2, 'rockLight', 0.1, 0.6, 0],
    [-18, -4, 1.9, 'rockDark', 0.4, 0.5, 0.2], [18, -14, 1.6, 'rockLight', 0.2, 0.8, 0.1],
  ];
  for (const [rx, rz, rs, col, rrotx, rroty, rrotz] of rockCoords) m.rock(rx, 0, rz, rs, col, rrotx, rroty, rrotz);

  m.barrel(8, 8, 1.1, 0.42, 0, 'barrelRust');
  m.barrel(8.6, 9.2, 1.1, 0.42, 0, 'barrelOlive');
  m.barrel(-8, -8, 1.1, 0.42, 0, 'barrelRust');

  const spawns = [
    [-18, 0, -18], [18, 0, 18], [-18, 0, 18], [18, 0, -18],
    [0, 0, -19], [0, 0, 19], [-19, 0, 0], [19, 0, 0],
  ].map(([x, y, z]) => ({ x, y, z }));

  return {
    boxes: m.boxes, visuals: m.visuals, spawns, barrels: m.barrels, sky: '#739184', fog: '#739184', theme: 'forest',
    getSurface: (x, y, z) => (y >= 1.4 ? 'wood' : 'dirt'),
  };
}

/* ---- 3. Procedural Random Sandbox Map ---- */
export function sandboxMap(seed = 12345) {
  const rand = mulberry32(seed);
  const m = new MapBuilder();
  const SS = 23;

  // Choose Theme
  const themeIdx = Math.floor(rand() * 3);
  const themes = [
    { floor: 'concrete', wall: 'metal', crate: 'hazard', deck: 'metal', pillar: 'rust', trim: 'slab', sky: '#9a887b', fog: '#9a887b', name: 'Industrial' },
    { floor: 'sand', wall: 'rockDark', crate: 'wood', deck: 'slab', pillar: 'rockLight', trim: 'woodDeck', sky: '#a89680', fog: '#a89680', name: 'Canyon' },
    { floor: 'floor', wall: 'wall', crate: 'cover', deck: 'deck', pillar: 'pillar', trim: 'trim', sky: '#6e7f91', fog: '#6e7f91', name: 'Facility' },
  ];
  const th = themes[themeIdx];

  // Base Floor and Perimeter Walls
  m.box(0, 0, SS * 2 + 2, SS * 2 + 2, 1, -1, th.floor);
  m.box(0, -SS - 0.5, SS * 2 + 2, 1.2, 5.5, 0, th.wall);
  m.box(0, SS + 0.5, SS * 2 + 2, 1.2, 5.5, 0, th.wall);
  m.box(-SS - 0.5, 0, 1.2, SS * 2, 5.5, 0, th.wall);
  m.box(SS + 0.5, 0, 1.2, SS * 2, 5.5, 0, th.wall);

  // Spawns (outer rings, always clear of structures)
  const spawns = [
    [-17, 0, -17], [17, 0, 17], [-17, 0, 17], [17, 0, -17],
    [0, 0, -18], [0, 0, 18], [-18, 0, 0], [18, 0, 0],
  ].map(([x, y, z]) => ({ x, y, z }));

  // Centerpiece Archetype
  const centerType = Math.floor(rand() * 3);
  if (centerType === 0) {
    // Crossfire Catwalk (+ shape bridge with stairs)
    const bridgeH = 1.6;
    m.box(0, 0, 6, 6, 0.35, bridgeH, th.deck);
    m.box(0, -6.5, 4, 7, 0.35, bridgeH, th.deck);
    m.box(0, 6.5, 4, 7, 0.35, bridgeH, th.deck);
    m.box(-6.5, 0, 7, 4, 0.35, bridgeH, th.deck);
    m.box(6.5, 0, 7, 4, 0.35, bridgeH, th.deck);
    // 4 stair flights
    m.stairs(0, -11.5, 3.2, 3.0, bridgeH, 3, 'z', 1, th.trim);
    m.stairs(0, 11.5, 3.2, 3.0, bridgeH, 3, 'z', -1, th.trim);
    m.stairs(-11.5, 0, 3.0, 3.2, bridgeH, 3, 'x', 1, th.trim);
    m.stairs(11.5, 0, 3.0, 3.2, bridgeH, 3, 'x', -1, th.trim);
    // Center column & cover
    m.box(0, 0, 1.2, 1.2, 1.3, bridgeH + 0.35, th.crate);
  } else if (centerType === 1) {
    // Fortress Compound (open-gate fortress with central dais)
    const fortH = 2.6;
    m.box(-5.2, -5.2, 0.8, 11, fortH, 0, th.wall); // West
    m.box(5.2, -5.2, 0.8, 11, fortH, 0, th.wall);  // East
    m.box(-5.2, -5.2, 11, 0.8, fortH, 0, th.wall); // North
    m.box(-5.2, 5.2, 11, 0.8, fortH, 0, th.wall);  // South
    // Center dais inside
    m.box(0, 0, 4.5, 4.5, 0.8, 0, th.deck);
    m.box(0, 0, 1.2, 1.2, 1.2, 0.8, th.crate);
    // Outer entry pillars
    for (const sx of [-9, 9]) for (const sz of [-9, 9]) m.box(sx, sz, 1.8, 1.8, 4.5, 0, th.pillar);
  } else {
    // Stepped Ziggurat (two-tier concentric deck)
    m.box(0, 0, 12, 12, 0.8, 0, th.deck);
    m.stairs(0, -7.5, 3.5, 3.0, 0.8, 2, 'z', 1, th.trim);
    m.stairs(0, 7.5, 3.5, 3.0, 0.8, 2, 'z', -1, th.trim);
    m.box(0, 0, 6, 6, 0.8, 0.8, th.deck);
    m.stairs(-4.2, 0, 2.5, 2.4, 0.8, 2, 'x', 1, th.trim);
    m.stairs(4.2, 0, 2.5, 2.4, 0.8, 2, 'x', -1, th.trim);
    m.box(0, 0, 1.4, 1.4, 1.3, 1.6, th.crate);
  }

  // Procedural Structures in each Quadrant
  const isClear = (x, z, r = 3.2) => {
    for (const s of spawns) if (Math.hypot(x - s.x, z - s.z) < r) return false;
    if (Math.hypot(x, z) < 8.5) return false; // center zone clear
    return true;
  };

  const quads = [
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  for (const [qx, qz] of quads) {
    // 3-4 procedural features per quadrant
    const count = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const rx = qx * (7 + rand() * 10);
      const rz = qz * (7 + rand() * 10);
      if (!isClear(rx, rz)) continue;

      const kind = Math.floor(rand() * 4);
      if (kind === 0) {
        // Shipping container / bunker block
        const orient = rand() > 0.5;
        const w = orient ? 5.2 : 2.2, d = orient ? 2.2 : 5.2;
        m.box(rx, rz, w, d, 2.4, 0, th.crate);
      } else if (kind === 1) {
        // Double crate stack
        m.box(rx, rz, 1.5, 1.5, 1.4, 0, th.crate);
        if (rand() > 0.3) m.box(rx, rz, 1.1, 1.1, 1.2, 1.4, th.trim);
      } else if (kind === 2) {
        // Low cover barrier
        const orient = rand() > 0.5;
        const w = orient ? 4.5 : 0.8, d = orient ? 0.8 : 4.5;
        m.box(rx, rz, w, d, 1.3, 0, th.wall);
      } else {
        // Structural pillar / tower
        m.box(rx, rz, 1.8, 1.8, 4.5, 0, th.pillar);
      }
    }
  }

  m.barrel(6, 6, 1.1, 0.42, 0, 'hazard');
  m.barrel(-6, -6, 1.1, 0.42, 0, 'hazard');

  return {
    boxes: m.boxes, visuals: m.visuals, spawns, barrels: m.barrels, sky: th.sky, fog: th.fog, theme: 'sandbox', seed, name: th.name,
    getSurface: (x, y, z) => (y >= 1.0 ? 'metal' : 'concrete'),
  };
}

/* ---- 4. Aftermath Map (Medal of Honor Allied Assault Style) ---- */
export function aftermathMap() {
  const m = new MapBuilder();
  const AS = 25;

  // Base War-torn Ground and Rubble Paths
  m.box(0, 0, AS * 2 + 2, AS * 2 + 2, 1, -1, 'aftermathGround');
  m.box(-3, 0, 5.5, 48, 0.03, 0, 'aftermathRubble');
  m.box(3, 4, 18, 16, 0.03, 0, 'aftermathRubble');
  m.box(-6, -6, 14, 14, 0.03, 0, 'plasterDamaged');

  // Outer Perimeter Walls
  m.box(0, -AS - 0.5, AS * 2 + 2, 1.2, 5.2, 0, 'plasterDamaged');
  m.box(0, AS + 0.5, AS * 2 + 2, 1.2, 5.2, 0, 'plasterDamaged');
  m.box(-AS - 0.5, 0, 1.2, AS * 2, 5.2, 0, 'plasterLight');
  m.box(AS + 0.5, 0, 1.2, AS * 2, 5.2, 0, 'plasterLight');

  // North-East Radio Tower (towering behind the ruins)
  m.antenna(18, -28, 20);

  // Exterior Pine Trees beyond the walls
  const extTrees = [
    [-18, -28], [-8, -28], [2, -28], [11, -28], [24, -28],
    [-28, -15], [-28, -5], [-28, 6], [-28, 16],
    [28, -15], [28, -4], [28, 8], [28, 18],
    [-15, 28], [0, 28], [15, 28],
  ];
  for (const [tx, tz] of extTrees) m.tree(tx, tz, 1.1, 7.5);

  // Center Courtyard Plaza: Bare blasted tree in stone planter, barrels & plank piles
  m.box(0, 2, 3.4, 3.4, 0.45, 0, 'plasterDamaged');
  m.bareTree(0, 2, 1.2, 5.8);

  // Oil drums and rust barrels around the planter
  m.barrel(-1.4, 3.2, 1.1, 0.42, 0, 'barrelRust');
  m.barrel(-1.3, 4.1, 1.1, 0.42, 0, 'barrelRust');
  m.barrel(1.5, 3.5, 1.1, 0.42, 0, 'barrelOlive');
  m.barrel(1.6, 4.4, 1.1, 0.42, 0, 'barrelRust');

  // Timber plank lumber pile
  m.box(-6.5, 2.5, 4.2, 2.0, 1.1, 0, 'burntWood');
  m.box(-6.5, 2.5, 3.6, 1.6, 0.8, 1.1, 'wood');

  // Supply crates
  m.box(2.4, 0, 1.4, 1.4, 1.2, 0, 'crate');
  m.box(2.4, 0, 1.1, 1.1, 1.0, 1.2, 'crate');

  // North-West Ruined 2-Story House (Sniper Loft)
  m.box(-12, -12, 12, 12, 0.3, 0, 'plasterDamaged');
  m.box(-12, -18, 12, 0.6, 4.8, 0, 'plasterLight');     // North outer wall
  m.box(-18, -12, 0.6, 12, 4.8, 0, 'plasterLight');     // West outer wall
  m.box(-15, -6, 5.5, 0.6, 4.8, 0, 'plasterDamaged');   // South wall left
  m.box(-8, -6, 3.5, 0.6, 4.8, 0, 'plasterDamaged');    // South wall right (doorway open)
  m.box(-6, -15, 0.6, 5.5, 4.8, 0, 'plasterDamaged');   // East wall

  // Second-floor sniper loft overlooking courtyard
  const loftH = 2.4;
  m.box(-12, -12, 8, 8, 0.3, loftH, 'deck');
  m.box(-8.2, -12, 0.3, 8, 1.0, loftH + 0.3, 'plasterLight');
  m.stairs(-9.5, -7.5, 2.2, 3.2, loftH, 4, 'z', -1, 'wood');

  // Collapsed roof slab ramp leading from loft into courtyard
  m.ramp(-5.5, -8.5, 2.8, 4.0, loftH, 5, 'x', -1, 0, 'plasterLight');
  m.slab(-5.5, 1.2, -8.5, 4.5, 3.0, 0.25, 0, 0, 0.45, 'plasterLight');

  // South-West Bombed Villa (interior ruins with broken furniture & floor slabs)
  m.box(-12, 12, 12, 12, 0.3, 0, 'plasterDamaged');
  m.box(-18, 12, 0.6, 12, 2.8, 0, 'plasterDamaged');
  m.box(-12, 18, 12, 0.6, 2.8, 0, 'plasterLight');
  m.box(-6, 14, 0.6, 6, 2.8, 0, 'plasterDamaged');
  m.box(-14, 6, 6, 0.6, 2.8, 0, 'plasterDamaged');
  // Bureau / furniture cover
  m.box(-15, 15, 2.2, 1.2, 2.0, 0, 'burntWood');
  m.box(-10, 15, 2.4, 1.6, 1.1, 0, 'wood');
  // Smashed floor debris slabs
  m.slab(-10, 0.15, 10, 2.5, 2.0, 0.2, 0.1, 0.4, 0.05, 'debrisWhite');
  m.slab(-13, 0.15, 9, 2.0, 1.8, 0.2, -0.1, 0.2, -0.05, 'debrisWhite');

  // North-East Garrison / Guardhouse
  m.box(12, -12, 10, 10, 0.3, 0, 'concrete');
  m.box(12, -17, 10, 0.6, 3.2, 0, 'concrete');
  m.box(17, -12, 0.6, 10, 3.2, 0, 'concrete');
  m.box(7, -14, 0.6, 6, 3.2, 0, 'plasterDamaged');
  m.box(14, -7, 6, 0.6, 3.2, 0, 'plasterDamaged');
  // Sandbags & crates outside entrance
  m.box(8, -8, 3.2, 0.9, 1.1, 0, 'sandWet');
  m.box(10, -5, 1.4, 1.4, 1.3, 0, 'crate');
  m.box(14, -13, 1.3, 1.3, 1.2, 0, 'crate');

  // South-East Storage Depot & Flanking Alley
  m.box(18, 6, 2.6, 6.0, 2.6, 0, 'metal');
  m.box(14, 13, 6, 6, 2.4, 0, 'brickRed');
  m.box(-20, 2, 2.6, 6.0, 2.6, 0, 'rust');
  m.box(12, 6, 0.4, 4.5, 2.2, 0, 'wood');

  // Tilted Concrete Slabs (signature Medal of Honor Aftermath rubble cover)
  m.ramp(0, -6, 3.0, 4.0, 1.6, 4, 'z', 1, 0, 'plasterLight');
  m.slab(0, 0.8, -6, 3.2, 4.2, 0.25, 0.38, 0, 0, 'plasterLight');
  m.slab(5, 0.5, 6, 3.0, 2.5, 0.25, -0.25, 0.3, 0.1, 'plasterDamaged');
  m.slab(-7, 0.5, -2, 2.5, 3.0, 0.25, 0.2, -0.3, 0.2, 'plasterDamaged');

  const spawns = [
    [-14, 0, -14], [14, 0, -14], [-14, 0, 14], [14, 0, 14],
    [-20, 0, 0], [20, 0, 0], [0, 0, -15], [0, 0, 15],
  ].map(([x, y, z]) => ({ x, y, z }));

  return {
    boxes: m.boxes, visuals: m.visuals, spawns, barrels: m.barrels, sky: '#b8a688', fog: '#b8a688', theme: 'aftermath',
    getSurface: (x, y, z) => (Math.hypot(x - 14, z - 14) < 3.5 ? 'metal' : (y >= 1.2 ? 'concrete' : 'rubble')),
  };
}

/* ---- 5. River Forest Map (River Valley & Wooden Bridges) ---- */
export function riverForestMap() {
  const m = new MapBuilder();
  const RS = 25;

  // Base Terrain
  m.box(0, 0, RS * 2 + 2, RS * 2 + 2, 1, -1, 'grass');

  // River Channel (running North to South through center)
  m.box(0, 0, 9.6, RS * 2 + 2, 0.3, -0.6, 'riverbed');
  m.box(-5.2, 0, 2.0, RS * 2 + 2, 0.35, -0.3, 'sandWet');
  m.box(5.2, 0, 2.0, RS * 2 + 2, 0.35, -0.3, 'sandWet');
  // Water Surface
  m.water(0, 0, 9.6, RS * 2 + 2, -0.15);

  // Outer Mountain Cliffs
  m.box(0, -RS - 0.5, RS * 2 + 2, 1.5, 6.5, 0, 'rockDark');
  m.box(0, RS + 0.5, RS * 2 + 2, 1.5, 6.5, 0, 'rockDark');
  m.box(-RS - 0.5, 0, 1.5, RS * 2, 6.5, 0, 'rockLight');
  m.box(RS + 0.5, 0, 1.5, RS * 2, 6.5, 0, 'rockLight');

  // Center Wooden Bridge spanning the river
  const brH = 0.45;
  m.box(0, 0, 11, 4.2, 0.35, brH, 'woodDeck');
  m.box(0, -2.1, 11, 0.25, 0.95, brH + 0.35, 'wood');
  m.box(0, 2.1, 11, 0.25, 0.95, brH + 0.35, 'wood');
  m.stairs(-6.5, 0, 2.2, 4.2, brH, 2, 'x', 1, 'wood');
  m.stairs(6.5, 0, 2.2, 4.2, brH, 2, 'x', -1, 'wood');

  // North Rapids Crossing: Fallen Mossy Tree Log & Stepping Stones
  m.box(0, -13, 11, 1.2, 0.7, -0.1, 'bark');
  m.rock(-2.5, -0.3, -13, 1.4, 'rockLight', 0.2, 0.4, 0);
  m.rock(2.5, -0.3, -13, 1.5, 'rockDark', 0.1, 0.8, 0.2);

  // South Shallows & Ford: Submerged Crates & Boulders
  m.box(-1.8, 13, 1.4, 1.4, 0.9, -0.3, 'crate');
  m.rock(1.5, -0.3, 13, 1.6, 'rockDark', 0.3, 0.2, 0.4);

  // West Bank: Ranger Cabin / Outpost on Elevated Bank
  m.box(-14, -8, 8, 8, 0.4, 0.5, 'woodDeck');
  m.box(-14, -12, 8, 0.4, 2.8, 0.9, 'wood');
  m.box(-18, -8, 0.4, 8, 2.8, 0.9, 'wood');
  m.box(-10, -8, 0.4, 8, 2.8, 0.9, 'wood');
  m.box(-14, -4, 4, 0.4, 2.8, 0.9, 'wood');
  m.box(-9.5, -8, 1.8, 7.5, 0.9, 0.5, 'wood'); // Veranda facing river
  m.box(-14, -8, 1.3, 1.3, 1.2, 0.9, 'crate');

  // East Bank: Lumber Camp & Watchtower
  const twH = 2.2;
  m.box(13, 9, 6, 6, 0.35, twH, 'woodDeck');
  for (const cx of [10.5, 15.5]) for (const cz of [6.5, 11.5]) m.box(cx, cz, 0.5, 0.5, twH, 0, 'bark');
  m.stairs(13, 5, 2.6, 2.8, twH, 4, 'z', 1, 'wood');
  m.box(9.8, 9, 0.3, 6, 1.0, twH + 0.35, 'wood');
  m.box(16.2, 9, 0.3, 6, 1.0, twH + 0.35, 'wood');
  m.box(13, 9, 1.4, 1.4, 1.2, twH + 0.35, 'crate');
  // Log stacks on East bank
  m.box(15, -6, 5.5, 2.2, 1.4, 0, 'wood');

  // Low-poly Pine Trees along West and East riverbanks
  const riverTrees = [
    // West Bank Forest
    [-9, -15, 1.2, 7.5], [-15, -17, 1.3, 8], [-19, -13, 1.0, 6.5], [-18, -3, 1.1, 7],
    [-8, 6, 1.3, 8], [-13, 8, 1.1, 7], [-18, 5, 1.4, 8.5], [-9, 15, 1.0, 6.5],
    [-14, 16, 1.2, 7.5], [-19, 18, 1.1, 7], [-8, 20, 1.3, 8], [-18, -20, 1.2, 7.5],
    // East Bank Forest
    [8, -15, 1.3, 8], [14, -16, 1.1, 7], [19, -12, 1.4, 8.5], [8, -7, 1.0, 6.2],
    [9, 4, 1.2, 7.5], [18, 3, 1.3, 8], [8, 16, 1.1, 7], [14, 17, 1.4, 8.5],
    [19, 15, 1.0, 6.5], [18, 20, 1.2, 7.5], [9, -20, 1.3, 8], [19, -20, 1.1, 7],
  ];
  for (const [tx, tz, ts, th] of riverTrees) m.tree(tx, tz, ts, th);

  // Riverbank Boulders
  const riverRocks = [
    [-7, -7, 1.7, 'rockDark', 0.2, 0.5, 0], [7, 7, 1.8, 'rockLight', 0.4, 1.2, 0.1],
    [-7, 8, 1.5, 'rockLight', 0.1, 0.3, 0.4], [7, -8, 1.6, 'rockDark', 0.3, 0.8, 0],
    [-13, 2, 1.3, 'rockDark', 0, 0.6, 0.2], [14, -1, 1.4, 'rockLight', 0.2, 0.1, 0.3],
  ];
  for (const [rx, rz, rs, col, rrotx, rroty, rrotz] of riverRocks) m.rock(rx, 0, rz, rs, col, rrotx, rroty, rrotz);

  const spawns = [
    [-17, 0, -17], [17, 0, 17], [-17, 0, 17], [17, 0, -17],
    [-18, 0, 0], [18, 0, 0], [-10, 0, 15], [10, 0, -15],
  ].map(([x, y, z]) => ({ x, y, z }));

  m.barrel(6, 12, 1.1, 0.42, 0, 'barrelRust');
  m.barrel(-6, -12, 1.1, 0.42, 0, 'barrelOlive');

  return {
    boxes: m.boxes, visuals: m.visuals, spawns, barrels: m.barrels, sky: '#5a828e', fog: '#5a828e', theme: 'river',
    getSurface: (x, y, z) => (Math.abs(x) < 4.5 && y >= 0.3 ? 'wood' : (y <= 0.15 && Math.abs(z) < 13 ? 'water' : 'dirt')),
  };
}

/* Factory returning the map requested */
export function getMap(type = 'aftermath', seed = 0) {
  if (type === 'aftermath') return aftermathMap();
  if (type === 'river') return riverForestMap();
  if (type === 'forest') return forestMap();
  if (type === 'sandbox') return sandboxMap(seed || 12345);
  return defaultArena();
}
