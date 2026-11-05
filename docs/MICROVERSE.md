# Operation Microverse: a walkable micro planet (Babylon / Spectre_Orbit_Light only)

The planet **is** the level. Pick **Microverse** in the Battlefield list. There is no flat arena and no
invisible boundary: gravity points at the planet centre, `WASD` runs along the local surface, and you can
walk all the way round onto the underside and back.

Screenshots: `docs/microverse/orbit-view.jpg`, `first-person-command-spire.jpg`,
`first-person-underside.jpg`, `first-person-forest-bot.jpg`.

## How it works

| Concern | Where | Notes |
|---|---|---|
| Spherical sim | `source/src/sphere_sim.js` | Pure maths shared by host, clients and tests. Radial gravity, transported heading, terrain heightfield, oriented-box (OBB) collision, ray tests, grenades. |
| Hooks | `source/src/sim.js` | `stepPlayer`, `castShot`, `stepGrenade` branch on `world.sphere`; flat maps are untouched. |
| Generator | `source/src/micro_planet.js` | Seeded, deterministic, gameplay-first layout: 6 districts, 3 great-circle roads, ramps, jump pads, cover, spawns, objectives, then a reachability validator. Output is plain data plus a layout hash. |
| Visuals | `source/src/babylon/micro_world.js` | One displaced low-poly icosphere plus every prop as GPU thin instances, bucketed by 54 cube-face sectors and base mesh for frustum culling. |
| Host and bots | `source/src/hostgame.js` | Spherical spawns, grenades, explosions, line of sight, simple great-circle bots. |
| Client | `source/src/game.js`, `babylon/view.js`, `babylon/character_loader.js` | Camera and avatars use a basis built from local up plus heading, never Euler angles. |
| Sandbox | `source/src/micro_sandbox.js` | Open the game with `?sandbox=1`. |

Player orientation on the wire is a heading vector (`hx,hy,hz`) plus the accumulated yaw `ly`; the input is still
`[seq, buttons, yaw, pitch, w]`. Each tick the sim turns the heading by `yaw - ly` around the local up, so the
host and a predicting client stay identical. Only `{ map: 'microverse', seed }` travels to guests; each client
builds identical collision from the seed and the room's `layoutHash` is checked on join.

## Map

Planet radius 72 m (configurable). Districts: **Command Spire** (north pole, control zone, deck on pillars,
pads and a ramp), **Neon Urban Hub** (+X, low-rise roofs reachable by launch pads), **Industrial Ridge** (-X,
containers with roof ramps, silos, warehouses with ramped catwalks, pipes), **Forest Belt** (+Z, rolling
terrain, trees, boulders, plateaus with ramps), **Orbital Outpost** (-Z, bunkers, pads, antenna) and **Under
Spire** (south pole, the second landmark on the opposite hemisphere). The equator is the ring road; two
meridian roads run through both spires. 36 spawns are spread over five latitude rings on both hemispheres.

Modes: Free-for-all, Team Deathmatch, Gun Game and Control (zone on the Command Spire plaza). Capture the Flag
is refused on this map.

## Sandbox (`Spectre_Orbit_Light.html?sandbox=1`)

Seed, radius, preset, building/vegetation/cover density and roughness; **Regenerate + play**; orbit camera
(drag, wheel); collision boxes; gravity vectors; spawn and objective markers; live stats (FPS, frame and render
ms, draw calls, active meshes, visible instances, triangles, materials and textures, heap, generation time,
reachability). Non-default densities are local to the sandbox; multiplayer rooms always use the default config
plus the seed.

## Tests

`npm run test:online` (and `test:all`) now include:

- `test/sphere_test.mjs`: closed planet, every spawn on the crust and reachable, a full loop of about 450 m around
  the globe with no snaps, underside stand/jump/land, stability at the pole, the planet blocks cross-planet shots
  while open sightlines hit, grenades obey radial gravity, seeded determinism, a host game with a bot, the control
  zone, and the CTF refusal.
- `test/sphere_net_test.mjs`: two sessions build the planet separately (same hash), see each other on opposite
  hemispheres, prediction stays near the authoritative state while walking the underside, and hits, deaths and
  respawns work.

## Measurements

Taken in the embedded browser pane (GPU not identified). Treat them as relative, not as a midrange-desktop benchmark.

Whole planet in view from orbit (worst case for instance count), 630 prop instances, 103k-triangle terrain:

| | Draw calls | Active meshes | Scene meshes | Materials |
|---|---|---|---|---|
| Optimised (sector thin instances) | 176 | 105 | about 121 | 17 |
| Baseline (one mesh and material per prop) | 1143 | 621 | 650 | 134 |

CPU frame time was about 1.2 ms (optimised) against 1.4 to 1.8 ms (baseline) with the display locked at 60 FPS, so
the proven saving is draw-call count, not an FPS gain on this machine. On the ground the planet drew 33 to 38 draw
calls, 32 active meshes and 108k triangles. Regenerating the planet five times keeps materials (17), textures (5),
lights (8) and transform nodes (7) constant (this also fixed a name-tag material leak in avatar disposal).
World generation takes about 30 ms in Node and about 330 ms in the browser including reachability validation;
building the visuals took about 250 ms.

## Not done and known limits

- The capture layout is the existing single Control zone on the Command Spire: no three-point objective, no CTF.
- Tunnels are not built. Tree trunks and boulders collide; foliage does not.
- Bots steer along the surface toward the nearest enemy with line-of-sight checks and jump when stuck. There is no
  navigation graph, so they can get snagged on large structures.
- Positional audio panning and the hit-direction indicator still use flat x/z maths and are wrong on the globe.
- Weather is forced off on this map (rain falls along world -Y).
- Terrain tessellation follows the graphics preset chosen when the match is built, not later changes.
- Shadows use the shared sun shadow map over the whole planet; quality was not tuned.
- The 60 FPS at 1080p Medium target was not verified on a reference midrange GPU.
