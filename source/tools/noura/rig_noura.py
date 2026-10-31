"""Rig and animate Noura (A-pose, six modular meshes) with the game's 17-bone skeleton and
the five clips idle / run / walk / crouch / die.

    blender -b -P rig_noura.py -- <unrigged.glb> <out.glb>

rig_batch.py assumes a T-pose; Noura stands in an A-pose, so bones follow her arms and the
arm motion is authored in world axes and converted into each bone's rest frame.
"""
import bpy, sys, math
from mathutils import Vector, Quaternion

src, out = sys.argv[sys.argv.index('--') + 1:][:2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT', 'ARMATURE'):
        bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for m in meshes:
    m.parent = None
    m.modifiers.clear()
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---- armature fitted to the A-pose (x = character left/right, -y = forward, z = up) ----
arm_data = bpy.data.armatures.new('Noura_Armature')
arm_obj = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if parent:
        b.parent = eb[parent]


bone('Hips', (0, 0, 0.93), (0, 0, 1.0))
bone('Spine', (0, 0, 1.0), (0, 0, 1.18), 'Hips')
bone('Chest', (0, 0, 1.18), (0, 0, 1.38), 'Spine')
bone('Neck', (0, 0, 1.38), (0, 0, 1.45), 'Chest')
bone('Head', (0, 0, 1.45), (0, 0, 1.78), 'Neck')
for s, k in (('L', 1), ('R', -1)):
    bone(f'UpperLeg.{s}', (k * 0.09, 0, 0.93), (k * 0.16, 0, 0.50), 'Hips')
    bone(f'LowerLeg.{s}', (k * 0.16, 0, 0.50), (k * 0.22, 0, 0.12), f'UpperLeg.{s}')
    bone(f'Foot.{s}', (k * 0.22, 0.05, 0.10), (k * 0.22, -0.17, 0.03), f'LowerLeg.{s}')
    bone(f'UpperArm.{s}', (k * 0.17, 0, 1.40), (k * 0.26, 0, 1.18), 'Chest')
    bone(f'Forearm.{s}', (k * 0.26, 0, 1.18), (k * 0.34, 0, 0.96), f'UpperArm.{s}')
    bone(f'Hand.{s}', (k * 0.34, 0, 0.96), (k * 0.40, 0, 0.80), f'Forearm.{s}')
bpy.ops.object.mode_set(mode='OBJECT')

# ---- weights: blender's heat weighting fails on these overlapping garments, so weight by distance
# to each bone segment (minus a per-bone radius), keep the 4 strongest influences.
RADIUS = {'Hips': .16, 'Spine': .16, 'Chest': .17, 'Neck': .07, 'Head': .14, 'UpperLeg': .11, 'LowerLeg': .09,
          'Foot': .07, 'UpperArm': .06, 'Forearm': .05, 'Hand': .04}
segs = {}
for b_ in arm_data.bones:
    segs[b_.name] = (b_.head_local.copy(), b_.tail_local.copy(), RADIUS[b_.name.split('.')[0]])


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def allowed(name, p):
    if name.endswith('.L') and name.split('.')[0] in ('UpperLeg', 'LowerLeg', 'Foot', 'UpperArm', 'Forearm', 'Hand'):
        return p.x > -0.03
    if name.endswith('.R') and name.split('.')[0] in ('UpperLeg', 'LowerLeg', 'Foot', 'UpperArm', 'Forearm', 'Hand'):
        return p.x < 0.03
    return True


for m in meshes:
    for name in segs:
        m.vertex_groups.new(name=name)
    for v in m.data.vertices:
        if 'Hair' in m.name:
            m.vertex_groups['Head'].add([v.index], 1.0, 'REPLACE')
            continue
        p = v.co
        w = {n: 1.0 / (max(seg_dist(p, a, b) - r, 0.0) + 0.03) ** 3 for n, (a, b, r) in segs.items() if allowed(n, p)}
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top)
        for n, x in top:
            m.vertex_groups[n].add([v.index], x / tot, 'REPLACE')
    mod = m.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_obj
    m.parent = arm_obj

bpy.ops.object.mode_set(mode='POSE')
pose = arm_obj.pose.bones
for pb in pose:
    pb.rotation_mode = 'XYZ'
rest = {pb.name: pb.bone.matrix_local.to_3x3() for pb in pose}


def rot_world(name, x=0.0, y=0.0, z=0.0):
    """Set a bone rotation from world-axis angles in degrees, converted to its rest frame."""
    w = Quaternion((0, 0, 1), math.radians(z)) @ Quaternion((0, 1, 0), math.radians(y)) @ Quaternion((1, 0, 0), math.radians(x))
    r = rest[name]
    pose[name].rotation_euler = (r.inverted() @ w.to_matrix() @ r).to_euler('XYZ')


def key(name, frame, loc=False, rot=True):
    if loc:
        pose[name].keyframe_insert('location', frame=frame)
    if rot:
        pose[name].keyframe_insert('rotation_euler', frame=frame)


actions = []


def action(act_name, frames, build):
    act = bpy.data.actions.new(act_name)
    act.use_fake_user = True
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    for f in range(1, frames + 1):
        for pb in pose:
            pb.location = Vector((0, 0, 0))
            pb.rotation_euler = (0, 0, 0)
        build(f, frames)
        for pb in pose:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_euler', frame=f)
    actions.append(act)


# forward swing = negative rotation about world X (forward is -Y)
def arms(f_l, f_r, bend_l, bend_r, out=0.0):
    rot_world('UpperArm.L', x=f_l, z=-out)
    rot_world('UpperArm.R', x=f_r, z=out)
    rot_world('Forearm.L', x=bend_l)
    rot_world('Forearm.R', x=bend_r)


def idle(f, n):
    t = (f - 1) / (n - 1) * math.tau
    pose['Hips'].location.z = math.sin(t) * 0.006
    rot_world('Chest', x=math.sin(t) * 1.0)
    s = math.sin(t) * 1.5
    arms(-8 + s, -8 - s, -28, -28)


def walk(f, n):
    t = (f - 1) / n * math.tau
    pose['Hips'].location.z = -abs(math.sin(t * 2)) * 0.025
    rot_world('Hips', z=math.sin(t) * 2.5)
    pose['UpperLeg.L'].rotation_euler.x = math.sin(t) * math.radians(26)
    pose['LowerLeg.L'].rotation_euler.x = min(0.0, math.sin(t - 0.4) * math.radians(38))
    pose['UpperLeg.R'].rotation_euler.x = -math.sin(t) * math.radians(26)
    pose['LowerLeg.R'].rotation_euler.x = min(0.0, -math.sin(t - 0.4) * math.radians(38))
    sw = math.sin(t) * 22
    arms(-8 + sw, -8 - sw, -22 - max(0, sw) * 0.6, -22 + min(0, sw) * 0.6)


def run(f, n):
    t = (f - 1) / n * math.tau
    pose['Hips'].location.z = -abs(math.sin(t * 2)) * 0.05
    rot_world('Hips', z=math.sin(t) * 4.5)
    rot_world('Chest', x=-8, z=-math.sin(t) * 3.5)
    pose['UpperLeg.L'].rotation_euler.x = math.sin(t) * math.radians(44)
    pose['LowerLeg.L'].rotation_euler.x = min(0.0, math.sin(t - 0.5) * math.radians(65))
    pose['UpperLeg.R'].rotation_euler.x = -math.sin(t) * math.radians(44)
    pose['LowerLeg.R'].rotation_euler.x = min(0.0, -math.sin(t - 0.5) * math.radians(65))
    sw = math.sin(t) * 42
    arms(-10 + sw, -10 - sw, -70 - max(0, sw) * 0.5, -70 + min(0, sw) * 0.5)


def crouch(f, n):
    t = (f - 1) / (n - 1) * math.tau
    pose['Hips'].location = Vector((0, -0.10, -0.36 + math.sin(t) * 0.005))
    for s in 'LR':
        pose[f'UpperLeg.{s}'].rotation_euler.x = math.radians(52)
        pose[f'LowerLeg.{s}'].rotation_euler.x = -math.radians(82)
        pose[f'Foot.{s}'].rotation_euler.x = math.radians(30)
    rot_world('Chest', x=-16)
    arms(-20, -20, -45, -45)


def die(f, n):
    p = (f - 1) / (n - 1)
    k = min(1.0, p * 1.25)
    pose['Hips'].location = Vector((0, -0.35 * k, -0.82 * k))
    pose['Hips'].rotation_euler.x = -math.radians(88) * k
    rot_world('Head', x=25 * k)
    arms(-8 * (1 - p), -8 * (1 - p), -28 * (1 - p), -28 * (1 - p), out=40 * p)


action('idle', 60, idle)
action('run', 24, run)
action('walk', 32, walk)
action('crouch', 30, crouch)
action('die', 40, die)

bpy.ops.object.mode_set(mode='OBJECT')
arm_obj.animation_data.action = actions[0]
bpy.ops.object.select_all(action='DESELECT')
for m in meshes:
    m.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='AUTO', export_apply=False,
                          export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_skins=True, export_morph=False)
print('RIGGED ->', out)
