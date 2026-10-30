"""HADOTA Rail Yard: a hand-authored arena built around the converted train.

Run with Blender 5.x headless (after tools/train_pipeline/convert_train.py produced the train GLBs):
  blender -b --python tools/map_pipeline/railyard.py

Writes assets/maps/processed/railyard.{glb,json}. Everything is laid out in game space
(metres, Y up). The long axis is Z; the train sits on the middle track (x = 0).
"""
import bpy, bmesh, os, sys, json, math, random
from collections import defaultdict
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import textures

PROPS = os.path.join(SRC, 'assets', 'props', 'train')
OUT = os.path.join(SRC, 'assets', 'maps', 'processed')
TMP = os.environ.get('YARD_TMP', os.path.join(HERE, '_tmp_yard'))
os.makedirs(TMP, exist_ok=True)

G = -0.2                       # ground level; rail heads sit at y = 0 where the train wheels touch
X0, X1, Z0, Z1 = -58.0, 58.0, -105.0, 105.0
TRACKS = [-12.0, 0.0, 12.0]
TRAIN_SHIFT = 66.3             # centres the 149 m train on z = 0
CART_OFFSETS = [0.0, 25.353, 50.702, 76.049, 101.398]   # cart_01..05 from cart_01 (USD frame 1001)
CART_BASE_Z = -119.773 + 0.0   # cart_01 min z in the USD
PLAT_H = 1.05
PLAT_Z = 62.0
SEED = 20261029

rnd = random.Random(SEED)

SOLID = []                     # collision boxes
VIS = defaultdict(list)        # texture kind -> [(box, tile, bottom)]
BARRELS = []
JUMPPADS = []
LAMPS = []


def r2(v):
    return round(float(v), 2)


def B(x0, y0, z0, x1, y1, z1, tex, solid=True, tile=3.0, bottom=None):
    """Axis-aligned box: optional collision + textured visual."""
    x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3 or z1 - z0 < 1e-3:
        return
    if solid:
        SOLID.append([r2(x0), r2(y0), r2(z0), r2(x1), r2(y1), r2(z1)])
    if bottom is None:
        bottom = y0 > G + 0.05
    VIS[tex].append(((x0, y0, z0, x1, y1, z1), tile, bottom))


def V(*a, **k):
    B(*a, solid=False, **k)


# ---------------------------------------------------------------------------------------
# layout
# ---------------------------------------------------------------------------------------
def ground():
    B(X0, G - 2.0, Z0, X1, G, Z1, 'gravel', tile=6.0)
    for sx in (-1, 1):                                          # service lanes beside the outer tracks
        V(min(sx * 14.6, sx * 20.0), G, Z0, max(sx * 14.6, sx * 20.0), G + 0.03, Z1, 'asphalt', tile=4.0)
    for za, zb in ((-100.0, -92.0), (92.0, 100.0)):             # cross roads at each end
        V(X0, G, za, X1, G + 0.03, zb, 'asphalt', tile=4.0)


def tracks():
    for xc in TRACKS:
        V(xc - 1.95, G, Z0, xc + 1.95, G + 0.07, Z1, 'gravel', tile=2.5, bottom=False)
        z = Z0 + 0.4
        while z < Z1 - 0.3:
            V(xc - 1.25, G + 0.03, z, xc + 1.25, G + 0.13, z + 0.26, 'sleeper', tile=1.2, bottom=False)
            z += 0.64
        for off in (-0.7175, 0.7175):
            V(xc + off - 0.035, G + 0.08, Z0, xc + off + 0.035, 0.0, Z1, 'steel', tile=1.0, bottom=False)


def platform(xa, xb):
    """Concrete platform (xa < xb) beside the train track with a canopy, steps at both ends."""
    za, zb = -PLAT_Z, PLAT_Z
    top = G + PLAT_H
    B(xa, G, za, xb, top, zb, 'concrete', tile=3.0, bottom=False)
    inner = xb if xb < 0 else xa                                # edge that faces the train
    outer = xa if xb < 0 else xb
    V(min(inner, inner + (-0.55 if inner == xb else 0.55)), top, za, max(inner, inner + (-0.55 if inner == xb else 0.55)), top + 0.02, zb, 'hazard', tile=1.1)
    # two steps at each end (0.35 m risers) so the platform can be walked onto
    for z_end, dz in ((za, -1.0), (zb, 1.0)):
        for i, h in enumerate((0.70, 0.35)):
            s0 = z_end + dz * i * 0.9
            s1 = z_end + dz * (i + 1) * 0.9
            B(xa + 1.0, G, min(s0, s1), xb - 1.0, G + h, max(s0, s1), 'concrete', tile=2.0, bottom=False)
    ya = top + 4.4
    for c0, c1 in ((-52.0, -4.5), (4.5, 52.0)):               # a gap at z = 0 lets a jump pad reach the roof
        B(xa - 0.6, ya, c0, xb + 0.6, ya + 0.28, c1, 'metal_dark', tile=3.0)
        V(xa - 0.6, ya - 0.06, c0, xb + 0.6, ya, c1, 'trim', tile=2.0)
    cx = outer + (0.5 if outer == xa else -0.5)
    z = -49.0
    while z < 50.0:                                             # columns on the outer edge double as cover
        B(cx - 0.22, G, z - 0.22, cx + 0.22, ya, z + 0.22, 'metal', tile=1.5, bottom=False)
        B(cx - 0.4, top, z - 0.4, cx + 0.4, top + 0.5, z + 0.4, 'concrete', tile=1.0)
        z += 14.0
    z = -46.0
    while z < 50.0:                                             # fluorescent strips under the canopy
        if abs(z) > 5.5:
            V(xa + 1.0, ya - 0.14, z - 0.35, xb - 1.0, ya - 0.06, z + 0.35, 'lamp', tile=1.0)
            LAMPS.append(((xa + xb) / 2, ya - 0.2, z))
        z += 9.0


def container(x, z, level=0, along='z', tex='corr_a', length=12.2):
    w, hgt = 2.44, 2.6
    y0 = G + level * hgt
    if along == 'z':
        x0, x1, z0, z1 = x - w / 2, x + w / 2, z - length / 2, z + length / 2
    else:
        x0, x1, z0, z1 = x - length / 2, x + length / 2, z - w / 2, z + w / 2
    B(x0, y0, z0, x1, y0 + hgt, z1, tex, tile=2.44, bottom=False)
    V(x0 - 0.03, y0, z0 - 0.03, x1 + 0.03, y0 + 0.14, z1 + 0.03, 'metal_dark', tile=1.0, bottom=False)
    V(x0 - 0.03, y0 + hgt - 0.12, z0 - 0.03, x1 + 0.03, y0 + hgt, z1 + 0.03, 'metal_dark', tile=1.0, bottom=False)


def crate(x, z, sx=1.2, sy=1.2, sz=1.2, y=None, tex='wood'):
    y = G if y is None else y
    B(x - sx / 2, y, z - sz / 2, x + sx / 2, y + sy, z + sz / 2, tex, tile=1.2, bottom=False)


def stair(xa, xb, z_start, dz, rise, steps, tex='plate'):
    """Straight stair along z; first tread at z_start, climbing toward dz."""
    run, h = 0.6, rise / steps
    for i in range(steps):
        a, b = z_start + dz * i * run, z_start + dz * (i + 1) * run
        B(xa, G, min(a, b), xb, G + (i + 1) * h, max(a, b), tex, tile=1.5, bottom=False)


def lamp_post(x, z, h=7.5, lean=1.0):
    B(x - 0.1, G, z - 0.1, x + 0.1, G + h, z + 0.1, 'metal_dark', tile=1.0, bottom=False)
    x_arm0, x_arm1 = (x, x + 1.2 * lean) if lean > 0 else (x + 1.2 * lean, x)
    V(x_arm0, G + h - 0.14, z - 0.06, x_arm1, G + h - 0.06, z + 0.06, 'metal_dark', tile=1.0)
    V(x + lean * 0.6 - 0.35, G + h - 0.2, z - 0.2, x + lean * 0.6 + 0.35, G + h - 0.14, z + 0.2, 'lamp', tile=1.0)
    LAMPS.append((x + lean * 0.6, G + h - 0.3, z))


def gantry(z, y_deck=6.4):
    xs = max(TRACKS) + 3.4
    for sx in (-xs, xs):
        for dz in (-0.55, 0.55):
            B(sx - 0.25, G, z + dz - 0.2, sx + 0.25, y_deck + 1.2, z + dz + 0.2, 'metal', tile=1.5, bottom=False)
    B(-xs, y_deck, z - 0.9, xs, y_deck + 0.25, z + 0.9, 'grate', tile=1.2)
    V(-xs, y_deck + 0.25, z - 0.9, xs, y_deck + 1.15, z - 0.84, 'metal_dark', tile=1.5)
    V(-xs, y_deck + 0.25, z + 0.84, xs, y_deck + 1.15, z + 0.9, 'metal_dark', tile=1.5)
    V(-xs, y_deck + 1.15, z - 0.92, xs, y_deck + 1.22, z + 0.92, 'metal', tile=1.5)
    for xc in TRACKS:
        V(xc - 0.15, y_deck - 1.5, z - 0.12, xc + 0.15, y_deck, z + 0.12, 'metal_dark', tile=1.0)
        V(xc - 0.22, y_deck - 1.15, z + 0.12, xc + 0.22, y_deck - 0.8, z + 0.2, 'lamp_a' if xc != 0 else 'lamp_b', tile=1.0)
        LAMPS.append((xc, y_deck - 1.0, z))
    # stair from the yard up to the deck end, running away from the tracks along z
    sgn = 1.0 if z > 0 else -1.0
    steps = 26
    start = z - sgn * (1.0 + steps * 0.6)                 # lowest tread toward the middle of the yard
    stair(xs - 0.9, xs + 0.9, start, sgn, y_deck - G, steps, 'plate')
    stair(-xs - 0.9, -xs + 0.9, start, sgn, y_deck - G, steps, 'plate')


def depot():
    """Workshop shed on the west yard, open on the track side."""
    x0, x1, z0, z1 = -57.0, -38.0, -46.0, -14.0
    wall, top = 0.35, G + 5.4
    B(x0, G, z0, x1, G + 0.12, z1, 'concrete', tile=3.0)
    B(x0, G + 0.12, z0, x0 + wall, top, z1, 'corr_c', tile=2.4)
    B(x0, G + 0.12, z0, x1, top, z0 + wall, 'corr_c', tile=2.4)
    B(x0, G + 0.12, z1 - wall, x1 - 8.0, top, z1, 'corr_c', tile=2.4)
    B(x0 - 0.3, top, z0 - 0.3, x1 + 0.3, top + 0.35, z1 + 0.3, 'metal_dark', tile=3.0)
    V(x0 - 0.3, top - 0.1, z0 - 0.3, x1 + 0.3, top, z1 + 0.3, 'trim', tile=2.0)
    for z in (-38.0, -30.0, -22.0):
        B(x1 - 0.5, G + 0.12, z - 0.25, x1, top, z + 0.25, 'metal', tile=1.5)
    B(x0 + 0.5, G + 0.12, -44.0, x0 + 2.2, G + 1.0, -34.0, 'metal_dark', tile=1.5)
    B(x0 + 0.5, G + 0.12, -28.0, x0 + 2.2, G + 1.0, -17.0, 'wood', tile=1.5)
    crate(-48.0, -42.0, 1.4, 1.4, 1.4)
    crate(-48.0, -40.4, 1.4, 1.4, 1.4)
    crate(-48.0, -41.2, 1.2, 1.2, 1.2, y=G + 1.4)
    for z in (-40.0, -32.0, -24.0):
        V(x0 + 2.0, G + 3.62, z + 0.05, x0 + 6.0, G + 3.7, z + 0.3, 'lamp', tile=1.0)
        LAMPS.append((x0 + 4.0, G + 3.6, z))
    stair(x0 + 1.0, x0 + 3.0, z0 - 0.4, -1.0, 5.4, 18, 'plate')       # outside stair to the roof


def tower():
    """Signal tower on the east yard."""
    cx, cz = 47.0, 28.0
    B(cx - 5, G, cz - 5, cx + 5, G + 4.4, cz + 5, 'concrete', tile=3.0)
    B(cx - 5.4, G + 4.4, cz - 5.4, cx + 5.4, G + 4.75, cz + 5.4, 'metal_dark', tile=3.0)
    B(cx - 4.4, G + 4.75, cz - 4.4, cx + 4.4, G + 7.4, cz + 4.4, 'plate', tile=2.5)
    for ax in (-1, 1):
        V(cx + ax * 4.45 - 0.02, G + 5.4, cz - 3.4, cx + ax * 4.45 + 0.02, G + 6.9, cz + 3.4, 'glass', tile=1.5)
    B(cx - 5.2, G + 7.4, cz - 5.2, cx + 5.2, G + 7.75, cz + 5.2, 'metal_dark', tile=3.0)
    stair(cx - 8.0, cx - 5.4, cz - 8.5, 1.0, 4.4, 15, 'plate')
    B(cx - 8.0, G + 4.0, cz - 3.0, cx - 5.4, G + 4.4, cz, 'plate', tile=1.5)
    lamp_post(cx + 6.4, cz + 6.4, 6.0, -1.0)


def tunnels_and_walls():
    """Concrete portal walls at both ends with a tunnel mouth per track, and retaining side walls."""
    h, depth = 14.0, 20.0
    mouth = 2.8
    for sign in (-1, 1):
        z_face = Z0 if sign < 0 else Z1
        za, zb = (z_face, z_face + 4.0) if sign < 0 else (z_face - 4.0, z_face)
        spans = [X0]
        for xc in TRACKS:
            spans += [xc - mouth, xc + mouth]
        spans.append(X1)
        for i in range(0, len(spans), 2):
            B(spans[i], G, za, spans[i + 1], G + h, zb, 'concrete', tile=4.0, bottom=False)
        for xc in TRACKS:
            B(xc - mouth, G + 6.4, za, xc + mouth, G + h, zb, 'concrete', tile=4.0)
            V(xc - mouth - 0.15, G + 6.2, za - 0.05 if sign > 0 else za, xc + mouth + 0.15, G + 6.4, zb + (0.05 if sign > 0 else 0), 'trim', tile=1.5)
        # tunnel bores: side walls, roof, and a sealed dark back
        z_in0, z_in1 = (za - depth, za) if sign < 0 else (zb, zb + depth)
        for xc in TRACKS:
            B(xc - mouth - 0.6, G, z_in0, xc - mouth, G + 8.0, z_in1, 'concrete', tile=4.0, bottom=False)
            B(xc + mouth, G, z_in0, xc + mouth + 0.6, G + 8.0, z_in1, 'concrete', tile=4.0, bottom=False)
            B(xc - mouth, G + 6.4, z_in0, xc + mouth, G + 8.0, z_in1, 'concrete', tile=4.0)
            cap0, cap1 = (z_in0 - 0.5, z_in0) if sign < 0 else (z_in1, z_in1 + 0.5)
            B(xc - mouth, G, cap0, xc + mouth, G + 8.0, cap1, 'asphalt', tile=3.0, bottom=False)
        edges = [X0] + [v for xc in TRACKS for v in (xc - mouth - 0.6, xc + mouth + 0.6)] + [X1]
        for i in range(0, len(edges), 2):
            if edges[i + 1] - edges[i] > 0.05:
                B(edges[i], G, z_in0, edges[i + 1], G + 8.0, z_in1, 'concrete', tile=4.0, bottom=False)
    B(X0 - 1.0, G, Z0, X0, G + 7.0, Z1, 'concrete', tile=4.0, bottom=False)
    B(X1, G, Z0, X1 + 1.0, G + 7.0, Z1, 'concrete', tile=4.0, bottom=False)
    z = Z0 + 12.0
    while z < Z1 - 8.0:
        B(X0, G, z - 0.5, X0 + 0.8, G + 7.4, z + 0.5, 'concrete', tile=2.0, bottom=False)
        B(X1 - 0.8, G, z - 0.5, X1, G + 7.4, z + 0.5, 'concrete', tile=2.0, bottom=False)
        z += 24.0


def containers():
    """Rows of containers beside the outer tracks; gaps keep lanes open, crate stairs give roof access."""
    cols = ['corr_a', 'corr_b', 'corr_c', 'corr_d']
    k = 0
    for side in (-1, 1):
        for xr in (24.0, 31.0, 38.0):
            z = -92.0
            while z < 82.0:
                if rnd.random() < 0.14:
                    z += rnd.choice([6.0, 9.0])
                    continue
                x = side * xr
                zc = z + 6.1
                blocked = False
                if side < 0 and x - 1.3 < -37.0 and -48.0 < zc < -12.0:     # depot footprint
                    blocked = True
                if side > 0 and xr == 38.0 and 16.0 < zc < 40.0:             # tower footprint + stair
                    blocked = True
                if side > 0 and xr == 31.0 and 18.0 < zc < 38.0:
                    blocked = True
                if blocked:
                    z += 14.0
                    continue
                container(x, zc, 0, 'z', cols[k % 4])
                k += 1
                if rnd.random() < 0.40:
                    container(x, zc, 1, 'z', cols[k % 4])
                z += 12.2 + rnd.choice([0.5, 0.5, 2.8, 6.0, 8.0])


def crates():
    # stepped crate pairs (1.2 m then 2.4 m) beside the lane give a way onto the containers
    for side in (-1, 1):
        for z in (-76.0, -52.0, -26.0, 2.0, 30.0, 58.0, 80.0):
            x = side * 20.4
            crate(x, z, 1.4, 1.2, 1.4)
            crate(x + side * 1.4, z + 0.3, 1.4, 2.4, 1.4)
    for z in (-84.0, 84.0):
        for x in (-19.5, -9.0, 9.0, 19.5):
            crate(x, z + (0.0 if x < 0 else 0.0), 1.8, 1.3, 1.8)
            crate(x + 2.0, z + 0.4, 1.4, 0.9, 1.4)


def platform_props():
    for xa, xb in ((-10.0, -2.6), (2.6, 10.0)):
        cx = (xa + xb) / 2
        sgn = 1.0 if cx < 0 else -1.0
        for z in (-50.0, -30.0, -10.0, 10.0, 30.0, 50.0):
            B(cx - 0.4, G + PLAT_H, z - 1.0, cx + 0.4, G + PLAT_H + 0.45, z + 1.0, 'wood', tile=1.0, bottom=False)
            V(cx - 0.4 + (0 if cx < 0 else 0.72), G + PLAT_H + 0.45, z - 0.95, cx - 0.32 + (0 if cx < 0 else 0.72), G + PLAT_H + 1.0, z + 0.95, 'metal_dark', tile=1.0)
        for z in (-40.0, 0.0, 40.0):
            kx = cx + sgn * 2.4
            B(kx - 0.9, G + PLAT_H, z - 1.6, kx + 0.9, G + PLAT_H + 2.5, z + 1.6, 'plate', tile=1.5, bottom=False)
            V(kx - 0.95, G + PLAT_H + 2.5, z - 1.7, kx + 0.95, G + PLAT_H + 2.62, z + 1.7, 'rust', tile=1.5)


def lamp_posts():
    for z in range(-96, 100, 24):
        lamp_post(-56.5, float(z), 7.5, 1.0)
        lamp_post(56.5, float(z), 7.5, -1.0)
    for z in range(-84, 90, 28):
        lamp_post(-17.5, float(z), 7.0, 1.0)
        lamp_post(17.5, float(z), 7.0, -1.0)


def jump_pads():
    """Pads at the platform ends fling players up onto the train roof."""
    top = G + PLAT_H

    def pad(x, z, tx, tz, ty):
        B(x - 1.0, top, z - 1.0, x + 1.0, top + 0.12, z + 1.0, 'metal_dark', tile=1.0)
        V(x - 0.8, top + 0.12, z - 0.8, x + 0.8, top + 0.16, z + 0.8, 'lamp_b', tile=1.0)
        h = ty - (top + 0.12)
        vy = math.sqrt(2 * 20 * h) + 1.0
        t = (vy + math.sqrt(vy * vy - 2 * 20 * h)) / 20.0
        JUMPPADS.append({'box': [r2(x - 1.0), r2(top + 0.12), r2(z - 1.0), r2(x + 1.0), r2(top + 0.5), r2(z + 1.0)],
                         'vy': r2(vy), 'vx': r2((tx - x) / t), 'vz': r2((tz - z) / t)})
    pad(-6.3, -60.6, 0.0, -57.0, 4.8)
    pad(6.3, 60.6, 0.0, 57.0, 4.8)
    pad(-6.3, 60.6, 0.0, 57.0, 4.8)
    pad(6.3, -60.6, 0.0, -57.0, 4.8)
    pad(-6.3, 0.0, 0.0, 0.0, 4.8)                              # mid-train pads through the canopy gap
    pad(6.3, 0.0, 0.0, 0.0, 4.8)


def barrels():
    spots = [(-18.5, -60.0), (-18.5, 12.0), (18.5, -30.0), (18.5, 52.0), (-48.0, -12.0), (-44.0, -50.0),
             (44.0, 12.0), (44.0, 44.0), (-30.0, 90.0), (30.0, -90.0), (-8.0, -90.0), (8.0, 90.0)]
    cols = ['barrelRust', 'barrelOlive', 'barrelRust']
    for i, (x, z) in enumerate(spots):
        BARRELS.append({'id': 'railyard_barrel_%d' % i, 'x': x, 'y': G, 'z': z, 'h': 1.1, 'r': 0.42, 'hp': 40, 'alive': True,
                        'color': cols[i % 3]})


def build_layout():
    ground()
    tracks()
    for xa, xb in ((-10.0, -2.6), (2.6, 10.0)):
        platform(xa, xb)
    tunnels_and_walls()
    containers()
    crates()
    platform_props()
    depot()
    tower()
    gantry(-88.0)
    gantry(88.0)
    lamp_posts()
    jump_pads()
    barrels()


# ---------------------------------------------------------------------------------------
# train: placement, collision, spawns
# ---------------------------------------------------------------------------------------
YUP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))    # importer Z-up -> game Y-up numbers


def import_train():
    """Import the two train GLBs and bring them back to game-space numbers."""
    parts = {}
    for key in ('engine', 'cart'):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(PROPS, key + '.glb'))
        bpy.context.view_layer.update()
        new = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in new if o.type == 'MESH']
        for o in meshes:
            mw = o.matrix_world.copy()
            o.parent = None
            o.data.transform(YUP @ mw)
            o.matrix_world = Matrix.Identity(4)
            o.data.update()
        for o in new:
            if o.type != 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        parts[key] = meshes
    return parts


def place_train(parts):
    placed = []
    bpy.context.view_layer.update()
    for o in parts['engine']:
        o.location = (0.0, 0.0, TRAIN_SHIFT)
        placed.append(o)
    for i, off in enumerate(CART_OFFSETS):
        for o in parts['cart']:
            c = o if i == 0 else o.copy()
            if i:
                bpy.context.scene.collection.objects.link(c)
            c.location = (0.0, 0.0, TRAIN_SHIFT + off)
            c.name = 'cart%d_%s' % (i + 1, o.name.split('.')[0])
            placed.append(c)
    bpy.context.view_layer.update()
    return placed


def train_collision(objs, cell_x=0.4, cell_z=0.5):
    """Column heightfield of the train hull -> merged solid boxes (players can stand on roofs)."""
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    vs = np.array([v.co[:] for v in bm.verts])
    print('[yard] train hull verts', len(vs), 'bounds', vs.min(0).round(2), vs.max(0).round(2))
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    xs = np.arange(-1.9, 1.9 + 1e-6, cell_x)
    z_lo, z_hi = TRAIN_SHIFT - 141.0, TRAIN_SHIFT + 8.5
    zs = np.arange(z_lo, z_hi, cell_z)
    H = np.zeros((len(xs) - 1, len(zs)))
    for i in range(len(xs) - 1):
        xc = (xs[i] + xs[i + 1]) / 2
        for j, z in enumerate(zs):
            zc = z + cell_z / 2
            best = 0.0
            for dx in (-0.12, 0.0, 0.12):
                hit = bvh.ray_cast(Vector((xc + dx, 8.0, zc)), Vector((0, -1, 0)), 12.0)
                if hit[0] is not None:
                    best = max(best, 8.0 - hit[3])
            H[i, j] = best
    Hq = np.round(H / 0.1) * 0.1
    # drop antenna-thin spikes: a cell far above all its neighbours snaps to the neighbour max
    P = np.pad(Hq, 1, mode='edge')
    for i in range(Hq.shape[0]):
        for j in range(Hq.shape[1]):
            nb = max(P[i, j + 1], P[i + 2, j + 1], P[i + 1, j], P[i + 1, j + 2])
            if Hq[i, j] - nb > 0.45:
                Hq[i, j] = nb
    boxes = []
    for i in range(Hq.shape[0]):
        j = 0
        while j < Hq.shape[1]:
            h = Hq[i, j]
            if h < 0.3:
                j += 1
                continue
            k = j
            while k + 1 < Hq.shape[1] and abs(Hq[i, k + 1] - h) < 1e-6:
                k += 1
            boxes.append([xs[i], zs[j], zs[k] + cell_z, xs[i + 1], h])
            j = k + 1
    merged, used = [], [False] * len(boxes)
    for a in range(len(boxes)):
        if used[a]:
            continue
        x0, z0, z1, x1, h = boxes[a]
        used[a] = True
        for b in range(a + 1, len(boxes)):
            if not used[b] and abs(boxes[b][0] - x1) < 1e-6 and abs(boxes[b][1] - z0) < 1e-6 and abs(boxes[b][2] - z1) < 1e-6 and abs(boxes[b][4] - h) < 1e-6:
                x1 = boxes[b][3]
                used[b] = True
        merged.append([r2(x0), r2(G), r2(z0), r2(x1), r2(h), r2(z1)])
    return merged, float(Hq.max())


def spawn_list():
    top = G + PLAT_H
    red, blue, free = [], [], []

    def face(x, z, tx=0.0, tz=0.0):
        return round(math.atan2(-(tx - x), -(tz - z)), 3)

    for x, z in ((-4.0, 92.0), (4.0, 92.0), (-9.0, 96.0), (9.0, 96.0), (-13.0, 91.0), (13.0, 91.0), (0.0, 98.0), (0.0, 85.0)):
        red.append({'x': x, 'y': G, 'z': z, 'yaw': face(x, z), 'team': 'red'})
        blue.append({'x': x, 'y': G, 'z': -z, 'yaw': face(x, -z), 'team': 'blue'})
    for x, z, y in ((-6.3, -20.0, top), (6.3, 20.0, top), (-6.3, 20.0, top), (6.3, -20.0, top),
                    (-18.0, -10.0, G), (18.0, 10.0, G), (-18.0, 40.0, G), (18.0, -40.0, G),
                    (-44.0, -2.0, G), (44.0, -4.0, G), (-47.0, -52.0, G), (47.0, 50.0, G)):
        free.append({'x': x, 'y': y, 'z': z, 'yaw': face(x, z)})
    return red + blue + free


# ---------------------------------------------------------------------------------------
# meshes
# ---------------------------------------------------------------------------------------
EMISSIVE_KINDS = {'lamp', 'lamp_a', 'lamp_b'}
METAL = {'steel': 0.75, 'metal': 0.45, 'metal_dark': 0.4, 'grate': 0.5}


def tex_image(kind):
    arr = textures.make(kind, 'yard')
    n = arr.shape[0]
    img = bpy.data.images.new('t_' + kind, n, n, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., :3] = arr
    img.pixels.foreach_set(rgba[::-1].ravel())      # image rows are bottom-up
    path = os.path.join(TMP, 'yard_%s.png' % kind)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return bpy.data.images.load(path)


def make_material(kind):
    emissive = kind in EMISSIVE_KINDS
    m = bpy.data.materials.new(('E_' if emissive else 'M_') + kind)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = tex_image(kind)
    t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85 if kind not in METAL else 0.4
    b.inputs['Metallic'].default_value = METAL.get(kind, 0.0)
    if emissive:
        nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 2.2
    return m


def build_meshes():
    objs = []
    for kind, items in VIS.items():
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        for (x0, y0, z0, x1, y1, z1), tile, bottom in items:
            faces = [
                ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), 'x'),
                ((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0), 'x'),
                ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), 'y'),
                ((x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), 'y'),
                ((x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1), 'z'),
                ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0), 'z'),
            ]
            for fi, (a, b, c, d, ax) in enumerate(faces):
                if fi == 3 and not bottom:
                    continue
                vs = [bm.verts.new(p) for p in (a, b, c, d)]
                f = bm.faces.new(vs)
                for lp in f.loops:
                    p = lp.vert.co
                    if ax == 'x':
                        lp[uvl].uv = (p.z / tile, p.y / tile)
                    elif ax == 'z':
                        lp[uvl].uv = (p.x / tile, p.y / tile)
                    else:
                        lp[uvl].uv = (p.x / tile, p.z / tile)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('yard_' + kind)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('yard_' + kind, me)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(make_material(kind))
        objs.append(o)
    return objs


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_layout()
    if all(os.path.exists(os.path.join(PROPS, k + '.glb')) for k in ('engine', 'cart')):
        parts = import_train()
        train = place_train(parts)
        t_boxes, t_max = train_collision(list(train))
    else:                                                   # layout preview without the converted train
        print('[yard] train GLBs missing: using a placeholder hull')
        t_boxes, t_max = [[-1.6, G, TRAIN_SHIFT - 140.7, 1.6, 4.4, TRAIN_SHIFT + 8.0]], 4.4
    print('[yard] train collision', len(t_boxes), 'boxes, top', t_max)
    SOLID.extend(t_boxes)
    build_meshes()

    for o in bpy.data.objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = o.name.startswith(('engine', 'cart'))

    glb = os.path.join(OUT, 'railyard.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=False, export_yup=False,
                              export_apply=True, export_image_format='JPEG', export_jpeg_quality=88,
                              export_normals=True, export_texcoords=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False)
    print('[yard] glb', os.path.getsize(glb) // 1024, 'KB')
    data = {
        'id': 'railyard', 'title': 'Hadota Rail Yard', 'sector': 'SECTOR 09 / 09',
        'description': 'A rail yard at dusk. Freight train down the middle, roof lanes, container canyons and signal gantries.',
        'category': 'Large rail yard', 'supportedModes': ['ffa', 'tdm'], 'recommendedPlayers': [2, 6],
        'sky': '#e0a070', 'fog': '#c88a68', 'theme': 'railyard',
        'boxes': SOLID, 'spawns': spawn_list(), 'jumpPads': JUMPPADS, 'hazards': [], 'killY': -20.0,
        'barrels': BARRELS,
        'attribution': 'Train model and textures: HADOTA production assets.',
    }
    json.dump(data, open(os.path.join(OUT, 'railyard.json'), 'w'), separators=(',', ':'))
    print('[yard] boxes', len(SOLID), 'spawns', len(data['spawns']), 'pads', len(JUMPPADS))


main()
