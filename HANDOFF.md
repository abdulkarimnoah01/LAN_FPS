# Spectre Orbit — Agent Handoff Document

> **Project**: Spectre Orbit (repo and file names remain LAN_FPS)  
> **Repository**: [https://github.com/abdulkarimnoah01/LAN_FPS](https://github.com/abdulkarimnoah01/LAN_FPS)  
> **Current Version**: `v1.4.2` (Branch: `main`)  
> **Architecture**: Zero-dependency standalone HTML5 bundle (`LAN_FPS.html`), P2P WebRTC DataChannel, shared-folder signaling, client prediction + authoritative host.

---

## 1. Executive Summary & Philosophy

`Spectre Orbit` (file: `LAN_FPS.html`) is a serverless, zero-install, zero-dependency multiplayer first-person shooter designed for PCs on the same local studio or home network. 

### Core Design Rules
1. **Single File Distribution**: The entire game compiles into a single, standalone HTML file (`LAN_FPS.html`, ~12.5 MB) containing inlined scripts, Three.js, styles, procedural audio synthesizers, 8 base64-encoded rigged humanoid operatives, and 3 open-source FPS arenas.
2. **Zero External Dependencies / CDNs**: The game must function 100% offline with no internet access. Never introduce external `<script src="...">` or remote stylesheet links.
3. **No Central Game Server**: Signaling is coordinated via a shared network folder (SMB/LAN share or browser OPFS / localStorage fallback) using the File System Access API. Real-time gameplay runs over direct, local WebRTC `RTCDataChannel` connections with no STUN/TURN servers.
4. **Authoritative Host + Client Prediction**: The host simulates physics, barrels, grenades, bot AI, hits, kills, jump pads, hazard floors, and scoring. Clients predict local movement and receive 20 snapshots per second with 100 ms entity interpolation.

---

## 2. Recent Upgrades
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
