"""Procedural tileable textures for the MAPFORGE maps (numpy only, deterministic).

The original Xonotic texture packs are not part of this repo, so each source texture
name is mapped to a material *kind*, and every kind is painted here. A palette per map
tints the kinds so each arena keeps its own mood.
"""
import numpy as np

N = 256


def _rng(seed):
    return np.random.default_rng(seed)


def fbm(seed, octaves=4, base=4, n=N):
    """Tileable fractal noise in 0..1 (FFT-filtered white noise, summed over octaves)."""
    rng = _rng(seed)
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    r = np.sqrt(fx * fx + fy * fy) + 1e-6
    for o in range(octaves):
        cutoff = base * (2 ** o) / n
        spec = np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-(r / cutoff) ** 2)
        layer = np.real(np.fft.ifft2(spec))
        layer = (layer - layer.min()) / (np.ptp(layer) + 1e-9)
        out += layer * amp
        total += amp
        amp *= 0.5
    return out / total


def grid(n=N):
    y, x = np.mgrid[0:n, 0:n]
    return x.astype(float), y.astype(float)


def shade(rgb, v):
    return np.clip(np.asarray(rgb)[None, None, :] * v[..., None], 0, 1)


def seams(n, cells, width=2):
    """Dark groove with a light lip on one side: panel joints."""
    x, y = grid(n)
    step = n / cells
    gx = np.minimum(x % step, step - (x % step))
    gy = np.minimum(y % step, step - (y % step))
    d = np.minimum(gx, gy)
    groove = (d < width).astype(float)
    lip = ((d >= width) & (d < width + 1.5)).astype(float)
    return groove, lip


def panel(color, seed, cells=2, wear=0.35, rivets=True, grime=0.35):
    n = N
    base = 0.78 + 0.22 * fbm(seed, 4, 3)
    scratches = np.zeros((n, n))
    rng = _rng(seed + 7)
    for _ in range(70):
        x0, y0 = rng.integers(0, n, 2)
        ln = rng.integers(8, 40)
        horiz = rng.random() < 0.5
        for i in range(ln):
            xx, yy = ((x0 + i) % n, y0) if horiz else (x0, (y0 + i) % n)
            scratches[yy, xx] = 1
    v = base * (1 - 0.18 * scratches * wear * 2)
    groove, lip = seams(n, cells)
    v = v * (1 - 0.65 * groove) + 0.12 * lip
    if rivets:
        x, y = grid(n)
        step = n / cells
        for ox in (6, step - 6):
            for oy in (6, step - 6):
                cx = (x % step) - ox
                cy = (y % step) - oy
                r = np.sqrt(cx * cx + cy * cy)
                v = np.where(r < 2.6, 1.08 - 0.25 * (r / 2.6), v)
                v = np.where((r >= 2.6) & (r < 3.6), v * 0.7, v)
    # vertical grime streaks
    streak = fbm(seed + 3, 3, 2)
    gy = np.linspace(0, 1, n)[:, None]
    v = v * (1 - grime * (streak * (0.4 + 0.6 * gy)) * 0.8)
    return shade(color, v)


def diamond(color, seed):
    n = N
    x, y = grid(n)
    k = 2 * np.pi / 32
    a = np.abs(np.sin((x + y) * k / 1.41)) * np.abs(np.sin((x - y) * k / 1.41))
    bump = np.clip(1 - np.abs(a - 0.5) * 3, 0, 1)
    v = 0.55 + 0.35 * bump + 0.2 * (fbm(seed, 4, 4) - 0.5)
    groove, lip = seams(n, 2, 2)
    v = v * (1 - 0.55 * groove) + 0.1 * lip
    return shade(color, v)


def grate(color, seed):
    n = N
    x, y = grid(n)
    step = 16
    cx = np.abs((x % step) - step / 2)
    cy = np.abs((y % step) - step / 2)
    hole = (cx < 4.5) & (cy < 4.5)
    v = np.where(hole, 0.08, 0.62 + 0.25 * fbm(seed, 3, 4))
    edge = ((cx < 5.5) & (cy < 5.5)) & ~hole
    v = np.where(edge, v * 1.25, v)
    return shade(color, v)


def concrete(color, seed):
    n = N
    v = 0.62 + 0.38 * fbm(seed, 5, 4)
    pits = fbm(seed + 9, 2, 40) > 0.78
    v = np.where(pits, v * 0.55, v)
    stains = fbm(seed + 5, 2, 2)
    v = v * (0.85 + 0.2 * stains)
    groove, lip = seams(n, 2, 1)
    v = v * (1 - 0.35 * groove)
    return shade(color, v)


def hazard(color_a, color_b, seed):
    n = N
    x, y = grid(n)
    band = (((x + y) // 32) % 2).astype(float)
    wear = fbm(seed, 4, 6)
    v = 0.82 + 0.18 * wear
    out = np.where(band[..., None] > 0.5, np.asarray(color_a)[None, None, :], np.asarray(color_b)[None, None, :])
    out = out * v[..., None]
    groove, _ = seams(n, 1, 2)
    return np.clip(out * (1 - 0.5 * groove[..., None]), 0, 1)


def pipe(color, seed):
    n = N
    _, y = grid(n)
    t = (y / n)
    cyl = 0.25 + 0.85 * np.sin(np.pi * t) ** 0.8
    spec = np.exp(-((t - 0.32) / 0.07) ** 2) * 0.35
    x, _ = grid(n)
    bands = 1 - 0.35 * (np.abs((x % 128) - 64) > 58)
    v = (cyl + spec) * bands * (0.9 + 0.1 * fbm(seed, 3, 4))
    return shade(color, v)


def ribs(color, seed):
    n = N
    x, _ = grid(n)
    t = (x % 32) / 32
    r = 0.35 + 0.65 * np.sin(np.pi * t) ** 0.7
    v = r * (0.88 + 0.12 * fbm(seed, 3, 4))
    return shade(color, v)


def trim(color, seed):
    n = N
    _, y = grid(n)
    band = (y % 64) / 64
    v = 0.7 + 0.2 * np.where(band < 0.5, band * 2, 2 - band * 2) + 0.12 * (fbm(seed, 4, 4) - 0.5)
    groove, lip = seams(n, 4, 1)
    v = v * (1 - 0.4 * groove) + 0.08 * lip
    return shade(color, v)


def lamp(color, seed, frame=(0.12, 0.12, 0.13)):
    n = N
    x, y = grid(n)
    d = np.minimum(np.minimum(x, n - 1 - x), np.minimum(y, n - 1 - y))
    inner = np.clip((d - 14) / 10, 0, 1)
    glow = 0.9 + 0.1 * fbm(seed, 2, 2)
    c = np.asarray(color)[None, None, :] * glow[..., None]
    out = np.asarray(frame)[None, None, :] * (1 - inner[..., None]) + c * inner[..., None]
    ridges = (np.abs((x % 64) - 32) < 1.5) & (inner > 0.9)
    return np.clip(out * (1 - 0.15 * ridges[..., None]), 0, 1)


def screen(color, seed):
    n = N
    x, y = grid(n)
    rng = _rng(seed)
    blocks = rng.random((32, 32))
    big = np.kron(blocks, np.ones((n // 32, n // 32)))
    scan = 0.85 + 0.15 * np.sin(y * 1.3)
    v = (0.18 + 0.55 * (big > 0.72)) * scan
    d = np.minimum(np.minimum(x, n - 1 - x), np.minimum(y, n - 1 - y))
    v = np.where(d < 10, 0.06, v)
    return shade(color, v)


def glass(color, seed):
    n = N
    x, y = grid(n)
    v = 0.55 + 0.25 * np.clip(np.sin((x + y) * 0.04) * 3, -1, 1) + 0.1 * fbm(seed, 2, 3)
    d = np.minimum(np.minimum(x, n - 1 - x), np.minimum(y, n - 1 - y))
    v = np.where(d < 4, 0.25, v)
    return shade(color, v)


def wood(color, seed):
    n = N
    x, y = grid(n)
    w = np.sin(x * 0.18 + 6 * fbm(seed, 3, 3)) * 0.5 + 0.5
    v = 0.55 + 0.35 * w
    groove, _ = seams(n, 4, 1)
    return shade(color, v * (1 - 0.5 * groove))


def gravel(color, seed):
    n = N
    coarse = fbm(seed, 3, 3)
    mid = fbm(seed + 3, 3, 9)
    fine = fbm(seed + 1, 2, 48)
    stones = fbm(seed + 2, 1, 22)
    v = 0.45 + 0.24 * coarse + 0.2 * mid + 0.14 * fine
    v = np.where(stones > 0.62, v * 1.12, v)
    v = np.where(stones < 0.32, v * 0.84, v)
    return shade(color, v)


def asphalt(color, seed):
    n = N
    v = 0.55 + 0.25 * fbm(seed, 4, 6) + 0.25 * fbm(seed + 1, 2, 60)
    crack = np.abs(fbm(seed + 4, 3, 5) - 0.5) < 0.012
    v = np.where(crack, v * 0.4, v)
    return shade(color, v)


def corrugated(color, seed):
    """Shipping-container wall: vertical ribs, rusty streaks, scuffed edges."""
    n = N
    x, y = grid(n)
    rib = np.sin(x * 2 * np.pi / 16)
    v = 0.74 + 0.2 * rib + 0.12 * (fbm(seed, 4, 3) - 0.5)
    rust = fbm(seed + 3, 3, 2) * np.linspace(0.3, 1.0, n)[:, None]
    tone = np.asarray(color)[None, None, :] * v[..., None]
    rusty = np.asarray((0.42, 0.2, 0.1))[None, None, :] * (0.7 + 0.3 * v[..., None])
    k = np.clip((rust - 0.55) * 3.0, 0, 0.65)[..., None]
    tone = tone * (1 - k) + rusty * k
    d = np.minimum(y, n - 1 - y)
    tone = np.where((d < 6)[..., None], tone * 0.6, tone)
    return np.clip(tone, 0, 1)


def sleeper(color, seed):
    n = N
    x, y = grid(n)
    grain = np.sin(y * 0.35 + 9 * fbm(seed, 3, 3)) * 0.5 + 0.5
    v = 0.42 + 0.3 * grain + 0.18 * fbm(seed + 1, 3, 8)
    return shade(color, v)


def steel(color, seed):
    n = N
    v = 0.55 + 0.25 * fbm(seed, 3, 2) + 0.15 * fbm(seed + 1, 2, 30)
    x, y = grid(n)
    v = v * (0.8 + 0.2 * np.sin(x * 0.05))
    return shade(color, v)


KINDS = {
    'metal': lambda c, s: panel(c['metal'], s, 2),
    'metal_dark': lambda c, s: panel(c['metal_dark'], s + 1, 2, grime=0.5),
    'paint': lambda c, s: panel(c['paint'], s + 2, 2),
    'base': lambda c, s: panel(c['base'], s + 3, 1, wear=0.5),
    'rust': lambda c, s: panel(c['rust'], s + 4, 2, grime=0.7),
    'plate': lambda c, s: panel(c['plate'], s + 5, 4, rivets=False),
    'floor': lambda c, s: diamond(c['floor'], s + 6),
    'grate': lambda c, s: grate(c['grate'], s + 7),
    'concrete': lambda c, s: concrete(c['concrete'], s + 8),
    'hazard': lambda c, s: hazard(c['hazard_a'], c['hazard_b'], s + 9),
    'pipe': lambda c, s: pipe(c['pipe'], s + 10),
    'ribs': lambda c, s: ribs(c['ribs'], s + 11),
    'trim': lambda c, s: trim(c['trim'], s + 12),
    'lamp': lambda c, s: lamp(c['lamp'], s + 13),
    'lamp_a': lambda c, s: lamp(c['lamp_a'], s + 14),
    'lamp_b': lambda c, s: lamp(c['lamp_b'], s + 15),
    'screen': lambda c, s: screen(c['screen'], s + 16),
    'glass': lambda c, s: glass(c['glass'], s + 17),
    'wood': lambda c, s: wood(c['wood'], s + 18),
    'lava': lambda c, s: lamp(c['lava'], s + 19, frame=c['lava']),
    'gravel': lambda c, s: gravel(c['gravel'], s + 20),
    'asphalt': lambda c, s: asphalt(c['asphalt'], s + 21),
    'corr_a': lambda c, s: corrugated(c['corr_a'], s + 22),
    'corr_b': lambda c, s: corrugated(c['corr_b'], s + 23),
    'corr_c': lambda c, s: corrugated(c['corr_c'], s + 24),
    'corr_d': lambda c, s: corrugated(c['corr_d'], s + 25),
    'sleeper': lambda c, s: sleeper(c['sleeper'], s + 26),
    'steel': lambda c, s: steel(c['steel'], s + 27),
}

EMISSIVE = {'lamp', 'lamp_a', 'lamp_b', 'screen', 'lava'}

PALETTES = {
    'foundry': dict(
        metal=(0.50, 0.44, 0.40), metal_dark=(0.34, 0.30, 0.28), paint=(0.62, 0.20, 0.14), base=(0.46, 0.40, 0.36),
        rust=(0.55, 0.30, 0.16), plate=(0.42, 0.37, 0.34), floor=(0.44, 0.40, 0.37), grate=(0.40, 0.37, 0.35),
        concrete=(0.52, 0.47, 0.42), hazard_a=(0.92, 0.62, 0.10), hazard_b=(0.10, 0.09, 0.08), pipe=(0.58, 0.40, 0.28),
        ribs=(0.45, 0.38, 0.34), trim=(0.58, 0.48, 0.38), lamp=(1.0, 0.85, 0.6), lamp_a=(1.0, 0.25, 0.12),
        lamp_b=(1.0, 0.7, 0.3), screen=(1.0, 0.55, 0.18), glass=(0.55, 0.40, 0.30), wood=(0.45, 0.30, 0.18),
        lava=(1.0, 0.38, 0.06)),
    'glowplant': dict(
        metal=(0.46, 0.52, 0.58), metal_dark=(0.30, 0.35, 0.40), paint=(0.28, 0.46, 0.55), base=(0.40, 0.48, 0.55),
        rust=(0.50, 0.36, 0.26), plate=(0.38, 0.44, 0.50), floor=(0.40, 0.45, 0.50), grate=(0.36, 0.42, 0.47),
        concrete=(0.50, 0.54, 0.56), hazard_a=(0.90, 0.78, 0.12), hazard_b=(0.08, 0.10, 0.12), pipe=(0.34, 0.55, 0.62),
        ribs=(0.38, 0.46, 0.54), trim=(0.55, 0.62, 0.68), lamp=(0.75, 0.95, 1.0), lamp_a=(0.35, 0.85, 1.0),
        lamp_b=(0.55, 0.95, 1.0), screen=(0.30, 0.95, 0.9), glass=(0.35, 0.60, 0.70), wood=(0.40, 0.30, 0.20),
        lava=(0.2, 0.8, 1.0)),
    'zenith': dict(
        metal=(0.42, 0.46, 0.54), metal_dark=(0.26, 0.29, 0.36), paint=(0.30, 0.40, 0.62), base=(0.36, 0.40, 0.48),
        rust=(0.46, 0.34, 0.28), plate=(0.34, 0.38, 0.46), floor=(0.38, 0.42, 0.50), grate=(0.32, 0.36, 0.44),
        concrete=(0.55, 0.57, 0.62), hazard_a=(0.88, 0.80, 0.14), hazard_b=(0.08, 0.09, 0.12), pipe=(0.40, 0.48, 0.60),
        ribs=(0.36, 0.42, 0.52), trim=(0.52, 0.58, 0.68), lamp=(0.85, 0.95, 1.0), lamp_a=(1.0, 0.25, 0.25),
        lamp_b=(0.25, 0.55, 1.0), screen=(0.3, 0.9, 1.0), glass=(0.35, 0.62, 0.80), wood=(0.45, 0.36, 0.26),
        lava=(0.2, 0.6, 1.0)),
}

PALETTES['yard'] = dict(
    metal=(0.46, 0.47, 0.48), metal_dark=(0.26, 0.27, 0.29), paint=(0.55, 0.17, 0.12), base=(0.40, 0.40, 0.40),
    rust=(0.52, 0.28, 0.15), plate=(0.36, 0.37, 0.38), floor=(0.40, 0.40, 0.40), grate=(0.30, 0.31, 0.32),
    concrete=(0.62, 0.60, 0.56), hazard_a=(0.92, 0.72, 0.10), hazard_b=(0.10, 0.10, 0.10), pipe=(0.45, 0.45, 0.45),
    ribs=(0.40, 0.40, 0.42), trim=(0.55, 0.53, 0.48), lamp=(1.0, 0.78, 0.45), lamp_a=(1.0, 0.2, 0.1),
    lamp_b=(0.4, 0.9, 0.5), screen=(0.4, 0.9, 1.0), glass=(0.3, 0.42, 0.5), wood=(0.38, 0.27, 0.17),
    lava=(1.0, 0.4, 0.1), gravel=(0.50, 0.47, 0.43), asphalt=(0.26, 0.26, 0.27),
    corr_a=(0.58, 0.18, 0.12), corr_b=(0.13, 0.27, 0.50), corr_c=(0.16, 0.38, 0.24), corr_d=(0.78, 0.50, 0.12),
    sleeper=(0.30, 0.21, 0.14), steel=(0.50, 0.50, 0.52))
# The yard is lit at runtime (sun + sky), so albedo is lifted compared with the baked maps.
PALETTES['yard'] = {k: (v if k.startswith('lamp') or k in ('screen', 'lava') else tuple(min(0.92, c * 1.4) for c in v))
                    for k, v in PALETTES['yard'].items()}

# Variants that recolour a kind: texture-name hints picked per face.
VARIANT_TINT = {
    'red': (1.35, 0.55, 0.5),
    'blue': (0.6, 0.85, 1.35),
}


def kind_of(tex):
    """Material kind for a Quake texture name."""
    t = tex.lower().split('/')[-1]
    full = tex.lower()
    if 'glass' in t:
        return 'glass'
    if 'lava' in t:
        return 'lava'
    if any(k in t for k in ('computer', 'switches', 'screen')):
        return 'screen'
    if t.startswith('light') or t.startswith('beam') or 'lightbeam' in t or 'light_beam' in t:
        if 'red' in t:
            return 'lamp_a'
        if 'blue' in t:
            return 'lamp_b'
        return 'lamp'
    if any(k in t for k in ('wrn', 'warn')):
        return 'hazard'
    if 'grate' in t:
        return 'grate'
    if t.startswith('floor') or 'tread' in t or 'clang' in t:
        return 'floor'
    if 'pipe' in t:
        return 'pipe'
    if 'rib' in t:
        return 'ribs'
    if any(k in t for k in ('concrete', 'stone', 'pits', 'wall-des', 'des01')):
        return 'concrete'
    if 'wood' in t:
        return 'wood'
    if 'rust' in t:
        return 'rust'
    if any(k in t for k in ('stair', 'steptop', 'trim', 'baseboard', 'support', 'psimple')):
        return 'trim'
    if 'red' in t:
        return 'paint'
    if t.startswith('base-base') or 'base1' in t:
        return 'base'
    if any(k in t for k in ('panel', 'plate', 'wall')):
        return 'plate' if 'metal' not in t else 'metal'
    if any(k in t for k in ('metal03', 'metal02', 'metal04', 'metal06', 'metal07')):
        return 'metal_dark'
    return 'metal'


def variant_of(tex):
    t = tex.lower().split('/')[-1]
    if 'concrete' in t and 'red' in t:
        return 'red'
    if 'concrete' in t and 'blue' in t:
        return 'blue'
    return None


def make(kind, palette_name, variant=None, seed=1234):
    arr = KINDS[kind](PALETTES[palette_name], seed)
    if variant:
        arr = np.clip(arr * np.asarray(VARIANT_TINT[variant])[None, None, :], 0, 1)
    return arr
