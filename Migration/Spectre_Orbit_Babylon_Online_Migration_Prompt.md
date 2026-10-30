# SPECTRE ORBIT — BABYLON.JS ONLINE MULTIPLAYER MIGRATION

## MASTER IMPLEMENTATION DIRECTIVE

**Role:** Senior Game Engine Architect, Babylon.js Rendering Engineer, Multiplayer Network Engineer, and Technical Artist.

**Mission:** Transform Spectre Orbit from a standalone Three.js LAN FPS into a visually polished, performance-optimized, internet-playable multiplayer FPS powered by **Babylon.js 9**.

This is an implementation assignment, not merely an architecture proposal.

Deliver a working Babylon.js browser game with real online multiplayer while preserving the original Three.js offline build and existing gameplay systems.

### Project information

- **Project:** Spectre Orbit (LAN_FPS)
- **Repository:** https://github.com/abdulkarimnoah01/LAN_FPS
- **Local project:** `X:\Projects\game\LAN_FPS`
- **Baseline:** `v1.4.7`, branch `main`
- **Reference bundle:** `LAN_FPS.html`
- **Reference upload:** `/mnt/data/LAN_FPS.html`, if accessible
- **Native counterpart:** Parallel Unreal Engine port, outside the scope of modifications
- **Target browser engine:** Babylon.js 9.x
- **Rendering:** WebGPU preferred, WebGL 2 fallback
- **Online networking:** Node.js LTS + HTTPS/WSS + WebRTC DataChannels + STUN/TURN
- **Deployment:** Publicly accessible browser game with online matchmaking

### Absolute restrictions

1. NEVER shut down or restart the computer.
2. NEVER overwrite the Unreal Engine project.
3. NEVER destroy, replace, or break the existing offline Three.js build.
4. NEVER modify unrelated user work.
5. NEVER introduce runtime CDN dependencies into the offline build.
6. NEVER embed infrastructure secrets in client-side JavaScript or HTML.
7. NEVER claim features have been tested without actually testing them.
8. NEVER replace working gameplay systems merely because Babylon provides a comparable feature.

Work in a separate Git branch or worktree. Inspect repository instructions, uncommitted changes, and existing build processes before modifying anything.

A previous agent created an incomplete, untested copy under `outputs/spectre-online`. Treat that copy only as potential reference material, not as a validated implementation.

---

# 1. VERIFIED BASELINE AND EXISTING ARCHITECTURE

The uploaded reference HTML was previously reported to match the local v1.4.7 bundle with SHA-256:

`72F8DF9D0C311DBB30B9CC7F6E192A468E818BD0602A00EE02FF67BF0EAE271E`

Recheck this hash if the relevant files are accessible.

### Existing project files

| File | Responsibility |
|---|---|
| `source/src/net.js` | Lobby, RoomBoard, WebRTC networking, shared-folder signaling |
| `source/src/game.js` | HostSession, GuestSession, prediction, reconciliation, interpolation |
| `source/src/hostgame.js` | Authoritative gameplay simulation |
| `source/src/sim.js` | Movement, combat, shared simulation and rules |
| `source/src/main.js` | Lobby flow, hosting, joining, settings and updater |
| `source/src/ui.js` | Lobby presentation and connection feedback |
| `source/src/arena.js` | Arena geometry and environment |
| `source/src/maps_registry.js` | Map definitions and identifiers |
| `source/build.mjs` | HTML bundling, resource inlining and CSP |
| `source/test/run.mjs` | Existing automated tests |

### Existing networking

- Player-hosted authoritative simulation at 60 Hz.
- Gameplay snapshots at 20 Hz.
- Approximately 100 ms interpolation for remote entities.
- Reliable, ordered DataChannel named `rel`.
- Unordered DataChannel named `fast`, with `maxRetransmits: 0`.
- ICE currently configured with `iceServers: []`.
- Shared-folder SDP/ICE signaling.
- Existing LAN ICE gathering heuristic.
- Current maximum player count: `RULES.maxPlayers = 6`.

Preserve established simulation semantics unless there is a demonstrated reason to change them.

### Important identifiers

- Schoolyard's actual map ID is `school`.
- Do not derive map IDs from display names.
- Retain canonical operative, character, weapon, team, and map IDs.
- Audit advertised lobby capacities against actual gameplay limits.

---

# 2. TARGET ARCHITECTURE

The project must support two independent browser distributions.

## A. Spectre Orbit Classic — Offline Edition

**Renderer:** Existing Three.js implementation.

**Output:** `LAN_FPS.html`

Requirements:

- Retain standalone single-file HTML distribution.
- Retain existing local multiplayer capabilities.
- Retain offline practice, bots, and all current maps.
- No dependency on the online service.
- No external CDN requirement.
- No mandatory installation.
- No forced migration to Babylon.js.

This is the stable legacy version.

## B. Spectre Orbit Online — Babylon Edition

**Renderer:** Babylon.js 9.

**Output:** `LAN_FPS_online.html` or a hosted `index.html` and asset directory.

Requirements:

- Browser-accessible multiplayer.
- Dedicated online matchmaking and signaling service.
- WebRTC transport for gameplay.
- STUN and TURN connectivity.
- Babylon.js rendering.
- Modernized visuals and lighting.
- Performance-oriented asset delivery.
- Configurable graphics quality.
- Compatible gameplay rules with the offline edition.

The online release does not need to be a single HTML file.

It must be straightforward to deploy as a normal static web application plus backend infrastructure.

Bundled local JavaScript packages are acceptable, but do not use runtime CDN scripts.

### Architecture principle

**Rendering, simulation, networking, and presentation must be separate systems.**

Proposed logical architecture:

```text
SPECTRE ORBIT
│
├── Shared Gameplay Core
│   ├── Movement
│   ├── Weapons
│   ├── Damage
│   ├── Rules
│   ├── Map Metadata
│   ├── Simulation
│   └── Protocol Definitions
│
├── Classic Edition
│   ├── Three.js Renderer
│   ├── Existing LAN Networking
│   └── Standalone HTML Bundle
│
├── Online Edition
│   ├── Babylon.js Renderer
│   ├── WebGPU / WebGL 2
│   ├── Render Asset Manager
│   ├── Visual Effects
│   ├── Modernized Lobby
│   └── Internet WebRTC Client
│
└── Online Infrastructure
    ├── Matchmaking
    ├── Signaling
    ├── Room Management
    ├── STUN / TURN
    ├── Health Checks
    └── Deployment Configuration
```

Adapt directory structure to the existing repository rather than imposing unnecessary reorganization.

Do not create two separate implementations of the shared gameplay simulation.

---

# 3. BABYLON.JS ENGINE MIGRATION

## 3.1 Engine requirements

Migrate the online edition's rendering from Three.js to Babylon.js.

Use an appropriate stable Babylon.js 9.x release, verifying current official APIs and package compatibility before implementation.

Required packages as appropriate:

- `@babylonjs/core`
- `@babylonjs/loaders`
- `@babylonjs/materials`, only where needed
- Additional packages only where justified

Prefer modular ES imports and Babylon's pure import system when compatible with required features.

Explicitly register necessary engine extensions, loaders, materials, and shaders.

Avoid broad imports that unnecessarily bundle unused systems.

Do not use the legacy global Babylon namespace as the default application architecture.

## 3.2 WebGPU and WebGL 2

Implement backend selection:

1. Detect WebGPU availability and compatibility.
2. Initialize Babylon WebGPU rendering when supported.
3. Fall back gracefully to WebGL 2.
4. Handle engine initialization failures with actionable UI.
5. Detect unsupported features per backend.
6. Expose the active renderer backend in diagnostics.

Do not assume that every Babylon feature performs identically across backends.

Ensure a missing WebGPU adapter never prevents a WebGL 2-capable browser from starting the game.

## 3.3 Renderer isolation

Create a rendering boundary, for example:

```text
RendererInterface
│
├── initialize()
├── loadArena()
├── loadOperative()
├── createWeaponViewmodel()
├── updateEntities()
├── updateAnimation()
├── renderFrame()
├── applyGraphicsSettings()
├── resize()
└── dispose()
```

Adapt to existing architecture.

The renderer consumes game state; it must not independently decide authoritative kills, damage, scoring, or physics outcomes.

Keep simulation collision, map triggers, jump pads, and hit validation independent of Babylon's visual scene representation.

## 3.4 Coordinate-system conversion

Audit and preserve:

- World handedness.
- Up-axis.
- Camera forward direction.
- Character facing direction.
- Quaternion orientation.
- Model transform hierarchy.
- Weapon attachment transforms.
- Animation root motion.
- Winding and normal orientation.
- Map origin and world scale.

Babylon.js and Three.js have different default coordinate conventions.

Use an explicit coordinate conversion policy where required rather than scattered sign inversions.

Document the convention chosen for Spectre Orbit.

---

# 4. ADVANCED LIGHTING AND VISUAL QUALITY

## Artistic objective

Create a polished, atmospheric, visually distinctive competitive FPS.

Visual direction:

**Grounded military science fiction with retro-futuristic industrial design, cinematic lighting, strong readability, and restrained cyberpunk influences.**

Reference qualities:

- Physically plausible material response.
- Distinct warm and cool lighting zones.
- Industrial atmosphere.
- Strong environment silhouettes.
- Detailed but readable weapons.
- Atmospheric fog and sunlight.
- Carefully controlled emissive highlights.
- Cohesive cinematic color grading.

The objective is not excessive bloom or maximum visual effects.

**Competitive visibility and input responsiveness take priority over decorative rendering effects.**

## 4.1 Physically based rendering

Implement an appropriate Babylon PBR workflow.

Support:

- Metallic/roughness materials.
- Image-based lighting.
- Environment reflections.
- Normal and ambient occlusion textures.
- Emissive materials.
- Correct color-space handling.
- Filmic tone mapping or an equivalent calibrated pipeline.
- Exposure controls.
- Color grading.
- Material variants.

Audit imported glTF materials instead of blindly recreating them.

Do not assume Houdini or Unreal shader networks transfer directly to Babylon.js.

## 4.2 Lighting system

Evaluate and implement the most appropriate supported combination of:

- Directional lighting.
- Shadow maps.
- Cascaded shadows.
- Clustered lighting.
- Spotlights and point lights.
- Environment-based lighting.
- Baked lightmaps.
- Reflection probes.
- Volumetric lighting and fog.
- Screen-space effects when practical.
- Static-scene indirect illumination techniques.

For Babylon.js 9 clustered lighting, verify capabilities and backend requirements before enabling it.

Use lighting budgets appropriate to each map.

Not every dynamic light needs to cast shadows.

Do not simulate global illumination by indiscriminately adding hundreds of expensive lights.

## 4.3 Arena-specific lighting direction

### Schoolyard

- Warm Egyptian daylight.
- Defined sunlight through pointed arcades.
- Soft courtyard shadow gradients.
- More atmospheric depth around galleries.
- Natural material response on stone and masonry.
- Dusty golden lighting near the locomotive tunnel.

### Hadota Rail Yard

- Cinematic dusk environment.
- Warm low-angle sunlight.
- Cool ambient fill.
- Metallic train reflections.
- Industrial practical lighting.
- Atmospheric depth around the locomotive and freight wagons.
- Controlled specular response for rails, steel, and machinery.

### Foundry Core

- Orange-red furnace lighting.
- Molten material emission.
- Dynamic industrial highlights.
- Heat-like distortion only where performance permits.
- Deep but readable shadows.

### Reactor Complex

- Cool industrial lighting.
- Bright reactor-core emission.
- Selective colored point and spot lights.
- Controlled volumetric effects.
- Strong differentiation between playable surfaces and hazards.

### Zenith Atrium

- Distinct atmospheric lighting.
- Clear silhouettes against the void.
- High contrast between safe platforms and lethal edges.
- Limited visual clutter.

### Classic arenas

Preserve their appearance and geometry first.

Apply compatible lighting improvements only after gameplay and performance parity have been verified.

---

# 5. BROWSER PERFORMANCE AND BUILD SIZE

Babylon.js must not be assumed to be lighter or faster simply because it is a browser-focused engine.

**Measure actual performance and bundle size.**

## 5.1 Asset optimization

Implement or improve:

- glTF/GLB asset delivery.
- Meshopt or Draco compression where appropriate.
- KTX2/Basis texture compression where supported.
- Texture mipmaps.
- Texture-resolution budgets.
- Geometry reduction.
- Mesh merging where appropriate.
- Hardware instancing.
- Thin instancing for suitable repeated static geometry.
- Frustum culling.
- Distance-based LODs.
- Material batching.
- Asset deduplication.
- GPU resource disposal.
- Scene unloading.

Use existing map and character conversion pipelines wherever possible.

Preserve licensing and attribution for third-party map assets.

## 5.2 Streaming and loading

The online edition must not force every player to download every arena at launch.

Separate:

- Core game code.
- Lobby assets.
- Operative showcase assets.
- Arena-specific geometry.
- Arena-specific textures.
- Optional enhanced visual assets.

Load only required resources.

Display meaningful download and loading progress.

Use immutable, versioned asset URLs where appropriate.

Support browser caching without allowing incompatible old assets to corrupt a new build.

Evaluate lazy-loading the Babylon inspector and development-only tools.

Do not bundle the full Babylon editor or development tools into production.

## 5.3 Graphics presets

Implement:

**LOW**
- Reduced render resolution.
- Low shadow resolution.
- Minimal post-processing.
- Limited dynamic lights.
- Reduced particles and volumetrics.

**MEDIUM**
- Balanced rendering resolution.
- Moderate shadows.
- PBR and environment lighting.
- Selective dynamic lighting.
- Moderate post-processing.

**HIGH**
- Full target rendering resolution.
- Higher shadow quality.
- Advanced lighting where supported.
- Controlled volumetrics.
- Enhanced reflections and post-processing.

**ULTRA / EXPERIMENTAL**
- Optional higher-quality settings for powerful GPUs.
- Must not become the default configuration.
- Enable only supported effects.

Include individual settings for:

- Resolution scale.
- Anti-aliasing.
- Shadows.
- Texture quality.
- Ambient occlusion.
- Reflections.
- Volumetrics.
- Bloom.
- Particles.
- VSync or frame limiting where supported.

Provide an automatic quality preset suggestion using runtime capability detection and measured frame performance.

Avoid repeatedly changing quality settings during combat.

## 5.4 Performance goals

Target smooth, responsive gameplay at 1080p and 60 FPS on a documented mainstream desktop test machine.

This is a target, not a guaranteed result.

Record:

- Average FPS.
- 1% low FPS.
- CPU frame time.
- GPU frame time where available.
- Draw calls.
- Active triangles.
- Texture memory estimates.
- JS heap usage.
- Initial download size.
- Decompressed asset size.
- Arena loading time.
- Cold-start and warm-start time.
- Network latency and packet loss.

Benchmark both equivalent-quality scenes and the enhanced Babylon visuals.

Distinguish a graphics improvement from a performance improvement.

---

# 6. OPERATIVES, RIGGING AND ANIMATION

Preserve all existing playable characters, skins, animations, and selection functionality.

Migrate existing rigged characters to Babylon's supported asset and animation systems.

Required:

- Skeletal mesh loading.
- Correct skin weights.
- Bone hierarchy.
- Animation playback.
- Animation blending.
- Idle, walk, run, crouch, and death states.
- First-person local character visibility rules.
- Remote player pose presentation.
- Weapon attachments.
- Operative preview turntable.
- Character skin selection.
- Appropriate animation state synchronization.

Evaluate native Babylon AnimationGroups, skeletons, and animation blending.

Do not needlessly replace the existing gameplay animation-state logic.

Test imported armatures for incorrect orientation, scale, inverse bind matrices, and root transforms.

Maintain stable character IDs across both browser editions.

---

# 7. WEAPONS, EFFECTS AND GAME FEEL

Preserve the existing combat system.

Weapons:

- AK-47.
- Shotgun.
- Sniper rifle.
- SMG.
- LMG.
- Combat knife.

Preserve:

- Firing rates.
- Reloading.
- Ammunition.
- Damage.
- Headshots.
- Sniper scope.
- Recoil behavior.
- Quick melee.
- Backstab behavior.
- Hit markers.
- Kill feedback.
- Grenades.
- Explosive barrels.
- Bots.
- Respawning.

### Babylon rendering upgrades

Implement appropriately optimized visual effects:

- Muzzle flashes.
- Weapon fire lighting.
- Impact sparks.
- Surface-specific hit effects.
- Bullet tracers.
- Grenade explosion effects.
- Explosion light pulses.
- Smoke particles.
- Environmental dust.
- Character death presentation.
- Weapon muzzle and attachment transforms.

Use Babylon's particle systems where beneficial.

Visual bullet tracers must not redefine the authoritative hit-scan or projectile simulation.

Do not use expensive physically simulated particles for effects that can be implemented efficiently.

Preserve the existing procedural audio system unless there is a compelling, tested reason to alter it.

Keep audio responsive and follow browser autoplay requirements.

---

# 8. ONLINE LOBBY AND MATCHMAKING

Replace the online edition's shared-folder discovery and SDP exchange with a proper network service.

Use Node.js LTS and HTTPS/WSS.

Provide:

- Connect online.
- Create public room.
- Create private room.
- Browse compatible rooms.
- Join by room code.
- Join by invite URL.
- Quick join.
- Display player count.
- Display selected arena and mode.
- Show player-hosted room status.
- Clear loading and connection states.
- Leave room.
- Return to lobby.
- Handle host disconnect.
- Handle rejected or canceled joins.
- Allow safe retries.

### Security

- Server-issued session identities.
- Enforced room ownership.
- Server-side message validation.
- Message size limits.
- Rate limiting.
- Sanitized player and room names.
- Protocol version validation.
- Match capacity enforcement.
- Host-to-guest signaling isolation.
- Safe room expiry.
- Safe cleanup of stale sessions.

Never trust client-supplied sender identities.

Prevent room-capacity races using join reservations.

Handle simultaneous join requests and reservations that expire before successful negotiation.

Document the initial single-instance matchmaking limitation.

---

# 9. INTERNET WEBRTC TRANSPORT

Preserve existing gameplay DataChannel semantics.

### Reliable channel

Keep `rel` reliable and ordered.

Use it for critical game events and state transitions that must not be silently discarded.

### Fast channel

Keep `fast` unordered with minimal retransmission.

Use it for appropriate transient gameplay state.

Discard stale fast-channel updates safely.

### Connectivity

Implement:

- Trickle ICE.
- Candidate buffering until remote descriptions are installed.
- STUN configuration.
- Authenticated TURN.
- TURN/TLS support where available.
- Short-lived TURN credentials.
- ICE failure handling.
- Negotiation timeout handling.
- Connection diagnostics.
- Cleanup of peer connections.
- Handler and timer disposal.
- Safe cancellation.
- Relay-only diagnostic testing.

Do not reuse the existing short LAN ICE gathering heuristic for internet connections.

Never put TURN shared secrets inside the browser bundle.

### Network resilience

Handle:

- Transient disconnections.
- Negotiation failures.
- Browser backgrounding.
- Host departure.
- Guest departure.
- High latency.
- Packet loss.
- Delayed snapshots.
- Out-of-order messages.
- Reliable-channel backpressure.

Avoid unbounded message queues.

Do not silently discard important reliable events to preserve bandwidth.

Keep client prediction, reconciliation, and remote interpolation functional after the renderer migration.

### Authority model

The first online release may retain the existing player-host authoritative model.

However:

- The matchmaking server is not the gameplay authority.
- The player host must remain connected.
- Host departure may terminate the match.
- Player-host authority is not equivalent to trusted dedicated-server anti-cheat.
- TURN can relay traffic but does not validate gameplay.

Explain these limitations in the interface and documentation.

---

# 10. MAP PIPELINE AND GAMEPLAY COLLISION

Preserve all existing maps and their canonical IDs.

Adapt rendering geometry for Babylon without silently changing gameplay collision.

Ensure that:

- Floors remain traversable.
- Walls block movement.
- Player spawn points remain valid.
- Rooftops and elevated platforms are accessible.
- Jump pads behave identically.
- Hazard floors remain lethal.
- Grenades collide and bounce as intended.
- Barrels remain interactive.
- Trains retain correct collision.
- Bot navigation and behavior remain functional.

Do not infer collision from high-detail render meshes unless explicitly suitable.

Prefer optimized collision representations independent of visual LODs.

Investigate Babylon mesh picking and physics integration as rendering-side or helper systems only.

Do not replace the existing authoritative simulation with a Babylon physics plugin unless explicitly justified by compatibility and test results.

### Houdini asset pipeline

Design a reusable conversion workflow for Houdini-produced assets:

```text
HOUDINI
   |
   v
GAME-READY GEOMETRY
   |
   +-- Render Mesh
   +-- Collision Mesh
   +-- LOD Variants
   +-- UVs
   +-- Materials
   +-- Lightmaps
   |
   v
GLTF / GLB EXPORT
   |
   v
ASSET OPTIMIZATION
   |
   +-- Mesh Compression
   +-- Texture Compression
   +-- Validation
   |
   v
BABYLON.JS SCENE
```

Document coordinate conventions, units, normals, UV sets, material conversions, asset naming, and export validation.

Retain compatible source assets for Unreal's independent import pipeline.

---

# 11. USER INTERFACE AND EXPERIENCE

Preserve Spectre Orbit's established visual identity.

Enhance usability without redesigning unrelated screens.

### Online lobby

Replace folder-based connection instructions with:

- Online status.
- Region or connection quality information where supported.
- Multiplayer room browser.
- Quick match.
- Create match.
- Join via code.
- Join via invitation.
- Operative selection.
- Map selection.
- Game mode.
- Settings.
- Graphics settings.

### Operative dossier

Use Babylon.js to render the character preview.

Retain:

- Character turntable.
- Skin selection.
- Operative details.
- Animation preview.
- Equip/select workflow.

### In-game HUD

Preserve:

- Health.
- Ammo.
- Weapon selection.
- Scoreboard.
- Kill feed.
- Crosshair.
- Hit markers.
- Damage indicators.
- Connection status.

Do not introduce visual effects that interfere with aiming or competitive clarity.

### Error handling

Provide understandable messages for:

- Unsupported GPU/API.
- Match not found.
- Room full.
- Incompatible build.
- Host disconnected.
- Signaling unavailable.
- TURN authentication failure.
- ICE negotiation failure.
- Connection timeout.
- Server maintenance.
- Asset loading failure.

Avoid exposing stack traces or infrastructure credentials to players.

---

# 12. BUILD SYSTEM AND SECURITY

Maintain separate build outputs.

```text
dist/
│
├── classic/
│   └── LAN_FPS.html
│
└── online/
    ├── index.html
    ├── assets/
    └── versioned JS/CSS bundles
```

The online `index.html` may also be produced under the name `LAN_FPS_online.html`, as appropriate.

Use the existing build system where practical.

Introduce Vite, Rollup, esbuild, or another suitable bundler only if it improves the migration and can be justified.

### Build requirements

- Deterministic dependency installation.
- Lockfile committed.
- Production minification.
- Code splitting where appropriate.
- Modular Babylon imports.
- No runtime CDN requirement.
- Cache-friendly asset names.
- Source maps handled appropriately.
- Explicit build metadata.
- Shared protocol version.
- Configurable backend URL.
- Correct Content Security Policy.

### CSP

Configure narrowly for:

- Same-origin game resources.
- HTTPS/WSS backend.
- Approved asset hosting.
- Required worker and blob functionality.
- WebRTC-related browser behavior.

Do not broadly disable CSP simply to fix loading errors.

### Updater

The current in-place updater must not overwrite the online Babylon build with an incompatible offline release.

Define a separate online release-update mechanism appropriate for hosted assets.

Keep the offline build's update behavior intact wherever safe.

---

# 13. UNREAL ENGINE PORT COMPATIBILITY

The Unreal Engine project is being developed separately.

Do not modify it.

Document shared concepts:

- Stable map IDs.
- Operative IDs.
- Weapon IDs.
- Team IDs.
- Gameplay rules.
- Protocol versions.
- Future account system.
- Matchmaking identifiers.
- Shared asset conventions.

Do not claim that browser WebRTC clients can automatically join Unreal Engine replication sessions.

Cross-play requires deliberate work involving:

- Common network protocol.
- Compatible transport.
- Consistent gameplay state.
- Server authority.
- Movement and hit validation.
- Prediction and reconciliation.
- Entity serialization.
- Gameplay simulation parity.

Keep actual cross-play outside this first release.

Design the browser implementation so shared services may be reused later without forcing a renderer rewrite.

Unreal Pixel Streaming may be documented as a separate alternative, but it must be described as remote Unreal rendering streamed to the browser—not a locally rendered Babylon.js game.

---

# 14. DEPLOYMENT

Deliver a functional deployment package and guide.

### Local development

Include commands to:

- Install dependencies.
- Start matchmaking/signaling.
- Start the browser client.
- Build Classic.
- Build Online.
- Run automated tests.
- Run browser integration tests.

### Production infrastructure

Provide:

- HTTPS/WSS reverse proxy example.
- TLS configuration.
- DNS requirements.
- Firewall documentation.
- TURN configuration.
- TURN/TLS configuration if used.
- Short-lived TURN credential issuance.
- Environment variable examples.
- Secret management instructions.
- Health checks.
- Structured logging.
- Restart behavior.
- Resource limits.
- Static game hosting configuration.
- Rollback instructions.

Document practical hosting choices without hard-coding a provider.

A single VPS with a signaling service and appropriately secured TURN deployment is acceptable for an initial small-scale release, subject to measured capacity and network requirements.

Describe bandwidth and hosting-cost drivers.

If hosting credentials are not available, deliver deployment-ready artifacts and clearly identify what remains unverified.

---

# 15. TESTING AND ACCEPTANCE

## 15.1 Preserve existing tests

Run the original test suite.

Do not delete failing tests merely to make the migration appear successful.

Fix regressions or document unresolved blockers.

## 15.2 Babylon rendering tests

Verify:

- Engine initialization.
- WebGPU rendering where available.
- WebGL 2 fallback.
- Correct camera orientation.
- Pointer-lock aiming.
- Character asset loading.
- Material loading.
- Rigging.
- Animation.
- Weapon rendering.
- Arena geometry.
- Texture loading.
- Shadow behavior.
- Graphics preset switching.
- Scene unloading.
- Resource disposal.
- Context/device loss handling where feasible.

## 15.3 Gameplay parity

Test:

- Movement.
- Jumping.
- Crouching.
- Shooting.
- Damage.
- Reloading.
- Headshots.
- Melee.
- Grenades.
- Explosive barrels.
- Bots.
- Team Deathmatch.
- Free For All.
- Respawns.
- Scoring.
- Jump pads.
- Hazards.

Compare online Babylon gameplay with the original Three.js version.

## 15.4 Networking tests

Cover:

- Room creation.
- Room discovery.
- Quick join.
- Invite joining.
- Room-code joining.
- Capacity races.
- Reservation expiry.
- Host departure.
- Join cancellation.
- Protocol mismatch.
- Spoofed sender IDs.
- Malformed messages.
- Oversized payloads.
- Candidate ordering.
- ICE cancellation.
- Reconnect attempts.
- Stale-room cleanup.

## 15.5 Real browser validation

Use real browsers, not only mocked RTC objects.

Verify two players can join the same match and exchange actual gameplay state.

Test:

- Movement synchronization.
- Shooting synchronization.
- Damage and kills.
- Respawning.
- Grenades and barrels.
- Bot behavior.
- Player departure.
- Host departure.

When infrastructure permits, force TURN relay and verify the selected ICE candidate pair.

Do not present localhost or two browser tabs on one PC as proof of internet connectivity.

Test different networks when available.

Test Chrome/Edge, Firefox, and Safari where accessible, and disclose what could not be tested.

## 15.6 Performance comparison

Benchmark the original Three.js baseline against Babylon.js on the same machine and comparable scenes.

Use identical or equivalent asset quality and rendering settings.

Then separately benchmark Babylon's enhanced visual preset.

Record measured differences in:

- FPS.
- Frame time.
- Memory.
- Draw calls.
- Triangle counts.
- Initial download size.
- Loading time.
- Network behavior.

Do not fabricate benchmark numbers.

---

# 16. REQUIRED EXECUTION ORDER

Work systematically without stopping after a design document.

### PHASE 1 — Audit and branch

- Inspect repository and instructions.
- Check working tree.
- Create isolated development branch/worktree.
- Run baseline tests.
- Audit rendering and networking dependencies.
- Identify any shared game-state assumptions tied to Three.js.

### PHASE 2 — Rendering isolation

- Define or implement rendering boundaries.
- Separate gameplay simulation from renderer-specific code.
- Preserve Classic build.
- Establish Babylon engine bootstrap.
- Implement WebGPU/WebGL 2 selection.

### PHASE 3 — Babylon gameplay migration

- Port cameras and input integration.
- Port maps and geometry.
- Port operatives and animation.
- Port weapons and visual effects.
- Port HUD integration.
- Restore complete gameplay parity.
- Validate all existing features.

### PHASE 4 — Lighting and performance

- Implement PBR pipeline.
- Configure environment lighting.
- Add shadows.
- Evaluate clustered lighting.
- Add selective atmosphere and effects.
- Implement graphics settings.
- Optimize models, textures and draw calls.
- Benchmark against Three.js.

### PHASE 5 — Online networking

- Create signaling service.
- Implement rooms and matchmaking.
- Integrate WebRTC internet negotiation.
- Implement STUN/TURN credential flow.
- Preserve authoritative host simulation.
- Handle failure and cleanup.
- Validate two-player real-browser sessions.

### PHASE 6 — Production packaging

- Generate both builds.
- Prepare deployment configuration.
- Add security hardening.
- Add integration tests.
- Document hosting.
- Perform final regression tests.

### PHASE 7 — Release candidate

Produce a working release candidate with documented limitations.

Do not silently defer core gameplay, online connectivity, or rendering migration to hypothetical future phases.

If blocked by unavailable infrastructure, distinguish completed local implementation from required external verification.

---

# 17. FINAL DELIVERABLES

Provide:

1. **Updated source repository** with isolated branch and clear commits.
2. **Original Three.js offline build**, preserved and verified.
3. **Babylon.js online browser build**, containing the migrated playable game.
4. **Matchmaking and signaling backend**.
5. **WebRTC STUN/TURN integration**.
6. **Deployment configuration and documentation**.
7. **Graphics settings and asset optimization pipeline**.
8. **Rendering comparison** between Three.js and Babylon.js.
9. **Automated and real-browser test results**, clearly separated.
10. **Known issues and limitations**, including host trust, host departure, background tabs, scalability, and TURN bandwidth.
11. **Future roadmap** toward dedicated authoritative game servers.
12. **Unreal compatibility notes**, without making cross-play claims.

### Required final report structure

```text
SPECTRE ORBIT — BABYLON ONLINE RELEASE

Branch / Commit:
Baseline Version:
Babylon Version:
Node.js Version:

IMPLEMENTED
- ...

BUILDS
- Classic:
- Online:

RENDERING
- WebGPU:
- WebGL 2:
- Lighting:
- Materials:
- Asset Pipeline:

MULTIPLAYER
- Signaling:
- Matchmaking:
- WebRTC:
- TURN:

TESTS
- Existing:
- Added:
- Browser:
- Cross-network:
- TURN relay:

PERFORMANCE
- Measured baseline:
- Babylon result:
- Outstanding benchmarks:

DEPLOYMENT
- Local:
- Production prerequisites:

KNOWN LIMITATIONS
- ...

NEXT MILESTONE
- ...
```

---

# FINAL DIRECTIVE

**Spectre Orbit Online must become a proper Babylon.js-powered multiplayer browser FPS, not merely a technology demonstration.**

The finished result must preserve established gameplay, improve graphical presentation, support players over the internet, and maintain the existing independent offline version.

Prioritize:

**1. Gameplay preservation.**

**2. Correct internet multiplayer.**

**3. Complete Babylon.js rendering migration.**

**4. Excellent lighting and visual presentation.**

**5. Consistent performance and efficient asset delivery.**

**6. Maintainable architecture and secure deployment.**

**7. Reproducible tests and honest verification.**

Make routine engineering decisions independently.

Preserve unrelated work.

Avoid unnecessary redesign.

Do not stop after writing a plan.

**Proceed with implementation.**
