/* Spectre Orbit Online — Babylon.js Renderer Adapter
   Implements identical export interface as render.js for the Online Edition. */

import { getMap } from './arena.js';
import { PLAYER_COLORS, makeBabylonCharacter, BabylonAvatar } from './babylon/character_loader.js';
import { BabylonCharacterPreview, BabylonHeroViewer } from './babylon/preview.js';
import { buildBabylonWeaponModel } from './babylon/weapon_viewmodel.js';
import { BabylonView } from './babylon/view.js';

export { PLAYER_COLORS };
export const charId = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function loadAssets() {
  const embedded = (typeof window !== 'undefined' ? window.LANFPS_ASSETS : null) || {};
  const out = {
    config: embedded.config || {},
    characters: embedded.characters ? embedded.characters.map(c => ({
      id: charId(c.name),
      name: c.name,
      glb: c.glb,
    })) : [],
    maps: embedded.maps || {},
    arena: embedded.arena || null,
    weapon: embedded.weapon || null,
  };
  return out;
}

export function buildWorld(assets, mapType = 'foundry', mapSeed = 0) {
  const base = getMap(mapType, mapSeed);
  const m = assets?.maps?.[mapType];
  return {
    ...base,
    id: mapType,
    preview: m?.preview || null,
  };
}

export function makeCharacter(assets, id, color) {
  return null;
}

export {
  BabylonCharacterPreview as CharacterPreview,
  BabylonHeroViewer as HeroViewer,
  buildBabylonWeaponModel as buildWeaponModel,
  BabylonView as View,
};
