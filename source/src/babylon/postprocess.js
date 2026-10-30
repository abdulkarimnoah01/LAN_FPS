/* Babylon.js Post-Processing Pipeline & Graphics Presets Controller */

import * as BABYLON from '@babylonjs/core';
import { GRAPHICS_PRESETS } from './materials.js';

export function createRenderingPipeline(scene, camera, preset = 'high') {
  const p = GRAPHICS_PRESETS[preset] || GRAPHICS_PRESETS.high;

  const pipeline = new BABYLON.DefaultRenderingPipeline(
    'defaultPipeline',
    true, // HDR
    scene,
    [camera]
  );

  // Anti-aliasing
  pipeline.fxaaEnabled = p.fxaa;

  // Bloom
  pipeline.bloomEnabled = p.bloom;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 32;
  pipeline.bloomScale = 0.5;

  // Color grading & Tone mapping (ACES Filmic)
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.05;
  pipeline.imageProcessing.contrast = 1.1;

  // Vignette
  pipeline.imageProcessing.vignetteEnabled = preset === 'ultra';
  pipeline.imageProcessing.vignetteWeight = 1.5;
  pipeline.imageProcessing.vignetteColor = new BABYLON.Color4(0, 0, 0, 0);

  return pipeline;
}

export function applyGraphicsPreset(engine, scene, pipeline, shadowGenerator, presetKey = 'high') {
  const p = GRAPHICS_PRESETS[presetKey] || GRAPHICS_PRESETS.high;

  // 1. Resolution Scaling (DPR)
  if (engine) {
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, p.dpr) : 1;
    engine.setHardwareScalingLevel(1 / dpr);
  }

  // 2. Shadows
  if (shadowGenerator) {
    if (!p.shadows) {
      shadowGenerator.getShadowMap()?.renderList?.splice(0);
    }
  }

  // 3. Post-processing pipeline
  if (pipeline) {
    pipeline.fxaaEnabled = p.fxaa;
    pipeline.bloomEnabled = p.bloom;
    if (pipeline.imageProcessing) {
      pipeline.imageProcessing.vignetteEnabled = presetKey === 'ultra';
    }
  }

  console.log(`[Spectre Orbit] Graphics preset applied: ${p.name}`);
}
