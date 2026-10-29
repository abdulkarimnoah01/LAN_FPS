import re
import math
import numpy as np

def parse_map_entities(text):
    entities = []
    curr_entity = None
    curr_brush = None
    in_brushdef = False
    
    # Tokenize by lines
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line or line.startswith('//'):
            continue
        
        if line == '{':
            if curr_entity is None:
                curr_entity = {'properties': {}, 'brushes': [], 'patches': []}
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
            
        # Entity property
        prop_m = re.match(r'^"([^"]+)"\s+"([^"]*)"', line)
        if prop_m and curr_brush is None and curr_entity is not None:
            curr_entity['properties'][prop_m.group(1)] = prop_m.group(2)
            continue
            
        # Brush plane: ( p1x p1y p1z ) ( p2x p2y p2z ) ( p3x p3y p3z ) ...
        plane_m = re.findall(r'\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)', line)
        if len(plane_m) >= 3 and curr_brush is not None:
            p1 = [float(x) for x in plane_m[0]]
            p2 = [float(x) for x in plane_m[1]]
            p3 = [float(x) for x in plane_m[2]]
            
            # Find texture name after the third ')'
            rest = line[line.rfind(')') + 1:].strip()
            tex = rest.split()[0] if rest else 'default'
            
            # Normal: (p2 - p1) x (p3 - p1)
            v1 = np.array(p2) - np.array(p1)
            v2 = np.array(p3) - np.array(p1)
            n = np.cross(v2, v1)
            norm = np.linalg.norm(n)
            if norm > 1e-6:
                n = n / norm
                d = np.dot(n, p1)
                curr_brush['planes'].append({'n': n, 'd': d, 'tex': tex, 'pts': [p1, p2, p3]})
                
    return entities

def solve_brush_polyhedron(planes, scale=0.03125, eps=0.1):
    # Solves intersections of all triplet planes
    M = len(planes)
    if M < 4:
        return None, None
        
    normals = np.array([p['n'] for p in planes])
    distances = np.array([p['d'] for p in planes])
    
    verts = []
    # Test all triplets
    for i in range(M):
        for j in range(i + 1, M):
            for k in range(j + 1, M):
                A = np.vstack([normals[i], normals[j], normals[k]])
                det = np.linalg.det(A)
                if abs(det) < 1e-4:
                    continue
                try:
                    pt = np.linalg.solve(A, [distances[i], distances[j], distances[k]])
                except np.linalg.LinAlgError:
                    continue
                    
                # Check if point is inside all other planes
                diffs = np.dot(normals, pt) - distances
                if np.all(diffs <= eps):
                    verts.append(pt)
                    
    if len(verts) < 4:
        return None, None
        
    # Unique vertices
    uverts = []
    for v in verts:
        if not any(np.linalg.norm(v - u) < 0.1 for u in uverts):
            uverts.append(v)
            
    if len(uverts) < 4:
        return None, None
        
    uverts = np.array(uverts)
    # Coordinate conversion to LAN_FPS: X -> x, Z -> y, Y -> -z
    # Apply scale
    conv_verts = np.zeros_like(uverts)
    conv_verts[:, 0] = uverts[:, 0] * scale
    conv_verts[:, 1] = uverts[:, 2] * scale
    conv_verts[:, 2] = -uverts[:, 1] * scale
    
    # Bounding box [minX, minY, minZ, maxX, maxY, maxZ]
    bbox = [
        float(np.min(conv_verts[:, 0])),
        float(np.min(conv_verts[:, 1])),
        float(np.min(conv_verts[:, 2])),
        float(np.max(conv_verts[:, 0])),
        float(np.max(conv_verts[:, 1])),
        float(np.max(conv_verts[:, 2]))
    ]
    
    return conv_verts, bbox

if __name__ == '__main__':
    with open('X:/Projects/game/LAN_FPS/source/assets/maps/sources/boil.map', 'r', encoding='latin1') as f:
        text = f.read()
    entities = parse_map_entities(text)
    print(f"Entities parsed: {len(entities)}")
    world = entities[0]
    print(f"World brushes: {len(world['brushes'])}")
    
    valid_boxes = []
    for b in world['brushes'][:100]:
        v, bbox = solve_brush_polyhedron(b['planes'])
        if bbox:
            valid_boxes.append(bbox)
            
    print(f"Sample 100 brushes -> valid boxes: {len(valid_boxes)}")
    if valid_boxes:
        print("Sample bbox:", [round(x, 2) for x in valid_boxes[0]])
