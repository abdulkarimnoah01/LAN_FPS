# Rig and author glTF skeletal animations for characters in Blender 5.2.
# Usage:
#   blender -b --factory-startup --python source/tools/rig_and_animate.py -- <input_glb> <output_glb> [pose: tpose|relaxed] [max_px]

import bpy
import sys
import os
import math
from mathutils import Vector, Euler, Quaternion

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(args) < 2:
    sys.exit('usage: blender -b --python rig_and_animate.py -- <input_glb> <output_glb> [pose] [max_px]')

src = args[0]
out = args[1]
pose_type = args[2] if len(args) > 2 and args[2] in ('tpose', 'relaxed') else 'tpose'
max_px = int(args[3]) if len(args) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

# Remove cameras and lights
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)

mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']
if not mesh_objs:
    sys.exit('No mesh found in ' + src)

char_mesh = mesh_objs[0]

# Scale textures
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > max_px:
        k = max_px / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
        print(f'Scaled image {img.name}: {w}x{h} -> {img.size[0]}x{img.size[1]}')

# Weld duplicate vertices to enable clean automatic bone heat weighting
bpy.context.view_layer.objects.active = char_mesh
char_mesh.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode='OBJECT')

# Apply all transforms to mesh
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Create Armature
arm_data = bpy.data.armatures.new('Humanoid_Armature')
arm_data.display_type = 'OCTAHEDRAL'
arm_obj = bpy.data.objects.new('Armature', arm_data)
bpy.context.scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)

bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones

def make_bone(name, head, tail, parent_name=None):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent_name and parent_name in eb:
        b.parent = eb[parent_name]
    return b

# Spine & Torso
make_bone('Hips', (0, 0, 0.96), (0, 0, 1.14))
make_bone('Spine', (0, 0, 1.14), (0, 0, 1.34), 'Hips')
make_bone('Chest', (0, 0, 1.34), (0, 0, 1.48), 'Spine')
make_bone('Neck', (0, 0, 1.48), (0, 0, 1.58), 'Chest')
make_bone('Head', (0, 0, 1.58), (0, 0, 1.80), 'Neck')

# Legs
make_bone('UpperLeg.L', (0.13, 0.01, 0.94), (0.13, 0.00, 0.50), 'Hips')
make_bone('LowerLeg.L', (0.13, 0.00, 0.50), (0.13, 0.01, 0.10), 'UpperLeg.L')
make_bone('Foot.L', (0.13, 0.01, 0.10), (0.13, -0.16, 0.02), 'LowerLeg.L')

make_bone('UpperLeg.R', (-0.13, 0.01, 0.94), (-0.13, 0.00, 0.50), 'Hips')
make_bone('LowerLeg.R', (-0.13, 0.00, 0.50), (-0.13, 0.01, 0.10), 'UpperLeg.R')
make_bone('Foot.R', (-0.13, 0.01, 0.10), (-0.13, -0.16, 0.02), 'LowerLeg.R')

# Arms
if pose_type == 'relaxed':
    # Mina's relaxed standing pose
    make_bone('Shoulder.L', (0.08, 0, 1.44), (0.18, 0, 1.42), 'Chest')
    make_bone('UpperArm.L', (0.18, 0, 1.42), (0.26, 0.01, 1.14), 'Shoulder.L')
    make_bone('Forearm.L', (0.26, 0.01, 1.14), (0.32, 0.02, 0.88), 'UpperArm.L')
    make_bone('Hand.L', (0.32, 0.02, 0.88), (0.34, 0.03, 0.76), 'Forearm.L')

    make_bone('Shoulder.R', (-0.08, 0, 1.44), (-0.18, 0, 1.42), 'Chest')
    make_bone('UpperArm.R', (-0.18, 0, 1.42), (-0.26, 0.01, 1.14), 'Shoulder.R')
    make_bone('Forearm.R', (-0.26, 0.01, 1.14), (-0.32, 0.02, 0.88), 'UpperArm.R')
    make_bone('Hand.R', (-0.32, 0.02, 0.88), (-0.34, 0.03, 0.76), 'Forearm.R')
else:
    # T-pose (Kimo, Kimo Black)
    make_bone('Shoulder.L', (0.08, 0, 1.42), (0.18, 0, 1.41), 'Chest')
    make_bone('UpperArm.L', (0.18, 0, 1.41), (0.45, 0.01, 1.39), 'Shoulder.L')
    make_bone('Forearm.L', (0.45, 0.01, 1.39), (0.66, 0.02, 1.38), 'UpperArm.L')
    make_bone('Hand.L', (0.66, 0.02, 1.38), (0.78, 0.03, 1.37), 'Forearm.L')

    make_bone('Shoulder.R', (-0.08, 0, 1.42), (-0.18, 0, 1.41), 'Chest')
    make_bone('UpperArm.R', (-0.18, 0, 1.41), (-0.45, 0.01, 1.39), 'Shoulder.R')
    make_bone('Forearm.R', (-0.45, 0.01, 1.39), (-0.66, 0.02, 1.38), 'UpperArm.R')
    make_bone('Hand.R', (-0.66, 0.02, 1.38), (-0.78, 0.03, 1.37), 'Forearm.R')

bpy.ops.object.mode_set(mode='OBJECT')

# Bind mesh to armature
bpy.ops.object.select_all(action='DESELECT')
char_mesh.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj

bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('Armature auto-weighted successfully!')

# Setup Pose Mode
bpy.ops.object.mode_set(mode='POSE')
for pb in arm_obj.pose.bones:
    pb.rotation_mode = 'XYZ'

actions = []

def create_action(name, total_frames, keyframe_builder):
    action = bpy.data.actions.new(name=name)
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = action

    # Clear transforms
    for pb in arm_obj.pose.bones:
        pb.location = Vector((0, 0, 0))
        pb.rotation_euler = Euler((0, 0, 0))
        pb.scale = Vector((1, 1, 1))

    keyframe_builder(total_frames)

    # Push action to NLA track so glTF exporter captures all actions
    track = arm_obj.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    actions.append(action)
    print(f'Created action: {name} ({total_frames} frames)')

# 1. IDLE Animation
def build_idle(total):
    for f in range(1, total + 1):
        t = (f - 1) / (total - 1) * math.pi * 2
        # Hips breathing
        pb_hips = arm_obj.pose.bones['Hips']
        pb_hips.location.z = math.sin(t) * 0.008
        pb_hips.keyframe_insert(data_path='location', index=2, frame=f)

        # Chest breathing
        pb_chest = arm_obj.pose.bones['Chest']
        pb_chest.rotation_euler.x = math.sin(t) * 0.025
        pb_chest.keyframe_insert(data_path='rotation_euler', index=0, frame=f)

        # Arms in weapon hold position
        pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
        pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
        pb_farm_l = arm_obj.pose.bones['Forearm.L']
        pb_farm_r = arm_obj.pose.bones['Forearm.R']

        if pose_type == 'relaxed':
            pb_uarm_l.rotation_euler = Euler((math.radians(65), math.radians(18), math.radians(-10)))
            pb_farm_l.rotation_euler = Euler((math.radians(45), math.radians(0), math.radians(20)))
            pb_uarm_r.rotation_euler = Euler((math.radians(70), math.radians(-12), math.radians(10)))
            pb_farm_r.rotation_euler = Euler((math.radians(50), math.radians(0), math.radians(-20)))
        else:
            pb_uarm_l.rotation_euler = Euler((math.radians(60), math.radians(0), math.radians(-65)))
            pb_farm_l.rotation_euler = Euler((math.radians(25), math.radians(0), math.radians(55)))
            pb_uarm_r.rotation_euler = Euler((math.radians(65), math.radians(0), math.radians(65)))
            pb_farm_r.rotation_euler = Euler((math.radians(30), math.radians(0), math.radians(-55)))

        pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

create_action('idle', 60, build_idle)

# 2. RUN Animation
def build_run(total):
    for f in range(1, total + 1):
        t = (f - 1) / total * math.pi * 2
        # Hips vertical bounce and yaw sway
        pb_hips = arm_obj.pose.bones['Hips']
        pb_hips.location.z = -abs(math.sin(t * 2)) * 0.06
        pb_hips.rotation_euler.z = math.sin(t) * 0.08
        pb_hips.keyframe_insert(data_path='location', index=2, frame=f)
        pb_hips.keyframe_insert(data_path='rotation_euler', index=2, frame=f)

        # Forward lean
        pb_chest = arm_obj.pose.bones['Chest']
        pb_chest.rotation_euler.x = math.radians(14)
        pb_chest.keyframe_insert(data_path='rotation_euler', index=0, frame=f)

        # Legs stride
        leg_amp = math.radians(46)
        knee_amp = math.radians(58)
        pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
        pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
        pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
        pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']

        pb_uleg_l.rotation_euler.x = math.sin(t) * leg_amp
        pb_lleg_l.rotation_euler.x = max(0, -math.sin(t - 0.4) * knee_amp)
        pb_uleg_r.rotation_euler.x = -math.sin(t) * leg_amp
        pb_lleg_r.rotation_euler.x = max(0, math.sin(t - 0.4) * knee_amp)

        pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)

        # Arms with running bob
        pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
        pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
        bob = math.sin(t * 2) * 0.06
        if pose_type == 'relaxed':
            pb_uarm_l.rotation_euler = Euler((math.radians(65) + bob, math.radians(18), math.radians(-10)))
            pb_uarm_r.rotation_euler = Euler((math.radians(70) - bob, math.radians(-12), math.radians(10)))
        else:
            pb_uarm_l.rotation_euler = Euler((math.radians(60) + bob, math.radians(0), math.radians(-65)))
            pb_uarm_r.rotation_euler = Euler((math.radians(65) - bob, math.radians(0), math.radians(65)))

        pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)

create_action('run', 24, build_run)

# 3. WALK Animation
def build_walk(total):
    for f in range(1, total + 1):
        t = (f - 1) / total * math.pi * 2
        pb_hips = arm_obj.pose.bones['Hips']
        pb_hips.location.z = -abs(math.sin(t * 2)) * 0.03
        pb_hips.keyframe_insert(data_path='location', index=2, frame=f)

        leg_amp = math.radians(28)
        pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
        pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
        pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
        pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']

        pb_uleg_l.rotation_euler.x = math.sin(t) * leg_amp
        pb_lleg_l.rotation_euler.x = max(0, -math.sin(t - 0.3) * math.radians(35))
        pb_uleg_r.rotation_euler.x = -math.sin(t) * leg_amp
        pb_lleg_r.rotation_euler.x = max(0, math.sin(t - 0.3) * math.radians(35))

        pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)

        pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
        pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
        if pose_type == 'relaxed':
            pb_uarm_l.rotation_euler = Euler((math.radians(65), math.radians(18), math.radians(-10)))
            pb_uarm_r.rotation_euler = Euler((math.radians(70), math.radians(-12), math.radians(10)))
        else:
            pb_uarm_l.rotation_euler = Euler((math.radians(60), math.radians(0), math.radians(-65)))
            pb_uarm_r.rotation_euler = Euler((math.radians(65), math.radians(0), math.radians(65)))

        pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)

create_action('walk', 32, build_walk)

# 4. CROUCH Animation
def build_crouch(total):
    for f in range(1, total + 1):
        t = (f - 1) / (total - 1) * math.pi * 2
        pb_hips = arm_obj.pose.bones['Hips']
        pb_hips.location.z = -0.35 + math.sin(t) * 0.005
        pb_hips.keyframe_insert(data_path='location', frame=f)

        pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
        pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
        pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
        pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']

        pb_uleg_l.rotation_euler.x = math.radians(55)
        pb_lleg_l.rotation_euler.x = math.radians(85)
        pb_uleg_r.rotation_euler.x = math.radians(55)
        pb_lleg_r.rotation_euler.x = math.radians(85)

        pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)

        pb_chest = arm_obj.pose.bones['Chest']
        pb_chest.rotation_euler.x = math.radians(16)
        pb_chest.keyframe_insert(data_path='rotation_euler', frame=f)

        pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
        pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
        if pose_type == 'relaxed':
            pb_uarm_l.rotation_euler = Euler((math.radians(72), math.radians(20), math.radians(-12)))
            pb_uarm_r.rotation_euler = Euler((math.radians(76), math.radians(-14), math.radians(12)))
        else:
            pb_uarm_l.rotation_euler = Euler((math.radians(68), math.radians(0), math.radians(-65)))
            pb_uarm_r.rotation_euler = Euler((math.radians(72), math.radians(0), math.radians(65)))

        pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)

create_action('crouch', 30, build_crouch)

# 5. DIE Animation
def build_die(total):
    for f in range(1, total + 1):
        p = (f - 1) / (total - 1)
        fall_angle = math.radians(90) * min(1.0, p * 1.3)
        drop_z = -0.85 * min(1.0, p * 1.3)

        pb_hips = arm_obj.pose.bones['Hips']
        pb_hips.location.z = drop_z
        pb_hips.location.y = -0.4 * min(1.0, p * 1.3)
        pb_hips.rotation_euler.x = -fall_angle
        pb_hips.keyframe_insert(data_path='location', frame=f)
        pb_hips.keyframe_insert(data_path='rotation_euler', frame=f)

        pb_head = arm_obj.pose.bones['Head']
        pb_head.rotation_euler.x = -math.radians(35) * min(1.0, p * 1.2)
        pb_head.keyframe_insert(data_path='rotation_euler', frame=f)

        pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
        pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
        pb_uarm_l.rotation_euler.x = math.radians(30) * (1 - p)
        pb_uarm_r.rotation_euler.x = math.radians(30) * (1 - p)
        pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
        pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)

create_action('die', 40, build_die)

bpy.ops.object.mode_set(mode='OBJECT')

# Set idle as active action for default rest pose
arm_obj.animation_data.action = actions[0]

# Select all required objects for export
bpy.ops.object.select_all(action='DESELECT')
char_mesh.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_image_format='AUTO',
    export_apply=False,
    export_yup=True,
    export_animations=True,
    export_nla_strips=True,
    export_skins=True,
    export_morph=False
)

print(f'Wrote rigged & animated GLB: {out}')
