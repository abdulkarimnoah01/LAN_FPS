import sys
import os
import re
import math
import json
import numpy as np

# Blender python environment
try:
    import bpy
    import bmesh
    HAS_BPY = True
except ImportError:
    HAS_BPY = False

SCALE = 0.03125 # 1 Quake unit = 0.03125 m (32 units = 1 m)

def parse_map(filepath):
    with open(filepath, 'r', encoding='latin1') as f:
        text = f.read()
        
    entities = []
    curr_entity = None
    curr_brush = None
    in_brushdef = False
    
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith('//'):
            continue
            
        if line == '{':
            if curr_entity is None:
                curr_entity = {'properties': {}, 'brushes': []}
            elif curr_brush is None:
                curr_brush = {'planes': []}
            continue
            
        if line == '}':
            if in_brushdef:
                in_brushdef = False
                continue
            if curr_brush is not None:
                if curr_brush['planes']:
                    curr_entity['brushes'].append(curr_brush)
                curr_brush = None
            elif curr_entity is not None:
                entities.append(curr_entity)
                curr_entity = None
            continue
            
        if line == 'brushDef' or line == '{':
            in_brushdef = True
            continue
            
        prop_m = re.match(r'^"([^"]+)"\s+"([^"]*)"', line)
        if prop_m and curr_brush is None and curr_entity is not None:
            curr_entity['properties'][prop_m.group(1)] = prop_m.group(2)
            continue
            
        plane_m = re.findall(r'\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)', line)
        if len(plane_m) >= 3 and curr_brush is not None:
            p1 = np.array([float(x) for x in plane_m[0]])
            p2 = np.array([float(x) for x in plane_m[1]])
            p3 = np.array([float(x) for x in plane_m[2]])
            
            rest = line[line.rfind(')') + 1:].strip()
            tex = rest.split()[0] if rest else 'default'
            
            # Quake plane: (p3 - p1) x (p2 - p1) normal points OUTWARD
            v1 = p2 - p1
            v2 = p3 - p1
            n = np.cross(v2, v1)
            norm = np.linalg.norm(n)
            if norm > 1e-6:
                n = n / norm
                d = np.dot(n, p1)
                curr_brush['planes'].append({'n': n, 'd': d, 'tex': tex, 'pts': [p1, p2, p3]})
                
    return entities

def solve_brush(planes, eps=0.15):
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
                diffs = np.dot(normals, pt) - distances
                if np.all(diffs <= eps):
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
    
    # Extract polygon faces for each plane
    faces = []
    for p in planes:
        n = p['n']
        d = p['d']
        on_plane = [v for v in uverts if abs(np.dot(n, v) - d) < 0.25]
        if len(on_plane) >= 3:
            ref = np.array([0, 0, 1]) if abs(n[2]) < 0.9 else np.array([0, 1, 0])
            u_axis = np.cross(n, ref)
            u_norm = np.linalg.norm(u_axis)
            if u_norm > 1e-6:
                u_axis /= u_norm
            v_axis = np.cross(n, u_axis)
            center = np.mean(on_plane, axis=0)
            def angle(pt):
                rel = pt - center
                return np.arctan2(np.dot(rel, v_axis), np.dot(rel, u_axis))
            sorted_pts = sorted(on_plane, key=angle)
            faces.append({'n': n, 'tex': p['tex'], 'pts': sorted_pts})
            
    return uverts, faces

def create_material(name, color, roughness=0.6, metallic=0.2, emission=None):
    if not HAS_BPY:
        return None
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        if emission:
            # Blender 4/5 Principled BSDF emission
            if 'Emission Color' in bsdf.inputs:
                bsdf.inputs['Emission Color'].default_value = (*emission[:3], 1.0)
                bsdf.inputs['Emission Strength'].default_value = emission[3] if len(emission) > 3 else 1.0
            elif 'Emission' in bsdf.inputs:
                bsdf.inputs['Emission'].default_value = (*emission[:3], 1.0)
    return mat

def convert_arena(map_key):
    sources_dir = 'X:/Projects/game/LAN_FPS/source/assets/maps/sources'
    processed_dir = 'X:/Projects/game/LAN_FPS/source/assets/maps/processed'
    os.makedirs(processed_dir, exist_ok=True)
    
    map_files = {
        'foundry': {'file': 'boil.map', 'title': 'Foundry Core', 'sector': 'SECTOR 06 / 08',
                    'desc': 'Molten industrial smelting pit, high catwalks, and intense CQB crossfires.',
                    'theme': 'foundry', 'sky': '#231b18', 'fog': '#2c221c', 'hazard': 'lava',
                    'cat': 'Compact industrial arena', 'modes': ['ffa', 'tdm'], 'players': [2, 6]},
        'glowplant': {'file': 'glowplant.map', 'title': 'Reactor Complex', 'sector': 'SECTOR 07 / 08',
                      'desc': 'Sub-orbital nuclear reactor facility with pulsating blue plasma cores and dual jump pads.',
                      'theme': 'reactor', 'sky': '#101e28', 'fog': '#152432', 'hazard': 'plasma',
                      'cat': 'Medium sci-fi facility', 'modes': ['tdm', 'ffa'], 'players': [4, 10]},
        'zenith': {'file': 'dance.map', 'title': 'Zenith Atrium', 'sector': 'SECTOR 08 / 08',
                   'desc': 'High-altitude vertical multi-tier sky arena with velocity jump pads and vertigo sightlines.',
                   'theme': 'zenith', 'sky': '#0e1c2b', 'fog': '#182d42', 'hazard': 'void',
                   'cat': 'Vertical futuristic complex', 'modes': ['ffa', 'tdm'], 'players': [4, 12]},
    }
    
    info = map_files[map_key]
    map_path = os.path.join(sources_dir, info['file'])
    print(f"\n[MAPFORGE] Processing {map_key} ({info['title']}) from {map_path}...")
    
    entities = parse_map(map_path)
    print(f"  Parsed {len(entities)} entities.")
    
    # 1. Collect candidate brushes
    solid_brushes = []
    for e in entities:
        c = e['properties'].get('classname', '')
        if c in ('worldspawn', 'func_group', 'func_wall'):
            solid_brushes.extend(e['brushes'])
            
    print(f"  Solid brushes found: {len(solid_brushes)}")
    
    # 2. Extract Spawns
    spawns_raw = [e for e in entities if 'info_player' in e['properties'].get('classname', '')]
    print(f"  Player spawns found: {len(spawns_raw)}")
    
    # 3. Extract Jump Pads & Hurt Triggers
    jump_pads_raw = [e for e in entities if 'trigger_push' in e['properties'].get('classname', '')]
    hurt_triggers = [e for e in entities if 'trigger_hurt' in e['properties'].get('classname', '')]
    print(f"  Jump pads found: {len(jump_pads_raw)}, Hurt triggers: {len(hurt_triggers)}")
    
    # 4. Solve all brushes
    solved = []
    for b in solid_brushes:
        uverts, faces = solve_brush(b['planes'])
        if uverts is not None and faces:
            # Check if caulk/sky/nodraw
            # We filter out brushes that are 100% skies
            all_sky = all('sky' in f['tex'].lower() for f in faces)
            if not all_sky:
                solved.append((uverts, faces))
                
    print(f"  Successfully solved {len(solved)} solid polyhedra.")
    
    # 5. Determine bounding box of all spawns and playable geometry
    all_quake_pts = []
    for uverts, _ in solved:
        all_quake_pts.append(uverts)
    all_quake_pts = np.vstack(all_quake_pts)
    
    spawn_pts = []
    for s in spawns_raw:
        orig = [float(x) for x in s['properties'].get('origin', '0 0 0').split()]
        spawn_pts.append(orig)
    if spawn_pts:
        spawn_pts = np.array(spawn_pts)
    else:
        spawn_pts = np.array([[0, 0, 0]])
        
    # In Quake: X is east, Y is north, Z is up.
    # We want lowest playable spawn or floor to be at game Y = 0.5m.
    # Convert points: game_x = quake_x * SCALE, game_y = quake_z * SCALE, game_z = -quake_y * SCALE
    lowest_spawn_z = np.min(spawn_pts[:, 2]) if len(spawn_pts) else np.min(all_quake_pts[:, 2])
    # Center of spawns
    center_x = (np.min(spawn_pts[:, 0]) + np.max(spawn_pts[:, 0])) / 2
    center_y = (np.min(spawn_pts[:, 1]) + np.max(spawn_pts[:, 1])) / 2
    
    offset_x = center_x
    offset_y = center_y
    offset_z = lowest_spawn_z # This will become Y=0 in game
    
    print(f"  Offsets: Center ({offset_x:.1f}, {offset_y:.1f}), Base Z: {offset_z:.1f}")
    
    def to_game(pt):
        gx = (pt[0] - offset_x) * SCALE
        gy = (pt[2] - offset_z) * SCALE
        gz = -(pt[1] - offset_y) * SCALE
        return [float(gx), float(gy), float(gz)]
        
    # 6. Build Game Collision Boxes
    game_boxes = []
    for uverts, faces in solved:
        gpts = np.array([to_game(v) for v in uverts])
        bmin = np.min(gpts, axis=0)
        bmax = np.max(gpts, axis=0)
        
        # Filter out giant boundary sky brushes (>150m) or zero-volume
        size = bmax - bmin
        if np.all(size > 0.05) and np.all(size < 120.0):
            # Expand slightly for collision stability
            game_boxes.append([
                round(float(bmin[0]), 3), round(float(bmin[1]), 3), round(float(bmin[2]), 3),
                round(float(bmax[0]), 3), round(float(bmax[1]), 3), round(float(bmax[2]), 3)
            ])
            
    print(f"  Generated {len(game_boxes)} collision boxes.")
    
    # 7. Convert Spawns
    game_spawns = []
    for s in spawns_raw:
        orig = [float(x) for x in s['properties'].get('origin', '0 0 0').split()]
        gpos = to_game(orig)
        # Ensure spawn is slightly above floor
        gpos[1] = max(0.2, gpos[1] + 0.1)
        game_spawns.append({
            'x': round(gpos[0], 2),
            'y': round(gpos[1], 2),
            'z': round(gpos[2], 2)
        })
    print(f"  Converted {len(game_spawns)} spawn coordinates.")
    
    # 8. Convert Jump Pads
    game_jump_pads = []
    for jp in jump_pads_raw:
        orig = [float(x) for x in jp['properties'].get('origin', '0 0 0').split()]
        gpos = to_game(orig)
        # Bounding box for trigger pad
        pad_box = [gpos[0] - 1.2, gpos[1] - 0.5, gpos[2] - 1.2, gpos[0] + 1.2, gpos[1] + 1.2, gpos[2] + 1.2]
        game_jump_pads.append({
            'box': [round(x, 2) for x in pad_box],
            'vy': 15.0
        })
        
    # 9. Blender 3D Scene Assembly
    if HAS_BPY:
        bpy.ops.wm.read_homefile(use_empty=True)
        scene = bpy.context.scene
        
        # Create Materials
        if map_key == 'foundry':
            mat_floor = create_material('Foundry_Floor', (0.18, 0.16, 0.15), roughness=0.7, metallic=0.4)
            mat_wall = create_material('Foundry_Wall', (0.24, 0.22, 0.20), roughness=0.8, metallic=0.1)
            mat_trim = create_material('Foundry_Hazard', (0.85, 0.55, 0.12), roughness=0.5, metallic=0.3)
            mat_core = create_material('Foundry_Lava', (0.95, 0.25, 0.05), roughness=0.2, metallic=0.0, emission=(1.0, 0.35, 0.05, 4.0))
        elif map_key == 'glowplant':
            mat_floor = create_material('Reactor_Floor', (0.15, 0.17, 0.20), roughness=0.6, metallic=0.5)
            mat_wall = create_material('Reactor_Wall', (0.22, 0.25, 0.28), roughness=0.7, metallic=0.2)
            mat_trim = create_material('Reactor_Trim', (0.12, 0.70, 0.85), roughness=0.4, metallic=0.6)
            mat_core = create_material('Reactor_Core', (0.05, 0.65, 0.95), roughness=0.1, metallic=0.0, emission=(0.1, 0.75, 1.0, 5.0))
        else: # zenith
            mat_floor = create_material('Zenith_Deck', (0.16, 0.18, 0.22), roughness=0.5, metallic=0.6)
            mat_wall = create_material('Zenith_Pillar', (0.20, 0.22, 0.25), roughness=0.6, metallic=0.3)
            mat_trim = create_material('Zenith_Neon', (0.05, 0.90, 0.70), roughness=0.3, metallic=0.5)
            mat_core = create_material('Zenith_Atrium', (0.05, 0.40, 0.90), roughness=0.2, metallic=0.0, emission=(0.2, 0.6, 1.0, 4.0))
            
        # Build Geometry using BMesh
        mesh = bpy.data.meshes.new(f"Arena_{map_key}")
        bm = bmesh.new()
        
        # Add materials to mesh
        for m in [mat_floor, mat_wall, mat_trim, mat_core]:
            mesh.materials.append(m)
            
        face_count = 0
        for uverts, faces in solved:
            for f in faces:
                pts = [to_game(p) for p in f['pts']]
                # Ignore faces outside reasonable bounds
                if any(abs(p[0]) > 60 or abs(p[2]) > 60 or p[1] > 40 or p[1] < -20 for p in pts):
                    continue
                # Calculate normal in game coords
                gn = np.array([f['n'][0], f['n'][2], -f['n'][1]])
                gn_norm = np.linalg.norm(gn)
                if gn_norm > 1e-6:
                    gn = gn / gn_norm
                    
                # Determine material index
                tex_lower = f['tex'].lower()
                if 'lava' in tex_lower or 'slime' in tex_lower or 'plasma' in tex_lower or 'water' in tex_lower:
                    mat_idx = 3 # Core / Hazard
                elif gn[1] > 0.65:
                    mat_idx = 0 # Floor
                elif abs(gn[1]) < 0.65:
                    mat_idx = 1 # Wall
                else:
                    mat_idx = 2 # Trim / Ceiling
                    
                bm_verts = []
                for p in pts:
                    bm_verts.append(bm.verts.new(p))
                try:
                    # In Blender/glTF, check polygon orientation
                    bface = bm.faces.new(bm_verts)
                    bface.material_index = mat_idx
                    face_count += 1
                except ValueError:
                    # Duplicate or degenerate face
                    pass
                    
        print(f"  Constructed BMesh with {face_count} faces.")
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.005)
        bm.to_mesh(mesh)
        bm.free()
        
        obj = bpy.data.objects.new(f"Map_{map_key}", mesh)
        bpy.context.collection.objects.link(obj)
        
        # Add interactive barrel props
        np.random.seed(42)
        barrels = []
        for i in range(12):
            sp = game_spawns[i % len(game_spawns)]
            bx = sp['x'] + np.random.uniform(-4, 4)
            bz = sp['z'] + np.random.uniform(-4, 4)
            # Find closest ground
            barrels.append({
                'id': f"{map_key}_barrel_{i}",
                'x': round(bx, 2),
                'y': round(sp['y'], 2),
                'z': round(bz, 2),
                'h': 1.1,
                'r': 0.42,
                'hp': 40,
                'alive': True,
                'color': 'barrelRust' if i % 2 == 0 else 'barrelOlive'
            })
            
        # Export GLB
        glb_out = os.path.join(processed_dir, f"{map_key}.glb")
        bpy.ops.export_scene.gltf(
            filepath=glb_out,
            export_format='GLB',
            export_apply=True
        )
        glb_size_kb = os.path.getsize(glb_out) / 1024
        print(f"  [EXPORTED GLB] {glb_out} ({glb_size_kb:.1f} KB)")
        
    # 10. Metadata JSON
    metadata = {
        'id': map_key,
        'title': info['title'],
        'sector': info['sector'],
        'description': info['desc'],
        'category': info['cat'],
        'supportedModes': info['modes'],
        'recommendedPlayers': info['players'],
        'sky': info['sky'],
        'fog': info['fog'],
        'theme': info['theme'],
        'boxes': game_boxes,
        'spawns': game_spawns,
        'jumpPads': game_jump_pads,
        'killY': -10.0 if map_key == 'zenith' else -15.0,
        'barrels': barrels if HAS_BPY else [],
        'attribution': f"Based on {info['file']} from Xonotic (GPL-2.0-or-later)."
    }
    
    json_out = os.path.join(processed_dir, f"{map_key}.json")
    with open(json_out, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"  [SAVED METADATA] {json_out} ({os.path.getsize(json_out) / 1024:.1f} KB)")
    print(f"[MAPFORGE] Completed {map_key}!\n")

if __name__ == '__main__':
    # Can accept args from blender: ... -- <map_key>
    args = sys.argv
    if '--' in args:
        target_maps = args[args.index('--') + 1:]
    else:
        target_maps = sys.argv[1:] if len(sys.argv) > 1 else ['foundry', 'glowplant', 'zenith']
        
    for m in target_maps:
        convert_arena(m)
