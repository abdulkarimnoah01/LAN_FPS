/* Shared game rules. Runs identically on the host (authoritative) and on each
   client (prediction), so a client's replayed inputs land where the host put it.
   No DOM, no three.js: the Node tests import this file directly. */

export const DT = 1 / 60;            // one input = one fixed simulation step
export const R = 0.35;               // player half-width (m)
export const H = 1.8;                // player height standing (backward-compatible)
export const EYE = 1.6;              // camera height above feet standing
export const HEAD = 1.45;            // head hitbox starts here standing

export const H_STAND = 1.8, H_CROUCH = 1.15;
export const EYE_STAND = 1.6, EYE_CROUCH = 1.05;
export const HEAD_STAND = 1.45, HEAD_CROUCH = 0.85;

const SPEED = 6.5, CROUCH_SPEED = 3.2, ACCEL = 70, AIR_ACCEL = 14, JUMP = 7.2, GRAVITY = 20, STEP = 0.55, EPS = 1e-4;

export const WEAPONS = [
  { id: 'ak47', name: 'AK-47', mag: 30, fireTicks: 6, reloadTicks: 70, damage: 25, headDamage: 50, range: 150, pellets: 1, spread: 0.012, fov: 48 },
  { id: 'shotgun', name: 'Shotgun', mag: 8, fireTicks: 42, reloadTicks: 85, damage: 16, headDamage: 28, range: 45, pellets: 8, spread: 0.065, fov: 56 },
  { id: 'sniper', name: 'Sniper', mag: 5, fireTicks: 52, reloadTicks: 95, damage: 85, headDamage: 170, range: 300, pellets: 1, spread: 0.0008, fov: 16 },
  { id: 'smg', name: 'SMG', mag: 40, fireTicks: 3, reloadTicks: 55, damage: 15, headDamage: 30, range: 75, pellets: 1, spread: 0.038, fov: 54 },
  { id: 'lmg', name: 'LMG', mag: 75, fireTicks: 5, reloadTicks: 140, damage: 28, headDamage: 56, range: 160, pellets: 1, spread: 0.026, fov: 50 },
  { id: 'knife', name: 'Combat Knife', mag: 1, fireTicks: 22, reloadTicks: 0, damage: 55, headDamage: 110, range: 2.8, pellets: 1, spread: 0, fov: 70, melee: true },
];

export const RULES = {
  hp: 100, mag: 30, fireTicks: 6, reloadTicks: 70, damage: 25, headDamage: 50,
  range: 150, respawn: 3, winKills: 10, endPause: 8, maxPlayers: 6,
};

// Input button bits.
export const B = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, FIRE: 32, RELOAD: 64, CROUCH: 128, MELEE: 256, GRENADE: 512 };

export function newPlayer(id, name, slot) {
  return { id, name, slot, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, g: false, cr: false,
    hp: RULES.hp, w: 0, ammos: WEAPONS.map(w => w.mag), ammo: WEAPONS[0].mag, cd: 0, rl: 0, alive: true, k: 0, d: 0, seq: 0, sp: 0,
    grenades: 2, grenadeCd: 0, team: 'none', isBot: false };
}

// The parts of a player that prediction owns and the host corrects.
export const PREDICTED = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'g', 'cr', 'w', 'ammo', 'cd', 'rl', 'grenades'];

export function aim(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

function overlaps(b, x, y, z, h = H_STAND) {
  return x + R > b[0] && x - R < b[3] && y + h > b[1] && y < b[4] && z + R > b[2] && z - R < b[5];
}

/* Big imported maps carry thousands of boxes, so movement only tests the ones near the
   player. The index is built once per box list and lives on the world object. */
const GRID = 4, REACH = 1.5;
function nearBoxes(world, x, z) {
  const boxes = world.boxes;
  if (boxes.length < 64) return boxes;
  let g = world._grid;
  if (!g || g.src !== boxes || g.n !== boxes.length) {
    g = world._grid = { src: boxes, n: boxes.length, cells: new Map() };
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      for (let cx = Math.floor(b[0] / GRID); cx <= Math.floor(b[3] / GRID); cx++) {
        for (let cz = Math.floor(b[2] / GRID); cz <= Math.floor(b[5] / GRID); cz++) {
          const k = cx * 100003 + cz;
          const c = g.cells.get(k);
          if (c) c.push(i); else g.cells.set(k, [i]);
        }
      }
    }
  }
  const out = [], seen = new Set();
  for (let cx = Math.floor((x - REACH) / GRID); cx <= Math.floor((x + REACH) / GRID); cx++) {
    for (let cz = Math.floor((z - REACH) / GRID); cz <= Math.floor((z + REACH) / GRID); cz++) {
      const c = g.cells.get(cx * 100003 + cz);
      if (c) for (const i of c) if (!seen.has(i)) { seen.add(i); out.push(i); }
    }
  }
  out.sort((a, b) => a - b);
  return out.map(i => boxes[i]);
}
/* True when something solid lies within `depth` below (or a step above) the point; bots use it to avoid ledges. */
export function supported(world, x, y, z, depth = 1) {
  for (const b of nearBoxes(world, x, z)) {
    if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5] && b[4] <= y + STEP && b[4] >= y - depth) return true;
  }
  return false;
}
function free(world, x, y, z, h = H_STAND) {
  for (const b of nearBoxes(world, x, z)) if (overlaps(b, x, y, z, h)) return false;
  return true;
}

function moveHorizontal(p, axis, d, world, h = H_STAND) {
  if (!d) return;
  p[axis] += d;
  for (const b of nearBoxes(world, p.x, p.z)) {
    if (!overlaps(b, p.x, p.y, p.z, h)) continue;
    const rise = b[4] - p.y;
    // Walk up low ledges and stairs instead of stopping dead.
    if (p.g && rise > 0 && rise <= STEP && free(world, p.x, b[4] + EPS, p.z, h)) { p.y = b[4] + EPS; continue; }
    const lo = axis === 'x' ? b[0] : b[2], hi = axis === 'x' ? b[3] : b[5];
    p[axis] = d > 0 ? lo - R - EPS : hi + R + EPS;
    p['v' + axis] = 0;
  }
}

function moveVertical(p, d, world, h = H_STAND) {
  p.y += d; p.g = false;
  for (const b of nearBoxes(world, p.x, p.z)) {
    if (!overlaps(b, p.x, p.y, p.z, h)) continue;
    if (d <= 0) { p.y = b[4]; p.g = true; } else p.y = b[1] - h - EPS;
    p.vy = 0;
  }
}

/* Advances one player by one input. Returns true when a shot leaves the barrel. */
export function stepPlayer(p, inp, world) {
  p.yaw = inp.yaw;
  p.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch));
  if (!p.alive) return false;
  const b = inp.b;

  // Crouching mode
  const wantCrouch = !!(b & B.CROUCH);
  if (wantCrouch) {
    p.cr = true;
  } else if (p.cr) {
    // Only stand up if head clearance is free
    if (free(world, p.x, p.y, p.z, H_STAND)) {
      p.cr = false;
    }
  } else {
    p.cr = false;
  }

  // Weapon switch handling
  if (inp.w !== undefined && inp.w !== p.w && inp.w >= 0 && inp.w < WEAPONS.length) {
    if (p.ammos) p.ammos[p.w] = p.ammo;
    p.w = inp.w;
    p.ammo = p.ammos ? p.ammos[p.w] : (WEAPONS[p.w]?.mag || RULES.mag);
    p.cd = 10; // equip delay (0.16s)
    p.rl = 0;  // cancel ongoing reload on weapon swap
  }

  const curWep = WEAPONS[p.w || 0] || WEAPONS[0];
  const maxMag = curWep.mag;
  const fireCd = curWep.fireTicks;
  const rlCd = curWep.reloadTicks;

  // Knife movement speed boost (+15% run speed)
  const speedMult = curWep.id === 'knife' ? 1.15 : 1.0;
  const curH = p.cr ? H_CROUCH : H_STAND;
  const maxSpeed = (p.cr ? CROUCH_SPEED : SPEED) * speedMult;

  // Weapon: cooldown and reload are counted in input steps so prediction matches.
  let fired = false;
  p.quickMelee = false;
  p.threwGrenade = false;
  if (p.cd > 0) p.cd--;
  if (p.grenadeCd > 0) p.grenadeCd--;
  if (p.rl > 0 && --p.rl === 0) {
    p.ammo = maxMag;
    if (p.ammos) p.ammos[p.w] = maxMag;
  }

  // Grenade throw (B.GRENADE)
  if ((b & B.GRENADE) && p.grenades > 0 && !p.grenadeCd) {
    p.grenades--;
    p.grenadeCd = 45;
    p.threwGrenade = true;
  }

  // Quick Melee (B.MELEE) or Knife Weapon Primary Attack (B.FIRE)
  if ((b & B.MELEE) && !p.cd) {
    p.cd = 22;
    p.quickMelee = true;
    fired = true;
  } else if (curWep.melee) {
    p.ammo = 1;
    p.rl = 0;
    if ((b & B.FIRE) && !p.cd) {
      p.cd = fireCd;
      fired = true;
    }
  } else {
    if ((b & B.RELOAD) && !p.rl && p.ammo < maxMag) p.rl = rlCd;
    if ((b & B.FIRE) && !p.cd && !p.rl) {
      if (p.ammo > 0) {
        p.ammo--;
        if (p.ammos) p.ammos[p.w] = p.ammo;
        p.cd = fireCd;
        fired = true;
        if (!p.ammo) p.rl = rlCd;
      } else {
        p.rl = rlCd;
      }
    }
  }

  // Movement.
  const fwd = ((b & B.FWD) ? 1 : 0) - ((b & B.BACK) ? 1 : 0);
  const side = ((b & B.RIGHT) ? 1 : 0) - ((b & B.LEFT) ? 1 : 0);
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  let wx = -s * fwd + c * side, wz = -c * fwd - s * side;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  const a = (p.g ? ACCEL : AIR_ACCEL) * DT;
  p.vx += Math.max(-a, Math.min(a, wx * maxSpeed - p.vx));
  p.vz += Math.max(-a, Math.min(a, wz * maxSpeed - p.vz));
  if (p.g && (b & B.JUMP) && !p.cr) { p.vy = JUMP; p.g = false; }
  p.vy = Math.max(p.vy - GRAVITY * DT, -40);

  moveHorizontal(p, 'x', p.vx * DT, world, curH);
  moveHorizontal(p, 'z', p.vz * DT, world, curH);
  moveVertical(p, p.vy * DT, world, curH);

  // Jump pads
  if (world.jumpPads && world.jumpPads.length) {
    for (let j = 0; j < world.jumpPads.length; j++) {
      const pad = world.jumpPads[j];
      if (overlaps(pad.box, p.x, p.y, p.z, curH)) {
        p.vy = pad.vy || 14.5;
        if (pad.vx) p.vx = pad.vx;
        if (pad.vz) p.vz = pad.vz;
        p.g = false;
        p.onJumpPad = true;
      }
    }
  }

  // Hazard kill floor (pit/void/lava)
  if (world.killY !== undefined && p.y < world.killY) {
    p.hp = 0;
  }
  if (world.hazards) {
    for (const hz of world.hazards) if (overlaps(hz, p.x, p.y, p.z, curH)) { p.hp = 0; break; }
  }

  return fired;
}

// Ray / box slab test. Returns the entry distance or Infinity.
export function rayBox(o, d, b, max = Infinity) {
  let t0 = 0, t1 = max;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let a = (b[i] - o[i]) * inv, c = (b[i + 3] - o[i]) * inv;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

export function hitboxes(p) {
  const h = p.cr ? H_CROUCH : H_STAND;
  const headStart = p.cr ? HEAD_CROUCH : HEAD_STAND;
  return {
    body: [p.x - R, p.y, p.z - R, p.x + R, p.y + headStart, p.z + R],
    head: [p.x - 0.22, p.y + headStart, p.z - 0.22, p.x + 0.22, p.y + h + 0.05, p.z + 0.22],
  };
}

/* Hitscan from the shooter's eye. Walls stop the shot. Supports multi-pellet spread. */
export function castShot(world, players, shooter, wepInfo = null, rand = Math.random) {
  const wep = wepInfo || (WEAPONS[shooter.w || 0] || WEAPONS[0]);
  const pellets = wep.pellets || 1;
  const spread = (wep.spread || 0) * (shooter.cr ? 0.7 : 1.0);
  const eyeH = shooter.cr ? EYE_CROUCH : EYE_STAND;
  const o = [shooter.x, shooter.y + eyeH, shooter.z];
  const hits = [];
  const tracers = [];

  for (let i = 0; i < pellets; i++) {
    let yaw = shooter.yaw, pitch = shooter.pitch;
    if (spread > 0 && pellets > 1) {
      const angle = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * spread;
      yaw += Math.cos(angle) * r;
      pitch += Math.sin(angle) * r;
    } else if (spread > 0) {
      yaw += (rand() - 0.5) * spread;
      pitch += (rand() - 0.5) * spread;
    }
    const d = aim(yaw, pitch);
    let best = wep.range || RULES.range;
    let hit = null;
    if (world.barrels) {
      for (const bar of world.barrels) {
        if (!bar.alive) continue;
        const bbox = [bar.x - bar.r, bar.y, bar.z - bar.r, bar.x + bar.r, bar.y + bar.h, bar.z + bar.r];
        const tb = rayBox(o, d, bbox, best);
        if (tb < best) { best = tb; hit = { barrelId: bar.id, id: null }; }
      }
    }
    for (let bi = 0; bi < world.boxes.length; bi++) {
      if (world.barrels?.some(b => b.alive && b.boxIdx === bi)) continue;
      const t = rayBox(o, d, world.boxes[bi], best);
      if (t < best) { best = t; hit = null; }
    }
    for (const p of players) {
      if (p === shooter || !p.alive) continue;
      const hb = hitboxes(p);
      const th = rayBox(o, d, hb.head, best);
      if (th < best) { best = th; hit = { id: p.id, head: true }; }
      const tb = rayBox(o, d, hb.body, best);
      if (tb < best) { best = tb; hit = { id: p.id, head: false }; }
      if (hit && wep.melee) {
        // Backstab detection: attacker roughly behind target
        const diffYaw = Math.abs(Math.atan2(Math.sin(p.yaw - shooter.yaw), Math.cos(p.yaw - shooter.yaw)));
        if (diffYaw < 1.3) {
          hit.head = true;
          hit.backstab = true;
        }
      }
    }
    const to = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    tracers.push({ from: o, to });
    if (hit) hits.push(hit);
  }
  return {
    from: o,
    to: tracers[0].to,
    tracers,
    hits,
    hit: hits[0] || null,
  };
}
