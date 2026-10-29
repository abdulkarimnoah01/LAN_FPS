import os
import json
import numpy as np

def overlaps(b, x, y, z, r=0.35, h=1.8):
    # b: [minX, minY, minZ, maxX, maxY, maxZ]
    return (x + r > b[0] and x - r < b[3] and
            y + h > b[1] and y < b[4] and
            z + r > b[2] and z - r < b[5])

def floor_below(boxes, x, y, z, r=0.35):
    best = -999.0
    for b in boxes:
        if x + r > b[0] and x - r < b[3] and z + r > b[2] and z - r < b[5]:
            if b[4] <= y + 0.5:
                best = max(best, b[4])
    return best

def validate_map(map_key):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'maps', 'processed', f'{map_key}.json')
    with open(path, 'r') as f:
        data = json.load(f)
        
    boxes = data['boxes']
    spawns = data['spawns']
    
    print(f"\n[VALIDATING] {map_key} ({data['title']}):")
    print(f"  Boxes: {len(boxes)}, Spawns: {len(spawns)}")
    
    valid_spawns = []
    fixed_spawns = 0
    for i, s in enumerate(spawns):
        x, y, z = s['x'], s['y'], s['z']
        
        # Check floor below
        f_y = floor_below(boxes, x, y + 1.0, z)
        if f_y > -900:
            target_y = f_y + 0.05
        else:
            target_y = y
            
        # Check collision overlap
        in_col = any(overlaps(b, x, target_y, z) for b in boxes)
        if in_col:
            # Shift slightly up until clear
            for step in range(1, 10):
                test_y = target_y + step * 0.25
                if not any(overlaps(b, x, test_y, z) for b in boxes):
                    target_y = test_y
                    in_col = False
                    fixed_spawns += 1
                    break
                    
        if not in_col:
            valid_spawns.append({'x': round(x, 2), 'y': round(target_y, 2), 'z': round(z, 2)})
        else:
            print(f"  WARNING: Spawn {i} ({x}, {y}, {z}) is stuck inside geometry!")
            
    print(f"  Clear, valid spawns: {len(valid_spawns)} / {len(spawns)} (fixed: {fixed_spawns})")
    data['spawns'] = valid_spawns
    
    # Save back validated spawns
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == '__main__':
    for m in ['foundry', 'glowplant', 'zenith']:
        validate_map(m)
