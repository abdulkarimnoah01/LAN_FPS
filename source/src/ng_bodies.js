/* Spectre Orbit Next Gen bodies: four archetypes that share one skeleton, one animation set
   and one UV layout. Pure data + a pure texture painter, so the GLB generator
   (tools/build_ng_characters.mjs, Node) and the in-game appearance resolver paint identical
   atlases. Because the UV layout is authored, outfit and skin swaps use exact region masks. */

export const NG_ATLAS_SIZE = 512;

// UV regions, [u0, v0, u1, v1] with v down (glTF convention). Every lofted part unwraps
// cylindrically: u = angle around the part (front of the body at the region's centre),
// v = position along the part from its top/start (0) to its bottom/end (1).
export const NG_UV = {
  head: [0, 0, 0.5, 0.3],
  hair: [0.5, 0, 1, 0.15],
  ears: [0.5, 0.15, 0.625, 0.3],
  nose: [0.625, 0.15, 0.75, 0.3],
  neck: [0.75, 0.15, 1, 0.3],
  torso: [0, 0.3, 0.5, 0.65],
  arm: [0.5, 0.3, 1, 0.65],
  leg: [0, 0.65, 0.5, 1],
  foot: [0.5, 0.65, 0.75, 0.85],
  sole: [0.75, 0.65, 1, 0.85],
};

// Positions along the arm/leg/torso that both the generator and painter agree on.
export const ARM_T = { elbow: 0.44, wrist: 0.82 };
export const LEG_T = { knee: 0.5 };
export const TORSO_T = { chest: 0.22, waist: 0.55, belt: 0.66 };

/* Proportions (metres). Visual only: every body uses the same gameplay capsule/hitboxes. */
export const NG_BODIES = [
  {
    id: 'ng-male-tall', file: 'NG Male Tall', code: 'MT', name: 'Rico', archetype: 'Male · Tall',
    title: 'Coastline Pointman', height: 1.86, shoulder: 0.25, chestR: [0.19, 0.13], waistR: [0.155, 0.11], hipR: [0.17, 0.115],
    limb: 1.0, bust: 0, glute: 0.05, hair: 'crop', hairColor: [42, 28, 20], skin: [198, 138, 94], beard: false,
    stock: { top: { color: [38, 176, 160], pattern: 'palm', patternColor: [16, 92, 70], sleeve: 0.27, hem: 1, collar: true },
      bottom: { color: [233, 220, 192], length: 1 }, shoes: [236, 236, 232], belt: [92, 58, 34] },
  },
  {
    id: 'ng-male-short', file: 'NG Male Short', code: 'MS', name: 'Dante', archetype: 'Male · Short',
    title: 'Harbor Bruiser', height: 1.72, shoulder: 0.255, chestR: [0.2, 0.14], waistR: [0.17, 0.125], hipR: [0.17, 0.12],
    limb: 1.12, bust: 0, glute: 0.05, hair: 'curl', hairColor: [22, 17, 14], skin: [184, 123, 82], beard: true,
    stock: { top: { color: [242, 242, 236], pattern: 'none', sleeve: 0, hem: 1, collar: false, chain: true },
      bottom: { color: [58, 88, 140], length: 1 }, shoes: [240, 240, 236], belt: [30, 26, 24] },
  },
  {
    id: 'ng-female-tall', file: 'NG Female Tall', code: 'FT', name: 'Lucia', archetype: 'Female · Tall',
    title: 'Neon Duelist', height: 1.76, shoulder: 0.205, chestR: [0.16, 0.115], waistR: [0.125, 0.095], hipR: [0.175, 0.12],
    limb: 0.86, bust: 0.32, glute: 0.14, hair: 'long', hairColor: [58, 36, 24], skin: [213, 154, 114], beard: false,
    stock: { top: { color: [232, 79, 154], pattern: 'flower', patternColor: [252, 170, 206], sleeve: 0.18, hem: 0.5, collar: true },
      bottom: { color: [238, 226, 204], length: 1 }, shoes: [226, 206, 178], belt: [120, 80, 46] },
  },
  {
    id: 'ng-female-short', file: 'NG Female Short', code: 'FS', name: 'Nina', archetype: 'Female · Short',
    title: 'Boardwalk Runner', height: 1.62, shoulder: 0.195, chestR: [0.152, 0.11], waistR: [0.12, 0.09], hipR: [0.165, 0.115],
    limb: 0.84, bust: 0.28, glute: 0.13, hair: 'bob', hairColor: [40, 26, 18], skin: [226, 176, 142], beard: false,
    stock: { top: { color: [244, 211, 74], pattern: 'none', sleeve: 0.1, hem: 0.52, collar: false },
      bottom: { color: [92, 132, 186], length: 0.3 }, shoes: [244, 244, 240], belt: [90, 60, 40] },
  },
];

export const NG_BODY_IDS = NG_BODIES.map(b => b.id);
export const ngBody = id => NG_BODIES.find(b => b.id === id) || null;

// Skin tones by appearance skinId; 'natural' uses the body's own tone.
const NG_SKIN = { light: [238, 200, 170], tan: [196, 138, 94], deep: [112, 72, 48] };

// Outfit surfaces keep each body's garment cut (sleeve/hem/leg length) and change fabric.
function outfitFor(body, outfitId) {
  const s = body.stock;
  switch (outfitId) {
    case 'midnight': return { top: { ...s.top, color: [40, 45, 60], pattern: 'stripe', patternColor: [34, 211, 238], sleeve: Math.max(s.top.sleeve, 0.78), collar: false, chain: false },
      bottom: { ...s.bottom, color: [26, 29, 38] }, shoes: [24, 24, 28], belt: [60, 62, 70] };
    case 'tropic': return { top: { ...s.top, color: [28, 160, 168], pattern: 'palm', patternColor: [230, 248, 236] },
      bottom: { ...s.bottom, color: [240, 240, 234] }, shoes: [238, 238, 232], belt: [92, 58, 34] };
    case 'sunset': return { top: { ...s.top, color: [240, 106, 112], pattern: 'flower', patternColor: [255, 214, 120] },
      bottom: { ...s.bottom, color: [52, 80, 126] }, shoes: [246, 238, 226], belt: [70, 44, 30] };
    default: return s;
  }
}

/* ---- tiny deterministic helpers ---- */
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function patternAt(kind, u, v, base, accent) {
  if (kind === 'palm') {
    const gu = u * 9, gv = v * 7, cu = Math.floor(gu), cv = Math.floor(gv);
    const fx = gu - cu - 0.5, fy = gv - cv - 0.5, r = hash(cu, cv);
    const a = r * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const lx = fx * ca - fy * sa, ly = fx * sa + fy * ca;
    if ((lx * lx) / 0.16 + (ly * ly) / 0.012 < 1 || (lx * lx) / 0.012 + (ly * ly) / 0.12 < 1) return accent;
    return base;
  }
  if (kind === 'flower') {
    const gu = u * 10, gv = v * 8, cu = Math.floor(gu), cv = Math.floor(gv);
    const fx = gu - cu - 0.5, fy = gv - cv - 0.5, d = Math.hypot(fx, fy), ang = Math.atan2(fy, fx);
    const petal = 0.22 + 0.12 * Math.cos(ang * 5 + hash(cu, cv) * 6);
    if (d < 0.07) return [255, 236, 150];
    if (d < petal) return accent;
    return base;
  }
  if (kind === 'stripe') return Math.abs(((v * 9) % 1) - 0.5) < 0.04 ? accent : base;
  return base;
}

/* Paints the full atlas for one body + appearance. Returns RGBA bytes (size × size). */
export function paintNgAtlas(bodyId, look = {}, size = NG_ATLAS_SIZE) {
  const body = ngBody(bodyId) || NG_BODIES[0];
  const out = new Uint8ClampedArray(size * size * 4);
  const skin = (look.skinId && NG_SKIN[look.skinId]) || body.skin;
  const fit = outfitFor(body, look.outfitId);
  const hairC = body.hairColor;
  const top = fit.top, bottom = fit.bottom;

  const regionOf = (u, v) => {
    for (const k in NG_UV) { const r = NG_UV[k]; if (u >= r[0] && u < r[2] && v >= r[1] && v < r[3]) return k; }
    return null;
  };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const U = (px + 0.5) / size, V = (py + 0.5) / size;
      const key = regionOf(U, V);
      let c = [96, 96, 104];
      if (key) {
        const r = NG_UV[key];
        const u = (U - r[0]) / (r[2] - r[0]), t = (V - r[1]) / (r[3] - r[1]);
        const front = 1 - Math.min(1, Math.abs(u - 0.5) * 2);   // 1 at the front centre, 0 at the back
        switch (key) {
          case 'head': {
            c = skin;
            // hairline: crown and back of the head
            const backHair = body.hair === 'long' || body.hair === 'bob' ? 0.78 : 0.55;
            if (t < 0.24 - front * 0.06 || (front < 0.32 && t < backHair)) c = hairC;
            const du = u - 0.5;
            const eye = (cx) => Math.hypot((du - cx) / 0.045, (t - 0.47) / 0.03) < 1;
            const iris = (cx) => Math.hypot((du - cx) / 0.02, (t - 0.47) / 0.026) < 1;
            if (eye(-0.065) || eye(0.065)) c = [244, 240, 232];
            if (iris(-0.065) || iris(0.065)) c = [40, 28, 22];
            if (Math.abs(t - 0.405) < 0.012 && Math.abs(Math.abs(du) - 0.068) < 0.04) c = shade(hairC, 0.9);  // brows
            if (Math.abs(t - 0.74) < 0.012 && Math.abs(du) < 0.05) c = body.bust ? [176, 58, 74] : shade(skin, 0.62);  // mouth
            if (body.beard && t > 0.66 && t < 0.95 && front > 0.42 && !(Math.abs(t - 0.74) < 0.03 && Math.abs(du) < 0.06)) c = mix(c, hairC, 0.7);
            if (Math.abs(du) > 0.16 && Math.abs(du) < 0.2 && t > 0.42 && t < 0.62) c = shade(c, 0.85);  // cheek facets
            break;
          }
          case 'hair': c = shade(hairC, 0.85 + 0.3 * hash(px >> 3, py >> 3)); break;
          case 'ears': case 'nose': c = shade(skin, key === 'nose' ? 0.96 : 0.9); break;
          case 'neck': c = shade(skin, 0.92); if (top.chain && t > 0.55 && t < 0.7) c = [212, 172, 72]; break;
          case 'torso': {
            const topEnd = top.hem >= 1 ? TORSO_T.belt : top.hem;   // crop tops end above the belt
            if (t < topEnd) {
              c = patternAt(top.pattern, u, t, top.color, top.patternColor || top.color);
              if (top.collar && front > 0.86 && t < 0.16 - (1 - front) * 0.6) c = skin;                     // V collar
              if (!top.collar && top.sleeve === 0 && t < 0.05 && front > 0.5) c = skin;                     // tank neckline
              if (top.collar && Math.abs(u - 0.5) < 0.006 && t > 0.16) c = shade(top.color, 0.7);         // placket
            } else if (t < TORSO_T.belt) c = skin;                                                          // midriff
            else if (t < TORSO_T.belt + 0.05) c = fit.belt;
            else c = bottom.color;
            if (top.chain && t < 0.03) c = [212, 172, 72];
            break;
          }
          case 'arm': {
            c = skin;
            if (t < top.sleeve) c = patternAt(top.pattern, u, t, top.color, top.patternColor || top.color);
            if (t > ARM_T.wrist - 0.02 && t < ARM_T.wrist + 0.01 && body.code === 'MT') c = [200, 170, 80];   // watch
            break;
          }
          case 'leg': c = bottom.length >= 1 || t < bottom.length ? bottom.color : skin; if (bottom.length < 1 && Math.abs(t - bottom.length) < 0.015) c = shade(bottom.color, 0.75); break;
          case 'foot': c = fit.shoes; break;
          case 'sole': c = shade(fit.shoes, 0.78); break;
        }
        // soft baked occlusion towards the back and bottom of each part keeps facets readable
        c = shade(c, 0.86 + 0.14 * front);
      }
      const i = (py * size + px) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }
  return out;
}

/* Roster dossier entries so the online lobby can describe the bodies honestly. */
export function ngHeroData(id) {
  const b = ngBody(id);
  if (!b) return null;
  return {
    id: b.id, name: b.name, title: `${b.archetype} · ${b.title}`, classType: `NEXT GEN · ${b.code}`, badge: '◆',
    bio: `${b.archetype} body on the shared Spectre Orbit rig (${b.height.toFixed(2)} m visual height). Same skeleton, animations and UV layout as every Next Gen body, so outfits, skin tones and shaders swap on the fly. Gameplay hitbox and speed are identical for all bodies.`,
    stats: { mobility: 80, durability: 80, precision: 80, firepower: 80 },
    signatureWeapon: 'Any loadout', signatureIcon: '◆', trait: 'Cosmetic only', traitDesc: 'Appearance never changes balance',
    defaultColor: '#22d3ee', ng: true,
  };
}
