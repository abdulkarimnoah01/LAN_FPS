# Spectre Orbit

A small low-poly first-person deathmatch for PCs on the same studio network.
It is one HTML file (`LAN_FPS.html`) with everything built in: no install, no server, no internet.

- 2–6 players, first to 10 kills (FFA) or 25 kills (TDM) wins the round, then a new round starts after 8 seconds.
- Game Modes: **Free For All (Deathmatch)** and **Team Deathmatch (TDM)** with auto-balancing, friendly-fire immunity, and team score banners.
- AI Bots / Practice Dummies: Host can spawn and dismiss tactical practice bots with target acquisition, line-of-sight checks, strafing, and grenade usage.
- 5 map modes: **Aftermath (Medal of Honor Ruins)**, **River Forest (River Valley & Bridges)**, **Pine Forest (Low-Poly)**, **Random Sandbox (Procedurally Generated)**, and **Arena (Retro Classic)**.
- Interactive Elements: Explodable fuel barrels with hit damage, chain reactions, and radial blast impulses.
- Grenades & Throwables: Press `G` to lob frag grenades with bounce physics, fuse timers, and AOE explosion shockwaves.
- Surface Footstep Audio: Procedural audio synthesis reacting to ground surfaces (`water` fluid splash, `wood` hollow knock, `metal` ping, `rubble` gravel crunch, and `concrete`).
- 6 weapons: **AK-47**, **Shotgun**, **Sniper Rifle**, **SMG**, **LMG**, and **Combat Knife** (+15% run speed, 55 front slash, 110 lethal backstab, and dedicated quick melee).
- glTF Skeletal Animations: Rigged humanoid characters support 5 animated action states blended with crossfading (`idle`, `walk`, `run`, `crouch`, and `die`).
- WASD to move, Space to jump, C / Ctrl to crouch, mouse to aim, left-click to shoot, right-click to ADS, V / F quick melee, G grenade, 1–6 / scroll / Q switch weapons, R reload, Tab scores, Esc settings.

## Playing

1. Copy `LAN_FPS.html` anywhere every PC can open it (the studio share is fine) and open it in **Chrome or Edge**.
2. Type your name, then **Choose shared folder…** and pick the same network folder on every PC.
   The game makes a `_LAN_FPS_DATA` folder inside it. The browser asks for permission the first time; after that **Use "…" again** remembers the folder.
3. One person chooses a map mode (Pine Forest, Random Sandbox, or Classic Arena) and clicks **Create room**. The room shows up in everyone else's list within a second or two; they click **Join**.
4. Before entering the map, everyone picks a character (← → or click, then **Play**). The choice is remembered for next time, and everyone sees it.
5. Click the game view to capture the mouse.

### How the connection works

The shared folder is only a notice board. The host writes `room.json` every second so the room stays listed. A joining PC leaves its WebRTC offer in `join-<id>.json`, and the host replies in `answer-<id>.json`.
After that, all gameplay goes over a **direct WebRTC DataChannel between the two PCs**. It uses no STUN/TURN servers, so it never leaves the local network.

The host is authoritative. Each client sends its inputs 60 times a second and predicts its own movement. The host simulates everyone, decides every hit, kill and respawn, and sends 20 snapshots a second. Other players are drawn 100 ms in the past and smoothed between snapshots.

A network folder is far too slow for real-time play, so there is **no folder fallback**. If the direct link cannot be made, the joining player sees a message saying so. The usual fixes are:
- both PCs on the same network or subnet, with no VPN;
- Windows Firewall allowing Chrome/Edge on private networks;
- the host's game tab open and not asleep.

The host's game keeps running while its tab is in the background, but closing the tab or letting the PC sleep ends the room.

### Testing on one PC

**This PC only (test in two tabs)** uses the browser's storage fallback or private directory instead of a network folder. Open the file in two tabs, host in one and join from the other.

## Updating LAN_FPS on Any PC

You can update `LAN_FPS` on any computer in three ways:

### 1. One-Click Windows Updater (Recommended)
Double-click **`Update_LAN_FPS.bat`** (or run `powershell -ExecutionPolicy Bypass -File Update_LAN_FPS.ps1`):
- **If Git is installed & cloned**: Automatically pulls the latest changes via `git pull`.
- **If Git is NOT installed**: Uses built-in Windows tools (`curl` / PowerShell) to fetch the latest `LAN_FPS.html` directly from GitHub—no Git, Python, or Node.js required!
- Safely creates a `.bak` backup before replacing the file and prompts to launch the game when finished.

### 2. In-Game Lobby Updater
In the lobby header next to the version badge (`v1.1.0`):
- Click **"Check for updates"**.
- If a newer release is published online, a notification banner appears with the changelog notes and a direct **"Download Update"** button.

### 3. Publishing Updates (From Primary / Dev PC)
When you make changes, balance weapons, or add characters on your primary PC:
1. Double-click **`Publish_Update.bat`** (or run `powershell -ExecutionPolicy Bypass -File publish_update.ps1`).
2. It automatically compiles `LAN_FPS.html`, runs verification tests, updates `version.json`, commits, and pushes to Git.
3. Every other PC can then immediately run `Update_LAN_FPS.bat` to receive the update!

To customize your GitHub repository link, edit **`updater_config.json`**.

## Building from source

Needs Node.js 18 or newer. From `source/`:

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

`npm run build` writes `../LAN_FPS.html`. `npm test` runs the headless tests: room listing and signaling over a temp folder with a fake WebRTC pair, the failed-link message, and the host's movement, hit, kill, respawn and scoring rules.

| File | What it does |
|---|---|
| `src/sim.js` | Shared rules: movement, collision, weapon timing, hitscan. Runs on the host and, for prediction, on every client. |
| `src/hostgame.js` | The host's authoritative match: inputs, hits, health, kills, respawns, rounds. |
| `src/net.js` | Shared-folder lobby, signaling, and the direct WebRTC links. |
| `src/game.js` | Client prediction and interpolation, plus the host and guest sessions. |
| `src/render.js` | three.js view, placeholder models, glTF loading, character preview. |
| `tools/usdz_to_glb.py` | Blender script that converts USDZ/FBX/OBJ characters to `.glb`. |
| `src/arena.js` | The built-in placeholder arena (boxes and spawn points). |
| `src/hud.js`, `src/main.js`, `index.html`, `style.css` | HUD, sounds, lobby and page. |

## Operative Roster & Characters

LAN_FPS features 9 distinct playable operatives, each equipped with custom humanoid skeletal armatures, procedural combat animations (idle, walk, run, crouch, and die), class badges, signature weapons, and tactical role traits in the 3D Operative Dossier:

| # | Operative | Role / Class | Signature Weapon | Tactical Trait |
|---|---|---|---|---|
| 01 | **ElDeep** | `SKIRMISHER` | SMG & Knife | Fleet-Footed (+8% run velocity) |
| 02 | **Gemy** | `MARKSMAN` | Sniper Rifle & AK-47 | Deadshot ADS (-15% zoom sway) |
| 03 | **Hamdy** | `ENFORCER` | LMG Drum Mag | Suppressor (Heavy fire capacity) |
| 04 | **Hooda** | `COMMANDO` | AK-47 & Shotgun | War-Hardened (Fast weapon swapping) |
| 05 | **Kimo Black** | `INFILTRATOR` | SMG Silenced | Shadow Stalker (Stealth footprint audio) |
| 06 | **Kimo** | `ASSAULT` | AK-47 & Frags | Rapid Recovery (Standard assault profile) |
| 07 | **Mina** | `RECON` | Sniper Rifle | Precision Scout (Extended radar range) |
| 08 | **Romero** | `BREACHER` | Shotgun & Frags | Blast Shielding (-15% explosive self-damage) |
| 09 | **Robot** | `VANGUARD` | AK-47 Vanguard | Hardened Armor (High bullet durability) |

Every `.glb` in `source/assets/characters/` is bundled directly into the standalone `LAN_FPS.html` via `npm run build`.

### Automated Skeletal Rigging Pipeline (Blender)

Raw 3D character meshes (e.g. from Tripo or model repositories) can be automatically rigged and animated using the batch pipeline script `source/tools/rig_batch.py`:
```bash
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python source/tools/rig_batch.py
```
This script:
1. Rescales and normalizes mesh height to standard 1.78m and grounds the feet precisely at Z = 0.00.
2. Constructs a standard humanoid armature hierarchy (Hips, Spine, Chest, Neck, Head, Upper/Lower Legs, Feet, Upper/Lower Arms, Hands).
3. Welds duplicate vertices and computes automatic bone heat weighting.
4. Generates 5 procedural combat animations blended in-engine: `idle`, `walk`, `run`, `crouch`, and `die`.
5. Compresses textures to 1024x1024 diffuse maps for minimal file weight.

### Converting USDZ, FBX or OBJ

The game needs binary glTF (`.glb`). `source/tools/usdz_to_glb.py` converts with Blender (4.2 or newer) without opening it, and scales textures down to 1024 px so the HTML file stays small. From `source/`:

```bash
& "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe" -b --factory-startup --python tools\usdz_to_glb.py -- "L:\3D\Refs\lowpolycharacters\Kimo.usdz" assets\characters\Kimo.glb
```

It prints the model's size. A character should be about 1.8 m tall with its feet at 0; if not, fix it with `assets.json` (below).

Each character adds its size to `LAN_FPS.html`: Kimo, with five textures, adds about 4 MB. Pass a smaller texture limit as a last argument (for example `512`) for lighter files.

## Replacing the placeholder models with glTF

Put any of these files in `source/assets/`, then run `npm run build`. Each one you add replaces the matching placeholder; the others stay as they are.

| File | Replaces |
|---|---|
| `arena.glb` | the level |
| `characters/<Name>.glb` | adds a selectable character (see above) |
| `player.glb` | older single-character slot; shows up as "Player" on the select screen |
| `weapon.glb` | the first-person gun |

Use binary glTF (`.glb`), with textures packed inside. Work in metres, Y up (Blender's glTF exporter does this by default). **Every PC must use the same build**, because collisions come from the arena file.

### arena.glb

- **Collision:** give simple box meshes names that start with `COL_` (for example `COL_wall_north`). Their bounding boxes become the walls and floors players collide with, and they are hidden in game.
  If the file has no `COL_` meshes, the bounding box of every mesh collides, which only suits very blocky levels.
- **Collision is axis-aligned boxes only.** Rotated `COL_` boxes grow to fit, so keep them square to the world. Build stairs as steps no taller than 0.55 m; players climb those automatically. Slopes and ramps are not supported yet.
- **Spawns:** add at least two empties named `SPAWN_1`, `SPAWN_2`, …, placed at floor level. Six to eight spread around the level works best.
- The built-in arena is about 44 × 44 m, with walls 5 m high, which gives a sense of scale.

### Characters (characters/*.glb)

- A character about 1.8 m tall, with its feet at the origin.
- In Blender, face **−Y** (towards you in Front view). That exports as glTF +Z, which the game turns to face forward.
- Any material named `TEAM` is recoloured with each player's colour.
- The hitbox stays a fixed box: 0.7 m wide, body up to 1.45 m, head up to 1.85 m. Animations are not played yet.

### weapon.glb

- The origin is where the gun sits in view. In Blender the barrel points **+Y** (away from you in Front view), which exports as glTF −Z.
- Add an empty named `MUZZLE` at the barrel tip for the muzzle flash and tracer start.

### Fine-tuning without re-exporting

An optional `source/assets/assets.json` adjusts the models. Characters are listed by file name, and `player` is the default for any character not listed. Rotations are in degrees:

```json
{
  "characters": { "Kimo": { "scale": 1.0, "position": [0, 0, 0], "rotation": [0, 0, 0] } },
  "player": { "scale": 1.0, "position": [0, 0, 0], "rotation": [0, 0, 0] },
  "weapon": { "scale": 1.0, "position": [0, 0, 0], "rotation": [0, 0, 0] }
}
```

## Architecture & Design Notes

- **Zero External Dependencies**: One HTML file containing the entire game engine, 3D assets, audio synthesis, and networking.
- **P2P DataChannels**: Low latency gameplay directly between peers with no intermediary servers.
- **Client Prediction**: Instant input responsiveness with authoritative host reconciliation and error easing.
- **Skeletal & Procedural Animation**: Rigged glTF models with animation blending plus procedural fallbacks for unrigged assets.
