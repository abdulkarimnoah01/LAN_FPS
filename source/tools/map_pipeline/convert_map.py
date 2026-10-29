"""MAPFORGE converter: Xonotic/Quake .map -> LAN_FPS collision JSON + GLB.

Run headless:  blender -b --python convert_map.py -- foundry glowplant zenith
(also runs without Blender: it then only writes the JSON).

Coordinates: game_x = q_x, game_y = q_z, game_z = -q_y, scaled by SCALE.
SCALE 0.025 m/unit is the Xonotic player ratio (72-unit hull = 1.8 m), which also
matches this game's gravity (800 u/s^2 = 20 m/s^2) and jump height.
"""
import sys
import os
import re
import math
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import bpy
    import bmesh
    HAS_BPY = True
except ImportError:
    HAS_BPY = False

SCALE = 0.025
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'maps', 'sources'))
PROCESSED = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'maps', 'processed'))

# Player (must match src/sim.js)
PR, PH, GRAVITY = 0.35, 1.8, 20.0

NUM = r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?'
TRIPLE = re.compile(r'\(\s*(' + NUM + r')\s+(' + NUM + r')\s+(' + NUM + r')\s*\)')

# Textures that never block the player or the eye.
NONSOLID_TEX = ('common/trigger', 'common/origin', 'common/nodrawnonsolid', 'common/weapclip', 'common/lightgrid',
                'common/hint', 'common/skip', 'common/areaportal', 'common/botclip', 'common/cluster',
                'common/donotenter', 'common/translucent', 'liquids/')
# Faces that are never drawn.
HIDDEN_TEX = ('common/caulk', 'common/clip', 'common/nodraw', 'common/hint', 'common/skip', 'common/trigger',
              'common/origin', 'common/weapclip', 'common/botclip', 'common/nodrawnonsolid', 'skies/', 'common/sky')
LIQUID = ('lava', 'slime', 'plasma', 'water')


def parse_map(filepath):
    """Brace-depth parser. Patch (curved surface) and other non-planar blocks are skipped
    without disturbing the entity they sit in."""
    with open(filepath, 'r', encoding='latin1') as f:
        lines = f.read().splitlines()

    entities = []
    ent = None
    blk = None
    depth = 0
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        if line == '{':
            depth += 1
            if depth == 1:
                ent = {'properties': {}, 'brushes': []}
            elif depth == 2:
                blk = []
            continue
        if line == '}':
            if depth == 2 and blk is not None:
                text = '\n'.join(blk)
                if 'patchDef' not in text:
                    planes = parse_planes(blk)
                    if len(planes) >= 4:
                        ent['brushes'].append({'planes': planes})
                blk = None
            elif depth == 1 and ent is not None:
                entities.append(ent)
                ent = None
            depth = max(0, depth - 1)
            continue
        if depth == 1:
            m = re.match(r'^"([^"]+)"\s+"([^"]*)"', line)
            if m:
                ent['properties'][m.group(1)] = m.group(2)
        elif depth >= 2 and blk is not None:
            blk.append(line)
    return entities


def parse_planes(block_lines):
    planes = []
    for line in block_lines:
        pts = TRIPLE.findall(line)
        if len(pts) < 3:
            continue
        p1, p2, p3 = (np.array([float(x) for x in t]) for t in pts[:3])
        rest = line[line.rfind(')') + 1:].strip()
        tex = rest.split()[0] if rest else 'default'
        n = np.cross(p3 - p1, p2 - p1)
        norm = np.linalg.norm(n)
        if norm < 1e-6:
            continue
        n = n / norm
        planes.append({'n': n, 'd': float(np.dot(n, p1)), 'tex': tex.lower().strip('"')})
    return planes


def solve_brush(planes, eps=0.15):
    """Vertices and polygon faces of the convex brush defined by its planes."""
    M = len(planes)
    if M < 4:
        return None, None
    normals = np.array([p['n'] for p in planes])
    distances = np.array([p['d'] for p in planes])

    verts = []
    for i in range(M):
        for j in range(i + 1, M):
            for k in range(j + 1, M):
                A = np.vstack([normals[i], normals[j], normals[k]])
                if abs(np.linalg.det(A)) < 1e-4:
                    continue
                try:
                    pt = np.linalg.solve(A, [distances[i], distances[j], distances[k]])
                except np.linalg.LinAlgError:
                    continue
                if np.all(normals @ pt - distances <= eps):
                    verts.append(pt)
    if len(verts) < 4:
        return None, None

    uverts = []
    for v in verts:
        if not any(np.linalg.norm(v - u) < 0.1 for u in uverts):
            uverts.append(v)
    if len(uverts) < 4:
        return None, None
    uverts = np.array(uverts)

    faces = []
    for p in planes:
        n, d = p['n'], p['d']
        on_plane = [v for v in uverts if abs(np.dot(n, v) - d) < 0.25]
        if len(on_plane) < 3:
            continue
        ref = np.array([0, 0, 1.0]) if abs(n[2]) < 0.9 else np.array([0, 1.0, 0])
        u_axis = np.cross(n, ref)
        u_axis /= np.linalg.norm(u_axis)
        v_axis = np.cross(n, u_axis)
        center = np.mean(on_plane, axis=0)
        ordered = sorted(on_plane, key=lambda pt: math.atan2(np.dot(pt - center, v_axis), np.dot(pt - center, u_axis)))
        faces.append({'n': n, 'd': d, 'tex': p['tex'], 'pts': ordered})
    return uverts, faces


def brush_volume(faces, centroid):
    vol = 0.0
    for f in faces:
        pts = f['pts']
        area = 0.0
        for i in range(1, len(pts) - 1):
            area += np.linalg.norm(np.cross(pts[i] - pts[0], pts[i + 1] - pts[0])) / 2
        vol += area * max(0.0, f['d'] - np.dot(f['n'], centroid)) / 3
    return vol


def column_boxes(planes_g, bmin, bmax, cell):
    """Approximate a convex solid (planes in game space) by merged vertical columns,
    so ramps become walkable stairs instead of one solid block."""
    nx = max(1, int(math.ceil((bmax[0] - bmin[0]) / cell)))
    nz = max(1, int(math.ceil((bmax[2] - bmin[2]) / cell)))
    cx = (bmax[0] - bmin[0]) / nx
    cz = (bmax[2] - bmin[2]) / nz
    vert = [(n, d) for n, d in planes_g if abs(n[1]) < 1e-4]
    up = [(n, d) for n, d in planes_g if n[1] > 1e-4]
    dn = [(n, d) for n, d in planes_g if n[1] < -1e-4]
    grid = [[None] * nx for _ in range(nz)]
    for iz in range(nz):
        z = bmin[2] + (iz + 0.5) * cz
        for ix in range(nx):
            x = bmin[0] + (ix + 0.5) * cx
            if any(n[0] * x + n[2] * z > d + 1e-6 for n, d in vert):
                continue
            top = min([(d - n[0] * x - n[2] * z) / n[1] for n, d in up], default=bmax[1])
            bot = max([(d - n[0] * x - n[2] * z) / n[1] for n, d in dn], default=bmin[1])
            if top - bot > 0.02:
                grid[iz][ix] = (round(top / 0.05) * 0.05, round(bot / 0.05) * 0.05)
    # merge along x, then across z
    runs = {}
    for iz in range(nz):
        ix = 0
        while ix < nx:
            h = grid[iz][ix]
            if h is None:
                ix += 1
                continue
            j = ix
            while j + 1 < nx and grid[iz][j + 1] == h:
                j += 1
            runs.setdefault((ix, j, h), []).append(iz)
            ix = j + 1
    out = []
    for (i0, i1, h), zs in runs.items():
        zs.sort()
        s = zs[0]
        prev = zs[0]
        for z in zs[1:] + [None]:
            if z is None or z != prev + 1:
                out.append([bmin[0] + i0 * cx, h[1], bmin[2] + s * cz,
                            bmin[0] + (i1 + 1) * cx, h[0], bmin[2] + (prev + 1) * cz])
                s = z
            prev = z if z is not None else prev
    return out


def drop_contained(boxes):
    """Remove duplicate boxes and boxes fully inside another."""
    if not boxes:
        return boxes
    a = np.array(boxes)
    a = np.unique(np.round(a, 3), axis=0)
    # biggest first so containers are tested against everything smaller
    vol = np.prod(a[:, 3:] - a[:, :3], axis=1)
    a = a[np.argsort(-vol)]
    keep = np.ones(len(a), dtype=bool)
    eps = 1e-3
    for i in range(len(a)):
        if not keep[i]:
            continue
        b = a[i]
        inside = np.all(a[i + 1:, :3] >= b[:3] - eps, axis=1) & np.all(a[i + 1:, 3:] <= b[3:] + eps, axis=1)
        keep[i + 1:] &= ~inside
    return a[keep].tolist()


def overlaps(b, x, y, z, h=PH):
    return x + PR > b[0] and x - PR < b[3] and y + h > b[1] and y < b[4] and z + PR > b[2] and z - PR < b[5]


def ground_spawn(boxes, x, y, z):
    """Put a spawn on the nearest floor at/below the entity origin with standing room."""
    cands = {}
    for b in boxes:
        if x + PR > b[0] and x - PR < b[3] and z + PR > b[2] and z - PR < b[5] and y - 3.0 <= b[4] <= y + 0.8:
            cands[round(b[4], 3)] = True
    for top in sorted(cands, reverse=True):
        for dx, dz in ((0, 0), (0.3, 0), (-0.3, 0), (0, 0.3), (0, -0.3), (0.3, 0.3), (-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3)):
            sx, sz = x + dx, z + dz
            sy = top + 0.01
            if any(overlaps(b, sx, sy, sz) for b in boxes):
                continue
            # the whole footprint must be supported
            ok = all(any(bb[0] <= sx + ox * (PR - 0.02) <= bb[3] and bb[2] <= sz + oz * (PR - 0.02) <= bb[5]
                         and abs(bb[4] - top) < 0.02 for bb in boxes) for ox in (-1, 1) for oz in (-1, 1))
            if ok:
                return sx, sy, sz
    return None


def push_velocity(start, target, height_units, g=GRAVITY):
    """Launch velocity so a player leaving 'start' lands on 'target' (Xonotic trigger_push)."""
    top = max(start[1], target[1]) + height_units * SCALE
    vy = math.sqrt(max(0.0, 2 * g * (top - start[1])))
    t = vy / g + math.sqrt(max(0.0, 2 * g * (top - target[1]))) / g
    return (target[0] - start[0]) / t, vy, (target[2] - start[2]) / t


def create_material(name, color, roughness=0.6, metallic=0.2, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        if emission and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (*emission[:3], 1.0)
            bsdf.inputs['Emission Strength'].default_value = emission[3] if len(emission) > 3 else 1.0
    return mat


MAPS = {
    'foundry': {'file': 'boil.map', 'title': 'Foundry Core', 'sector': 'SECTOR 06 / 08',
                'desc': 'Molten industrial smelting pit, high catwalks, and intense CQB crossfires.',
                'theme': 'foundry', 'sky': '#231b18', 'fog': '#2c221c',
                'cat': 'Compact industrial arena', 'modes': ['ffa', 'tdm'], 'players': [2, 6]},
    'glowplant': {'file': 'glowplant.map', 'title': 'Reactor Complex', 'sector': 'SECTOR 07 / 08',
                  'desc': 'Sub-orbital nuclear reactor facility with pulsating blue plasma cores and dual jump pads.',
                  'theme': 'reactor', 'sky': '#101e28', 'fog': '#152432',
                  'cat': 'Medium sci-fi facility', 'modes': ['tdm', 'ffa'], 'players': [4, 10]},
    'zenith': {'file': 'dance.map', 'title': 'Zenith Atrium', 'sector': 'SECTOR 08 / 08',
               'desc': 'High-altitude vertical multi-tier sky arena with velocity jump pads and vertigo sightlines.',
               'theme': 'zenith', 'sky': '#0e1c2b', 'fog': '#182d42',
               'cat': 'Vertical futuristic complex', 'modes': ['ffa', 'tdm'], 'players': [4, 12]},
}


def origin_of(e):
    return [float(x) for x in e['properties'].get('origin', '0 0 0').split()]


def convert_arena(map_key):
    info = MAPS[map_key]
    map_path = os.path.join(SOURCES, info['file'])
    os.makedirs(PROCESSED, exist_ok=True)
    print(f"\n[MAPFORGE] {map_key} ({info['title']}) from {map_path}")

    entities = parse_map(map_path)
    by_class = {}
    for e in entities:
        by_class.setdefault(e['properties'].get('classname', ''), []).append(e)

    solid_brushes = []
    for c in ('worldspawn', 'func_group', 'func_wall'):
        for e in by_class.get(c, []):
            solid_brushes.extend(e['brushes'])
    print(f"  entities {len(entities)}, solid brushes {len(solid_brushes)}")

    spawns_raw = [e for e in entities if e['properties'].get('classname', '').startswith('info_player_')
                  and e['properties'].get('classname') != 'info_player_start_unused']
    if not spawns_raw:
        raise SystemExit('no spawns')
    sp = np.array([origin_of(e) for e in spawns_raw])
    offset_x = (sp[:, 0].min() + sp[:, 0].max()) / 2
    offset_y = (sp[:, 1].min() + sp[:, 1].max()) / 2
    offset_z = sp[:, 2].min()

    def to_game(pt):
        return [float((pt[0] - offset_x) * SCALE), float((pt[2] - offset_z) * SCALE), float(-(pt[1] - offset_y) * SCALE)]

    solved = []
    for b in solid_brushes:
        texs = [p['tex'] for p in b['planes']]
        if any(t.startswith(NONSOLID_TEX) for t in texs):
            continue
        uverts, faces = solve_brush(b['planes'])
        if uverts is None or not faces:
            continue
        solved.append((uverts, faces, any(k in t for t in texs for k in ('lava', 'slime'))))
    print(f"  solved {len(solved)} convex solids")

    # ---- collision boxes
    boxes = []
    decomposed = 0
    liquids = []
    for uverts, faces, liquid in solved:
        g = np.array([to_game(v) for v in uverts])
        bmin, bmax = g.min(0), g.max(0)
        size = bmax - bmin
        if np.any(size < 0.02):
            continue
        if liquid:  # lava is not floor: it hurts instead
            liquids.append([round(float(v), 2) for v in [*bmin, *bmax]])
            continue
        centroid = uverts.mean(0)
        ratio = brush_volume(faces, centroid) / max(1e-9, float(np.prod(size / SCALE)))
        if ratio >= 0.8:
            boxes.append([*bmin.tolist(), *bmax.tolist()])
            continue
        planes_g = []
        for f in faces:
            ng = np.array([f['n'][0], f['n'][2], -f['n'][1]])
            pg = np.array(to_game(np.mean(f['pts'], axis=0)))
            planes_g.append((ng, float(np.dot(ng, pg))))
        cell = min(0.4, max(0.15, min(size[0], size[2]) / 3))
        while (size[0] / cell) * (size[2] / cell) > 6000:
            cell *= 1.5
        boxes.extend(column_boxes(planes_g, bmin, bmax, cell))
        decomposed += 1
    boxes = [[round(v, 3) for v in b] for b in boxes]
    boxes = drop_contained(boxes)
    boxes = [[round(v, 3) for v in b] for b in boxes]
    print(f"  collision boxes {len(boxes)} ({decomposed} sloped brushes decomposed)")

    # ---- spawns: ground each one, drop the ones that cannot stand
    spawns = []
    for e in spawns_raw:
        gx, gy, gz = to_game(origin_of(e))
        res = ground_spawn(boxes, gx, gy, gz)
        if not res:
            print(f"  dropped spawn at {gx:.1f},{gy:.1f},{gz:.1f}: no floor")
            continue
        ang = float(e['properties'].get('angle', 0))
        a = math.radians(ang)
        cls = e['properties'].get('classname')
        s = {'x': round(res[0], 2), 'y': round(res[1], 3), 'z': round(res[2], 2),
             'yaw': round(math.atan2(-math.cos(a), math.sin(a)), 3)}
        if cls == 'info_player_team1':
            s['team'] = 'red'
        elif cls == 'info_player_team2':
            s['team'] = 'blue'
        spawns.append(s)
    print(f"  spawns {len(spawns)}/{len(spawns_raw)} usable")

    # ---- jump pads
    jump_pads = []
    notnull = {}
    for c in ('target_position', 'info_notnull'):
        for e in by_class.get(c, []):
            notnull[e['properties'].get('targetname')] = e
    for e in by_class.get('trigger_push', []):
        tgt = notnull.get(e['properties'].get('target'))
        pts = []
        for b in e['brushes']:
            uv, fc = solve_brush(b['planes'])
            if uv is not None:
                pts.extend(to_game(v) for v in uv)
        if not pts or tgt is None:
            continue
        pts = np.array(pts)
        lo, hi = pts.min(0), pts.max(0)
        start = [(lo[0] + hi[0]) / 2, hi[1], (lo[2] + hi[2]) / 2]
        vx, vy, vz = push_velocity(start, to_game(origin_of(tgt)), float(e['properties'].get('height', 200)))
        pad = {'box': [round(float(lo[0]), 2), round(float(lo[1]), 2), round(float(lo[2]), 2),
                       round(float(hi[0]), 2), round(float(hi[1] + 0.3), 2), round(float(hi[2]), 2)],
               'vy': round(vy, 2)}
        if abs(vx) > 0.05:
            pad['vx'] = round(vx, 2)
        if abs(vz) > 0.05:
            pad['vz'] = round(vz, 2)
        jump_pads.append(pad)
    print(f"  jump pads {len(jump_pads)}")

    # ---- hurt volumes (lava / void)
    hazards = []
    for e in by_class.get('trigger_hurt', []):
        for b in e['brushes']:
            uv, fc = solve_brush(b['planes'])
            if uv is None:
                continue
            g = np.array([to_game(v) for v in uv])
            hazards.append([round(float(v), 2) for v in [*g.min(0), *g.max(0)]])

    hazards.extend(liquids)
    floor_min = min(s['y'] for s in spawns)
    kill_y = round(floor_min - 40.0, 1)

    # ---- barrels on open floor spots (map item positions), away from spawns
    rng = np.random.default_rng(42)
    item_pts = []
    for e in entities:
        c = e['properties'].get('classname', '')
        if c.startswith(('item_', 'weapon_')):
            gx, gy, gz = to_game(origin_of(e))
            r = ground_spawn(boxes, gx, gy, gz)
            if r and all(math.hypot(r[0] - s['x'], r[2] - s['z']) > 5 or abs(r[1] - s['y']) > 2.5 for s in spawns):
                item_pts.append(r)
    rng.shuffle(item_pts)
    barrels = []
    for i, r in enumerate(item_pts[:12]):
        barrels.append({'id': f'{map_key}_barrel_{i}', 'x': round(r[0] + 0.9, 2), 'y': round(r[1], 3), 'z': round(r[2], 2),
                        'h': 1.1, 'r': 0.42, 'hp': 40, 'alive': True, 'color': 'barrelRust' if i % 2 == 0 else 'barrelOlive'})
    barrels = [b for b in barrels if not any(overlaps(bb, b['x'], b['y'] + 0.02, b['z'], 1.0) for bb in boxes)]

    if HAS_BPY:
        lights = []
        for e in by_class.get('light', []):
            o = to_game(origin_of(e))
            cols = [float(c) for c in e['properties'].get('_color', '1 1 1').split()][:3]
            lights.append((tuple(o), float(e['properties'].get('light', 100)), tuple(cols) if len(cols) == 3 else (1, 1, 1)))
        build_glb(map_key, solved, to_game, hazards if map_key == 'foundry' else [], lights)

    metadata = {
        'id': map_key, 'title': info['title'], 'sector': info['sector'], 'description': info['desc'],
        'category': info['cat'], 'supportedModes': info['modes'], 'recommendedPlayers': info['players'],
        'sky': info['sky'], 'fog': info['fog'], 'theme': info['theme'],
        'boxes': boxes, 'spawns': spawns, 'jumpPads': jump_pads, 'hazards': hazards, 'killY': kill_y,
        'barrels': barrels, 'attribution': f"Based on {info['file']} from Xonotic (GPL-2.0-or-later).",
    }
    json_out = os.path.join(PROCESSED, f'{map_key}.json')
    with open(json_out, 'w') as f:
        json.dump(metadata, f, indent=1)
    print(f"  saved {json_out} ({os.path.getsize(json_out) / 1024:.1f} KB)")


LIGHT_SCALE = {'foundry': 45.0, 'glowplant': 7.0, 'zenith': 9.0}
AMBIENT = {'foundry': ((0.30, 0.19, 0.14), 0.55), 'glowplant': ((0.20, 0.36, 0.50), 0.45), 'zenith': ((0.30, 0.45, 0.75), 1.1)}
EMIT_STRENGTH = {'foundry': 3.0, 'glowplant': 3.5, 'zenith': 3.0}
MAX_EDGE = 1.6


def srgb_image(name, arr):
    """8-bit sRGB image (file backed) from an HxWx3 float array in 0..1."""
    import tempfile
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    # colour space and alpha mode must be set before the pixels: changing them later wipes the buffer
    img.colorspace_settings.name = 'sRGB'
    img.alpha_mode = 'NONE'
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())  # Blender stores rows bottom-up
    img.update()
    img.filepath_raw = os.path.join(tempfile.gettempdir(), f'mapforge_{name}.png')
    img.file_format = 'PNG'
    img.save()
    return img


def tex_material(name, img, emissive, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    node.interpolation = 'Linear'
    nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Metallic'].default_value = 0.0
    if emissive:
        nt.links.new(node.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def subdivide_long_edges(bm):
    for _ in range(6):
        edges = [e for e in bm.edges if e.calc_length() > MAX_EDGE]
        if not edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)


def assign_uvs(bm, tile=2.0):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in f.loops:
            p = loop.vert.co
            if ay >= ax and ay >= az:
                u, v = p.x, p.z
            elif ax >= az:
                u, v = p.z, p.y
            else:
                u, v = p.x, p.y
            loop[uv].uv = (u / tile, v / tile)


def build_glb(map_key, solved, to_game, lava_boxes=(), lights=()):
    import textures as T
    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene

    kinds = {}      # (kind, variant) -> material index
    mesh = bpy.data.meshes.new(f'Arena_{map_key}')
    emissive_idx = set()
    avg_color = {}

    def mat_index(kind, variant):
        key = (kind, variant)
        if key not in kinds:
            arr = T.make(kind, map_key, variant)
            img = srgb_image(f'T_{kind}{"_" + variant if variant else ""}', arr)
            emissive = kind in T.EMISSIVE
            name = ('E_' if emissive else 'M_') + kind + (('_' + variant) if variant else '')
            mesh.materials.append(tex_material(name, img, emissive, EMIT_STRENGTH[map_key]))
            avg_color[len(mesh.materials) - 1] = (np.clip(arr, 0, 1).reshape(-1, 3).mean(0) ** 2.2).tolist()
            kinds[key] = len(mesh.materials) - 1
            if emissive:
                emissive_idx.add(kinds[key])
        return kinds[key]

    bm = bmesh.new()
    count = 0
    for uverts, faces, _liquid in solved:
        for f in faces:
            tex = f['tex']
            if tex.startswith(HIDDEN_TEX):
                continue
            pts = [to_game(p) for p in f['pts']]
            gn = np.array([f['n'][0], f['n'][2], -f['n'][1]])
            a, b, c = (np.array(p) for p in pts[:3])
            if np.dot(np.cross(b - a, c - a), gn) < 0:
                pts.reverse()
            mi = mat_index(T.kind_of(tex), T.variant_of(tex))
            try:
                face = bm.faces.new([bm.verts.new(p) for p in pts])
                face.material_index = mi
                count += 1
            except ValueError:
                pass
    for lo_x, lo_y, lo_z, hi_x, hi_y, hi_z in lava_boxes:  # the lava surface is a curved patch in the source map
        y = hi_y - 0.15
        quad = [(lo_x, y, lo_z), (lo_x, y, hi_z), (hi_x, y, hi_z), (hi_x, y, lo_z)]
        if np.cross(np.subtract(quad[1], quad[0]), np.subtract(quad[2], quad[0]))[1] < 0:
            quad.reverse()
        face = bm.faces.new([bm.verts.new(p) for p in quad])
        face.material_index = mat_index('lava', None)
        count += 1
    bm.normal_update()
    subdivide_long_edges(bm)
    bm.normal_update()
    assign_uvs(bm)
    print(f'  mesh faces {count} -> {len(bm.faces)} after subdivision, {len(kinds)} materials')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(f'Map_{map_key}', mesh)
    bpy.context.collection.objects.link(obj)

    # ---- lighting: world ambient, entity lights, emissive panels, then bake into vertex colours
    amb, amb_strength = AMBIENT[map_key]
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*amb, 1.0)
    bg.inputs['Strength'].default_value = amb_strength
    scene.world = world
    k = LIGHT_SCALE[map_key]
    for (x, y, z), inten, col in lights:
        ld = bpy.data.lights.new('L', 'POINT')
        ld.energy = max(20.0, min(inten, 400.0)) * k
        ld.color = col
        ld.shadow_soft_size = 0.25
        lo = bpy.data.objects.new('L', ld)
        lo.location = (x, y, z)  # the scene is authored in game space (y is up) and exported untouched
        bpy.context.collection.objects.link(lo)
    if map_key == 'zenith':
        sd = bpy.data.lights.new('Sun', 'SUN')
        sd.energy = 2.5
        sd.color = (0.8, 0.88, 1.0)
        so = bpy.data.objects.new('Sun', sd)
        import mathutils
        so.rotation_euler = mathutils.Vector((0, 0, -1)).rotation_difference(mathutils.Vector((-0.45, -0.8, -0.35)).normalized()).to_euler()
        bpy.context.collection.objects.link(so)

    attr = mesh.color_attributes.new(name='Lit', type='FLOAT_COLOR', domain='POINT')
    mesh.color_attributes.active_color = attr
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = int(os.environ.get('BAKE_SAMPLES', '64'))
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if os.environ.get('SAVE_BLEND'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['SAVE_BLEND'])
    # Image textures confuse the vertex-colour bake (it yields black), so bake with flat stand-ins
    # that carry each material's average colour for bounce light, then put the textures back.
    textured = list(mesh.materials)
    for i, m in enumerate(textured):
        bm_mat = bpy.data.materials.new(f'bake_{i}')
        bm_mat.use_nodes = True
        bs = bm_mat.node_tree.nodes.get('Principled BSDF')
        r, g, b = avg_color[i]
        bs.inputs['Base Color'].default_value = (r, g, b, 1.0)
        bs.inputs['Roughness'].default_value = 0.8
        bs.inputs['Metallic'].default_value = 0.0
        if i in emissive_idx:
            bs.inputs['Emission Color'].default_value = (r, g, b, 1.0)
            bs.inputs['Emission Strength'].default_value = EMIT_STRENGTH[map_key]
        mesh.materials[i] = bm_mat
    res = bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS')
    print('  bake result', res)
    for i, m in enumerate(textured):
        mesh.materials[i] = m
    for ca in mesh.color_attributes:
        buf = np.zeros(len(ca.data) * 4, dtype=np.float32)
        ca.data.foreach_get('color', buf)
        print('   attr', ca.name, ca.domain, ca.data_type, 'max', float(buf.max()), 'active', mesh.color_attributes.active_color.name)

    # ---- grade the bake: floor the shadows, normalise exposure, keep emitters at full bright
    n = len(attr.data)
    col = np.zeros(n * 4, dtype=np.float32)
    attr.data.foreach_get('color', col)
    col = col.reshape(n, 4)
    print('  raw bake: max', float(col[:, :3].max()), 'mean', float(col[:, :3].mean()), 'lit verts', int((col[:, :3].sum(1) > 0).sum()), 'of', n)
    lum = col[:, :3] @ np.array([0.2126, 0.7152, 0.0722])
    ref = float(np.percentile(lum, 70)) or 1.0
    expo = 0.8 / ref
    graded = np.clip(0.16 + (col[:, :3] * expo) ** 0.85, 0.0, 1.45)
    # smooth sampling noise and thin-shadow aliasing along the mesh edges (edges never cross faces)
    ev = np.zeros(len(mesh.edges) * 2, dtype=np.int32)
    mesh.edges.foreach_get('vertices', ev)
    ev = ev.reshape(-1, 2)
    for _ in range(2):
        acc = graded.copy()
        cnt = np.ones(n)
        np.add.at(acc, ev[:, 0], graded[ev[:, 1]])
        np.add.at(acc, ev[:, 1], graded[ev[:, 0]])
        np.add.at(cnt, ev[:, 0], 1)
        np.add.at(cnt, ev[:, 1], 1)
        graded = 0.4 * graded + 0.6 * (acc / cnt[:, None])
    pm = np.zeros(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get('material_index', pm)
    for pi, poly in enumerate(mesh.polygons):
        if pm[pi] in emissive_idx:
            graded[list(poly.vertices)] = 1.0
    col[:, :3] = graded
    col[:, 3] = 1.0
    attr.data.foreach_set('color', col.ravel())
    print(f'  baked: exposure x{expo:.2f}, mean lit {float(graded.mean()):.2f}')

    glb_out = os.path.join(PROCESSED, f'{map_key}.glb')
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    kw = dict(filepath=glb_out, export_format='GLB', export_apply=True, export_yup=False,
              export_image_format='JPEG', export_jpeg_quality=82, export_normals=False)
    for name, val in (('export_vertex_color', 'ACTIVE'), ('export_active_vertex_color_when_no_material', True),
                      ('export_all_vertex_colors', True)):
        if name in props:
            kw[name] = val
    bpy.ops.export_scene.gltf(**kw)
    print(f'  exported {glb_out} ({os.path.getsize(glb_out) / 1024:.1f} KB)')


if __name__ == '__main__':
    args = sys.argv
    targets = args[args.index('--') + 1:] if '--' in args else args[1:]
    for m in (targets or list(MAPS)):
        convert_arena(m)
