# Spectre Orbit — Agent Handoff Document

> **Project**: Spectre Orbit (repo and file names remain LAN_FPS)  
> **Repository**: [https://github.com/abdulkarimnoah01/LAN_FPS](https://github.com/abdulkarimnoah01/LAN_FPS)  
> **Current Version**: `v1.5.0` (Branch: `feat/babylon-online` / Baseline `v1.4.7` on `main`)  
> **Architecture**:
> - **Classic Edition**: Standalone single-file HTML5 bundle (`LAN_FPS.html`), Three.js renderer, P2P WebRTC DataChannel via shared-folder signaling.
> - **Online Edition**: Babylon.js 9 (WebGPU / WebGL 2) bundle (`LAN_FPS_online.html` / `dist/online/index.html`), dedicated Node.js LTS matchmaking & signaling server (`server/index.mjs`), WebRTC DataChannels + STUN/TURN traversal.

---

## 1. Executive Summary & Philosophy

`Spectre Orbit` supports two independent, high-performance browser distributions:
1. **Classic Edition (`LAN_FPS.html`)**: Serverless, zero-install, zero-dependency multiplayer FPS powered by Three.js for local studio or home network LAN play.
2. **Online Edition (`LAN_FPS_online.html` & `dist/online/`)**: Internet multiplayer FPS powered by Babylon.js 9, WebGPU acceleration with WebGL 2 fallback, PBR materials, cascaded shadow maps, filmic tone mapping, and a dedicated WebSocket matchmaking server with STUN/TURN integration.

### Core Design Rules
1. **Classic Edition Uncompromised**: Preserves 100% offline functionality, single-file distribution, zero external CDNs, and zero dependency on online services.
2. **Online Edition Modernization**: Uses Babylon.js 9 modular imports, WebGPU pipeline, configurable graphics presets (Low, Medium, High, Ultra), and internet WebRTC transport with Trickle ICE and ephemeral Coturn TURN credentials.
3. **Decoupled Simulation Core**: Shared physics, collision, movement, weapon ballistics, raycasting, and rules (`sim.js`, `hostgame.js`) are completely renderer-agnostic.
4. **Authoritative Host + Client Prediction**: Authoritative 60 Hz simulation with 20 Hz network snapshots, client prediction with reconciliation, and 100 ms entity interpolation across both editions.

---

## 2. Recent Upgrades

### v1.5.0: Babylon.js 9 Online Multiplayer Migration (`feat/babylon-online`)
- **Babylon.js 9 Engine Integration**:
  - `source/src/babylon/engine_factory.js`: Automatic WebGPU detection and initialization with seamless WebGL 2 fallback.
  - `source/src/babylon/materials.js`: PBR metallic/roughness workflow, procedural palettes, custom atmospheric sky dome shader, and graphics presets (Low, Medium, High, Ultra).
  - `source/src/babylon/procedural_world.js`: Procedural map generation for Pine Forest, Aftermath, River Forest, and Sandbox.
  - `source/src/babylon/map_loader.js`: Asynchronous GLB loader for imported arenas (Foundry Core, Schoolyard, Hadota Rail Yard, Reactor Complex, Zenith Atrium).
  - `source/src/babylon/character_loader.js`: Rigged skeletal operative loading, AnimationGroups (`idle`, `walk`, `run`, `crouch`, `death`), and remote player avatars with overhead nametags.
  - `source/src/babylon/weapon_viewmodel.js`: Procedural viewmodels for all 6 weapons (`ak47`, `shotgun`, `sniper`, `smg`, `lmg`, `knife`), separate foreground rendering pass (`renderingGroupId = 1`), recoil kick, ADS zoom, muzzle flashes, and combat particle effects.
  - `source/src/babylon/view.js`: Drop-in replacement `BabylonView` conforming to the simulation rendering interface.
- **Dedicated Matchmaking & Signaling Server (`server/index.mjs`)**:
  - Node.js LTS + WebSocket (`ws`), RFC 5766 ephemeral Coturn TURN credentials, room browsing, quick match, invite codes, rate limiting, and stale room garbage collection.
  - Tested and verified with 5 automated unit tests (`server/test/server_test.mjs`).
- **Internet WebRTC Client Transport (`source/src/net_online.js`)**:
  - `OnlineNetHost` and `OnlineNetGuest` implementing the exact `NetHost` / `NetGuest` contracts for `HostSession` and `GuestSession`.
  - Trickle ICE, candidate buffering, reliable `rel` and fast `fast` DataChannels.
  - Tested with 3 automated transport and game session integration tests.
- **Dual Build Pipelines**:
  - `npm run build` -> builds Classic `LAN_FPS.html` (36.5 MB, v1.4.7)
  - `npm run build:online` -> builds Online `LAN_FPS_online.html` (42.5 MB, Babylon 9) + `dist/online/index.html`
  - `npm run test:all` -> runs all 56 tests across Classic, Online, Babylon renderer, and Server.
- **UI & 3D Operative Turntable Parity (100% Three.js Match)**:
  - `source/index_online.html` & `source/index.html`: Replaced the relay outpost background photograph with a glowing retro terminal ASCII art representation of a planet with concentric orbital rings (`.ascii-planet`), with telemetry label `SECTOR 00 // CELESTIAL ORBIT`.
  - Full retro-futuristic Fieldlink terminal UI (`terminal-ui reference-ui`), including masthead, brand cluster, signal lamps, CRT toggle, operative roster launcher, station config readout, deployment rail, `01 operator.profile` with `#lobby-portrait` 3D canvas, `02 network.uplink` with matchmaking server controls, `03 match.terminal` with roomboard and Foundry Core map briefing card, full 3-column `#hero-roster-modal`, and `#settings-modal`.
  - `source/src/babylon/preview.js`: Upgraded `BabylonCharacterPreview` (for live `#lobby-portrait` rendering) and `BabylonHeroViewer` featuring cinematic 3-point Hero lighting (sun, rim, fill, hemi), cyber-metallic podium with glowing team accent ring, pointer drag-to-orbit and camera height tilt, mouse wheel & `+`/`-` zoom, keyboard arrow navigation, auto-spin (`roster-btn-spin`), reset view (`roster-btn-reset`), animation cross-fading (`idle`, `walk`, `run`, `crouch`, `die`), outfit switching, and team shader swatches (`setColor`).
  - Verified with headless Chrome CDP automation (`source/test/capture_online_ui.mjs`):
    - `screenshot_online_terminal_lobby.png`: Full retro terminal layout with live 3D portrait.
    - `screenshot_online_turntable_roster.png`: 3-column Operative Registry with interactive 3D turntable, animations, outfits, swatches, and tactical stats.
    - `screenshot_online_settings_modal.png`: Full station configuration modal with Sensitivity & Aim, Graphics & Engine, and Keybindings tabs.
- **In-Game Verification & Screenshot Automation (`source/test/capture_online_match.mjs`)**:
  - Headless Chrome CDP automation running against live matchmaking server.
  - Automatically loads operative preview turntable, configures Schoolyard arena, starts authoritative WebGPU match, deploys AI combat bots, and captures match screenshots.
  - All 56/56 tests passing.
### Schoolyard (`schoolyard` — v1.4.7)
- An authentic Egyptian school courtyard arena featuring pointed arcades, a continuous second-floor gallery ring, classrooms, and a vintage locomotive halfway emerging from a brick tunnel.

### Hadota Rail Yard (`railyard`, theme `railyard` — v1.4.5)
- A fifth imported-style arena built around the production train from the HADOTA shot `sc034sh0200` (USD, frame 1001, engine + 5 carts, ~149 m). Hand-authored layout, lit at runtime (not baked): warm low sun with a 4096 shadow map, hemisphere sky light, ACES tone mapping, dusk sky dome and ridge silhouettes built in `render.js` (`makeSkyDome`, `makeRidge`).
- **Train pipeline** (`source/tools/train_pipeline/convert_train.py`, Blender 5.2.3 headless, reads the USD share directly): imports the high-poly frame (7.5 M tris engine, 6 M tris cart), decimates to ~38k / ~30k tris, unwraps one atlas, bakes base colour (from the original UDIM textures), ambient occlusion and a tangent-space normal map from the high-poly originals, writes `assets/props/train/{engine,cart}.glb` + textures. `train_materials.json` maps USD mesh names to materials. Run: `blender -b --python tools/train_pipeline/convert_train.py -- engine cart` (about 40 min at TRAIN_SIZE=2048). Gotcha: the USD importer adds a `MeshSequenceCache` modifier that would re-read the high-poly at export, so `world_mesh()` strips modifiers. The cart is instanced five times by the map script.
- **Map generator** (`source/tools/map_pipeline/railyard.py`): box layout (platforms with canopies, container yards, depot, tower, signal gantries, tunnel portals, tracks) -> textured GLB + collision JSON. The train collision is a roof height-field ray-cast from the converted train mesh, merged into boxes, so roofs can be stood on. Six jump pads put players on the train roof. Textures come from `textures.py` (palette `yard`).
- Assets are the studio's production files: the repo's licence terms do not cover them.

### v1.4.2: map rebuild
- Map pipeline lives in `source/tools/map_pipeline/`; run with Blender 5.2.3: `blender -b --python tools/map_pipeline/convert_map.py -- foundry glowplant zenith`, then `node tools/map_pipeline/generate_registry.mjs`. Paths are relative to the script. Scale is 0.025 m/unit (Xonotic 72 u = 1.8 m).
- `textures.py` generates procedural tileable textures; `convert_map.py` bakes entity lights into vertex colours (Cycles). Runtime draws these maps unlit (`MeshBasicMaterial`, `DoubleSide`). Map GLBs are gzip-embedded (`glbz`) and unpacked via `DecompressionStream`.
- `sim.js` has a grid broadphase for big maps, `world.hazards` (kill volumes) and the `killY` floor. Spawns are grounded, carry yaw and team (red/blue). Bots have a ledge guard.
- Curved patches (pipes, lava surface) are not converted; textures are approximations.

## 2b. v1.4.0: OPERATION: MAPFORGE

1. **Three New Multiplayer Arenas**:
   - **Sector 06: Foundry Core (`foundry`)**: Compact industrial arena (FFA 2–6) based on Xonotic *Boil* by kuniu the frogg & Mirio. Molten casting pit, elevated catwalks, 201 collision boxes, 7 spawns, 2 jump pads, lava kill floor.
   - **Sector 07: Reactor Complex (`glowplant`)**: Medium sci-fi facility (TDM 4–10) based on Xonotic *Glow Plant* by tZork, Cuinnton, Debugger & Mirio. Symmetrical team lanes, central plasma reactor, 1,029 collision boxes, 17 spawns, 3 jump pads.
   - **Sector 08: Zenith Atrium (`zenith`)**: Vertical futuristic complex (4–12) based on Xonotic *Dance* by FruitieX, dublpaws, Debugger & packer. Multi-level floating sky platforms, 146 collision boxes, 18 spawns, 2 velocity jump pads, bottomless void kill floor.

2. **Automated Quake Map Conversion Pipeline ([`source/tools/map_pipeline/`](file:///X:/Projects/game/LAN_FPS/source/tools/map_pipeline/))**:
   - `fetch_sources.mjs`: Upstream repository downloader.
   - `convert_map.py`: Headless Blender 5.2 Python parser that solves convex polyhedra, transforms coordinates ($1\,\text{m} = 32\,\text{units}$), grounds the floor at $Y = 0.00$, creates batched PBR materials, and exports `.glb` and `.json` collision geometries.
   - `validate_maps.py`: Geometry and spawn clearance validator (0/42 spawns stuck).
   - `generate_registry.mjs`: Central registry generator compiling `source/src/maps_registry.js`.

3. **New Engine Mechanics**:
   - **Velocity Jump Pads**: Stepping on a launch pad applies immediate vertical boost ($v_y = 15.0\,\text{m/s}$) with client prediction.
   - **Hazard Kill Floors**: Falling into molten pits or off floating sky platforms eliminates the player when dropping below `killY`.
   - **Tactical Sector Selector**: Lobby UI displays all 8 sectors with preview briefings and mode rules.

4. **Operative Roster (9 Playable Heroes)**:
   - Abdulkarim, ElDeep, Gemy, Hamdy, Hooda, Romero, Mina, and Robot, with custom skeletal rigs and 5 combat animation states.

5. **In-Place File Updater (v1.3.3)**:
   - Browser File System Access API updates `LAN_FPS.html` in-place and reloads.

---

## 3. Directory Structure & Key Files

```
X:\Projects\game\LAN_FPS\
├── LAN_FPS.html            # Compiled, standalone playable game bundle (~12.5 MB)
├── README.md               # User & player documentation
├── HANDOFF.md              # THIS FILE: Technical architecture and state handoff
├── version.json            # Semantic version, build date, and release notes (v1.4.0)
│
├── docs/                   # Complete MAPFORGE Documentation
│   ├── MAP_PIPELINE.md     # Conversion pipeline and coordinate standards
│   ├── MAP_LICENSES.md     # Licensing audit, authors, and GPL-2.0 compliance
│   ├── MAP_PERFORMANCE.md  # Benchmarks: FPS, draw calls, triangles, heap
│   └── MAP_RELEASE_NOTES.md# v1.4.0 release notes
│
└── source/
    ├── package.json
    ├── build.mjs           # Bundles characters, maps (*.glb), CSS, and JS
    ├── index.html          # Sector 01–08 selection & briefing UI
    │
    ├── src/
    │   ├── maps_registry.js# Central map metadata & collision database
    │   ├── arena.js        # getMap() factory & getSurface() audio resolvers
    │   ├── game.js         # Client prediction, HostSession & GuestSession
    │   ├── heroes.js       # 9 tactical operative dossiers
    │   ├── hostgame.js     # Authoritative server logic, bots, barrels, grenades
    │   ├── hud.js          # HUD rendering & procedural audio synthesizers
    │   ├── main.js         # Sector selection, game flow & updater
    │   ├── net.js          # WebRTC links & folder signaling
    │   ├── render.js       # Three.js view, GLTF loader, jump pads, barrels
    │   ├── sim.js          # Physics, AABBs, jump pads, kill floors, rayBox
    │   └── ui.js           # Tactical briefings for Sectors 01–08
    │
    ├── assets/
    │   ├── characters/     # 8 rigged operative models (*.glb)
    │   └── maps/
    │       ├── sources/    # Raw uncompiled *.map, *.mapinfo, *.jpg
    │       └── processed/  # Production *.glb, *.json, *.jpg
    │
    ├── test/
    │   ├── run.mjs                 # 39/39 automated unit tests
    │   ├── test_maps_chrome.mjs    # Headless Chrome E2E verification
    │   └── screenshot_*.png        # Visual verification captures
    │
    └── tools/
        └── map_pipeline/           # Reproducible MAPFORGE toolchain
```

---

## 4. Standing Constraints
- **CRITICAL RULE**: Do NOT initiate a system shutdown under any circumstances unless explicitly instructed by the user in a new prompt.
- **Self-Contained Bundle**: Keep `LAN_FPS.html` completely standalone with no external CDNs or scripts.

## 2026-10-31 — Noura V3 Classic integration
Added exact source/assets/characters/Noura.glb, operative dossier and bot entry. Rebuilt offline Classic v1.4.8. No Babylon changes in this commit. Tests: 42 gameplay checks and Chrome Noura load/roster smoke passed; 9,512 triangles, six textured primitives, no clips or browser exceptions. UI-bundle artwork check has a pre-existing baseline failure for relay-panorama.jpg; verified against caf3fc1. No claim that this unrelated test passes. Source character repository is untouched.
