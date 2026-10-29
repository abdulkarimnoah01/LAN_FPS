# Converts a .usdz/.usd/.fbx/.obj model to a .glb the game can embed.
# Run with Blender (4.2 or newer), no UI:
#   blender -b --factory-startup --python tools/usdz_to_glb.py -- <input> <output.glb> [max_texture_px]
# Textures larger than max_texture_px (default 1024) are scaled down to keep LAN_FPS.html small.
import bpy, sys, os
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 2:
    sys.exit('usage: blender -b --python usdz_to_glb.py -- <input> <output.glb> [max_texture_px]')
src, out = args[0], args[1]
max_px = int(args[2]) if len(args) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext in ('.usdz', '.usd', '.usda', '.usdc'): bpy.ops.wm.usd_import(filepath=src)
elif ext == '.fbx': bpy.ops.import_scene.fbx(filepath=src)
elif ext == '.obj': bpy.ops.wm.obj_import(filepath=src)
elif ext in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=src)
else: sys.exit('unsupported input: ' + ext)

# USD imports can bring in cameras and lights; the game only wants geometry.
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT'): bpy.data.objects.remove(o)

for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > max_px:
        k = max_px / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
        print(f'texture {img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}')

mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
for o in bpy.data.objects:
    if o.type == 'MESH':
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
print(f'size (Blender X,Y,Z): {mx.x - mn.x:.3f} x {mx.y - mn.y:.3f} x {mx.z - mn.z:.3f} m, feet at Z={mn.z:.3f}')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='AUTO', export_apply=True, export_yup=True)
print('wrote', out)
