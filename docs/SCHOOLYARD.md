# Schoolyard (Egyptian school courtyard)

Playable map `school` (FFA / TDM, 2-8 players): a two-storey pointed-arch courtyard with a diesel locomotive half inside a tunnel in the east wing.

## Source and scale
- `school.fbx` (Houdini 20.5 export, ASCII FBX 7.7, one mesh `blast2`, 202k verts / 368k polys) is a **layout guide only**: it is sparse and incomplete.
- Scale: the scan's raw numbers are already metres. The FBX header says centimetres (`UnitScaleFactor 1`), which is why Blender shows 0.01 scale and 90 deg X; applying that would shrink the school to 0.8 m wide. Game scale is 1 unit = 1 m, Y up.
- Measured from the scan: courtyard ~31 x 35 m, wings ~11 m (two floors + parapet), arcade bay pitch ~3.7 m, track corridor ~5.5 m wide through the east wall at its centre.
- The scan is not modified or shipped. Blender 5.2 cannot open ASCII FBX, so the scan was parsed directly with numpy for the analysis.

## Build
```
blender -b --python source/tools/map_pipeline/school.py     # writes assets/maps/processed/school.{glb,json}
node source/tools/map_pipeline/generate_registry.mjs
cd source && npm run build && npm test
```
Needs `assets/props/train/engine.glb` (Hadota locomotive, from `train_pipeline/convert_train.py`). `school.jpg` is the lobby preview (a render of the exported GLB).

## Layout (origin = courtyard centre, track along X)
- Courtyard 31 x 35 m, ring walkway 2.6 m wide on both floors, so the gallery is a continuous loop (also over the tunnel).
- Four stairs (S, N, W, E wings) lead to the gallery; the gallery has 1.5 m collision railings, so it cannot be dropped from.
- Locomotive nose at x = 5, rear 21 m inside the tunnel; the tunnel interior is sealed (blockers beside the hull).
- Teams spawn on the north (red) and south (blue) halves of the courtyard; the train splits the middle, with routes around the buffer stop (west end), through the arcades and over the gallery.
- No jump pads or hazards; kill floor at y = -20.

## Known limits
- The scan's slanted north wing is straightened to a rectangle.
- Classrooms are solid; doors and windows are visual only.
- No LODs, no Arabic signage (no verified text to copy), textures are procedural (no photos used).
- The locomotive is the Hadota engine, not a re-model of the grey/red Egyptian diesel in the reference screenshots.
- Frame rate not measured in a browser; static counts: 418 collision boxes, ~16 materials.
