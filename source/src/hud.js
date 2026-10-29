/* Heads-up display (plain DOM) and a few synthesized sounds. */
import { RULES, WEAPONS } from './sim.js';
import { PLAYER_COLORS } from './render.js';

const $ = id => document.getElementById(id);
function set(el, prop, value) { if (el[prop] !== value) el[prop] = value; }

export class Hud {
  constructor() {
    this.hp = $('hp'); this.hpBar = $('hpbar'); this.ammo = $('ammo'); this.feedEl = $('feed'); this.link = $('link');
    this.marker = $('hitmarker'); this.damage = $('damage'); this.arc = $('damage-arc'); this.crosshair = $('crosshair');
    this.sniperScope = $('sniper-scope'); this.center = $('center'); this.board = $('scoreboard'); this.score = $('myscore');
    this.stance = $('stance');
    this.grenades = $('grenades');
    this.tdmScore = $('tdm-score');
    this.elimFeed = $('elim-feed');
    this.elimSkull = $('elim-skull');
    this.killCombo = 0;
    this.lastKillTime = 0;
    this.wepCards = null; this.showBoard = false; this.session = null;
  }
  update(client) {
    const me = client.me, s = client.state;
    const curW = me.w || 0;
    const wep = WEAPONS[curW] || WEAPONS[0];

    set(this.hp, 'textContent', String(Math.max(0, me.hp)));
    this.hpBar.style.width = Math.max(0, me.hp) + '%';
    this.hpBar.classList.toggle('low', me.hp <= 25);
    $('vitals')?.classList.toggle('low', me.hp <= 25);
    $('ammo-row')?.classList.toggle('reloading', !!me.rl);
    if (this.stance) {
      set(this.stance, 'textContent', me.cr ? 'CROUCH' : 'STAND');
      this.stance.classList.toggle('crouched', !!me.cr);
    }
    const ammoStr = wep.melee ? `${wep.name} · ∞` : (me.rl ? `Reloading ${wep.name}…` : `${wep.name} · ${me.ammo} / ${wep.mag}`);
    set(this.ammo, 'textContent', ammoStr);
    if (this.grenades) set(this.grenades, 'textContent', 'FRAG / ' + (me.grenades ?? 0));
    if (this.session) set(this.link, 'textContent', this.session.link().text);

    if (s?.mode === 'tdm' && s.teams) {
      if (this.tdmScore) {
        this.tdmScore.hidden = false;
        set(this.tdmScore, 'innerHTML', `<span class="team-red">RED ${s.teams.red?.kills || 0}</span> · <span class="team-blue">BLUE ${s.teams.blue?.kills || 0}</span>`);
      }
      set(this.score, 'textContent', `Target: ${RULES.winKillsTDM || 25} kills`);
    } else {
      if (this.tdmScore) this.tdmScore.hidden = true;
      set(this.score, 'textContent', s ? `${me.k} / ${RULES.winKills} kills` : '');
    }
    this.crosshair?.classList.toggle('ads', !!client.aiming);

    if (this.sniperScope) {
      const scopeOn = client.aiming && me.alive && wep.id === 'sniper';
      this.sniperScope.hidden = !scopeOn;
    }

    if (!this.wepCards) this.wepCards = document.querySelectorAll('#weapons .wep');
    if (this.wepCards) {
      this.wepCards.forEach((c, idx) => {
        c.classList.toggle('on', idx === curW);
        c.setAttribute('aria-pressed', String(idx === curW));
        const countSpan = c.querySelector('.ammo-count');
        if (countSpan) {
          const wItem = WEAPONS[idx];
          countSpan.textContent = wItem?.melee ? '∞' : (me.ammos?.[idx] !== undefined ? me.ammos[idx] : wItem?.mag);
        }
      });
    }

    let msg = '';
    if (!s) msg = 'Waiting for the host…';
    else if (s.phase === 'ended') {
      if (s.mode === 'tdm') {
        const teamLabel = s.winner === 'red' ? 'RED TEAM' : 'BLUE TEAM';
        msg = `${teamLabel} wins! Next round in ${Math.ceil(s.endIn)}`;
      } else {
        msg = `${client.name(s.winner)} wins! Next round in ${Math.ceil(s.endIn)}`;
      }
    } else if (!me.alive) {
      const mine = s.players.find(p => p.id === client.id);
      msg = `${client.killer ? 'Fragged by ' + client.killer : 'You died'} · respawn in ${Math.ceil(mine?.respawnIn || 0)}`;
    } else if (!client.active) msg = 'Click to play';
    set(this.center, 'textContent', msg);
    this.center.hidden = !msg;

    const board = this.showBoard || s?.phase === 'ended';
    this.board.hidden = !board;
    $('btn-scores-game')?.setAttribute('aria-pressed', String(board));
    if (board && s) {
      const isTDM = s.mode === 'tdm';
      const rows = [...s.players].sort((a, b) => {
        if (isTDM && a.team !== b.team) return a.team === 'red' ? -1 : 1;
        return b.k - a.k || a.d - b.d;
      });
      const header = isTDM
        ? '<tr><th>Team</th><th>Player</th><th>Kills</th><th>Deaths</th></tr>'
        : '<tr><th>Player</th><th>Kills</th><th>Deaths</th></tr>';
      const html = header + rows.map(p => {
        const teamBadge = isTDM ? `<td><span class="badge-${p.team || 'none'}">${(p.team || 'none').toUpperCase()}</span></td>` : '';
        const color = isTDM
          ? (p.team === 'red' ? '#ef4444' : (p.team === 'blue' ? '#3b82f6' : PLAYER_COLORS[p.slot % 6]))
          : PLAYER_COLORS[p.slot % 6];
        const botTag = p.isBot ? ' <span style="font-size:10px;opacity:.65;">[BOT]</span>' : '';
        return `<tr class="${p.id === client.id ? 'you' : ''}">${teamBadge}<td><i style="background:${color}"></i>${escape(p.name)}${botTag}</td><td>${p.k}</td><td>${p.d}</td></tr>`;
      }).join('');
      if (this.boardHtml !== html) { this.boardHtml = html; this.board.querySelector('table').innerHTML = html; }
    }
  }
  feed(text, strong) {
    const li = document.createElement('li'); li.textContent = text; if (strong) li.className = 'strong';
    this.feedEl.prepend(li);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
    setTimeout(() => li.remove(), 6000);
  }
  elimination(victimName, isHeadshot = false, isKnife = false, isBackstab = false) {
    const now = performance.now();
    if (now - this.lastKillTime < 5500) {
      this.killCombo++;
    } else {
      this.killCombo = 1;
    }
    this.lastKillTime = now;

    let verb = 'ELIMINATED';
    if (isBackstab) verb = 'BACKSTAB';
    else if (isKnife) verb = 'KNIFED';
    else {
      const verbs = {
        1: 'ELIMINATED',
        2: 'DOUBLE KILL',
        3: 'TRIPLE KILL',
        4: 'QUAD KILL',
        5: 'MULTI KILL',
      };
      verb = verbs[Math.min(5, this.killCombo)] || 'MULTI KILL';
    }
    const baseScore = 100 * this.killCombo;
    const score = isBackstab ? baseScore + 100 : (isHeadshot ? baseScore + 50 : baseScore);
    const fireIcons = isKnife ? '🗡️' : '🔥'.repeat(Math.min(4, this.killCombo));

    if (this.elimSkull) {
      this.elimSkull.classList.remove('show');
      void this.elimSkull.offsetWidth;
      this.elimSkull.classList.add('show');
      clearTimeout(this.skullTimer);
      this.skullTimer = setTimeout(() => {
        this.elimSkull.classList.remove('show');
      }, 1300);
    }

    if (this.elimFeed) {
      const item = document.createElement('div');
      item.className = 'elim-item' + (isHeadshot || isBackstab ? ' headshot' : '') + (this.killCombo > 1 ? ' combo' : '');
      item.innerHTML = `<span class="elim-verb">${verb}</span> <span class="elim-name">${escape(victimName)}</span> <span class="elim-score">${score}</span> <span class="elim-flame">${fireIcons}</span>${(isHeadshot && !isBackstab) ? ' <span class="elim-hs">⊕</span>' : ''}`;
      this.elimFeed.appendChild(item);
      while (this.elimFeed.children.length > 3) this.elimFeed.firstChild.remove();
      setTimeout(() => {
        item.classList.add('fade-out');
        setTimeout(() => item.remove(), 380);
      }, 2800);
    }
  }
  hitmarker(head) {
    this.marker.className = head ? 'show head' : 'show';
    clearTimeout(this.markerTimer); this.markerTimer = setTimeout(() => { this.marker.className = ''; }, 140);
  }
  hurt(relAngle = null) {
    this.damage.classList.remove('show'); void this.damage.offsetWidth; this.damage.classList.add('show');
    if (relAngle != null && this.arc) {
      const deg = Math.round(relAngle * 180 / Math.PI);
      this.arc.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      this.arc.classList.remove('show'); void this.arc.offsetWidth; this.arc.classList.add('show');
      this.arc.hidden = false;
      clearTimeout(this.arcTimer);
      this.arcTimer = setTimeout(() => { if (this.arc) this.arc.hidden = true; }, 650);
    }
  }
}

function escape(s) { return String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }

export class Sound {
  constructor() { this.ctx = null; this.volume = 0.5; }
  ensure() {
    if (!this.ctx) try { this.ctx = new AudioContext(); } catch { return null; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  panFor(lx, lz, lyaw, sx, sz) {
    if (lx == null || sx == null) return 0;
    const dx = sx - lx, dz = sz - lz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return 0;
    const right = dx * Math.cos(lyaw) - dz * Math.sin(lyaw);
    return Math.max(-1, Math.min(1, right / dist));
  }
  connectPanner(ctx, src, pan) {
    if (ctx.createStereoPanner && typeof pan === 'number' && Number.isFinite(pan)) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      src.connect(panner);
      return panner;
    }
    return src;
  }
  shot(level, pan = 0, wepId = 'ak47') {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const dur = wepId === 'smg' ? 0.07 : (wepId === 'sniper' ? 0.22 : (wepId === 'shotgun' ? 0.16 : 0.12));
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
    const exp = wepId === 'shotgun' ? 2.2 : (wepId === 'sniper' ? 2.5 : 3);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, exp);
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buf;
    filt.type = 'lowpass';
    const cutoff = wepId === 'sniper' ? 3800 : (wepId === 'shotgun' ? 1400 : (wepId === 'smg' ? 2200 : (wepId === 'lmg' ? 1700 : 2700)));
    filt.frequency.value = cutoff * Math.min(1, level);
    const volScale = wepId === 'sniper' ? 1.1 : (wepId === 'shotgun' ? 1.05 : (wepId === 'smg' ? 0.65 : 0.8));
    gain.gain.value = this.volume * Math.min(1, level) * volScale;
    src.connect(filt);
    const out = this.connectPanner(ctx, filt, pan);
    out.connect(gain).connect(ctx.destination);
    src.start();

    // Extra low-end boom for sniper and shotgun
    if (wepId === 'sniper' || wepId === 'shotgun') {
      const t = ctx.currentTime, o = ctx.createOscillator(), bg = ctx.createGain();
      o.frequency.setValueAtTime(wepId === 'sniper' ? 120 : 90, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.14);
      bg.gain.setValueAtTime(this.volume * Math.min(1, level) * 0.4, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(bg);
      this.connectPanner(ctx, bg, pan).connect(ctx.destination);
      o.start(t); o.stop(t + 0.15);
    }
  }
  hit(head = false) {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(head ? 1800 : 1300, t);
    if (head) o.frequency.exponentialRampToValueAtTime(2400, t + 0.09);
    g.gain.setValueAtTime(this.volume * (head ? 0.35 : 0.22), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (head ? 0.12 : 0.08));
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + (head ? 0.13 : 0.09));
  }
  step(level = 0.2, pan = 0, surface = 'concrete') {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime;
    if (surface === 'water') {
      // Fluid splash
      const len = 0.08, buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
      const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buf; filt.type = 'bandpass'; filt.frequency.setValueAtTime(950, t); filt.frequency.exponentialRampToValueAtTime(320, t + len); filt.Q.value = 3.5;
      gain.gain.value = this.volume * Math.min(1, level) * 0.42;
      src.connect(filt);
      this.connectPanner(ctx, filt, pan).connect(gain).connect(ctx.destination);
      src.start();
    } else if (surface === 'wood') {
      // Hollow wood knock / clank
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
      g.gain.setValueAtTime(this.volume * Math.min(1, level) * 0.48, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      this.connectPanner(ctx, o, pan).connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.07);
    } else if (surface === 'metal') {
      // Resonant metallic ping / clank
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1450, t);
      o.frequency.exponentialRampToValueAtTime(800, t + 0.07);
      g.gain.setValueAtTime(this.volume * Math.min(1, level) * 0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      this.connectPanner(ctx, o, pan).connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.08);
    } else if (surface === 'rubble') {
      // Crunchy gravel step
      const len = 0.065, buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buf; filt.type = 'bandpass'; filt.frequency.value = 1100 + Math.random() * 200; filt.Q.value = 1.8;
      gain.gain.value = this.volume * Math.min(1, level) * 0.38;
      src.connect(filt);
      this.connectPanner(ctx, filt, pan).connect(gain).connect(ctx.destination);
      src.start();
    } else {
      // Default / concrete
      const len = 0.045, buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
      const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buf; filt.type = 'bandpass'; filt.frequency.value = 380 + Math.random() * 120; filt.Q.value = 2.2;
      gain.gain.value = this.volume * Math.min(1, level) * 0.35;
      src.connect(filt);
      this.connectPanner(ctx, filt, pan).connect(gain).connect(ctx.destination);
      src.start();
    }
  }
  land(level = 0.4, surface = 'concrete') {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(surface === 'water' ? 220 : 140, t);
    o.frequency.exponentialRampToValueAtTime(surface === 'water' ? 60 : 45, t + 0.12);
    g.gain.setValueAtTime(this.volume * level * 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.13);
  }
  explosion(level = 0.8, pan = 0) {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime;
    // 1. Heavy low-passed noise burst
    const dur = 0.65;
    const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.0);
    const src = ctx.createBufferSource(), filt = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buf; filt.type = 'lowpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.exponentialRampToValueAtTime(70, t + dur);
    gain.gain.setValueAtTime(this.volume * Math.min(1, level) * 0.85, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    this.connectPanner(ctx, filt, pan).connect(gain).connect(ctx.destination);
    src.start(t);

    // 2. Sub-bass resonant thump
    const o = ctx.createOscillator(), bg = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.45);
    bg.gain.setValueAtTime(this.volume * Math.min(1, level) * 0.7, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(bg);
    this.connectPanner(ctx, bg, pan).connect(ctx.destination);
    o.start(t); o.stop(t + 0.5);
  }
  grenadePin(own = true, pan = 0) {
    if (own) {
      this.click(0, 1800, 0.04);
      this.click(0.07, 2400, 0.04);
    } else {
      this.click(0, 1600, 0.04);
    }
  }
  grenadeBounce(pan = 0) {
    this.click(0, 950, 0.03);
  }
  reload(wepId = 'ak47') {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    if (wepId === 'shotgun') {
      this.click(0, 750, 0.04);
      this.click(0.4, 900, 0.04);
      this.click(0.7, 1100, 0.05);
    } else if (wepId === 'sniper') {
      this.click(0, 1100, 0.04);
      this.click(0.5, 600, 0.04);
      this.click(0.9, 1400, 0.05);
    } else {
      this.click(0, 950, 0.035);
      this.click(0.65, 1350, 0.045);
    }
  }
  click(delay, freq, len) {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + len);
    g.gain.setValueAtTime(this.volume * 0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + len + 0.01);
  }
  elimination(head = false) {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime;
    // Punch
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(head ? 440 : 330, t);
    o1.frequency.exponentialRampToValueAtTime(head ? 880 : 660, t + 0.12);
    g1.gain.setValueAtTime(this.volume * 0.45, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o1.connect(g1).connect(ctx.destination);
    o1.start(t); o1.stop(t + 0.36);

    // Harmonic chime
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(head ? 1200 : 880, t + 0.04);
    o2.frequency.exponentialRampToValueAtTime(head ? 1760 : 1320, t + 0.18);
    g2.gain.setValueAtTime(this.volume * 0.35, t + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o2.connect(g2).connect(ctx.destination);
    o2.start(t + 0.04); o2.stop(t + 0.43);
  }
  melee(hit = false, backstab = false, pan = 0) {
    const ctx = this.ensure(); if (!ctx || !this.volume) return;
    const t = ctx.currentTime;
    if (!hit) {
      // Blade whoosh in air
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(280, t);
      o.frequency.exponentialRampToValueAtTime(75, t + 0.12);
      g.gain.setValueAtTime(this.volume * 0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      this.connectPanner(ctx, o, pan).connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.14);
    } else {
      // Meat slice / knife impact
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(backstab ? 920 : 620, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.15);
      g.gain.setValueAtTime(this.volume * (backstab ? 0.65 : 0.48), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
      this.connectPanner(ctx, o, pan).connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.18);
    }
  }
}
