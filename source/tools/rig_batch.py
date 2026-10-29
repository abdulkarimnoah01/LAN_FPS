import bpy
import sys
import os
import math
from mathutils import Vector, Euler

CHARACTERS = [
    {
        "name": "Romero",
        "src": r"X:\Assets\Geo\Characters\character-lowpoly-main\characters\romero\romero.glb",
        "out": r"X:\Projects\game\LAN_FPS\source\assets\characters\Romero.glb",
        "pose": "tpose"
    },
    {
        "name": "ElDeep",
        "src": r"X:\Assets\Geo\Characters\character-lowpoly-main\characters\eldeep\eldeep.glb",
        "out": r"X:\Projects\game\LAN_FPS\source\assets\characters\ElDeep.glb",
        "pose": "tpose"
    },
    {
        "name": "Gemy",
        "src": r"X:\Assets\Geo\Characters\character-lowpoly-main\characters\gemy\gemy.glb",
        "out": r"X:\Projects\game\LAN_FPS\source\assets\characters\Gemy.glb",
        "pose": "tpose"
    },
    {
        "name": "Hamdy",
        "src": r"X:\Assets\Geo\Characters\character-lowpoly-main\characters\hamdy\hamdy.glb",
        "out": r"X:\Projects\game\LAN_FPS\source\assets\characters\Hamdy.glb",
        "pose": "tpose"
    },
    {
        "name": "Hooda",
        "src": r"X:\Assets\Geo\Characters\character-lowpoly-main\characters\hooda\hooda.glb",
        "out": r"X:\Projects\game\LAN_FPS\source\assets\characters\Hooda.glb",
        "pose": "tpose"
    }
]

max_px = 1024

for char in CHARACTERS:
    name = char["name"]
    src = char["src"]
    out = char["out"]
    pose_type = char["pose"]

    print(f"\n==========================================")
    print(f"Rigging & Animating Character: {name}")
    print(f"Source: {src}")
    print(f"Output: {out}")
    print(f"==========================================")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)

    # Remove cameras, lights, existing armatures, and extraneous helper meshes
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT', 'ARMATURE') or (o.type == 'MESH' and 'icosphere' in o.name.lower()):
            bpy.data.objects.remove(o)

    # Clear any previous actions
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)

    mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']
    if not mesh_objs:
        print(f"ERROR: No mesh found in {src}")
        continue

    char_mesh = next((m for m in mesh_objs if 'tripo' in m.name.lower()), mesh_objs[0])
    char_mesh.modifiers.clear()

    for m in list(bpy.data.objects):
        if m.type == 'MESH' and m != char_mesh:
            bpy.data.objects.remove(m)

    # Scale textures if needed
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

    # Apply initial transforms
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Height and ground normalization
    min_z = min(v.co.z for v in char_mesh.data.vertices)
    max_z = max(v.co.z for v in char_mesh.data.vertices)
    h = max_z - min_z
    if h > 0.1:
        target_h = 1.78
        s = target_h / h
        char_mesh.scale = (s, s, s)
        char_mesh.location.z = -min_z * s
        min_x = min(v.co.x for v in char_mesh.data.vertices) * s
        max_x = max(v.co.x for v in char_mesh.data.vertices) * s
        min_y = min(v.co.y for v in char_mesh.data.vertices) * s
        max_y = max(v.co.y for v in char_mesh.data.vertices) * s
        char_mesh.location.x = -(min_x + max_x) / 2
        char_mesh.location.y = -(min_y + max_y) / 2
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        print(f'Normalized {name} height: {h:.3f}m -> 1.78m, grounded feet at Z=0')

    # Create Armature
    arm_data = bpy.data.armatures.new(f'{name}_Armature')
    arm_data.display_type = 'OCTAHEDRAL'
    arm_obj = bpy.data.objects.new('Armature', arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)

    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones

    def make_bone(bname, head, tail, parent_name=None):
        b = eb.new(bname)
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
    make_bone('UpperArm.L', (0.18, 0, 1.41), (0.45, 0.01, 1.39), 'Chest')
    make_bone('Forearm.L', (0.45, 0.01, 1.39), (0.66, 0.02, 1.38), 'UpperArm.L')
    make_bone('Hand.L', (0.66, 0.02, 1.38), (0.78, 0.03, 1.37), 'Forearm.L')

    make_bone('UpperArm.R', (-0.18, 0, 1.41), (-0.45, 0.01, 1.39), 'Chest')
    make_bone('Forearm.R', (-0.45, 0.01, 1.39), (-0.66, 0.02, 1.38), 'UpperArm.R')
    make_bone('Hand.R', (-0.66, 0.02, 1.38), (-0.78, 0.03, 1.37), 'Forearm.R')

    bpy.ops.object.mode_set(mode='OBJECT')

    # Bind mesh to armature with auto-weighting
    bpy.ops.object.select_all(action='DESELECT')
    char_mesh.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj

    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print(f'Armature auto-weighted successfully for {name}!')

    # Setup Pose Mode
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = 'XYZ'

    actions = []

    def create_action(act_name, total_frames, keyframe_builder):
        action = bpy.data.actions.new(name=act_name)
        action.use_fake_user = True
        if not arm_obj.animation_data:
            arm_obj.animation_data_create()
        arm_obj.animation_data.action = action

        for pb in arm_obj.pose.bones:
            pb.location = Vector((0, 0, 0))
            pb.rotation_euler = Euler((0, 0, 0))
            pb.scale = Vector((1, 1, 1))

        keyframe_builder(total_frames)
        actions.append(action)

    # 1. IDLE
    def build_idle(total):
        for f in range(1, total + 1):
            t = (f - 1) / (total - 1) * math.pi * 2
            pb_hips = arm_obj.pose.bones['Hips']
            pb_hips.location.z = math.sin(t) * 0.006
            pb_hips.keyframe_insert(data_path='location', index=2, frame=f)

            pb_chest = arm_obj.pose.bones['Chest']
            pb_chest.rotation_euler.x = math.sin(t) * 0.018
            pb_chest.keyframe_insert(data_path='rotation_euler', index=0, frame=f)

            pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
            pb_farm_l = arm_obj.pose.bones['Forearm.L']
            pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
            pb_farm_r = arm_obj.pose.bones['Forearm.R']

            breath_sway = math.sin(t) * 0.015
            pb_uarm_l.rotation_euler = Euler((math.radians(-55) + breath_sway, math.radians(5), math.radians(-35)))
            pb_farm_l.rotation_euler = Euler((0, 0, math.radians(-80)))
            pb_uarm_r.rotation_euler = Euler((math.radians(-55) - breath_sway, math.radians(-5), math.radians(35)))
            pb_farm_r.rotation_euler = Euler((0, 0, math.radians(80)))

            pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

    create_action('idle', 60, build_idle)

    # 2. RUN
    def build_run(total):
        for f in range(1, total + 1):
            t = (f - 1) / total * math.pi * 2
            pb_hips = arm_obj.pose.bones['Hips']
            pb_hips.location.z = -abs(math.sin(t * 2)) * 0.05
            pb_hips.rotation_euler.z = math.sin(t) * 0.08
            pb_hips.keyframe_insert(data_path='location', index=2, frame=f)
            pb_hips.keyframe_insert(data_path='rotation_euler', index=2, frame=f)

            pb_chest = arm_obj.pose.bones['Chest']
            pb_chest.rotation_euler.x = math.radians(14)
            pb_chest.rotation_euler.z = -math.sin(t) * 0.06
            pb_chest.keyframe_insert(data_path='rotation_euler', frame=f)

            leg_amp = math.radians(44)
            knee_amp = math.radians(65)
            pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
            pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
            pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
            pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']

            pb_uleg_l.rotation_euler.x = math.sin(t) * leg_amp
            pb_lleg_l.rotation_euler.x = min(0.0, math.sin(t - 0.5) * knee_amp)
            pb_uleg_r.rotation_euler.x = -math.sin(t) * leg_amp
            pb_lleg_r.rotation_euler.x = min(0.0, -math.sin(t - 0.5) * knee_amp)

            pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
            pb_farm_l = arm_obj.pose.bones['Forearm.L']
            pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
            pb_farm_r = arm_obj.pose.bones['Forearm.R']

            bob = math.sin(t * 2) * 0.06
            pb_uarm_l.rotation_euler = Euler((math.radians(-52) + bob, math.radians(5), math.radians(-32)))
            pb_farm_l.rotation_euler = Euler((math.cos(t * 2) * 0.04, 0, math.radians(-76)))
            pb_uarm_r.rotation_euler = Euler((math.radians(-52) - bob, math.radians(-5), math.radians(32)))
            pb_farm_r.rotation_euler = Euler((-math.cos(t * 2) * 0.04, 0, math.radians(76)))

            pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

    create_action('run', 24, build_run)

    # 3. WALK
    def build_walk(total):
        for f in range(1, total + 1):
            t = (f - 1) / total * math.pi * 2
            pb_hips = arm_obj.pose.bones['Hips']
            pb_hips.location.z = -abs(math.sin(t * 2)) * 0.025
            pb_hips.rotation_euler.z = math.sin(t) * 0.04
            pb_hips.keyframe_insert(data_path='location', index=2, frame=f)
            pb_hips.keyframe_insert(data_path='rotation_euler', index=2, frame=f)

            leg_amp = math.radians(26)
            knee_amp = math.radians(38)
            pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
            pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
            pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
            pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']

            pb_uleg_l.rotation_euler.x = math.sin(t) * leg_amp
            pb_lleg_l.rotation_euler.x = min(0.0, math.sin(t - 0.4) * knee_amp)
            pb_uleg_r.rotation_euler.x = -math.sin(t) * leg_amp
            pb_lleg_r.rotation_euler.x = min(0.0, -math.sin(t - 0.4) * knee_amp)

            pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
            pb_farm_l = arm_obj.pose.bones['Forearm.L']
            pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
            pb_farm_r = arm_obj.pose.bones['Forearm.R']

            bob = math.sin(t * 2) * 0.03
            pb_uarm_l.rotation_euler = Euler((math.radians(-55) + bob, math.radians(5), math.radians(-35)))
            pb_farm_l.rotation_euler = Euler((0, 0, math.radians(-80)))
            pb_uarm_r.rotation_euler = Euler((math.radians(-55) - bob, math.radians(-5), math.radians(35)))
            pb_farm_r.rotation_euler = Euler((0, 0, math.radians(80)))

            pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

    create_action('walk', 32, build_walk)

    # 4. CROUCH
    def build_crouch(total):
        for f in range(1, total + 1):
            t = (f - 1) / (total - 1) * math.pi * 2
            pb_hips = arm_obj.pose.bones['Hips']
            pb_hips.location = Vector((0, -0.10, -0.36 + math.sin(t) * 0.005))
            pb_hips.keyframe_insert(data_path='location', frame=f)

            pb_uleg_l = arm_obj.pose.bones['UpperLeg.L']
            pb_lleg_l = arm_obj.pose.bones['LowerLeg.L']
            pb_foot_l = arm_obj.pose.bones['Foot.L']

            pb_uleg_r = arm_obj.pose.bones['UpperLeg.R']
            pb_lleg_r = arm_obj.pose.bones['LowerLeg.R']
            pb_foot_r = arm_obj.pose.bones['Foot.R']

            pb_uleg_l.rotation_euler.x = math.radians(52)
            pb_lleg_l.rotation_euler.x = -math.radians(82)
            pb_foot_l.rotation_euler.x = math.radians(30)

            pb_uleg_r.rotation_euler.x = math.radians(52)
            pb_lleg_r.rotation_euler.x = -math.radians(82)
            pb_foot_r.rotation_euler.x = math.radians(30)

            pb_uleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_foot_l.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_uleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_lleg_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_foot_r.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_chest = arm_obj.pose.bones['Chest']
            pb_chest.rotation_euler.x = math.radians(16)
            pb_chest.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
            pb_farm_l = arm_obj.pose.bones['Forearm.L']
            pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
            pb_farm_r = arm_obj.pose.bones['Forearm.R']

            pb_uarm_l.rotation_euler = Euler((math.radians(-52), math.radians(5), math.radians(-32)))
            pb_farm_l.rotation_euler = Euler((0, 0, math.radians(-78)))
            pb_uarm_r.rotation_euler = Euler((math.radians(-52), math.radians(-5), math.radians(32)))
            pb_farm_r.rotation_euler = Euler((0, 0, math.radians(78)))

            pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

    create_action('crouch', 30, build_crouch)

    # 5. DIE
    def build_die(total):
        for f in range(1, total + 1):
            p = (f - 1) / (total - 1)
            fall_prog = min(1.0, p * 1.25)
            fall_angle = -math.radians(88) * fall_prog
            drop_z = -0.82 * fall_prog
            slide_y = -0.35 * fall_prog

            pb_hips = arm_obj.pose.bones['Hips']
            pb_hips.location = Vector((0, slide_y, drop_z))
            pb_hips.rotation_euler.x = fall_angle
            pb_hips.keyframe_insert(data_path='location', frame=f)
            pb_hips.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_head = arm_obj.pose.bones['Head']
            pb_head.rotation_euler.x = -math.radians(25) * fall_prog
            pb_head.keyframe_insert(data_path='rotation_euler', frame=f)

            pb_uarm_l = arm_obj.pose.bones['UpperArm.L']
            pb_uarm_r = arm_obj.pose.bones['UpperArm.R']
            pb_farm_l = arm_obj.pose.bones['Forearm.L']
            pb_farm_r = arm_obj.pose.bones['Forearm.R']

            pb_uarm_l.rotation_euler = Euler((math.radians(-55) * (1 - p), 0, math.radians(-35) * (1 - p) + math.radians(40) * p))
            pb_farm_l.rotation_euler = Euler((0, 0, math.radians(-80) * (1 - p)))
            pb_uarm_r.rotation_euler = Euler((math.radians(-55) * (1 - p), 0, math.radians(35) * (1 - p) - math.radians(40) * p))
            pb_farm_r.rotation_euler = Euler((0, 0, math.radians(80) * (1 - p)))

            pb_uarm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_l.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_uarm_r.keyframe_insert(data_path='rotation_euler', frame=f)
            pb_farm_r.keyframe_insert(data_path='rotation_euler', frame=f)

    create_action('die', 40, build_die)

    bpy.ops.object.mode_set(mode='OBJECT')

    # Set idle as active action for default rest pose
    arm_obj.animation_data.action = actions[0]

    # Select required objects for export
    bpy.ops.object.select_all(action='DESELECT')
    char_mesh.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        export_image_format='AUTO',
        export_apply=False,
        export_yup=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_morph=False
    )
    print(f"SUCCESS: Exported rigged character -> {out}")

print("\nAll characters rigged and exported successfully!")
