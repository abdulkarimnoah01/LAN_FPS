/* Builds Procedural Maps in Babylon.js with PBR Materials & Shadows */

import * as BABYLON from '@babylonjs/core';
import { getPBRMaterial, PALETTE } from './materials.js';

export function buildProceduralWorld(scene, world, shadowGenerator = null) {
  const root = new BABYLON.TransformNode('world_root', scene);
  const barrelMeshes = new Map();
  const meshesToShadow = [];

  if (!world.visuals) return { root, barrelMeshes };

  for (const v of world.visuals) {
    if (v.type === 'tree') {
      const s = v.scale || 1, h = v.h || 6.5;
      const tg = new BABYLON.TransformNode('tree', scene);
      tg.parent = root;
      tg.position.set(v.x, 0, v.z);

      // Trunk
      const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', {
        height: h * 0.45,
        diameterTop: 0.24 * s * 2,
        diameterBottom: 0.36 * s * 2,
        tessellation: 6,
      }, scene);
      trunk.position.y = (h * 0.45) / 2;
      trunk.material = getPBRMaterial(scene, 'bark');
      trunk.parent = tg;
      meshesToShadow.push(trunk);

      // 3 Foliage cones
      const colors = ['pine1', 'pine2', 'pine3'];
      for (let i = 0; i < 3; i++) {
        const coneH = (h * 0.48) * (1 - i * 0.15);
        const coneR = (1.9 * s) * (1 - i * 0.22);
        const cone = BABYLON.MeshBuilder.CreateCylinder(`cone_${i}`, {
          height: coneH,
          diameterTop: 0,
          diameterBottom: coneR * 2,
          tessellation: 6,
        }, scene);
        cone.position.y = (h * 0.32) + i * (coneH * 0.58) + coneH / 2;
        cone.material = getPBRMaterial(scene, colors[i]);
        cone.parent = tg;
        meshesToShadow.push(cone);
      }
    } else if (v.type === 'bareTree') {
      const s = v.scale || 1, h = v.h || 5.2;
      const tg = new BABYLON.TransformNode('bareTree', scene);
      tg.parent = root;
      tg.position.set(v.x, 0, v.z);

      const trunk = BABYLON.MeshBuilder.CreateCylinder('bareTrunk', {
        height: h,
        diameterTop: 0.18 * s * 2,
        diameterBottom: 0.28 * s * 2,
        tessellation: 6,
      }, scene);
      trunk.position.y = h / 2;
      trunk.material = getPBRMaterial(scene, 'burntWood');
      trunk.parent = tg;
      meshesToShadow.push(trunk);

      const b1 = BABYLON.MeshBuilder.CreateCylinder('branch1', {
        height: 2.2 * s,
        diameterTop: 0.08 * s * 2,
        diameterBottom: 0.12 * s * 2,
        tessellation: 5,
      }, scene);
      b1.position.set(0.6 * s, h * 0.72, 0.2 * s);
      b1.rotation.set(0.3, 0.2, 0.85);
      b1.material = getPBRMaterial(scene, 'burntWood');
      b1.parent = tg;
      meshesToShadow.push(b1);
    } else if (v.type === 'rock') {
      const s = v.scale || 1;
      const rock = BABYLON.MeshBuilder.CreatePolyhedron('rock', {
        type: 1, // Dodecahedron
        size: s * 0.85,
      }, scene);
      rock.position.set(v.x, v.y + s * 0.7, v.z);
      if (v.rx || v.ry || v.rz) rock.rotation.set(v.rx || 0, v.ry || 0, v.rz || 0);
      rock.scaling.set(1.15, 0.85, 1.0);
      rock.material = getPBRMaterial(scene, v.color || 'rockDark');
      rock.parent = root;
      meshesToShadow.push(rock);
    } else if (v.type === 'barrel') {
      const r = v.r || 0.42, bh = v.h || 1.1;
      const barrel = BABYLON.MeshBuilder.CreateCylinder('barrel', {
        height: bh,
        diameter: r * 2,
        tessellation: 12,
      }, scene);
      barrel.position.set(v.x, (v.y || 0) + bh / 2, v.z);
      barrel.material = getPBRMaterial(scene, v.color || 'barrelRust');
      barrel.parent = root;
      meshesToShadow.push(barrel);
      if (v.id) barrelMeshes.set(v.id, barrel);
    } else if (v.type === 'slab') {
      const slab = BABYLON.MeshBuilder.CreateBox('slab', {
        width: v.w,
        height: v.h || 0.25,
        depth: v.d,
      }, scene);
      slab.position.set(v.x, v.y, v.z);
      if (v.rx || v.ry || v.rz) slab.rotation.set(v.rx || 0, v.ry || 0, v.rz || 0);
      slab.material = getPBRMaterial(scene, v.color || 'plasterDamaged');
      slab.parent = root;
      meshesToShadow.push(slab);
    } else if (v.type === 'water') {
      const water = BABYLON.MeshBuilder.CreateGround('water', {
        width: v.w,
        height: v.d,
        subdivisions: 4,
      }, scene);
      water.position.set(v.x, v.y || -0.15, v.z);
      water.material = getPBRMaterial(scene, 'water');
      water.parent = root;
    } else if (v.type === 'antenna') {
      const ant = new BABYLON.TransformNode('antenna', scene);
      ant.parent = root;
      ant.position.set(v.x, 0, v.z);
      const th = v.h || 18;

      const mast = BABYLON.MeshBuilder.CreateCylinder('antennaMast', {
        height: th,
        diameterTop: 0.2,
        diameterBottom: 1.6 * 2,
        tessellation: 4,
      }, scene);
      mast.position.y = th / 2;
      mast.material = getPBRMaterial(scene, 'antennaMetal');
      mast.parent = ant;
      meshesToShadow.push(mast);

      const spike = BABYLON.MeshBuilder.CreateCylinder('antennaSpike', {
        height: 4.5,
        diameterTop: 0.06 * 2,
        diameterBottom: 0.08 * 2,
        tessellation: 6,
      }, scene);
      spike.position.y = th + 2.25;
      spike.material = getPBRMaterial(scene, 'antennaMetal');
      spike.parent = ant;
    } else {
      // Generic bounding box
      const min = v.min || [v.x - v.w / 2, v.y, v.z - v.d / 2];
      const max = v.max || [v.x + v.w / 2, v.y + v.h, v.z + v.d / 2];
      const sizeX = max[0] - min[0], sizeY = max[1] - min[1], sizeZ = max[2] - min[2];

      const box = BABYLON.MeshBuilder.CreateBox('box', {
        width: sizeX,
        height: sizeY,
        depth: sizeZ,
      }, scene);
      box.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      box.material = getPBRMaterial(scene, v.color || 'cover');
      box.parent = root;

      const isGround = v.color === 'floor' || v.color === 'grass' || v.color === 'dirt' || v.color === 'moss';
      if (!isGround) {
        meshesToShadow.push(box);
      }
      box.receiveShadows = true;
    }
  }

  // Jump pads
  if (world.jumpPads && world.jumpPads.length) {
    for (const jp of world.jumpPads) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = jp.box;
      const w = Math.max(1.4, maxX - minX), d = Math.max(1.4, maxZ - minZ);
      const pad = BABYLON.MeshBuilder.CreateBox('jumpPad', {
        width: w,
        height: 0.14,
        depth: d,
      }, scene);
      pad.position.set((minX + maxX) / 2, minY + 0.07, (minZ + maxZ) / 2);

      const padMat = new BABYLON.PBRMaterial('padMat', scene);
      padMat.albedoColor = hexToColor3('#0284c7');
      padMat.emissiveColor = hexToColor3('#38bdf8');
      padMat.emissiveIntensity = 0.9;
      padMat.roughness = 0.3;
      padMat.metallic = 0.8;
      pad.material = padMat;
      pad.parent = root;
      pad.receiveShadows = true;
    }
  }

  // Barrels defined in world.barrels
  if (world.barrels && world.barrels.length) {
    for (const b of world.barrels) {
      if (barrelMeshes.has(b.id)) continue;
      const barrel = BABYLON.MeshBuilder.CreateCylinder(`barrel_${b.id}`, {
        height: b.h || 1.1,
        diameter: (b.r || 0.42) * 2,
        tessellation: 12,
      }, scene);
      barrel.position.set(b.x, (b.y || 0) + (b.h || 1.1) / 2, b.z);
      barrel.material = getPBRMaterial(scene, b.color || 'barrelRust');
      barrel.parent = root;
      barrel.receiveShadows = true;
      meshesToShadow.push(barrel);
      barrelMeshes.set(b.id, barrel);
    }
  }

  // Hook up shadow casters
  if (shadowGenerator) {
    for (const m of meshesToShadow) {
      shadowGenerator.addShadowCaster(m);
      m.receiveShadows = true;
    }
  }

  return { root, barrelMeshes };
}
