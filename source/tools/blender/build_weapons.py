"""Builds the six Spectre Orbit Next Gen first-person weapons in Blender (headless) and exports
one GLB per weapon to source/assets/weapons/<id>.glb.

    blender -b --factory-startup --python-exit-code 1 -P source/tools/blender/build_weapons.py

Art direction (original): chunky readable silhouettes, chamfered edges, a light/dark two-tone
body, one signature accent colour per weapon and a thin emissive strip. Conventions: metres,
barrel along +Y in Blender (exports as -Z, the viewmodel's forward), +Z up, the grip near the
origin. Each GLB has an empty named "muzzle" at the barrel tip."""

import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "weapons"))
os.makedirs(OUT, exist_ok=True)


def hexrgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)   # sRGB → linear


_mats = {}
def material(name, hex_, rough=0.5, metal=0.0, emit=0.0):
    key = (name, hex_, rough, metal, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = hexrgb(hex_)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = hexrgb(hex_)
        bsdf.inputs["Emission Strength"].default_value = emit
    _mats[key] = m
    return m


def _box_uv(bm, scale=6.0):
    """Box-projected UVs (by dominant normal axis) so every part has a valid UV map."""
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            u, v = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][ax]
            l[uv].uv = (u * scale + 0.5, v * scale + 0.5)


def _object(name, bm, mat, root, bevel):
    bm.normal_update()
    _box_uv(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    ob.parent = root
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel; mod.segments = 2; mod.limit_method = "ANGLE"; mod.angle_limit = math.radians(40)
        mod.harden_normals = False
    return ob


def box(name, size, loc, mat, root, rot=(0, 0, 0), bevel=0.006, taper=None):
    """Axis box of `size` (x, y, z) centred at `loc`. taper=(sx, sz) scales the +Y end."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co
        if taper and y > 0:
            x *= taper[0]; z *= taper[1]
        v.co = Vector((x * size[0], y * size[1], z * size[2]))
    m = Matrix.Translation(loc) @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[2], 4, "Z")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return _object(name, bm, mat, root, bevel)


def tube(name, r1, r2, length, loc, mat, root, segs=10, axis="Y", bevel=0.003):
    """Cylinder/cone along an axis, centred at `loc`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=length)
    rot = {"Y": Matrix.Rotation(-math.pi / 2, 4, "X"), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Z": Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(loc) @ rot, verts=bm.verts)
    return _object(name, bm, mat, root, bevel)


def start(wid):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    root = bpy.data.objects.new(f"wep_{wid}", None)
    bpy.context.scene.collection.objects.link(root)
    return root


def muzzle(root, y, z):
    e = bpy.data.objects.new("muzzle", None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = root; e.location = (0, y, z)
    return e


# Shared materials
LIGHT = material("body_light", "#e6eaf0", 0.42)
DARK = material("body_dark", "#2a2f3a", 0.55, 0.15)
METAL = material("metal", "#8a94a6", 0.3, 0.85)
GRIP = material("grip", "#1c1f26", 0.85)


def rifle():
    root = start("ak47")
    acc = material("acc_ak47", "#f97316", 0.45)
    glow = material("glow_cyan", "#22d3ee", 0.3, emit=6.0)
    box("receiver", (0.064, 0.34, 0.085), (0, 0.04, 0.0), DARK, root)
    box("shroud", (0.07, 0.26, 0.05), (0, 0.24, 0.02), LIGHT, root, taper=(0.85, 0.85))
    box("topRail", (0.03, 0.22, 0.016), (0, 0.06, 0.051), METAL, root, bevel=0.003)
    tube("barrel", 0.013, 0.012, 0.2, (0, 0.44, 0.02), METAL, root)
    tube("brake", 0.02, 0.02, 0.045, (0, 0.555, 0.02), DARK, root, segs=8)
    box("mag", (0.034, 0.06, 0.13), (0, 0.06, -0.1), acc, root, rot=(math.radians(-14), 0, 0))
    box("grip", (0.04, 0.055, 0.11), (0, -0.07, -0.085), GRIP, root, rot=(math.radians(18), 0, 0))
    box("stock", (0.05, 0.2, 0.07), (0, -0.22, -0.01), LIGHT, root, taper=(1.0, 1.4))
    box("stockPad", (0.054, 0.025, 0.1), (0, -0.33, -0.02), GRIP, root)
    box("stripL", (0.004, 0.2, 0.008), (0.0365, 0.22, 0.02), glow, root, bevel=0)
    box("stripR", (0.004, 0.2, 0.008), (-0.0365, 0.22, 0.02), glow, root, bevel=0)
    box("sight", (0.022, 0.03, 0.03), (0, -0.02, 0.07), DARK, root)
    return root, muzzle(root, 0.58, 0.02)


def smg():
    root = start("smg")
    acc = material("acc_smg", "#a3e635", 0.45)
    glow = material("glow_mag", "#e879f9", 0.3, emit=6.0)
    box("body", (0.07, 0.26, 0.09), (0, 0.06, 0.0), LIGHT, root)
    box("lower", (0.06, 0.2, 0.04), (0, 0.04, -0.06), DARK, root)
    tube("barrel", 0.014, 0.014, 0.12, (0, 0.24, 0.015), METAL, root)
    tube("suppressorRing", 0.022, 0.022, 0.03, (0, 0.3, 0.015), acc, root, segs=8)
    box("mag", (0.03, 0.045, 0.16), (0, 0.12, -0.14), DARK, root)
    box("foregrip", (0.03, 0.035, 0.08), (0, 0.165, -0.08), GRIP, root, rot=(math.radians(-8), 0, 0))
    box("grip", (0.04, 0.05, 0.1), (0, -0.04, -0.08), GRIP, root, rot=(math.radians(16), 0, 0))
    box("panel", (0.074, 0.08, 0.05), (0, 0.11, 0.01), acc, root)
    box("stock", (0.03, 0.16, 0.035), (0, -0.14, 0.0), DARK, root)
    box("strip", (0.076, 0.004, 0.01), (0, 0.05, 0.0315), glow, root, bevel=0)
    box("sight", (0.02, 0.05, 0.025), (0, 0.02, 0.058), DARK, root)
    return root, muzzle(root, 0.32, 0.015)


def lmg():
    root = start("lmg")
    acc = material("acc_lmg", "#fbbf24", 0.45)
    glow = material("glow_cyan", "#22d3ee", 0.3, emit=6.0)
    box("receiver", (0.09, 0.38, 0.11), (0, 0.04, 0.0), DARK, root)
    box("cover", (0.094, 0.18, 0.04), (0, 0.04, 0.072), LIGHT, root)
    tube("shroud", 0.034, 0.03, 0.28, (0, 0.36, 0.015), LIGHT, root, segs=8)
    for i in range(4):
        tube(f"vent{i}", 0.036, 0.036, 0.012, (0, 0.27 + i * 0.05, 0.015), DARK, root, segs=8, bevel=0)
    tube("barrel", 0.015, 0.015, 0.16, (0, 0.56, 0.015), METAL, root)
    tube("drum", 0.075, 0.075, 0.07, (0.0, 0.05, -0.11), acc, root, segs=14, axis="X")
    box("grip", (0.044, 0.055, 0.11), (0, -0.12, -0.09), GRIP, root, rot=(math.radians(18), 0, 0))
    box("stock", (0.06, 0.18, 0.09), (0, -0.25, -0.01), LIGHT, root, taper=(1.0, 1.3))
    box("carry", (0.02, 0.12, 0.03), (0, 0.06, 0.104), METAL, root)
    box("strip", (0.004, 0.24, 0.01), (0.0475 + 0.0015, 0.06, 0.0), glow, root, bevel=0)
    box("strip2", (0.004, 0.24, 0.01), (-0.0475 - 0.0015, 0.06, 0.0), glow, root, bevel=0)
    return root, muzzle(root, 0.64, 0.015)


def shotgun():
    root = start("shotgun")
    acc = material("acc_shotgun", "#ef4444", 0.45)
    glow = material("glow_amber", "#fbbf24", 0.3, emit=5.0)
    box("receiver", (0.08, 0.26, 0.1), (0, 0.0, 0.0), DARK, root)
    for x in (-0.018, 0.018):
        tube(f"barrel{'L' if x < 0 else 'R'}", 0.019, 0.019, 0.36, (x, 0.3, 0.025), METAL, root, segs=10)
    box("rib", (0.05, 0.36, 0.012), (0, 0.3, 0.05), LIGHT, root, bevel=0.003)
    box("pump", (0.075, 0.13, 0.055), (0, 0.24, -0.03), acc, root)
    for i in range(3):
        box(f"pumpRidge{i}", (0.078, 0.008, 0.058), (0, 0.2 + i * 0.04, -0.03), GRIP, root, bevel=0)
    box("grip", (0.045, 0.06, 0.11), (0, -0.1, -0.08), GRIP, root, rot=(math.radians(20), 0, 0))
    box("stock", (0.06, 0.22, 0.085), (0, -0.25, -0.025), LIGHT, root, taper=(1.0, 1.35))
    box("shell", (0.084, 0.06, 0.03), (0, 0.06, 0.04), acc, root)
    box("strip", (0.004, 0.16, 0.01), (0.0425, 0.02, 0.0), glow, root, bevel=0)
    return root, muzzle(root, 0.49, 0.025)


def sniper():
    root = start("sniper")
    acc = material("acc_sniper", "#8b5cf6", 0.4)
    glow = material("glow_lens", "#22d3ee", 0.1, emit=8.0)
    box("receiver", (0.062, 0.36, 0.08), (0, 0.04, 0.0), DARK, root)
    box("handguard", (0.06, 0.28, 0.06), (0, 0.33, 0.005), LIGHT, root, taper=(0.8, 0.8))
    tube("barrel", 0.012, 0.011, 0.34, (0, 0.62, 0.015), METAL, root)
    box("brake", (0.034, 0.06, 0.03), (0, 0.8, 0.015), DARK, root)
    tube("scope", 0.022, 0.022, 0.24, (0, 0.06, 0.09), DARK, root, segs=12)
    tube("scopeFront", 0.03, 0.026, 0.05, (0, 0.2, 0.09), acc, root, segs=12)
    tube("scopeBack", 0.027, 0.027, 0.04, (0, -0.07, 0.09), acc, root, segs=12)
    tube("lens", 0.024, 0.024, 0.004, (0, 0.226, 0.09), glow, root, segs=12, bevel=0)
    box("mountF", (0.02, 0.02, 0.04), (0, 0.12, 0.05), METAL, root)
    box("mountB", (0.02, 0.02, 0.04), (0, -0.01, 0.05), METAL, root)
    box("mag", (0.03, 0.05, 0.06), (0, 0.08, -0.07), acc, root)
    box("grip", (0.04, 0.055, 0.11), (0, -0.12, -0.08), GRIP, root, rot=(math.radians(18), 0, 0))
    box("stock", (0.05, 0.26, 0.09), (0, -0.3, -0.01), LIGHT, root, taper=(1.0, 1.25))
    box("cheek", (0.052, 0.12, 0.025), (0, -0.27, 0.05), acc, root)
    return root, muzzle(root, 0.83, 0.015)


def knife():
    root = start("knife")
    glow = material("glow_edge", "#22d3ee", 0.2, emit=7.0)
    blade = material("blade", "#dbe2ea", 0.18, 0.9)
    box("blade", (0.008, 0.2, 0.04), (0, 0.13, 0.0), blade, root, taper=(0.6, 0.15), bevel=0.002)
    box("edge", (0.002, 0.18, 0.006), (0, 0.13, -0.019), glow, root, taper=(1.0, 0.5), bevel=0)
    box("guard", (0.03, 0.014, 0.07), (0, 0.025, -0.002), METAL, root)
    box("handle", (0.028, 0.11, 0.034), (0, -0.04, -0.004), GRIP, root, taper=(1.1, 1.1))
    box("pommel", (0.032, 0.018, 0.04), (0, -0.1, -0.004), material("acc_knife", "#f472b6", 0.4), root)
    return root, muzzle(root, 0.23, 0.0)


def export(wid, root):
    bpy.context.view_layer.update()
    path = os.path.join(OUT, f"{wid}.glb")
    for ob in bpy.data.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_apply=True,
                              export_yup=True, export_materials="EXPORT", export_animations=False)
    tris = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ev = ob.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles(); tris += len(me.loop_triangles); ev.to_mesh_clear()
    return {"id": wid, "file": os.path.relpath(path, os.path.join(HERE, "..", "..")), "bytes": os.path.getsize(path), "tris": tris,
            "parts": sum(1 for o in bpy.data.objects if o.type == "MESH")}


BUILDS = (rifle, shotgun, sniper, smg, lmg, knife)

if __name__ == "__main__":
    report = []
    for build in BUILDS:
        root, _ = build()
        report.append(export(root.name[4:], root))
    print("@@JSON@@" + json.dumps(report))
