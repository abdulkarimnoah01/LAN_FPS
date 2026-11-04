/* Operative appearance: catalog, validation, encoding and the pure texture transform.
   DOM- and renderer-free so the host, tests and both Babylon views share one source of truth.

   AppearanceV1 = { v: 1, bodyId, outfitId, skinId, shaderId, accentId }
   - bodyId is an existing roster character id (legacy `char`); it selects the GLB/rig and is
     fixed for the match. The other four fields are cosmetic and never touch geometry,
     skeleton, animation, hitboxes or balance.
   - On the wire the cosmetic part travels as a short code "outfit.skin.shader.accent". */

export const APPEARANCE_VERSION = 1;
export const LOOK_STORAGE_KEY = 'look.v1';
export const MAX_LOOK_BYTES = 512;
export const LOOK_UPDATES_PER_SEC = 2;

// Outfit surfaces recolour the clothing part of the rig's own baked atlas. `tint` is the
// target clothing colour; `strength` how far pixels move towards it. 'stock' is the original.
export const OUTFITS = [
  { id: 'stock', name: 'Stock', tint: null, strength: 0 },
  { id: 'midnight', name: 'Midnight Ops', tint: [38, 46, 74], strength: 0.78 },
  { id: 'tropic', name: 'Tropic Teal', tint: [20, 170, 160], strength: 0.72 },
  { id: 'sunset', name: 'Sunset Coral', tint: [236, 88, 120], strength: 0.72 },
];

// Skin tones move only pixels the skin mask selects; 'natural' keeps the bake.
export const SKINS = [
  { id: 'natural', name: 'Natural', tone: null },
  { id: 'light', name: 'Light', tone: [238, 196, 164] },
  { id: 'tan', name: 'Tan', tone: [196, 136, 92] },
  { id: 'deep', name: 'Deep', tone: [112, 70, 46] },
];

export const SHADERS = [
  { id: 'matte', name: 'Matte PBR' },
  { id: 'rim', name: 'Neon Rim' },
];

export const ACCENTS = [
  { id: 'cyan', name: 'Cyan', color: '#22d3ee' },
  { id: 'magenta', name: 'Magenta', color: '#e879f9' },
  { id: 'amber', name: 'Amber', color: '#fbbf24' },
  { id: 'lime', name: 'Lime', color: '#a3e635' },
  { id: 'violet', name: 'Violet', color: '#a78bfa' },
];

export const TEAM_ACCENTS = { red: '#ef4444', blue: '#3b82f6' };

export const PRESETS = [
  { id: 'field', name: 'Field Issue', outfitId: 'stock', skinId: 'natural', shaderId: 'matte', accentId: 'cyan' },
  { id: 'nightshift', name: 'Night Shift', outfitId: 'midnight', skinId: 'natural', shaderId: 'rim', accentId: 'cyan' },
  { id: 'vice', name: 'Vice Coast', outfitId: 'tropic', skinId: 'tan', shaderId: 'rim', accentId: 'magenta' },
  { id: 'flamingo', name: 'Flamingo', outfitId: 'sunset', skinId: 'light', shaderId: 'matte', accentId: 'magenta' },
  { id: 'ember', name: 'Ember', outfitId: 'sunset', skinId: 'deep', shaderId: 'rim', accentId: 'amber' },
  { id: 'reef', name: 'Reef Runner', outfitId: 'tropic', skinId: 'deep', shaderId: 'matte', accentId: 'lime' },
];

export const CATALOG = { outfits: OUTFITS, skins: SKINS, shaders: SHADERS, accents: ACCENTS, presets: PRESETS };

const ids = list => new Set(list.map(x => x.id));
const OUTFIT_IDS = ids(OUTFITS), SKIN_IDS = ids(SKINS), SHADER_IDS = ids(SHADERS), ACCENT_IDS = ids(ACCENTS);

export const DEFAULT_LOOK = Object.freeze({ outfitId: 'stock', skinId: 'natural', shaderId: 'matte', accentId: 'cyan' });

export const cleanBodyId = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32);

const pick = (value, allowed, fallback) => (typeof value === 'string' && allowed.has(value) ? value : fallback);

/* Always returns a fresh, valid appearance. Unknown keys/ids fall back to defaults;
   nothing here can name a URL, path or shader source. */
export function normalizeAppearance(raw, fallbackBody = '') {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    v: APPEARANCE_VERSION,
    bodyId: cleanBodyId(typeof r.bodyId === 'string' && r.bodyId ? r.bodyId : fallbackBody),
    outfitId: pick(r.outfitId, OUTFIT_IDS, DEFAULT_LOOK.outfitId),
    skinId: pick(r.skinId, SKIN_IDS, DEFAULT_LOOK.skinId),
    shaderId: pick(r.shaderId, SHADER_IDS, DEFAULT_LOOK.shaderId),
    accentId: pick(r.accentId, ACCENT_IDS, DEFAULT_LOOK.accentId),
  };
}

/* Wire code for the cosmetic part: "outfit.skin.shader.accent". */
export function encodeLook(app) {
  const a = normalizeAppearance(app);
  return `${a.outfitId}.${a.skinId}.${a.shaderId}.${a.accentId}`;
}

export function decodeLook(code, bodyId = '') {
  if (typeof code !== 'string' || code.length > 64) return normalizeAppearance(null, bodyId);
  const [outfitId, skinId, shaderId, accentId] = code.split('.');
  return normalizeAppearance({ bodyId, outfitId, skinId, shaderId, accentId }, bodyId);
}

/* Canonical code for anything a peer sends: strings, objects, garbage. */
export function canonicalLook(raw) {
  if (typeof raw === 'string') return encodeLook(decodeLook(raw));
  if (raw && typeof raw === 'object') {
    try { if (JSON.stringify(raw).length > MAX_LOOK_BYTES) return encodeLook(DEFAULT_LOOK); } catch { return encodeLook(DEFAULT_LOOK); }
    return encodeLook(normalizeAppearance(raw));
  }
  return encodeLook(DEFAULT_LOOK);
}

export function applyPreset(app, presetId) {
  const p = PRESETS.find(x => x.id === presetId);
  if (!p) return normalizeAppearance(app);
  return normalizeAppearance({ ...app, outfitId: p.outfitId, skinId: p.skinId, shaderId: p.shaderId, accentId: p.accentId }, app?.bodyId);
}

export function sameLook(a, b) {
  return encodeLook(a) === encodeLook(b);
}

/* Accent colour actually rendered: team modes override the personal accent so teams stay readable. */
export function resolveAccent(app, team = 'none') {
  if (TEAM_ACCENTS[team]) return TEAM_ACCENTS[team];
  return (ACCENTS.find(a => a.id === app?.accentId) || ACCENTS[0]).color;
}

/* Persistence: versioned key, tolerant of corrupt JSON and unavailable storage. */
export function loadAppearance(store, bodyId = '') {
  let raw = null;
  try { raw = JSON.parse(store.get(LOOK_STORAGE_KEY, 'null')); } catch { raw = null; }
  const app = normalizeAppearance(raw, bodyId);
  if (bodyId) app.bodyId = cleanBodyId(bodyId);
  return app;
}

export function saveAppearance(store, app) {
  const a = normalizeAppearance(app);
  try { store.set(LOOK_STORAGE_KEY, JSON.stringify(a)); } catch {}
  return a;
}

/* Token bucket used by the host to cap look changes per player. */
export function makeLookLimiter(perSec = LOOK_UPDATES_PER_SEC) {
  const state = new Map();
  return (id, now) => {
    const s = state.get(id) || { tokens: perSec, at: now };
    s.tokens = Math.min(perSec, s.tokens + (now - s.at) * perSec);
    s.at = now;
    state.set(id, s);
    if (s.tokens < 1) return false;
    s.tokens -= 1;
    return true;
  };
}

/* ---- Texture transform (pure, operates on RGBA bytes) ----
   The roster atlases are single baked textures with no slot masks, so masks are derived per
   pixel: warm mid-saturation pixels are skin; very dark (hair, eyes, outlines) and near-white
   highlight pixels are preserved; everything else is treated as clothing. This is a heuristic
   documented in docs/SPECTRE_ORBIT_UPGRADE.md, not an authored mask. */

function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

export const PIXEL_CLASS = { KEEP: 0, SKIN: 1, CLOTH: 2 };

export function classifyPixel(r, g, b) {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (v < 0.09) return PIXEL_CLASS.KEEP;                                 // hair, pupils, outlines
  if (h >= 8 && h <= 42 && s >= 0.22 && s <= 0.78 && v >= 0.28 && r > b + 25) return PIXEL_CLASS.SKIN;
  if (s < 0.05 && v > 0.97) return PIXEL_CLASS.KEEP;                    // eye whites, specular bakes
  return PIXEL_CLASS.CLOTH;
}

/* Returns a new RGBA buffer. `data` is not modified. */
export function transformAtlas(data, outfitId = 'stock', skinId = 'natural') {
  const out = new Uint8ClampedArray(data);
  const outfit = OUTFITS.find(o => o.id === outfitId) || OUTFITS[0];
  const skin = SKINS.find(s => s.id === skinId) || SKINS[0];
  if (!outfit.tint && !skin.tone) return out;

  // Mean skin luminance so a new tone keeps the bake's shading pattern.
  let skinLum = 0, skinN = 0;
  if (skin.tone) {
    for (let i = 0; i < data.length; i += 16) {
      if (classifyPixel(data[i], data[i + 1], data[i + 2]) === PIXEL_CLASS.SKIN) {
        skinLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; skinN++;
      }
    }
    skinLum = skinN ? skinLum / skinN : 160;
  }

  for (let i = 0; i < out.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const cls = classifyPixel(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (cls === PIXEL_CLASS.SKIN && skin.tone) {
      const k = Math.max(0.35, Math.min(1.25, lum / skinLum));
      out[i] = skin.tone[0] * k; out[i + 1] = skin.tone[1] * k; out[i + 2] = skin.tone[2] * k;
    } else if (cls === PIXEL_CLASS.CLOTH && outfit.tint) {
      const shade = 0.35 + 1.25 * (lum / 255);   // lifts black fabric enough to carry the colour
      const t = outfit.strength;
      out[i] = r + (Math.min(255, outfit.tint[0] * shade) - r) * t;
      out[i + 1] = g + (Math.min(255, outfit.tint[1] * shade) - g) * t;
      out[i + 2] = b + (Math.min(255, outfit.tint[2] * shade) - b) * t;
    }
  }
  return out;
}

/* Locate the base-colour image inside a GLB without a renderer (used by the Babylon layer to
   decode the atlas once per body). Returns { bytes, mimeType } or null. */
export function extractGlbImage(glbBytes) {
  try {
    const u8 = glbBytes instanceof Uint8Array ? glbBytes : new Uint8Array(glbBytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
    const binStart = 20 + jsonLen + 8;
    const mat = json.materials?.[0];
    const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index ?? 0;
    const imgIdx = json.textures?.[texIdx]?.source ?? 0;
    const img = json.images?.[imgIdx];
    if (!img || img.bufferView === undefined) return null;
    const view = json.bufferViews[img.bufferView];
    const start = binStart + (view.byteOffset || 0);
    return { bytes: u8.slice(start, start + view.byteLength), mimeType: img.mimeType || 'image/png' };
  } catch {
    return null;
  }
}
