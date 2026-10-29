# OPERATION: MAPFORGE — Release Notes (v1.4.0)

**LAN_FPS: Expanded Tactical Arena Expansion**  
*Release Date: October 2026*

---

## 1. Overview

**OPERATION: MAPFORGE** introduces a complete, professional map acquisition, conversion, optimization, and production pipeline into **LAN_FPS**, expanding the game's battleground roster with three iconic, open-source FPS arenas sourced from **Team Xonotic** (GPL-2.0-or-later) and art-directed with a retro-futuristic industrial sci-fi aesthetic.

The entire update remains **100% self-contained in `LAN_FPS.html` (12.5 MB)** with zero runtime server requirements, zero CDN calls, full LAN WebRTC multiplayer synchronization, and client-side prediction.

---

## 2. New Playable Arenas

### Sector 06: Foundry Core (`foundry`)
- **Archetype**: Compact Industrial Arena (Fast FFA, 2–6 players).
- **Origin**: Based on *Boil* by kuniu the frogg & Mirio.
- **Environment**: Molten industrial smelting pit surrounded by multi-tier steel catwalks, coolant machinery, safety railings, and explosive fuel barrels.
- **Gameplay Features**: Tight CQB corners, central high-exposure walkway, 2 directional jump pads, and an active lava hazard kill floor.
- **Stats**: 201 collision boxes, 7 verified player spawns, 1,167 polygons.

### Sector 07: Reactor Complex (`glowplant`)
- **Archetype**: Medium Sci-Fi Facility (Team Deathmatch / FFA, 4–10 players).
- **Origin**: Based on *Glow Plant* by tZork, Cuinnton, Debugger & Mirio.
- **Environment**: Sub-orbital nuclear reactor facility featuring central pulsating blue plasma cores, symmetrical corridors, and dual terminal wings.
- **Gameplay Features**: Balanced team spawns for Red and Blue teams, 3 velocity jump pads, tactical server cover, and hazard warning trim.
- **Stats**: 1,029 collision boxes, 17 verified player spawns, 6,903 polygons.

### Sector 08: Zenith Atrium (`zenith`)
- **Archetype**: Vertical Futuristic Complex (Multi-level combat, 4–12 players).
- **Origin**: Based on *Dance* by FruitieX, dublpaws, Debugger & packer.
- **Environment**: High-altitude open sky arena featuring floating multi-level combat tiers, perimeter sniper catwalks, and vertical sightlines.
- **Gameplay Features**: 2 high-velocity jump pads propelling operatives between lower and upper tiers, bottomless void kill floor, and long-range engagement corridors.
- **Stats**: 146 collision boxes, 18 verified player spawns, 768 polygons.

---

## 3. New Engine & Gameplay Mechanics

1. **Velocity Jump Pads**:
   - Stepping onto a glowing blue launch pad gives an immediate vertical velocity boost ($v_y = 15.0\,\text{m/s}$), propelling the player to upper catwalks with deterministic client prediction and server authority.
2. **Hazard Kill Floors**:
   - Falling into molten lava or off high-altitude floating platforms triggers instant elimination when dropping below the map's `killY` threshold, triggering standard respawn timers.
3. **Multiplayer Sector Selection UI**:
   - The lobby battlefield selector now features all 8 sectors with dedicated map briefings, tactical descriptions, sector badges, and supported game modes.
4. **Surface Footstep Audio Integration**:
   - Metallic grating, concrete walkways, and molten pits trigger distinct procedural Web Audio footsteps via `getSurface(x, y, z)`.

---

## 4. Verification & Testing

- **39/39 Automated Unit Tests Passing** (`node test/run.mjs` in `source/`).
- **End-to-End Headless Chrome Tests Verified**: All 3 maps load, host, spawn, and render with 0 console errors and clean screenshots captured under `source/test/`.
- **Full Legal Compliance**: Provenance, author attributions, and source files documented in `docs/MAP_LICENSES.md` and archived under `source/assets/maps/sources/`.
