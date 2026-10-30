"""Schoolyard: a two-storey Egyptian school courtyard with a locomotive halfway out of a tunnel.

The scanned school.fbx (Houdini metres: 1 raw unit = 1 m, the FBX header's cm flag is what makes
Blender show 0.01) was used as a layout guide only: courtyard ~31 x 35 m, ~11 m two-storey arcades,
a tunnel through the east wing. This script rebuilds a clean, game-ready version of it.

Run with Blender 5.x headless (needs assets/props/train/engine.glb from train_pipeline/convert_train.py):
  blender -b --python tools/map_pipeline/school.py

Writes assets/maps/processed/school.{glb,json}. Layout is in game space (metres, Y up): the
courtyard is centred on the origin, the track runs along X and the tunnel is in the east wing (+X).
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
TMP = os.environ.get('SCHOOL_TMP', os.path.join(HERE, '_tmp_school'))
os.makedirs(TMP, exist_ok=True)

G = -0.3                      # courtyard paving; rail heads sit at y = 0 where the locomotive wheels touch
CX, CZ = 15.5, 17.5           # courtyard half extents (the scan is ~31 x 35 m)
FACE, WALK, BACK = 0.7, 2.6, 2.2          # wing depth: arcade face wall, covered walkway, classroom mass
H1 = 5.4                      # ground floor clear height (the locomotive is 4.7 m tall)
H2 = H1 + 0.4                 # upper gallery floor
H_TOP = 10.3                  # underside of the cornice
ROOF = 10.8
SPRING_LO, SPRING_HI = 2.3, 2.0
PIER = 0.9
STEP_N = 24
SEED = 20261030

rnd = random.Random(SEED)
SOLID = []
VIS = defaultdict(list)       # kind -> [(box, tile, bottom)]
QUADS = defaultdict(list)     # kind -> [(pts, tile, facing)]
BARRELS = []
TREES = []


def r2(v):
    return round(float(v), 2)


def B(x0, y0, z0, x1, y1, z1, tex, solid=True, tile=3.0, bottom=None):
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


def S(*a, **k):
    """Collision only."""
    x0, y0, z0, x1, y1, z1 = a[:6]
    x0, x1 = sorted((x0, x1)); y0, y1 = sorted((y0, y1)); z0, z1 = sorted((z0, z1))
    if x1 - x0 > 1e-3 and y1 - y0 > 1e-3 and z1 - z0 > 1e-3:
        SOLID.append([r2(x0), r2(y0), r2(z0), r2(x1), r2(y1), r2(z1)])


def quad(kind, pts, facing, tile=3.0):
    QUADS[kind].append((pts, tile, facing))


# ---------------------------------------------------------------------------------------
# wing frames: local (s along the wing, y, d outward from the courtyard face) -> world
# ---------------------------------------------------------------------------------------
class Wing:
    def __init__(self, name, origin, u, o):
        self.name, self.org, self.u, self.o = name, origin, u, o

    def w(self, s, y, d):
        return (self.org[0] + self.u[0] * s + self.o[0] * d, y, self.org[1] + self.u[1] * s + self.o[1] * d)

    def inward(self):
        return (-self.o[0], 0.0, -self.o[1])

    def outward(self):
        return (self.o[0], 0.0, self.o[1])

    def box(self, s0, s1, y0, y1, d0, d1, tex=None, solid=True, tile=3.0):
        a, b = self.w(s0, y0, d0), self.w(s1, y1, d1)
        if tex:
            B(a[0], a[1], a[2], b[0], b[1], b[2], tex, solid=solid, tile=tile)
        else:
            S(a[0], a[1], a[2], b[0], b[1], b[2])


WINGS = {
    'S': Wing('S', (0.0, CZ), (1.0, 0.0), (0.0, 1.0)),
    'N': Wing('N', (0.0, -CZ), (-1.0, 0.0), (0.0, -1.0)),
    'E': Wing('E', (CX, 0.0), (0.0, 1.0), (1.0, 0.0)),
    'W': Wing('W', (-CX, 0.0), (0.0, -1.0), (-1.0, 0.0)),
}


def bays_for(wing):
    """[(centre_s, pitch, kind)] along a wing."""
    if wing in ('S', 'N'):
        n = 8
        p = 2 * CX / n
        return [(-CX + p * (i + 0.5), p, 'arch') for i in range(n)]
    if wing == 'W':
        n = 9
        p = 2 * CZ / n
        return [(-CZ + p * (i + 0.5), p, 'arch') for i in range(n)]
    portal = 5.6
    p = (2 * CZ - portal) / 8
    out = []
    for i in range(9):
        if i == 4:
            out.append((0.0, portal, 'portal'))
        else:
            k = i if i < 4 else i - 1
            lo = -CZ + p * k if i < 4 else portal / 2 + p * (i - 5)
            out.append((lo + p / 2, p, 'arch'))
    return out


def arch_curve(wo, spring, rise_k=0.742, n=10):
    """Pointed arch: two arcs of radius 0.8 w meeting at the apex. Returns [(s, dy)] left to right."""
    r = 0.8 * wo
    pts = []
    for i in range(2 * n + 1):
        s = -wo / 2 + wo * i / (2 * n)
        cx = (-wo / 2 + r) if s <= 0 else (wo / 2 - r)
        dy = math.sqrt(max(r * r - (s - cx) ** 2, 0.0))
        pts.append((s, dy))
    # arcs start vertical at the springing line, dy at the ends = 0 relative to spring
    return [(s, spring + dy - 0.0) for s, dy in pts]


def face_level(wing, y_base, y_top, spring, bay, floor_kind):
    """The arcade face wall of one bay on one level, as a textured mesh with a pointed arch opening."""
    sc, pitch, kind = bay
    w = WINGS[wing]
    T = FACE
    ins, outv = w.inward(), w.outward()
    s0, s1 = sc - pitch / 2, sc + pitch / 2
    if kind == 'portal':
        wo = 4.2
        top = 4.95
        pts = [(sc - wo / 2, top), (sc + wo / 2, top)]
        # flat head: wall above, piers either side, no arch
        for (a, b, ya, yb) in ((s0, sc - wo / 2, y_base, y_top), (sc + wo / 2, s1, y_base, y_top), (sc - wo / 2, sc + wo / 2, top, y_top)):
            for d, f in ((0.0, ins), (T, outv)):
                quad('plaster', [w.w(a, ya, d), w.w(b, ya, d), w.w(b, yb, d), w.w(a, yb, d)], f)
        for s, f in ((sc - wo / 2, w.u), (sc + wo / 2, tuple(-c for c in w.u))):
            f3 = (f[0], 0.0, f[1])
            quad('stone', [w.w(s, y_base, 0.0), w.w(s, y_base, T), w.w(s, top, T), w.w(s, top, 0.0)], f3)
        quad('stone', [w.w(sc - wo / 2, top, 0.0), w.w(sc + wo / 2, top, 0.0), w.w(sc + wo / 2, top, T), w.w(sc - wo / 2, top, T)], (0, -1, 0))
        return
    wo = pitch - PIER
    crv = arch_curve(wo, spring)
    # silhouette samples across the whole pitch: pier, arch, pier
    cols = [(sc - pitch / 2, None)] + [(sc + s, y_base + yy) for s, yy in crv] + [(sc + pitch / 2, None)]
    for i in range(len(cols) - 1):
        a, ya = cols[i]
        b, yb = cols[i + 1]
        if ya is None and yb is None:
            continue
        if ya is None:                      # left pier strip up to the first arch sample
            a2, ya2 = sc - wo / 2, y_base
            for d, f in ((0.0, ins), (T, outv)):
                quad('plaster', [w.w(a, y_base, d), w.w(a2, y_base, d), w.w(a2, y_top, d), w.w(a, y_top, d)], f)
            continue
        if yb is None:
            for d, f in ((0.0, ins), (T, outv)):
                quad('plaster', [w.w(a, y_base, d), w.w(b, y_base, d), w.w(b, y_top, d), w.w(a, y_top, d)], f)
            continue
        for d, f in ((0.0, ins), (T, outv)):
            quad('plaster', [w.w(a, ya, d), w.w(b, yb, d), w.w(b, y_top, d), w.w(a, y_top, d)], f)
        quad('stone', [w.w(a, ya, 0.0), w.w(b, yb, 0.0), w.w(b, yb, T), w.w(a, ya, T)], (0, -1, 0))
        # arch trim band on the courtyard side, proud of the wall
        quad('stone', [w.w(a, ya, -0.06), w.w(b, yb, -0.06), w.w(b, yb + 0.26, -0.06), w.w(a, ya + 0.26, -0.06)], ins)
    for sgn in (-1, 1):
        s = sc + sgn * wo / 2
        f = w.u if sgn < 0 else tuple(-c for c in w.u)
        f3 = (f[0], 0.0, f[1])
        quad('stone', [w.w(s, y_base, 0.0), w.w(s, y_base, T), w.w(s, y_base + spring, T), w.w(s, y_base + spring, 0.0)], f3)
        s2 = s + sgn * 0.26
        quad('stone', [w.w(s, y_base, -0.06), w.w(s2, y_base, -0.06), w.w(s2, y_base + spring, -0.06), w.w(s, y_base + spring, -0.06)], ins)


def wing_collision(wing):
    """Face-wall collision: pier boxes, lintels over the arches and gallery railings."""
    w = WINGS[wing]
    for sc, pitch, kind in bays_for(wing):
        s0, s1 = sc - pitch / 2, sc + pitch / 2
        if kind == 'portal':
            wo = 4.2
            w.box(s0, sc - wo / 2, G, H2, 0.0, FACE)
            w.box(sc + wo / 2, s1, G, H2, 0.0, FACE)
            w.box(sc - wo / 2, sc + wo / 2, 4.95, H2, 0.0, FACE)
            w.box(s0, s1, H2, H_TOP, 0.0, FACE)             # gallery wall above the portal
            continue
        wo = pitch - PIER
        ap_lo = SPRING_LO + 0.742 * wo
        ap_hi = SPRING_HI + 0.742 * wo
        w.box(s0, sc - wo / 2, G, H1, 0.0, FACE)
        w.box(sc + wo / 2, s1, G, H1, 0.0, FACE)
        w.box(s0, s1, G + ap_lo, H1, 0.0, FACE)
        w.box(s0, sc - wo / 2, H1, H_TOP, 0.0, FACE)
        w.box(sc + wo / 2, s1, H1, H_TOP, 0.0, FACE)
        w.box(s0, s1, H2 + ap_hi, H_TOP, 0.0, FACE)
        if (wing, sc) not in LANDINGS:
            w.box(sc - wo / 2, sc + wo / 2, H2, H2 + 1.5, 0.0, 0.12)     # gallery railing (visual 1.05 m, collision 1.5 m)
    # end piers where the face wall turns the corner
    if wing in ('S', 'N'):
        w.box(-CX - FACE, -CX, G, H_TOP, 0.0, FACE)
        w.box(CX, CX + FACE, G, H_TOP, 0.0, FACE)


LANDINGS = set()


def gallery_railings(wing):
    w = WINGS[wing]
    for sc, pitch, kind in bays_for(wing):
        if kind != 'arch' or (wing, sc) in LANDINGS:
            continue
        wo = pitch - PIER
        x0, x1 = sc - wo / 2 + 0.05, sc + wo / 2 - 0.05
        w.box(x0, x1, H2 + 0.95, H2 + 1.05, 0.12, 0.2, 'metal_dark', solid=False)
        w.box(x0, x1, H2 + 0.12, H2 + 0.2, 0.12, 0.2, 'metal_dark', solid=False)
        n = max(2, int((x1 - x0) / 0.18))
        for i in range(n + 1):
            s = x0 + (x1 - x0) * i / n
            w.box(s - 0.015, s + 0.015, H2 + 0.2, H2 + 0.95, 0.14, 0.18, 'metal_dark', solid=False)


def wing_dressing(wing):
    """Faces, bands, doors, windows, cornice and crenellated parapet of one wing."""
    w = WINGS[wing]
    bays = bays_for(wing)
    for bay in bays:
        face_level(wing, G, H1, SPRING_LO, bay, 'lo')
        face_level(wing, H2, H_TOP, SPRING_HI, bay, 'hi')
        sc, pitch, kind = bay
        s0, s1 = sc - pitch / 2, sc + pitch / 2
        # pink dado on the ground-floor piers
        if kind == 'arch':
            wo = pitch - PIER
            w.box(s0, sc - wo / 2, G, 1.5, -0.04, 0.0, 'plaster_pink', solid=False)
            w.box(sc + wo / 2, s1, G, 1.5, -0.04, 0.0, 'plaster_pink', solid=False)
    L = 15.5 if wing in ('S', 'N') else CZ
    ext = 21.0 if wing in ('S', 'N') else CZ
    # floor band, cornice, parapet with merlons (S/N run the full width to the outer corners)
    a, b = (-ext, ext)
    w.box(a, b, H1, H2, -0.12, 0.0, 'stone', solid=False)
    w.box(a, b, H_TOP, H_TOP + 0.5, -0.3, FACE + 4.8, 'stone', solid=False)
    w.box(a, b, ROOF, ROOF + 0.8, 0.0, 0.35, 'plaster', solid=False)
    n = int((b - a) / 1.1)
    for i in range(n):
        s = a + (i + 0.5) * (b - a) / n
        w.box(s - 0.3, s + 0.3, ROOF + 0.8, ROOF + 1.35, 0.05, 0.3, 'stone', solid=False, tile=1.0)
    # back wall of the walkway: doors and shuttered windows on both floors
    d_back = FACE + WALK
    for level, yb in (('lo', G), ('hi', H2)):
        yb0 = yb
        for idx, (sc, pitch, kind) in enumerate(bays):
            if kind != 'arch':
                continue
            if wing == 'E' and abs(sc) < 3.6 and level == 'lo':
                continue
            if idx % 2 == 0:
                w.box(sc - 0.62, sc + 0.62, yb0, yb0 + 2.55, d_back - 0.08, d_back, 'stone', solid=False)
                w.box(sc - 0.5, sc + 0.5, yb0, yb0 + 2.45, d_back - 0.12, d_back - 0.08, 'wood', solid=False, tile=1.5)
                w.box(sc - 0.5, sc + 0.5, yb0 + 2.45, yb0 + 2.55, d_back - 0.12, d_back - 0.08, 'dark', solid=False)
                w.box(sc + 0.32, sc + 0.4, yb0 + 1.0, yb0 + 1.1, d_back - 0.16, d_back - 0.12, 'steel', solid=False, tile=0.3)
            else:
                w.box(sc - 0.62, sc + 0.62, yb0 + 1.15, yb0 + 3.35, d_back - 0.08, d_back, 'stone', solid=False)
                w.box(sc - 0.5, sc + 0.5, yb0 + 1.25, yb0 + 3.25, d_back - 0.11, d_back - 0.08, 'glass', solid=False, tile=1.0)
                for sg in (-1, 1):
                    w.box(sc + sg * 0.5, sc + sg * 0.88, yb0 + 1.25, yb0 + 3.25, d_back - 0.16, d_back - 0.11, 'wood', solid=False, tile=1.5)
    # dado on the back wall
    w.box(-ext, ext, G, 1.5, d_back - 0.04, d_back, 'plaster_pink', solid=False)


def building_masses():
    """Solid mass of the school: back walls, upper gallery slab, roof and the tunnel."""
    ow = CX + FACE + WALK + BACK                    # 21.0
    od = CZ + FACE + WALK + BACK                    # 23.0
    wx = CX + FACE + WALK
    wz = CZ + FACE + WALK
    # back walls / classroom mass (visual: plaster, walkway-side faces get the dado and doors elsewhere)
    B(-ow, G, wz, ow, ROOF, od, 'plaster', tile=3.0)
    B(-ow, G, -od, ow, ROOF, -wz, 'plaster', tile=3.0)
    B(-ow, G, -wz, -wx, ROOF, wz, 'plaster', tile=3.0)
    B(wx, G, -wz, ow, ROOF, -3.0, 'plaster', tile=3.0)
    B(wx, G, 3.0, ow, ROOF, wz, 'plaster', tile=3.0)
    B(wx, H1, -3.0, ow, ROOF, 3.0, 'plaster', tile=3.0)         # above the tunnel inside the east back wall
    # upper gallery floor (ring) and the ring ceiling is the roof slab
    inner_x, inner_z = CX, CZ
    for (x0, z0, x1, z1) in ((-wx, inner_z, wx, wz), (-wx, -wz, wx, -inner_z), (inner_x, -wz, wx, wz), (-wx, -wz, -inner_x, wz)):
        B(x0, H1, z0, x1, H2, z1, 'stone', tile=3.0)
    # roof slab over everything
    for (x0, z0, x1, z1) in ((-ow, CZ, ow, od), (-ow, -od, ow, -CZ), (CX, -CZ, ow, CZ), (-ow, -CZ, -CX, CZ)):
        S(x0, H_TOP, z0, x1, ROOF, z1)
    for (x0, z0, x1, z1) in ((-ow, CZ, ow, od), (-ow, -od, ow, -CZ), (CX, -CZ, ow, CZ), (-ow, -CZ, -CX, CZ)):
        V(x0, H_TOP, z0, x1, ROOF, z1, 'stone', tile=3.0)
    # ring floor (ground): flagstone
    for (x0, z0, x1, z1) in ((-wx, inner_z, wx, wz), (-wx, -wz, wx, -inner_z), (inner_x, -wz, wx, wz), (-wx, -wz, -inner_x, wz)):
        V(x0, G, z0, x1, G + 0.006, z1, 'stone', tile=2.5, bottom=False)
    # corner towers (visual only, above the roof)
    for sx, sz in ((1, 1), (-1, -1)):
        x0, x1 = sorted((sx * (CX + FACE + 0.3), sx * ow))
        z0, z1 = sorted((sz * (CZ + FACE + 0.3), sz * od))
        V(x0, ROOF, z0, x1, ROOF + 3.0, z1, 'plaster', tile=3.0)
        V(x0 - 0.15, ROOF + 3.0, z0 - 0.15, x1 + 0.15, ROOF + 3.35, z1 + 0.15, 'stone')
        for i in range(4):
            for j in range(4):
                if i in (0, 3) or j in (0, 3):
                    mx = x0 - 0.15 + (x1 - x0 + 0.3) * (i + 0.5) / 4
                    mz = z0 - 0.15 + (z1 - z0 + 0.3) * (j + 0.5) / 4
                    V(mx - 0.3, ROOF + 3.35, mz - 0.3, mx + 0.3, ROOF + 3.9, mz + 0.3, 'stone', tile=1.0)


def tunnel():
    """Portal frame, lining, floor and the track bed running east through the wing."""
    wx = CX + FACE + WALK
    ow = wx + BACK
    top = 4.95
    # portal surround on the courtyard face
    V(CX - 0.14, G, -2.5, CX, top + 0.55, -2.1, 'stone')
    V(CX - 0.14, G, 2.1, CX, top + 0.55, 2.5, 'stone')
    V(CX - 0.14, top, -2.5, CX, top + 0.55, 2.5, 'stone')
    V(CX - 0.22, top + 0.35, -0.35, CX, top + 0.8, 0.35, 'stone')           # keystone
    # lining: dark soot concrete, narrower than the portal so the blockers read as walls
    L = 38.0
    B(CX, G, -3.0, L, top + 0.5, -1.75, 'tunnel', tile=2.5)
    B(CX, G, 1.75, L, top + 0.5, 3.0, 'tunnel', tile=2.5)
    B(CX, top, -3.0, L, top + 0.5, 3.0, 'tunnel', tile=2.5)
    V(L - 0.01, G, -3.0, L, top + 0.5, 3.0, 'dark')                       # black end of the tunnel
    # soot on the floor of the mouth
    V(CX, G + 0.004, -2.1, CX + 6, G + 0.008, 2.1, 'dark', bottom=False)


def track():
    x_a, x_b = -8.3, 38.0
    V(x_a - 0.5, G, -1.85, x_b, G + 0.1, 1.85, 'gravel', tile=2.0, bottom=False)
    n = int((x_b - x_a) / 0.65)
    for i in range(n):
        x = x_a + 0.2 + i * 0.65
        V(x - 0.13, G + 0.08, -1.3, x + 0.13, G + 0.17, 1.3, 'sleeper', tile=1.0)
    for z in (-0.7175, 0.7175):
        V(x_a, G + 0.17, z - 0.04, x_b, 0.0, z + 0.04, 'steel', tile=1.0)
        V(x_a, -0.02, z - 0.07, x_b, 0.0, z + 0.07, 'steel', tile=1.0)
    # buffer stop at the west end of the siding
    B(x_a - 0.9, G, -1.2, x_a - 0.2, 0.9, 1.2, 'redpaint', tile=1.0)
    B(x_a - 0.35, 0.5, -1.2, x_a - 0.2, 0.9, 1.2, 'redpaint', tile=1.0)
    for z in (-0.9, 0.9):
        V(x_a - 0.5, G, z - 0.05, x_a - 0.2, 0.55, z + 0.05, 'steel', tile=0.5)
    # ballast spilling onto the paving
    for _ in range(60):
        x = rnd.uniform(x_a + 3, 14.5)
        z = rnd.choice((-1, 1)) * rnd.uniform(1.9, 3.3)
        s = rnd.uniform(0.12, 0.35)
        V(x, G, z, x + s, G + rnd.uniform(0.04, 0.12), z + s, 'gravel', tile=1.0, bottom=False)


def ground():
    B(-60, -4.0, -60, 60, G, 60, 'asphalt', tile=6.0, bottom=False)
    V(-CX, G, -CZ, CX, G + 0.004, CZ, 'paving', tile=2.4, bottom=False)
    # faint court markings near the hoop
    for (x0, z0, x1, z1) in ((-13.5, -11, -7.5, -10.9), (-13.5, -4.1, -7.5, -4.0), (-13.5, -11, -13.4, -4.0), (-7.6, -11, -7.5, -4.0)):
        V(x0, G + 0.004, z0, x1, G + 0.008, z1, 'whitewash', tile=1.0, bottom=False)


def stair(wing_name, landing_s, forward_sign, run_axis):
    """Straight flight in the courtyard against a wing face, landing in front of an upper arch bay."""
    w = WINGS[wing_name]
    ins = w.inward()
    sc, pitch, kind = next(b for b in bays_for(wing_name) if abs(b[0] - landing_s) < 1e-6)
    wo = pitch - PIER
    LANDINGS.add((wing_name, sc))
    # landing block: width of the opening, 2.4 m into the courtyard, up to the gallery floor
    w.box(sc - wo / 2, sc + wo / 2, G, H2, -2.4, 0.0, 'stone', tile=2.0)
    # steps run along the wall: forward_sign picks the direction along s (away from the landing)
    run = STEP_N * 0.3
    rise = (H2 - G) / STEP_N
    for i in range(1, STEP_N + 1):
        if forward_sign > 0:
            a = sc + wo / 2 + (i - 1) * 0.3
            b = a + 0.3
        else:
            b = sc - wo / 2 - (i - 1) * 0.3
            a = b - 0.3
        top = H2 - i * rise
        w.box(a, b, G, top, -2.4, 0.0, 'concrete', tile=1.2)
    # stringer wall and handrail on the open side
    s_far = sc + wo / 2 + run if forward_sign > 0 else sc - wo / 2 - run
    s_near = sc + wo / 2 if forward_sign > 0 else sc - wo / 2
    a, b = sorted((s_near, s_far))
    # rail follows the slope as a sequence of posts and a sloped bar built from short boxes
    for i in range(0, STEP_N + 1, 2):
        if forward_sign > 0:
            s = sc + wo / 2 + i * 0.3
        else:
            s = sc - wo / 2 - i * 0.3
        y = H2 - i * rise
        w.box(s - 0.025, s + 0.025, y, y + 1.0, -2.4, -2.35, 'metal_dark', solid=False)
        w.box(s - 0.3, s + 0.3, y + 0.96, y + 1.04 - 0.0, -2.4, -2.35, 'metal_dark', solid=False)


def stairs():
    stair('S', next(b[0] for b in bays_for('S') if b[0] > 5 and b[0] < 6.5), +1, 'x')
    stair('N', next(b[0] for b in bays_for('N') if abs(b[0] - 5.8) < 0.5), +1, 'x')
    stair('W', min(b[0] for b in bays_for('W') if -12 < b[0] < -11), +1, 'z')
    stair('E', min(b[0] for b in bays_for('E') if -13 < b[0] < -11), +1, 'z')


def planter_tree(x, z, size=2.4):
    h = size / 2
    B(x - h, G, z - h, x + h, 0.6, z + h, 'stone', tile=1.5)
    B(x - h + 0.12, 0.6, z - h + 0.12, x + h - 0.12, 0.72, z + h - 0.12, 'tunnel', tile=1.0, solid=False)
    B(x - 0.18, 0.7, z - 0.18, x + 0.18, 3.1, z + 0.18, 'wood', tile=1.0)
    TREES.append((x, z))


def bench(x, z, along='x', length=2.0):
    if along == 'x':
        B(x - length / 2, G, z - 0.3, x + length / 2, 0.9, z + 0.3, 'wood', tile=1.0)
    else:
        B(x - 0.3, G, z - length / 2, x + 0.3, 0.9, z + length / 2, 'wood', tile=1.0)


def props():
    for x, z in ((-8.0, -9.0), (-8.0, 9.0), (3.5, -9.0), (3.5, 9.0)):
        planter_tree(x, z)
    # low concrete planter walls flanking the siding: chest-low cover, step-over for crouch routes
    for z in (-5.0, 5.0):
        B(-12.5, G, z - 0.45, -8.9, 0.95, z + 0.45, 'stone', tile=1.5)
    # benches against the arcade faces
    for x in (-9.0, -1.0):
        bench(x, CZ - 0.5)
    for x in (1.0, 9.0):
        bench(x, -CZ + 0.5)
    bench(-CX + 0.5, -3.0, 'z')
    bench(-CX + 0.5, -12.0, 'z', 1.6)
    bench(CX - 0.5, 6.0, 'z')
    # basketball hoop on a pole near the west wing
    B(-12.1, G, -8.0, -11.9, 3.0, -7.8, 'metal_dark', tile=1.0)
    V(-12.25, 3.0, -8.6, -12.15, 3.9, -7.2, 'whitewash', tile=1.0)
    V(-12.15, 3.2, -8.1, -11.6, 3.28, -7.9, 'redpaint', tile=1.0)
    # football goal frame in the east side of the courtyard
    for z in (4.9, 8.1):
        B(CX - 3.2 - 0.06, G, z - 0.06, CX - 3.2 + 0.06, 2.1, z + 0.06, 'whitewash', tile=1.0)
    V(CX - 3.26, 2.0, 4.9, CX - 3.14, 2.12, 8.1, 'whitewash', tile=1.0)
    # flag pole
    B(-13.55, G, -14.3, -13.45, 7.0, -14.2, 'steel', tile=1.0)
    V(-13.45, 6.0, -14.28, -11.95, 6.2, -14.22, 'redpaint', tile=1.0)
    V(-13.45, 5.8, -14.28, -11.95, 6.0, -14.22, 'whitewash', tile=1.0)
    V(-13.45, 5.6, -14.28, -11.95, 5.8, -14.22, 'metal_dark', tile=1.0)
    # signal post and oil drums near the tunnel mouth
    B(8.9, G, -2.7, 9.1, 3.2, -2.5, 'steel', tile=1.0)
    V(8.8, 2.6, -2.8, 9.2, 3.2, -2.4, 'redpaint', tile=1.0)
    for i, (x, z) in enumerate(((9.5, -4.5), (10.3, -4.8), (11.0, -4.3), (-6.0, 3.6))):
        BARRELS.append({'id': 'school_barrel_%d' % i, 'x': x, 'y': G, 'z': z, 'h': 1.1, 'r': 0.42, 'hp': 40, 'alive': True, 'color': 'barrelRust'})


# ---------------------------------------------------------------------------------------
# train
# ---------------------------------------------------------------------------------------
YUP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
TURN = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))    # game (x,y,z) -> (z, y, -x): nose points to -x
FRONT_X = 5.0                                                              # nose of the locomotive; the rest is inside the tunnel
ENGINE_MIN_Z = -140.664


def import_engine():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PROPS, 'engine.glb'))
    bpy.context.view_layer.update()
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    shift = FRONT_X - ENGINE_MIN_Z
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(TURN @ YUP @ mw)
        o.data.transform(Matrix.Translation((shift, 0.0, 0.0)))
        o.matrix_world = Matrix.Identity(4)
        o.data.update()
        o.name = 'engine_' + o.name.split('.')[0]
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def engine_collision(objs, cell_x=0.5, cell_z=0.4):
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    vs = np.array([v.co[:] for v in bm.verts])
    print('[school] engine bounds', vs.min(0).round(2), vs.max(0).round(2))
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    xs = np.arange(vs[:, 0].min() - 0.1, vs[:, 0].max() + 0.1, cell_x)
    zs = np.arange(-1.9, 1.9 + 1e-6, cell_z)
    H = np.zeros((len(xs), len(zs) - 1))
    for i, x in enumerate(xs):
        xc = x + cell_x / 2
        for j in range(len(zs) - 1):
            zc = (zs[j] + zs[j + 1]) / 2
            best = 0.0
            for dx in (-0.12, 0.0, 0.12):
                hit = bvh.ray_cast(Vector((xc + dx, 8.0, zc)), Vector((0, -1, 0)), 12.0)
                if hit[0] is not None:
                    best = max(best, 8.0 - hit[3])
            H[i, j] = best
    Hq = np.round(H / 0.1) * 0.1
    P = np.pad(Hq, 1, mode='edge')
    for i in range(Hq.shape[0]):
        for j in range(Hq.shape[1]):
            nb = max(P[i, j + 1], P[i + 2, j + 1], P[i + 1, j], P[i + 1, j + 2])
            if Hq[i, j] - nb > 0.45:
                Hq[i, j] = nb
    boxes = []
    for j in range(Hq.shape[1]):
        i = 0
        while i < Hq.shape[0]:
            h = Hq[i, j]
            if h < 0.3:
                i += 1
                continue
            k = i
            while k + 1 < Hq.shape[0] and abs(Hq[k + 1, j] - h) < 1e-6:
                k += 1
            boxes.append([r2(xs[i]), r2(G), r2(zs[j]), r2(xs[k] + cell_x), r2(h), r2(zs[j + 1])])
            i = k + 1
    return boxes, float(Hq.max())


# ---------------------------------------------------------------------------------------
# spawns
# ---------------------------------------------------------------------------------------
def face(x, z, tx=0.0, tz=0.0):
    return round(math.atan2(-(tx - x), -(tz - z)), 3)


def spawn_list():
    red, blue, free = [], [], []
    for x, z in ((-11.0, -13.0), (-5.0, -13.5), (1.0, -13.0), (7.0, -13.5), (-13.0, -9.0), (10.0, -9.5), (-2.5, -9.0), (12.5, -14.0)):
        red.append({'x': x, 'y': G, 'z': z, 'yaw': face(x, z), 'team': 'red'})
    for x, z in ((11.0, 13.0), (5.0, 13.5), (-1.0, 13.0), (-7.0, 13.5), (13.5, 10.5), (-10.0, 9.5), (-1.5, 9.0), (-12.5, 14.0)):
        blue.append({'x': x, 'y': G, 'z': z, 'yaw': face(x, z), 'team': 'blue'})
    for x, z, y in ((-8.0, 19.5, H2), (8.0, 19.5, H2), (-8.0, -19.5, H2), (8.0, -19.5, H2),
                    (-17.5, 6.0, H2), (-17.5, -6.0, H2), (17.5, 7.0, H2), (17.5, -7.0, H2),
                    (-17.5, 6.0, G), (17.5, -8.0, G), (-6.0, 19.5, G), (6.0, -19.5, G)):
        free.append({'x': x, 'y': y, 'z': z, 'yaw': face(x, z, 0.0, 0.0)})
    return red + blue + free


# ---------------------------------------------------------------------------------------
# meshes
# ---------------------------------------------------------------------------------------
EMISSIVE_KINDS = set()
METAL = {'steel': 0.7, 'metal_dark': 0.5}


def tex_image(kind):
    arr = textures.make(kind, 'school')
    n = arr.shape[0]
    img = bpy.data.images.new('t_' + kind, n, n, alpha=False)
    try:
        img.colorspace_settings.name = 'sRGB'
    except TypeError:
        img.colorspace_settings.name = 'Utility - sRGB - Texture'
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., :3] = arr
    img.pixels.foreach_set(rgba[::-1].ravel())
    path = os.path.join(TMP, 'school_%s.png' % kind)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return bpy.data.images.load(path)


def make_material(kind):
    m = bpy.data.materials.new('M_' + kind)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = tex_image(kind)
    t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9 if kind not in METAL else 0.45
    b.inputs['Metallic'].default_value = METAL.get(kind, 0.0)
    return m


def build_meshes():
    objs = []
    kinds = set(VIS) | set(QUADS)
    for kind in sorted(kinds):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.verify()
        for (x0, y0, z0, x1, y1, z1), tile, bottom in VIS.get(kind, []):
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
        for pts, tile, facing in QUADS.get(kind, []):
            P = [Vector(p) for p in pts]
            n = (P[1] - P[0]).cross(P[3] - P[0])
            if n.length < 1e-9:
                n = (P[2] - P[1]).cross(P[3] - P[1])
            if n.length < 1e-9:
                continue
            if Vector(facing).dot(n) < 0:
                P = P[::-1]
                n = -n
            try:
                f = bm.faces.new([bm.verts.new(p) for p in P])
            except ValueError:
                continue
            ax = max(range(3), key=lambda i: abs(n[i]))
            for lp in f.loops:
                p = lp.vert.co
                lp[uvl].uv = ((p.z, p.y) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y))
                lp[uvl].uv = (lp[uvl].uv[0] / tile, lp[uvl].uv[1] / tile)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces) if not QUADS.get(kind) else None
        me = bpy.data.meshes.new('school_' + kind)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new('school_' + kind, me)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(make_material(kind))
        objs.append(o)
    return objs


def foliage():
    """Low-poly orange-tree crowns (icospheres) on the planter trunks."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    for x, z in TREES:
        for dx, dy, dz, r in ((0, 3.6, 0, 1.45), (0.7, 3.1, 0.4, 1.0), (-0.6, 3.2, -0.5, 1.0), (0.1, 4.3, -0.2, 0.9)):
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r, matrix=Matrix.Translation((x + dx, dy, z + dz)))
    for f in bm.faces:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x * 0.5, lp.vert.co.y * 0.5)
    me = bpy.data.meshes.new('school_foliage')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('school_foliage', me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(make_material('leaf'))
    for p in me.polygons:
        p.use_smooth = True


def build_layout():
    ground()
    building_masses()
    stairs()
    for wn in 'SNEW':
        wing_dressing(wn)
    for wn in 'SNEW':
        wing_collision(wn)
        gallery_railings(wn)
    tunnel()
    track()
    props()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_layout()
    engine_ok = os.path.exists(os.path.join(PROPS, 'engine.glb'))
    if engine_ok:
        parts = import_engine()
        t_boxes, t_max = engine_collision(parts)
    else:
        print('[school] engine.glb missing: placeholder hull')
        t_boxes, t_max = [[FRONT_X, G, -1.6, FRONT_X + 20.9, 4.7, 1.6]], 4.7
    print('[school] engine collision', len(t_boxes), 'boxes, top', t_max)
    SOLID.extend(t_boxes)
    build_meshes()
    foliage()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = o.name.startswith(('engine', 'school_foliage'))

    glb = os.path.join(OUT, 'school.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=False, export_yup=False,
                              export_apply=True, export_image_format='JPEG', export_jpeg_quality=88,
                              export_normals=True, export_texcoords=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False)
    print('[school] glb', os.path.getsize(glb) // 1024, 'KB')
    data = {
        'id': 'school', 'title': 'Schoolyard', 'sector': 'SECTOR 10 / 10',
        'description': 'An Egyptian school courtyard in full sun. Two storeys of pointed arcades, a gallery ring, and a diesel locomotive halfway out of a tunnel.',
        'category': 'Courtyard arena', 'supportedModes': ['ffa', 'tdm'], 'recommendedPlayers': [2, 6],
        'sky': '#8cc4ec', 'fog': '#cfe2ea', 'theme': 'school',
        'boxes': SOLID, 'spawns': spawn_list(), 'jumpPads': [], 'hazards': [], 'killY': -20.0,
        'barrels': BARRELS,
        'attribution': 'Layout from the supplied school scan; locomotive and rail textures: HADOTA production assets.',
    }
    json.dump(data, open(os.path.join(OUT, 'school.json'), 'w'), separators=(',', ':'))
    print('[school] boxes', len(SOLID), 'spawns', len(data['spawns']))


main()
