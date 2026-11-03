# Decisions

- Character clips: in-match avatars play `death` (character_loader.js), the hub viewer's Defeat button plays `die`; older rigged GLBs only have `die`, so they do not fall in matches. Forge characters export both.
- Forge characters (X:/Assets/Geo/Characters/character-lowpoly-main/tools/lowpoly_forge) are fitted to the reference sheet's silhouettes, not to the Hunyuan mesh: Hunyuan proportions drift 7–9 cm, which misregisters projected textures.
- Forge atlases use nearest sampling (glTF sampler NEAREST) for the pixel-art look; Babylon honours it.
