/* Authoritative match state. Only the host runs this: it applies every player's
   inputs, resolves shots, and owns health, kills, respawns, bots, barrels, grenades, and the round. */
import { DT, RULES, WEAPONS, newPlayer, stepPlayer, castShot, PREDICTED, aim, rayBox, B } from './sim.js';

const MAX_CREDIT = 10;   // inputs a player may bank (absorbs network bursts, stops speed-ups)
const MAX_QUEUE = 120;

const BOT_NAMES = ['Rex', 'Viper', 'Ghost', 'Shadow', 'Hawk', 'Titan', 'Wolf', 'Blaze', 'Frost', 'Echo'];
const CHAR_ROSTER = ['abdulkarim', 'mina', 'abdulkarim-blue'];

function round(v) { return Math.round(v * 1000) / 1000; }

export function hasLOS(world, from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.1) return true;
  const d = [dx / dist, dy / dist, dz / dist];
  for (const b of world.boxes) {
    const t = rayBox(from, d, b, dist);
    if (t < dist - 0.2) return false;
  }
  return true;
}

export class HostGame {
  constructor(world, { random = Math.random, mode = 'ffa' } = {}) {
    this.world = world;
    this.random = random;
    this.mode = mode; // 'ffa' or 'tdm'
    this.players = new Map();
    this.queues = new Map();
    this.credit = new Map();
    this.bots = new Map();
    this.barrels = (world.barrels || []).map(b => ({ ...b }));
    this.grenades = [];
    this.grenadeSeq = 0;
    this.time = 0;
    this.tick = 0;
    this.phase = 'play';
    this.winner = null;
    this.endAt = 0;
    this.events = [];
    this.teams = { red: { kills: 0 }, blue: { kills: 0 } };
  }

  addPlayer(id, name, char = '', team = null) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= RULES.maxPlayers) throw Error('Room is full');
    const used = new Set([...this.players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    const p = newPlayer(id, String(name || 'Player').slice(0, 20), slot);
    p.char = String(char || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32);

    if (this.mode === 'tdm') {
      const redCount = [...this.players.values()].filter(x => x.team === 'red').length;
      const blueCount = [...this.players.values()].filter(x => x.team === 'blue').length;
      p.team = team || (redCount <= blueCount ? 'red' : 'blue');
    } else {
      p.team = 'none';
    }

    this.players.set(id, p);
    this.queues.set(id, []);
    this.credit.set(id, MAX_CREDIT);
    this.spawn(p);
    this.events.push({ t: 'join', id, name: p.name, team: p.team });
    return p;
  }

  addBot(name = null, char = '', diff = 'medium') {
    if (this.players.size >= RULES.maxPlayers) throw Error('Room is full');
    const existing = new Set([...this.players.values()].map(p => p.name));
    let botName = name;
    if (!botName) {
      botName = BOT_NAMES.find(n => !existing.has(n)) || ('Bot-' + (this.bots.size + 1));
    }
    const chosenChar = char || CHAR_ROSTER[this.bots.size % CHAR_ROSTER.length];
    const botId = 'bot_' + Math.random().toString(36).slice(2, 8);
    const p = this.addPlayer(botId, botName, chosenChar);
    p.isBot = true;
    p.botDiff = diff;
    p.botStrafeDir = Math.random() > 0.5 ? 1 : -1;
    p.botStrafeTime = 0;
    this.bots.set(botId, p);
    return p;
  }

  removeBot(id = null) {
    const botId = id || [...this.bots.keys()].pop();
    if (!botId) return false;
    this.bots.delete(botId);
    this.removePlayer(botId);
    return true;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.bots.delete(id);
    this.queues.delete(id);
    this.credit.delete(id);
    this.events.push({ t: 'leave', id });
  }

  /* Inputs arrive as [seq, buttons, yaw, pitch, w]. Clients resend the last few on
     the unreliable channel, so duplicates and old ones are dropped here. */
  queueInput(id, list) {
    const p = this.players.get(id), q = this.queues.get(id);
    if (!p || !Array.isArray(list)) return;
    let last = q.length ? q[q.length - 1].seq : p.seq;
    for (const it of list) {
      if (!Array.isArray(it)) continue;
      const [seq, b, yaw, pitch, w] = it;
      if (!Number.isSafeInteger(seq) || seq <= last || !Number.isFinite(yaw) || !Number.isFinite(pitch)) continue;
      q.push({ seq, b: b | 0, yaw, pitch, w: (w !== undefined && Number.isInteger(w)) ? w : (p.w || 0) });
      last = seq;
    }
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
  }

  /* One fixed step of the match. Returns the events it produced. */
  step() {
    this.time += DT;
    this.tick++;

    // Step AI Bots
    this.stepBots();

    // Step Human / Network Players
    for (const p of this.players.values()) {
      if (p.isBot) continue; // Bots are stepped in stepBots
      const q = this.queues.get(p.id);
      let credit = Math.min(this.credit.get(p.id) + 1, MAX_CREDIT);
      while (q.length && credit >= 1) {
        credit--;
        this.apply(p, q.shift());
      }
      this.credit.set(p.id, credit);
      if (!p.alive && this.phase === 'play' && this.time >= p.respawnAt) this.spawn(p);
    }

    // Step Active Grenades
    this.stepGrenades();

    // End Phase Check
    if (this.phase === 'ended' && this.time >= this.endAt) this.restart();

    const out = this.events;
    this.events = [];
    return out;
  }

  apply(p, inp) {
    p.seq = inp.seq;
    if (stepPlayer(p, inp, this.world)) this.shoot(p);
    if (p.threwGrenade) {
      p.threwGrenade = false;
      this.spawnGrenade(p);
    }
    if (p.alive && p.y < -30) this.kill(p, null, false);
  }

  spawnGrenade(p) {
    const d = aim(p.yaw, p.pitch);
    const eyeH = p.cr ? 1.05 : 1.6;
    const g = {
      id: 'g_' + (++this.grenadeSeq),
      x: p.x + d[0] * 0.45,
      y: p.y + eyeH,
      z: p.z + d[2] * 0.45,
      vx: d[0] * 19 + p.vx * 0.35,
      vy: d[1] * 19 + 4.2,
      vz: d[2] * 19 + p.vz * 0.35,
      fuse: 2.2,
      owner: p.id,
      alive: true,
    };
    this.grenades.push(g);
    this.events.push({
      t: 'grenade_spawn',
      id: g.id,
      x: round(g.x),
      y: round(g.y),
      z: round(g.z),
      vx: round(g.vx),
      vy: round(g.vy),
      vz: round(g.vz),
      owner: p.id,
    });
  }

  stepGrenades() {
    for (const g of this.grenades) {
      g.vy -= 18 * DT;
      g.x += g.vx * DT;
      g.y += g.vy * DT;
      g.z += g.vz * DT;

      // Box bounce collision
      for (const b of this.world.boxes) {
        if (g.x > b[0] - 0.15 && g.x < b[3] + 0.15 && g.y > b[1] - 0.15 && g.y < b[4] + 0.15 && g.z > b[2] - 0.15 && g.z < b[5] + 0.15) {
          const dTop = Math.abs(g.y - (b[4] + 0.15));
          const dBot = Math.abs(g.y - (b[1] - 0.15));
          const dMinX = Math.abs(g.x - (b[0] - 0.15));
          const dMaxX = Math.abs(g.x - (b[3] + 0.15));
          const dMinZ = Math.abs(g.z - (b[2] - 0.15));
          const dMaxZ = Math.abs(g.z - (b[5] + 0.15));

          const minD = Math.min(dTop, dBot, dMinX, dMaxX, dMinZ, dMaxZ);
          if (minD === dTop) {
            g.y = b[4] + 0.15;
            g.vy = Math.abs(g.vy) * 0.45;
            if (Math.abs(g.vy) < 0.8) g.vy = 0;
            g.vx *= 0.65; g.vz *= 0.65;
          } else if (minD === dBot) {
            g.y = b[1] - 0.15;
            g.vy = -Math.abs(g.vy) * 0.45;
          } else if (minD === dMinX || minD === dMaxX) {
            g.vx = -g.vx * 0.55;
            g.x = minD === dMinX ? b[0] - 0.15 : b[3] + 0.15;
          } else {
            g.vz = -g.vz * 0.55;
            g.z = minD === dMinZ ? b[2] - 0.15 : b[5] + 0.15;
          }
        }
      }

      // Rolling friction when rolling on the ground
      if (Math.abs(g.vy) < 0.8) {
        g.vx *= 0.95;
        g.vz *= 0.95;
      }

      g.fuse -= DT;
      if (g.fuse <= 0 && g.alive) {
        g.alive = false;
        this.detonateAOE(g.x, g.y, g.z, 6.5, 125, this.players.get(g.owner), 'grenade');
      }
    }
    this.grenades = this.grenades.filter(g => g.alive);
  }

  detonateBarrel(bar, attacker) {
    bar.alive = false;
    if (bar.boxIdx != null && this.world.boxes[bar.boxIdx]) {
      this.world.boxes[bar.boxIdx] = [0, -100, 0, 0, -100, 0];
    }
    this.events.push({ t: 'barrel_destroyed', id: bar.id, x: round(bar.x), y: round(bar.y + bar.h * 0.5), z: round(bar.z) });
    this.detonateAOE(bar.x, bar.y + bar.h * 0.5, bar.z, 6.2, 140, attacker, 'barrel');
  }

  detonateAOE(x, y, z, maxRadius, maxDamage, attacker, wepId = 'grenade') {
    this.events.push({ t: 'explode', kind: wepId, x: round(x), y: round(y), z: round(z), r: maxRadius });

    // Damage Players
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (this.mode === 'tdm' && attacker && p.team === attacker.team && p !== attacker) continue;
      const dist = Math.hypot(p.x - x, (p.y + 0.9) - y, p.z - z);
      if (dist <= maxRadius) {
        if (!hasLOS(this.world, [x, y, z], [p.x, p.y + 0.9, p.z])) continue;
        const factor = 1 - dist / maxRadius;
        const dmg = Math.round(maxDamage * factor);
        if (dmg > 0) {
          p.hp -= dmg;
          const push = factor * 14;
          p.vx += (p.x - x) / Math.max(0.1, dist) * push;
          p.vy += 7 * factor;
          p.vz += (p.z - z) / Math.max(0.1, dist) * push;
          p.g = false;
          if (p.hp <= 0) {
            this.kill(p, attacker, false, wepId);
          } else {
            this.events.push({ t: 'hit', id: p.id, by: attacker?.id || null, hp: p.hp, head: false, wepId, ax: round(x), az: round(z) });
          }
        }
      }
    }

    // Damage other barrels (chain reaction)
    for (const b of this.barrels) {
      if (!b.alive) continue;
      const dist = Math.hypot(b.x - x, (b.y + b.h * 0.5) - y, b.z - z);
      if (dist <= maxRadius && dist > 0.1) {
        b.hp -= Math.round(maxDamage * (1 - dist / maxRadius));
        if (b.hp <= 0) {
          this.detonateBarrel(b, attacker);
        }
      }
    }
  }

  shoot(p) {
    const isQuickMelee = !!p.quickMelee;
    p.quickMelee = false;
    const wep = isQuickMelee ? (WEAPONS.find(w => w.id === 'knife') || WEAPONS[0]) : (WEAPONS[p.w || 0] || WEAPONS[0]);
    const r = castShot({ ...this.world, barrels: this.barrels }, this.players.values(), p, wep, this.random);
    this.events.push({
      t: 'shot',
      id: p.id,
      w: p.w || 0,
      wepId: wep.id,
      quickMelee: isQuickMelee,
      from: r.from.map(round),
      to: r.to.map(round),
      tracers: r.tracers.map(tr => ({ from: tr.from.map(round), to: tr.to.map(round) })),
      hit: r.hit?.id || null,
    });

    if (this.phase === 'play') {
      for (const h of r.hits) {
        if (h.barrelId) {
          const bar = this.barrels.find(b => b.id === h.barrelId);
          if (bar && bar.alive) {
            bar.hp -= wep.damage;
            if (bar.hp <= 0) this.detonateBarrel(bar, p);
          }
        } else if (h.id) {
          const victim = this.players.get(h.id);
          if (victim && victim.alive) {
            if (this.mode === 'tdm' && victim.team === p.team && victim !== p) continue; // No friendly fire
            this.damage(victim, p, h.head, wep, h.backstab);
          }
        }
      }
    }
  }

  damage(victim, attacker, head, wep = null, backstab = false) {
    const w = wep || (WEAPONS[attacker.w || 0] || WEAPONS[0]);
    victim.hp -= head ? w.headDamage : w.damage;
    if (victim.hp <= 0) this.kill(victim, attacker, head, w.id, backstab);
    else this.events.push({ t: 'hit', id: victim.id, by: attacker.id, hp: victim.hp, head, wepId: w.id, backstab, ax: round(attacker.x), az: round(attacker.z) });
  }

  kill(victim, killer, head, wepId = 'ak47', backstab = false) {
    victim.hp = 0; victim.alive = false; victim.d++; victim.respawnAt = this.time + RULES.respawn;
    victim.vx = victim.vy = victim.vz = 0;
    if (killer && killer !== victim) {
      killer.k++;
      if (this.mode === 'tdm' && killer.team && killer.team !== 'none') {
        this.teams[killer.team].kills++;
      }
    }

    this.events.push({
      t: 'kill',
      id: victim.id,
      by: killer?.id || null,
      head: !!head,
      wepId,
      backstab: !!backstab,
      ax: killer ? round(killer.x) : null,
      az: killer ? round(killer.z) : null,
      victimTeam: victim.team,
      killerTeam: killer?.team || null,
    });

    // Check Win Condition
    if (this.phase === 'play') {
      if (this.mode === 'tdm') {
        const winKills = RULES.winKillsTDM || 25;
        if (killer && this.teams[killer.team]?.kills >= winKills) {
          this.phase = 'ended';
          this.winner = killer.team;
          this.endAt = this.time + RULES.endPause;
          this.events.push({ t: 'end', winner: killer.team, isTeam: true });
        }
      } else {
        if (killer && killer.k >= RULES.winKills) {
          this.phase = 'ended';
          this.winner = killer.id;
          this.endAt = this.time + RULES.endPause;
          this.events.push({ t: 'end', winner: killer.id, isTeam: false });
        }
      }
    }
  }

  restart() {
    this.phase = 'play';
    this.winner = null;
    this.teams.red.kills = 0;
    this.teams.blue.kills = 0;
    this.barrels = (this.world.barrels || []).map(b => ({ ...b }));
    for (const p of this.players.values()) {
      p.k = 0; p.d = 0; p.grenades = 2;
      this.spawn(p);
    }
    this.events.push({ t: 'restart' });
  }

  // Spawn at the point farthest from living opponents
  spawn(p) {
    const others = [...this.players.values()].filter(o => o !== p && o.alive);
    let best = null, bestScore = -Infinity;
    for (const s of this.world.spawns) {
      const near = others.length ? Math.min(...others.map(o => Math.hypot(o.x - s.x, o.z - s.z))) : 100;
      const score = near + this.random() * 2;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.w = p.w || 0;
    p.ammos = WEAPONS.map(w => w.mag);
    p.grenades = 2;
    p.grenadeCd = 0;
    const curWep = WEAPONS[p.w] || WEAPONS[0];
    Object.assign(p, { x: best.x, y: best.y, z: best.z, vx: 0, vy: 0, vz: 0, g: false, hp: RULES.hp, ammo: curWep.mag, cd: 0, rl: 0, alive: true });
    p.yaw = Math.atan2(best.x, best.z);
    p.pitch = 0;
    p.sp++;
  }

  stepBots() {
    for (const bot of this.bots.values()) {
      if (!bot.alive) {
        if (this.phase === 'play' && this.time >= bot.respawnAt) this.spawn(bot);
        continue;
      }

      // Find best target
      const enemies = [...this.players.values()].filter(o => o !== bot && o.alive && (this.mode !== 'tdm' || o.team !== bot.team));
      let bestTarget = null, bestDist = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - bot.x, e.z - bot.z);
        if (d < bestDist) { bestDist = d; bestTarget = e; }
      }

      let buttons = 0;
      if (bestTarget) {
        const dx = bestTarget.x - bot.x;
        const dz = bestTarget.z - bot.z;
        const dy = (bestTarget.y + (bestTarget.cr ? 1.0 : 1.5)) - (bot.y + 1.6);
        const dist = Math.max(0.1, Math.hypot(dx, dz));

        const aimYaw = Math.atan2(dx, -dz);
        const aimPitch = Math.atan2(dy, dist);

        // Turn towards target smoothly
        let dyaw = aimYaw - bot.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        bot.yaw += Math.max(-0.16, Math.min(0.16, dyaw));
        bot.pitch += Math.max(-0.1, Math.min(0.1, aimPitch - bot.pitch));

        const visible = hasLOS(this.world, [bot.x, bot.y + 1.6, bot.z], [bestTarget.x, bestTarget.y + 1.2, bestTarget.z]);
        const angleDiff = Math.abs(dyaw);

        if (visible) {
          // Shooting & Melee
          if (dist < 2.6 && !bot.cd) {
            buttons |= B.MELEE;
          } else if (angleDiff < 0.22 && bot.ammo > 0 && !bot.cd && !bot.rl) {
            buttons |= B.FIRE;
          } else if (bot.ammo === 0 && !bot.rl) {
            buttons |= B.RELOAD;
          }

          // Tactical Grenade Throwing
          if (dist > 7.5 && dist < 22 && bot.grenades > 0 && !bot.grenadeCd && Math.random() < 0.015) {
            buttons |= B.GRENADE;
          }

          // Tactical Movement
          if (dist > 12) buttons |= B.FWD;
          else if (dist < 4.0) buttons |= B.BACK;

          // Strafe
          bot.botStrafeTime = (bot.botStrafeTime || 0) + DT;
          if (bot.botStrafeTime > 1.2 + Math.random() * 0.8) {
            bot.botStrafeTime = 0;
            bot.botStrafeDir = -bot.botStrafeDir;
          }
          buttons |= (bot.botStrafeDir > 0 ? B.RIGHT : B.LEFT);

          if (Math.random() < 0.02 && bot.g) buttons |= B.JUMP;
        } else {
          // Pursue target
          buttons |= B.FWD;
          if (Math.hypot(bot.vx, bot.vz) < 0.3 && bot.g) {
            buttons |= B.JUMP;
            bot.yaw += (Math.random() - 0.5) * 1.5;
          }
        }
      } else {
        // Patrol
        buttons |= B.FWD;
      }

      this.apply(bot, { seq: ++bot.seq, b: buttons, yaw: bot.yaw, pitch: bot.pitch, w: bot.w });
    }
  }

  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      const s = {
        id: p.id,
        name: p.name,
        slot: p.slot,
        char: p.char,
        team: p.team,
        isBot: !!p.isBot,
        yaw: round(p.yaw),
        pitch: round(p.pitch),
        hp: p.hp,
        alive: p.alive,
        k: p.k,
        d: p.d,
        seq: p.seq,
        sp: p.sp,
        grenades: p.grenades,
      };
      for (const key of PREDICTED) s[key] = p[key];
      if (!p.alive) s.respawnIn = Math.max(0, round(p.respawnAt - this.time));
      players.push(s);
    }
    return {
      t: 's',
      tick: this.tick,
      phase: this.phase,
      mode: this.mode,
      teams: this.teams,
      winner: this.winner,
      endIn: this.phase === 'ended' ? round(this.endAt - this.time) : 0,
      players,
    };
  }
}
