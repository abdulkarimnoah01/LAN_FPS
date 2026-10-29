# Lobby media provenance

**Map thumbnails must use authentic game imagery. Do not substitute AI artwork.**

| File | Source and use |
| --- | --- |
| `map-aftermath.jpg` | Actual Aftermath gameplay frame, cropped to terrain |
| `map-river.jpg` | Actual River Forest frame, cropped to the bridge/trees |
| `map-forest.jpg` | Actual Pine Forest frame |
| `map-sandbox.jpg` | Actual procedurally generated Sandbox sample; labeled as a sample in the UI |
| `map-arena.jpg` | Actual Classic Arena frame |
| `relay-panorama.jpg` | Original generated decorative masthead art; never used as a map thumbnail |

The v1.4.0 Mapforge update also supplies `assets/maps/processed/{foundry,glowplant,zenith}.jpg`. These are original source-map previews, displayed with the explicit **SOURCE MAP PREVIEW** label. They are not captures of LAN_FPS's converted rendering. Their existing attribution is retained in `docs/MAP_LICENSES.md`.

Unmodified gameplay frames are in `design/screenshots/map-source/`. All were captured at 1440×900 from the real game through the local browser UI. Crops are 580×360: `(32,360)` for Aftermath, Forest, Sandbox and Arena; `(820,160)` for River. Cropping excludes HUD/weapon overlays. No generative processing was applied to map images.

The relay panorama was generated with the built-in imagegen tool and converted to a web-sized JPEG at quality 88. It is a fictional atmospheric backdrop, not a screenshot or representation of a playable map.

Generation brief: an original panoramic ruined industrial communications outpost, broken concrete buildings, a large satellite dish and radio relay tower, utility cables, rubble and a derelict car; restrained cinematic teal/black concept-art treatment, detailed etched texture, dark sparse left third for HTML title placement, no people, no text, logos, borders, UI or recognizable franchise architecture.

`source/build.mjs` inlines all six UI JPEGs and three Mapforge previews into the standalone HTML. `npm run test:ui` verifies the bundled bytes, unique DOM IDs and functional UI targets. No image server or connection is required.
