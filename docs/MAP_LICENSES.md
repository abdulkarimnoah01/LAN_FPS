# LAN_FPS — Map Licenses, Provenance & Attribution Report

This document records the licensing audit, provenance, original authors, source repositories, and redistribution permissions for all multiplayer arenas integrated into **LAN_FPS** under **OPERATION: MAPFORGE**.

---

## 1. Licensing Manifest & Overview

| Map ID | Display Name | Category | Upstream Source | Primary Authors | Original License | Runtime Distribution Status |
|---|---|---|---|---|---|---|
| `foundry` | **Foundry Core** | Compact Industrial Arena (FFA 2–6) | Xonotic (`maps/boil.map`) | kuniu the frogg, Mirio | GPL-2.0-or-later | Cleared (Full source geometry and tools included) |
| `glowplant` | **Reactor Complex** | Medium Sci-Fi Facility (TDM 4–10) | Xonotic (`maps/glowplant.map`) | tZork, Cuinnton, Debugger, Mirio | GPL-2.0-or-later | Cleared (Full source geometry and tools included) |
| `zenith` | **Zenith Atrium** | Vertical Futuristic Complex (4–12) | Xonotic (`maps/dance.map`) | FruitieX, dublpaws, Debugger, packer | GPL-2.0-or-later | Cleared (Full source geometry and tools included) |
| `railyard` | **Hadota Rail Yard** | Large rail yard (2–6) | Original layout (`tools/map_pipeline/railyard.py`) | LAN_FPS contributors | Project licence for the layout; the train model and textures are HADOTA production assets and are **not** covered by it | Train used with the production team's consent (confirm before any public release) |

---

## 2. Upstream Project Details

### Team Xonotic
- **Project Repository**: [https://github.com/xonotic/xonotic-maps.pk3dir](https://github.com/xonotic/xonotic-maps.pk3dir)
- **Official Website**: [https://xonotic.org](https://xonotic.org)
- **Primary License**: GNU General Public License version 2 or later (GPL-2.0-or-later)
- **Commit Reference**: `master` branch upstream tracking official release maps.

---

## 3. Individual Map Audits

### A. Sector 06: Foundry Core (`foundry`)
- **Original Map**: `boil.map`
- **Original Title**: Boil
- **Original Description**: *"Stay calm and watch how your enemy is boiling with anger. This is the moment you know you can beat them."*
- **Authors**: `kuniu the frogg`, `Mirio`
- **Supported Modes**: Free For All (`ffa`), Team Deathmatch (`tdm`)
- **Geometry Type**: Quake 3 / NetRadiant Convex Brush Definitions (`brushDef`)
- **License**: GPL-2.0-or-later
- **Attribution Text**:
  > Based on the open-source multiplayer map "Boil" by kuniu the frogg and Mirio from the Xonotic project. Licensed under GPL-2.0-or-later. Converted, re-meshed, and art-directed for LAN_FPS.

### B. Sector 07: Reactor Complex (`glowplant`)
- **Original Map**: `glowplant.map`
- **Original Title**: Glow Plant
- **Original Description**: *"A nuclear power plant with a LOT of blue glowy stuff..."*
- **Authors**: `tZork`, `Cuinnton`, `Debugger`, `Mirio`
- **Supported Modes**: Team Deathmatch (`tdm`), Free For All (`ffa`)
- **Geometry Type**: Multi-group Brush Definitions (`worldspawn`, `func_group`, `func_wall`)
- **License**: GPL-2.0-or-later
- **Attribution Text**:
  > Based on the open-source multiplayer map "Glow Plant" by tZork, Cuinnton, Debugger, and Mirio from the Xonotic project. Licensed under GPL-2.0-or-later. Converted, re-meshed, and art-directed for LAN_FPS.

### C. Sector 08: Zenith Atrium (`zenith`)
- **Original Map**: `dance.map`
- **Original Title**: Dance
- **Original Description**: *"Very open, small sized map floating above an ocean."*
- **Authors**: `FruitieX`, `dublpaws`, `Debugger`, `packer`
- **Supported Modes**: Free For All (`ffa`), Team Deathmatch (`tdm`)
- **Geometry Type**: High-verticality floating platform brushes and jump pads
- **License**: GPL-2.0-or-later
- **Attribution Text**:
  > Based on the open-source multiplayer map "Dance" by FruitieX, dublpaws, Debugger, and packer from the Xonotic project. Licensed under GPL-2.0-or-later. Converted, re-meshed, and art-directed for LAN_FPS.

---

## 4. Materials, Textures, and Audio Licenses

All supplementary textures, procedural shaders, and audio assets generated for the arenas comply with permissive distribution:
- **Procedural PBR Textures & Palettes**: Retro-futuristic industrial shaders generated in Blender / WebGL. No proprietary third-party copyrighted textures are used.
- **Surface Audio Synthesis**: 100% procedural Web Audio synthesizers built into `LAN_FPS` (metal pings, concrete thuds, water splashes).
- **Public Domain Assets**: Any modular structural elements are modeled following CC0 / public domain conventions (Kenney.nl style).

---

## 5. Compliance & Source Availability

In accordance with GPL-2.0-or-later:
1. The full conversion pipeline scripts are provided in [`source/tools/map_pipeline/`](file:///X:/Projects/game/LAN_FPS/source/tools/map_pipeline/).
2. Raw uncompiled `.map` and `.mapinfo` source files are preserved under [`source/assets/maps/sources/`](file:///X:/Projects/game/LAN_FPS/source/assets/maps/sources/).
3. The complete source code and build system for `LAN_FPS` remain fully open and public on GitHub.
