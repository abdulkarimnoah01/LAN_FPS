# LAN_FPS — Agent Handoff Document

> **Project**: LAN_FPS  
> **Repository**: [https://github.com/abdulkarimnoah01/LAN_FPS](https://github.com/abdulkarimnoah01/LAN_FPS)  
> **Current Version**: `v1.3.3` (Branch: `main`)  
> **Architecture**: Zero-dependency standalone HTML5 bundle (`LAN_FPS.html`), P2P WebRTC DataChannel, shared-folder signaling, client prediction + authoritative host.

---

## 1. Executive Summary & Philosophy

`LAN_FPS` is a serverless, zero-install, zero-dependency multiplayer first-person shooter designed for PCs on the same local studio or home network. 

### Core Design Rules
1. **Single File Distribution**: The entire game compiles into a single, standalone HTML file (`LAN_FPS.html`, ~6.3 MB) containing inlined scripts, Three.js, styles, procedural audio synthesizers, and base64-encoded 3D glTF character assets.
2. **Zero External Dependencies / CDNs**: The game must function 100% offline with no internet access. Never introduce external `<script src="...">` or remote stylesheet links.
3. **No Central Game Server**: Signaling is coordinated via a shared network folder (SMB/LAN share or browser OPFS / localStorage fallback) using the File System Access API. Real-time gameplay runs over direct, local WebRTC `RTCDataChannel` connections with no STUN/TURN servers.
4. **Authoritative Host + Client Prediction**: The host simulates physics, barrels, grenades, bot AI, hits, kills, and scoring. Clients predict local movement and receive 20 snapshots per second with 100 ms entity interpolation.

---

## 2. Recent Upgrades (Completed)

1. **AI Practice Bots / Dummies ([`source/src/hostgame.js`](file:///X:/Projects/game/LAN_FPS/source/src/hostgame.js))**:
   - Host can spawn and dismiss AI bots with dynamic target acquisition, line-of-sight raycasting, smooth turning, strafe movement, firearm combat, reload cycles, and grenade throws.
   - Lobby / HUD controls: `+ Bot` and `- Bot` buttons exposed to the match host.

2. **Grenades & Throwables ([`source/src/sim.js`](file:///X:/Projects/game/LAN_FPS/source/src/sim.js), [`source/src/hostgame.js`](file:///X:/Projects/game/LAN_FPS/source/src/hostgame.js), [`source/src/render.js`](file:///X:/Projects/game/LAN_FPS/source/src/render.js))**:
   - Press `G` to throw a grenade (input bit `B.GRENADE = 512`, cooldown 1.2s, max 2 grenades per spawn).
   - 3D AABB normal bouncing, wall deflection, ground rolling friction, 2.2s fuse timer, and radial AOE explosion with visual fireball, shockwave ring, particle debris, and radial push impulse.

3. **Explodable Barrels & Interactive Elements ([`source/src/arena.js`](file:///X:/Projects/game/LAN_FPS/source/src/arena.js), [`source/src/hostgame.js`](file:///X:/Projects/game/LAN_FPS/source/src/hostgame.js))**:
   - Barrels placed across maps have 40 HP. When shot or caught in an explosion, they detonate (6.2m blast radius, 120 max damage), trigger chain reactions, and dynamically remove their collision boxes from `world.boxes`.

4. **Team Deathmatch (TDM) Mode ([`source/src/hostgame.js`](file:///X:/Projects/game/LAN_FPS/source/src/hostgame.js), [`source/src/hud.js`](file:///X:/Projects/game/LAN_FPS/source/src/hud.js))**:
   - Modes: `Free For All` (first to 10 kills) and `Team Deathmatch` (first to 25 team kills).
   - Auto-balances joined players into `red` and `blue` teams with friendly fire immunity, team-colored name tags, and live HUD banner (`RED X · BLUE Y`).

5. **Surface Footstep Audio ([`source/src/arena.js`](file:///X:/Projects/game/LAN_FPS/source/src/arena.js), [`source/src/hud.js`](file:///X:/Projects/game/LAN_FPS/source/src/hud.js))**:
   - Deterministic `getSurface(x, y, z)` across all maps (`water`, `wood`, `metal`, `rubble`, `concrete`).
   - Procedural Web Audio footstep synthesizers: fluid water splashes, hollow timber knocks, metallic pings, and crunchy rubble steps.

6. **glTF Skeletal Animation System ([`source/src/render.js`](file:///X:/Projects/game/LAN_FPS/source/src/render.js), [`source/tools/rig_and_animate.py`](file:///X:/Projects/game/LAN_FPS/source/tools/rig_and_animate.py))**:
   - 3D low-poly humanoid characters (*Kimo*, *Kimo Black*, *Mina*, and *Robot*) rigged with full humanoid armatures and 5 animation states blended with crossfading: `idle`, `walk`, `run`, `crouch`, and `die`.
   - Blender automation script in `source/tools/rig_and_animate.py` automates bone weighting and procedural skeletal keyframing.

7. **Lobby & Room Creation Fix ([`source/src/render.js`](file:///X:/Projects/game/LAN_FPS/source/src/render.js), [`source/style.css`](file:///X:/Projects/game/LAN_FPS/source/style.css))**:
   - Resolved uncaught `TypeError: Cannot read properties of undefined (reading 'clear')` caused by `buildVisuals` running before `this.barrelMeshes` was initialized in `View`.
   - Corrected CSS flexbox rules preventing `#room-name` from squishing to zero width.
   - Added `StorageDirectory` fallback so 2-tab local play works even under Chrome `file:///` security restrictions.

8. **Dual-Mode Online Updater & GitHub Integration**:
   - `Update_LAN_FPS.bat` / `Update_LAN_FPS.ps1`: Git mode (`git pull`) + direct Web mode (downloads `LAN_FPS.html` over HTTPS with no Git/Node requirement).
   - In-game `Check for updates` button in the lobby header.
   - `Publish_Update.bat` / `publish_update.ps1`: 1-click build, test, version bump, commit, and push.
   - Public GitHub repository: [https://github.com/abdulkarimnoah01/LAN_FPS](https://github.com/abdulkarimnoah01/LAN_FPS).

9. **FieldLink Tactical UI & Hero Roster 3D Showcase (v1.2.0)**:
   - Modernized tactical interface (`source/src/ui.js`, `source/src/heroes.js`, `source/style.css`): step indicators (Identify -> Connect -> Deploy), operator profiles, and link architecture diagram.
   - Dedicated 3D operative roster screen with real-time character inspection, archetype badges, and weapon signatures.
   - Fixed character skeletal rigs and combat animations.


---

## 3. Directory Structure & Key Files

```
X:\Projects\game\LAN_FPS\
├── LAN_FPS.html            # Compiled, standalone playable game bundle (~6.3 MB)
├── README.md               # User & player documentation
├── HANDOFF.md              # THIS FILE: Technical architecture and state handoff
├── version.json            # Semantic version, build date, and release notes
├── updater_config.json     # Remote repository & raw URLs for updaters
├── Update_LAN_FPS.bat      # Windows batch wrapper for portable updating
├── Update_LAN_FPS.ps1      # PowerShell updater (Git + direct HTTPS fallback)
├── Publish_Update.bat      # Windows batch wrapper for developer release publishing
├── publish_update.ps1      # Automated build, test, commit, and push script
│
└── source/                 # Source code, assets, and tests
    ├── package.json        # Node.js devDependencies (esbuild, three)
    ├── build.mjs           # Bundler: inlines assets, glTF base64, CSS, and JS
    ├── index.html          # Lobby & HUD DOM structure
    ├── style.css           # Styling, themes, HUD overlays, flex layouts
    │
    ├── src/
    │   ├── arena.js        # Maps (Aftermath, River Forest, Pine Forest, Sandbox, Arena) + getSurface()
    │   ├── game.js         # Client prediction, interpolation, HostSession & GuestSession
    │   ├── hostgame.js     # Authoritative server logic, bots, barrels, grenades, rounds
    │   ├── hud.js          # HUD rendering, damage arcs, scoreboard, Web Audio synthesizers
    │   ├── main.js         # Page wiring, folder selection, settings modal, update checker
    │   ├── net.js          # Signaling, Lobby, RoomBoard, StorageDirectory, WebRTC links
    │   ├── render.js       # Three.js view, dual-pass weapon layer, skeletal animation mixer
    │   └── sim.js          # Movement physics, AABB collisions, weapon definitions, hitscan
    │
    ├── assets/
    │   └── characters/     # glTF binary models (*.glb)
    │       ├── Kimo.glb
    │       ├── Kimo Black.glb
    │       └── Mina.glb
    │
    ├── test/
    │   ├── run.mjs         # Headless test runner (34 comprehensive unit tests)
    │   └── fakes.mjs       # Mock WebRTC and fake directory handles for testing
    │
    └── tools/
        ├── rig_and_animate.py  # Headless Blender script to rig & animate USDZ/OBJ/FBX
        └── usdz_to_glb.py      # Headless Blender USDZ to GLB converter
```

---

## 4. Development Workflow

### Requirements
- **Node.js**: v18 or newer
- **Git**: For version control and remote updates
- **Blender**: 4.2+ (only needed if converting or rigging new characters)

### Common Commands (from `source/`)
```bash
# Install dependencies
npm install

# Run unit tests (34 tests)
npm test

# Build single-file LAN_FPS.html
npm run build
```

### Publishing an Update (from root)
Run `Publish_Update.bat` or:
```powershell
powershell -ExecutionPolicy Bypass -File publish_update.ps1
```
This runs `npm run build`, executes `npm test`, updates `version.json`, commits, and pushes to `origin main`.

---

## 5. Architectural Invariants & Gotchas for Future Agents

1. **Weapon Layer 1 & Depth Clearing**:
   - In [`source/src/render.js`](file:///X:/Projects/game/LAN_FPS/source/src/render.js#L899-L904), the camera renders the world (layer 0), then clears depth (`r.autoClear = false; r.clearDepth();`), and renders the first-person weapon (layer 1).
   - *Why*: This prevents weapon barrels from clipping through walls when the player stands flush against obstacles. Any newly created first-person weapon or attachment must be assigned to layer 1: `obj.traverse(o => o.layers.set(1));`.

2. **Hitscan vs. Collision Boxes**:
   - Explodable barrels have physical bounding boxes in `world.boxes` (so players collide with them) AND entries in `world.barrels`.
   - In [`source/src/sim.js`](file:///X:/Projects/game/LAN_FPS/source/src/sim.js), `castShot()` specifically ignores the barrel's own box in `world.boxes` so the bullet ray doesn't get blocked before hitting the barrel mesh entity.

3. **Storage Fallback on `file:///` URLs**:
   - Double-clicking `LAN_FPS.html` opens it under `file:///`. Chrome blocks OPFS (`navigator.storage.getDirectory()`) in this security origin.
   - Always ensure [`StorageDirectory`](file:///X:/Projects/game/LAN_FPS/source/src/net.js#L64) in `net.js` is maintained as the fallback so local 2-tab testing functions without requiring a local HTTP web server.

4. **Character glTF Model Orientations**:
   - Standard glTF models face `+Z`. In `LAN_FPS`, the forward movement direction is `-Z`.
   - `makeCharacter()` rotates character roots by 180° (`model.rotation.y += Math.PI`) and wraps them in a parent group so local offsets apply cleanly.

5. **PowerShell Stderr in Updaters**:
   - When calling native executables like `git` inside PowerShell with `$ErrorActionPreference = "Stop"`, redirecting with `2>&1` causes Git progress text on stderr to be treated as terminating errors. Always handle stderr with `2>$null` or check `$LASTEXITCODE`.

---

## 6. Recommended Next Improvements

If picking up this project for subsequent iterations, consider:
- **Audio Volume Channels**: Connect HUD volume slider directly to separate BGM, SFX, and footstep gain nodes in [`source/src/hud.js`](file:///X:/Projects/game/LAN_FPS/source/src/hud.js).
- **Recoil & Spread**: Add per-shot weapon spread cone and screen-kick recovery for automatic weapons (AK-47 / SMG).
- **Interactive Map Elements**: Sliding blast doors or moving jump pads triggered by proximity or interact key (`E`).
- **Post-Processing Pass**: Subtle screen shake and radial blur shockwave on nearby barrel/grenade explosions.
