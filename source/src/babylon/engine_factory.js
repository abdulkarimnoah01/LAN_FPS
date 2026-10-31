/* Babylon.js Engine Bootstrap with WebGPU preferred and WebGL 2 fallback */

import * as BABYLON from '@babylonjs/core';

export async function createBabylonEngine(canvas, options = {}) {
  // WebGL 2 is the proven, high-stability default. WebGPU is opt-in for experimental hardware testing
  const preferWebGPU = options.preferWebGPU === true;
  const antialias = options.antialias !== false;
  let engine = null;
  let backend = 'WebGL 2';

  if (preferWebGPU && typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const isSupported = await BABYLON.WebGPUEngine.IsSupportedAsync;
      if (isSupported) {
        const webgpu = new BABYLON.WebGPUEngine(canvas, {
          antialias,
          powerPreference: 'high-performance',
          audioEngine: false,
        });
        await webgpu.initAsync();
        engine = webgpu;
        backend = 'WebGPU';
        console.log('[Spectre Orbit] Babylon 9 initialized with WebGPU backend');
      }
    } catch (err) {
      console.warn('[Spectre Orbit] WebGPU initialization failed, falling back to WebGL 2:', err);
      engine = null;
    }
  }

  if (!engine) {
    try {
      engine = new BABYLON.Engine(canvas, antialias, {
        preserveDrawingBuffer: false,
        stencil: true,
        powerPreference: 'high-performance',
        audioEngine: false,
        failIfMajorPerformanceCaveat: false,
      });
      backend = 'WebGL 2';
      console.log('[Spectre Orbit] Babylon 9 initialized with WebGL 2 backend');
    } catch (e) {
      console.error('[Spectre Orbit] WebGL 2 initialization failed:', e);
      throw new Error('Neither WebGPU nor WebGL 2 could be initialized on this browser/GPU.');
    }
  }

  // Handle high-DPI displays safely
  const maxDpr = options.maxDpr || 1.5;
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, maxDpr) : 1;
  engine.setHardwareScalingLevel(1 / dpr);

  return { engine, backend };
}
