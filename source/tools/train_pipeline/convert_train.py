"""Bring the HADOTA train (USD, one frozen frame) into the game.

Run with Blender 5.x headless:
  blender -b --python tools/train_pipeline/convert_train.py -- engine cart

For each asset (engine / cart) it
  1. imports the high-poly meshes of frame 1001 from the USD stack on the share,
  2. decimates every part to a small triangle budget and joins them into one mesh,
  3. unwraps one atlas and bakes base colour, ambient occlusion and a tangent-space
     normal map from the high-poly originals (original UDIM textures are the colour source),
  4. exports a GLB (Y-up numbers untouched, game space) to assets/props/train/.

Env: TRAIN_SIZE (atlas px, default 2048), TRAIN_SAMPLES (colour samples), TRAIN_AO_SAMPLES,
     TRAIN_TRIS_ENGINE / TRAIN_TRIS_CART (triangle budgets), TRAIN_TMP (scratch folder).
"""
import bpy, bmesh, os, sys, json, time, math
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(SRC, 'assets', 'props', 'train')
TMP = os.environ.get('TRAIN_TMP', os.path.join(HERE, '_tmp'))
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

SHARE = r'\\192.168.8.210\VFX-Projects\Cinema\2026\hadota'
USD = SHARE + r'\shots\sc034\sc034sh0200\work\setdress\geo\train\had_sc034_sc034sh0200_setdress_v001.usd_rop1.usd'
TEX_ENGINE = SHARE + r'\assets\train\work\texture\Textures'
TEX_CART = SHARE + r'\assets\train_car\work\Textures\Main'

SIZE = int(os.environ.get('TRAIN_SIZE', 2048))
SAMPLES = int(os.environ.get('TRAIN_SAMPLES', 8))
AO_SAMPLES = int(os.environ.get('TRAIN_AO_SAMPLES', 48))
FRAME = 1001

ASSETS = {
    'engine': dict(clip='Engine', prim='/Train_Anim/sc034sh0200_animClipEngine',
                   tris=int(os.environ.get('TRAIN_TRIS_ENGINE', 38000)), glass_tris=900),
    'cart': dict(clip='Cart_01', prim='/Train_Anim/sc034sh0200_animClipCart_01',
                 tris=int(os.environ.get('TRAIN_TRIS_CART', 30000)), glass_tris=1500),
}

# material name -> ('tex', first-tile path) | 'glass' | 'led'
def material_kind(name):
    n = name or ''
    if n.startswith('Tractor') and 'Windows' in n: return 'glass'
    if 'Leds' in n: return 'led'
    if n == 'TractorFBXASC032Train_TopSG_Sh90': return ('tex', TEX_ENGINE + r'\V011\Tractor Train_Top_Basecolor_sRGB.1001.png')
    if n.startswith('TractorFBXASC032Train_Top'): return ('tex', TEX_ENGINE + r'\V011\Tractor Train_Top_Basecolor_sRGB.1001.png')
    if 'WheelMTL' in n: return ('tex', TEX_ENGINE + r'\v008\Tractor_WheelMTL_Basecolor_sRGB.1001.png')
    if n.startswith('Carriage_Bot'): return ('tex', TEX_CART + r'\Carriage_BotMTL_Basecolor_Utility - sRGB - Texture.1001.png')
    if n.startswith('Carriage_Top'): return ('tex', TEX_CART + r'\Carriage_TopMTL_Basecolor_Utility - sRGB - Texture.1001.png')
    if n.startswith('Carriage_Window'): return 'glass'
    return ('tex', TEX_CART + r'\Carriage_TopMTL_Basecolor_Utility - sRGB - Texture.1001.png')

# the engine uses the V010 layout for TopSG and V011 for TopSG_Sh90; both bake from the V011 set
# except the plain TopSG meshes which keep V010 (different UV layout).
def material_kind_engine_top(name):
    return TEX_ENGINE + (r'\V011' if name.endswith('Sh90') else r'\V010') + r'\Tractor Train_Top_Basecolor_sRGB.1001.png'


def log(*a):
    print('[train]', *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_set(FRAME)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = False
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    return sc


def load_udim(first_tile_path):
    """Load a UDIM set as one tiled image (all sibling tiles are detected)."""
    d, f = os.path.split(first_tile_path)
    before = set(bpy.data.images)
    bpy.ops.image.open(filepath=first_tile_path, directory=d + os.sep, files=[{'name': f}], use_udim_detecting=True, relative_path=False)
    new = [i for i in bpy.data.images if i not in before]
    img = new[-1]
    log('udim', img.name, img.source, len(img.tiles))
    return img


def srgb_image(path, tiled=True):
    key = os.path.normcase(path)
    if key in _img_cache:
        return _img_cache[key]
    img = load_udim(path)
    img.colorspace_settings.name = 'sRGB'
    _img_cache[key] = img
    return img


_img_cache = {}


def surface_area(me):
    n = len(me.polygons)
    a = np.empty(n, np.float32)
    me.polygons.foreach_get('area', a)
    return float(a.sum())


def tri_count(me):
    c = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_total', c)
    return int(np.maximum(c - 2, 0).sum())


def import_clip(asset):
    before = set(bpy.data.objects)
    bpy.ops.wm.usd_import(filepath=USD, prim_path_mask=asset['prim'], import_materials=False, import_subdivision=False,
                          read_mesh_uvs=True, read_mesh_attributes=False, import_cameras=False, import_lights=False,
                          import_curves=False, import_volumes=False, import_skeletons=False, import_blendshapes=False,
                          validate_meshes=False, create_collection=False)
    return [o for o in bpy.data.objects if o not in before and o.type == 'MESH']


def leaf(o):
    n = o.name
    return n.rsplit('.', 1)[0] if n[-4:-3] == '.' and n[-3:].isdigit() else n


def world_mesh(o):
    """Bake the object transform into its mesh so everything is in one space."""
    mw = o.matrix_world.copy()
    # frame 1001 lives in the MeshSequenceCache modifier (the stored mesh is the rest pose): freeze the evaluated mesh
    dg = bpy.context.evaluated_depsgraph_get()
    frozen = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = o.data
    o.data = frozen
    bpy.data.meshes.remove(old)
    me = o.data
    for m in list(o.modifiers):            # the USD importer adds a MeshSequenceCache that would re-read the high-poly at export
        o.modifiers.remove(m)
    for c in list(o.constraints):
        o.constraints.remove(c)
    o.parent = None
    o.matrix_world = mw
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)


def new_material(name, color=None, image=None, rough=0.7, metal=0.0, alpha=1.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if color is not None:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = 3.0
    if image is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image
        t.interpolation = 'Linear'
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def build(sc, key):
    asset = ASSETS[key]
    t0 = time.time()
    mats_by_leaf = json.load(open(os.path.join(HERE, 'train_materials.json')))[asset['clip']]
    objs = import_clip(asset)
    bpy.context.view_layer.update()
    flt = [t for t in os.environ.get('TRAIN_FILTER', '').split(',') if t]
    if flt:
        for o in list(objs):
            if not any(t in o.name for t in flt):
                bpy.data.objects.remove(o)
                objs.remove(o)
    log(key, 'imported', len(objs), 'meshes', round(time.time() - t0, 1), 's')

    high, glass, led = [], [], []
    for o in objs:
        world_mesh(o)
        name = leaf(o)
        mat = mats_by_leaf.get(name)
        if name.startswith('Plane_GEO'):
            bpy.data.objects.remove(o)
            continue
        kind = material_kind(mat)
        if kind == 'glass':
            glass.append(o)
        elif kind == 'led':
            led.append(o)
        else:
            path = kind[1]
            if key == 'engine' and mat and mat.startswith('TractorFBXASC032Train_Top'):
                path = material_kind_engine_top(mat)
            o.data.materials.clear()
            o.data.materials.append(new_material('hi_' + mat, image=srgb_image(path), rough=0.6))
            high.append(o)

    hi_tris = sum(tri_count(o.data) for o in high)
    log(key, 'high', len(high), 'objects', hi_tris, 'tris; glass', len(glass), 'led', len(led))

    # ---- decimate: budget by surface area ------------------------------------------------
    areas = {o: surface_area(o.data) for o in high}
    total = sum(areas.values())
    lows = []
    for o in high:
        share = areas[o] / total
        tgt = max(10, int(asset['tris'] * share))
        if areas[o] < 0.015 and tgt < 14:
            continue                               # bolts, wires: carried by the normal map only
        tris = tri_count(o.data)
        ratio = min(1.0, tgt / max(tris, 1))
        lo = o.copy(); lo.data = o.data.copy(); lo.name = 'lo_' + o.name
        sc.collection.objects.link(lo)
        if ratio < 1.0:
            md = lo.modifiers.new('dec', 'DECIMATE')
            md.decimate_type = 'COLLAPSE'; md.ratio = ratio; md.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = lo
            bpy.ops.object.modifier_apply(modifier='dec')
        lo.data.materials.clear()
        got = tri_count(lo.data)
        if got > max(300, 4 * tgt):
            # many-island parts (grilles, springs) refuse to collapse: keep them as bake sources only,
            # their relief reaches the game through the normal map of the surface behind them
            log('  skipped (will not decimate):', o.name, 'tris', tris, 'target', tgt, 'got', got)
            bpy.data.objects.remove(lo)
            continue
        lows.append(lo)
    for o in glass:
        tris = tri_count(o.data)
        ratio = min(1.0, max(0.02, asset['glass_tris'] / max(1, sum(tri_count(g.data) for g in glass))) )
        if ratio < 1.0 and tris > 40:
            md = o.modifiers.new('dec', 'DECIMATE'); md.ratio = ratio; md.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='dec')
    for o in led:
        tris = tri_count(o.data)
        if tris > 400:
            md = o.modifiers.new('dec', 'DECIMATE'); md.ratio = 400 / tris; md.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='dec')
    log(key, 'decimated', round(time.time() - t0, 1), 's')

    # ---- join lows, unwrap one atlas ----------------------------------------------------
    bpy.ops.object.select_all(action='DESELECT')
    for o in lows:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lows[0]
    bpy.ops.object.join()
    low = bpy.context.view_layer.objects.active
    low.name = key + '_body'
    me = low.data
    me.name = key + '_body'
    if os.environ.get('TRAIN_SAVE_LOW'):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(TMP, 'low_%s.blend' % key), copy=True)
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    me.uv_layers.new(name='atlas')
    # merge doubles on the joined shell so smooth normals work, then unwrap
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(40))
    bpy.ops.mesh.mark_sharp()                           # creases > 40 deg stay hard when the rest is smooth
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.7, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()                  # one texel density across the whole shell
    bpy.ops.uv.pack_islands(rotate=True, margin_method='ADD', margin=0.003, scale=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    bmq = bmesh.new()
    bmq.from_mesh(low.data)
    uvl = bmq.loops.layers.uv.active
    if uvl is None:
        raise RuntimeError('atlas UV layer missing after unwrap')
    uvs = np.array([l[uvl].uv[:] for f in bmq.faces for l in f.loops], np.float32)
    bmq.free()
    log(key, 'uv extent', uvs.min(0).round(3), uvs.max(0).round(3), 'cells used', len(np.unique((uvs * 64).astype(int), axis=0)), '/ 4096')
    me = low.data
    for p_ in me.polygons:
        p_.use_smooth = True
    low_tris = tri_count(me)
    log(key, 'low body', low_tris, 'tris', round(time.time() - t0, 1), 's')

    # ---- bake --------------------------------------------------------------------------
    for m in list(me.materials):
        me.materials.clear()
    bake_mat = bpy.data.materials.new('bake')
    bake_mat.use_nodes = True
    me.materials.append(bake_mat)
    nt = bake_mat.node_tree
    tex_node = nt.nodes.new('ShaderNodeTexImage')

    def bake(kind, name, srgb, samples, extra):
        img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        tex_node.image = img
        nt.nodes.active = tex_node
        sc.cycles.samples = samples
        bpy.ops.object.select_all(action='DESELECT')
        for h in high:
            h.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        t = time.time()
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, target='IMAGE_TEXTURES', margin=4, margin_type='EXTEND',
                            cage_extrusion=0.10, max_ray_distance=0.35, use_clear=True, **extra)
        log(key, 'baked', kind, round(time.time() - t, 1), 's')
        return img

    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    sc.world.light_settings.distance = 1.2

    col = bake('DIFFUSE', key + '_col', True, SAMPLES, {'pass_filter': {'COLOR'}})
    ao = bake('AO', key + '_ao', False, AO_SAMPLES, {})
    nrm = bake('NORMAL', key + '_nrm', False, 1, {'normal_space': 'TANGENT'})

    # ---- combine colour x AO and write the textures ------------------------------------
    def px(img):
        a = np.empty(SIZE * SIZE * 4, np.float32)
        img.pixels.foreach_get(a)
        return a.reshape(SIZE, SIZE, 4)
    c = px(col)
    a = px(ao)[..., 0:1]
    c[..., :3] = c[..., :3] * (0.35 + 0.65 * a)
    out_col = bpy.data.images.new(key + '_color_out', SIZE, SIZE, alpha=False)
    out_col.colorspace_settings.name = 'sRGB'
    out_col.pixels.foreach_set(np.clip(c, 0, 1).ravel())

    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.display_settings.display_device = 'sRGB'
    jpg = sc.render.image_settings
    jpg.file_format = 'JPEG'
    jpg.quality = 86
    jpg.color_mode = 'RGB'
    col_path = os.path.join(OUT, key + '_color.jpg')
    out_col.save_render(col_path, scene=sc)
    jpg.quality = 92
    nrm_path = os.path.join(OUT, key + '_normal.jpg')
    nrm.save_render(nrm_path, scene=sc)
    log(key, 'textures written', os.path.getsize(col_path) // 1024, 'KB /', os.path.getsize(nrm_path) // 1024, 'KB')

    # ---- final materials + export --------------------------------------------------------
    for img in (col, ao, nrm, out_col):
        pass
    body_mat = bpy.data.materials.new('M_' + key)
    body_mat.use_nodes = True
    n2 = body_mat.node_tree
    b = n2.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.62
    b.inputs['Metallic'].default_value = 0.18
    ci = n2.nodes.new('ShaderNodeTexImage'); ci.image = bpy.data.images.load(col_path); ci.image.colorspace_settings.name = 'sRGB'
    n2.links.new(ci.outputs['Color'], b.inputs['Base Color'])
    ni = n2.nodes.new('ShaderNodeTexImage'); ni.image = bpy.data.images.load(nrm_path); ni.image.colorspace_settings.name = 'Non-Color'
    nm = n2.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
    n2.links.new(ni.outputs['Color'], nm.inputs['Color'])
    n2.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    me.materials.clear()
    me.materials.append(body_mat)

    glass_mat = new_material('M_glass_' + key, color=(0.05, 0.07, 0.09), rough=0.08, metal=0.0, alpha=0.38)
    led_mat = new_material('M_led_' + key, color=(0.9, 0.85, 0.7), rough=0.3, emit=(1.0, 0.9, 0.7))

    # drop everything that is not part of the export
    keep = [low] + glass + led
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in glass + led:
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
    for o in glass:
        o.data.materials.clear(); o.data.materials.append(glass_mat); o.name = key + '_glass_' + o.name
    for o in led:
        o.data.materials.clear(); o.data.materials.append(led_mat); o.name = key + '_led_' + o.name
    # glass + leds as single objects
    for group, nm_ in ((glass, key + '_glass'), (led, key + '_led')):
        if len(group) > 1:
            bpy.ops.object.select_all(action='DESELECT')
            for o in group:
                o.select_set(True)
            bpy.context.view_layer.objects.active = group[0]
            bpy.ops.object.join()
            bpy.context.view_layer.objects.active.name = nm_
        elif group:
            group[0].name = nm_

    for o in bpy.data.objects:
        if o.type == 'MESH':
            for p in o.data.polygons:
                p.use_smooth = True

    # report bounds
    mn = [1e9] * 3; mx = [-1e9] * 3
    for o in bpy.data.objects:
        for v in o.bound_box:
            for i in range(3):
                mn[i] = min(mn[i], v[i]); mx[i] = max(mx[i], v[i])
    log(key, 'bounds', [round(x, 3) for x in mn], [round(x, 3) for x in mx])
    json.dump({'min': mn, 'max': mx, 'tris': low_tris}, open(os.path.join(OUT, key + '.json'), 'w'))

    for o in bpy.data.objects:
        if o.type == 'MESH':
            log('  export object', o.name, 'data', o.data.name, 'tris', tri_count(o.data), 'uv', o.data.uv_layers.keys(), 'mods', [m.name for m in o.modifiers], 'mats', [m.name for m in o.data.materials])
    glb = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=False, export_yup=False,
                              export_apply=True, export_image_format='JPEG', export_jpeg_quality=88,
                              export_normals=True, export_texcoords=True, export_materials='EXPORT',
                              export_cameras=False, export_lights=False, export_extras=False)
    log(key, 'exported', os.path.getsize(glb) // 1024, 'KB', round(time.time() - t0, 1), 's total')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['engine', 'cart']
    for key in argv:
        _img_cache.clear()
        sc = reset()
        build(sc, key)


main()
