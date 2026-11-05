/* Dynamic weather: pure, deterministic and host-owned. The host evaluates weatherAt(seed,
   time) and puts the compact state in every snapshot (wx), so all clients — late joiners
   included — blend the same sky. Weather is cosmetic: it never changes movement, damage or
   hit detection. */

export const WEATHER_STATES = ['sunny', 'cloudy', 'fog', 'rain'];
export const WEATHER_OPTIONS = ['dynamic', ...WEATHER_STATES, 'off'];
export const WEATHER_LABELS = { dynamic: 'Dynamic', sunny: 'Sunny', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', off: 'Off' };

// Indoor / space arenas never get weather (no rain under a roof or in orbit).
export const NO_WEATHER_MAPS = new Set(['foundry', 'glowplant', 'zenith', 'microverse']);
export const weatherAllowed = map => !NO_WEATHER_MAPS.has(map);

/* Look parameters per state; the renderer multiplies light into the map's own lighting.
   fogEnd/fogStart are absolute metres (null = keep the map's own fog), so fog reads the same
   on every map regardless of its base fog distance. */
export const WEATHER_LOOK = {
  sunny: { sun: 1.0, hemi: 1.0, fogEnd: null, fogStart: null, overcast: 0.0, rain: 0, tint: [1, 1, 1] },
  cloudy: { sun: 0.32, hemi: 0.78, fogEnd: 260, fogStart: 40, overcast: 0.7, rain: 0, tint: [0.84, 0.87, 0.92] },
  fog: { sun: 0.28, hemi: 0.85, fogEnd: 46, fogStart: 2, overcast: 0.92, rain: 0, tint: [0.9, 0.92, 0.94] },
  rain: { sun: 0.12, hemi: 0.55, fogEnd: 105, fogStart: 6, overcast: 0.95, rain: 1, tint: [0.6, 0.66, 0.76] },
};

export const BLEND_SECONDS = 12;

function prng(seed) {
  let s = (Math.trunc(+seed || 0) ^ 0x5bd1e995) | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* Deterministic schedule: [{ id, start, end }...] covering at least `until` seconds. */
export function weatherSchedule(seed, until = 3600) {
  const rnd = prng(seed), out = [];
  let t = 0, prev = 'sunny';
  while (t < until) {
    // favour sunny/cloudy, never repeat the same state twice in a row
    const pool = WEATHER_STATES.filter(s => s !== prev);
    const w = pool.map(s => (s === 'sunny' ? 3 : s === 'cloudy' ? 2.5 : s === 'rain' ? 2 : 1.5));
    let r = rnd() * w.reduce((a, b) => a + b, 0), id = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { id = pool[i]; break; } }
    if (!out.length) id = 'sunny';
    const dur = 90 + Math.floor(rnd() * 90);
    out.push({ id, start: t, end: t + dur });
    prev = id; t += dur;
  }
  return out;
}

/* Weather at host time t (seconds): { from, to, k } with k∈[0,1] the blend from → to. */
export function weatherAt(option, seed, t) {
  if (option === 'off') return null;
  if (WEATHER_STATES.includes(option)) return { from: option, to: option, k: 1 };
  const sched = weatherSchedule(seed, Math.max(600, t + 400));
  const i = sched.findIndex(s => t < s.end);
  const cur = sched[Math.max(0, i)], prev = sched[Math.max(0, i - 1)];
  const into = t - cur.start;
  if (i > 0 && into < BLEND_SECONDS) return { from: prev.id, to: cur.id, k: into / BLEND_SECONDS };
  return { from: cur.id, to: cur.id, k: 1 };
}

/* Snapshot form: [fromIndex, toIndex, k×100]. */
export const encodeWeather = w => (w ? [WEATHER_STATES.indexOf(w.from), WEATHER_STATES.indexOf(w.to), Math.round(w.k * 100)] : null);
export function decodeWeather(wx) {
  if (!Array.isArray(wx) || wx.length !== 3) return null;
  const from = WEATHER_STATES[wx[0]], to = WEATHER_STATES[wx[1]];
  if (!from || !to) return null;
  return { from, to, k: Math.max(0, Math.min(1, (+wx[2] || 0) / 100)) };
}

/* Blended look for the renderer. */
/* `base` = the map's own { fogStart, fogEnd } (used where a state keeps the map fog). */
export function blendLook(w, base = { fogStart: 40, fogEnd: 300 }) {
  const a = WEATHER_LOOK[w?.from] || WEATHER_LOOK.sunny, b = WEATHER_LOOK[w?.to] || a, k = w ? w.k : 1;
  const l = (x, y) => x + (y - x) * k;
  const fe = s => (s.fogEnd ?? base.fogEnd), fs = s => (s.fogStart ?? base.fogStart);
  return { sun: l(a.sun, b.sun), hemi: l(a.hemi, b.hemi), fogEnd: l(fe(a), fe(b)), fogStart: l(fs(a), fs(b)), overcast: l(a.overcast, b.overcast), rain: l(a.rain, b.rain), tint: a.tint.map((v, i) => l(v, b.tint[i])) };
}

export const normalizeWeatherOption = o => (WEATHER_OPTIONS.includes(o) ? o : 'dynamic');
