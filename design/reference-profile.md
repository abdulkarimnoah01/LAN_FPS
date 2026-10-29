# FIELDLINK reference profile — v1.4.1

## Reference and task

Source: user-provided `codex-clipboard-b5a0df77-757c-49be-928c-4f9b3a703f41.png`, inspected directly. It depicts this game's lobby as a compact neon/CRT equipment console. The requested implementation remains a functioning local-network FPS interface.

The reference supports three primary tasks: configure an operative, connect shared-folder discovery, and join/create a match. The shipped UI retains real networking, settings, character outfits, bots, combat controls, scores and updater behavior.

## Design contract

1. Audience: LAN players; connection and deployment are the main decisions.
2. Surface: existing offline HTML/JavaScript game, Chrome/Edge on Windows, preserving current v1.4.0 functionality including Mapforge arenas.
3. Mode: NEON.
4. Character: compact, mechanical, battle-worn.
5. Signature: framed Connect → Deploy rail.
6. Priority: P0 connect/play; P1 operative/match; P2 controls/status.
7. Motion: restrained existing feedback; optional static CRT, reduced-motion support.
8. Constraints: real states, keyboard access, desktop fit and responsive reflow, bundled media, no rig/rendering-source changes.

## Layout and typography

Observed proportions: a narrow full-width masthead, approximately 180px hero strip, two large setup steps, then an approximately 41/59 split between personnel/uplink and match terminal. Gutters are about 16–20px; outer safe edges about 28px. Borders are mostly one pixel cyan with short two-pixel yellow corner marks. Compact labels use a narrow technical type category; body text uses monospace. The reference does not identify exact fonts.

Implementation uses host system fonts only: Impact for the command logo, Bahnschrift with condensed/system fallbacks for headings and controls, and Consolas/Courier for operational text and data. No fonts or images load from the network.

Information map:

```text
brand + version | system identity | real lamps + CRT + roster + updater
game identity + original atmosphere art | live station configuration
session status
CONNECT                                 DEPLOY
operator.profile                        match.terminal
network.uplink                          discovery / map / rules / host
field manual and actual shortcuts
```

Color sampling used sRGB pixels from the supplied image, quantized into 16-step bins rather than claiming exact design tokens. Dominant bright bins were `#F0E000`/`#F0F000` yellow and `#00F0F0` cyan. Production uses `#FCEE0A` actions, `#4DF2F3` data, near-black blue surfaces, cool text, and explicit red errors.

Five reusable principles: prioritize operations; keep major regions compact; distinguish actions from data; concentrate framing at edges/headers; use imagery to support context rather than replace controls.

Five corrections to avoid copying weaknesses: retain correct “Room name” spelling; keep disabled hosting visibly disabled; do not fabricate always-lit lamps; avoid excessive glow on small text; do not use a generic portrait for a named character.

Original functional deviations: real map captures (explicit user constraint), a live still portrait of the equipped model, and lamps bound to identity/uplink/error state. Reconnect appears only when a saved handle exists. Generated masthead artwork is original and separate from all map imagery.

## Components and states

| Component | Actual source / behavior | Keyboard / recovery |
| --- | --- | --- |
| Connect rail | Calls existing folder chooser before connection; scrolls to uplink once configured | Native button, Enter/Space |
| Deploy rail | Navigates to room discovery and hosting | Native anchor |
| Station lamps | Name assigned; folder/practice configured; real session error | Accessible state labels and matching visible readouts |
| Operative portrait | Equipped game model rendered once, resized via ResizeObserver; no extra animation loop | Existing accessible roster launcher |
| Map card | Five gameplay captures, Sandbox marked sample; three new arenas use bundled source-map previews labeled as such | Native select; accurate accessible description |
| Host action | Existing connection availability and mode selection | Disabled before configuration; native activation |
| CRT | Existing saved on/off preference, static background lines/glow | Header toggle and native settings checkbox |
| Modal/score/HUD | Existing functional flows, focus management and real snapshot data | Escape, focus wrap, native controls and combat keys retained |

## Verification and visual QA

- `npm run build`: standalone v1.4.1 builds successfully, about 13 MB.
- `npm test`: all 39 simulation/network/roster/map tests pass after integration with v1.4.0.
- `npm run test:ui`: nine offline images, no external UI image URLs, unique DOM IDs and required controls pass.
- Desktop review at 1440×1080: the lobby, connection action, host controls and footer fit on one screen.
- Tablet 768×1024 and narrow 360×800: inspected reflow, reachable settings, no measured horizontal overflow.
- Manual checks: live map switching, Sandbox sample labeling, equipped-character portrait, keyboard focus wrapping, CRT off/on, connected rail activation, practice setup, operative selection, match creation, bot addition, live scoreboard and return to lobby.
- A real second browser tab discovered and joined the room over WebRTC. The guest reported a direct link. Host departure activated the red error lamp and textual recovery message.
- The generated decorative art is used only in the masthead. Actual map source captures were visually inspected and cropped without AI processing.

First visual review found a missing oversized PNG background, undersized supporting copy, and an overly distant portrait. The second pass uses a smaller embedded JPEG, larger text and closer portrait framing. A further narrow-layout check fixed a logo suffix producing excess line height. Portrait resizing now preserves aspect ratio when hidden/shown or reflowed.

Measured token contrasts: text/panel 16.66:1; muted/panel 11.07:1; cyan/panel 14.04:1; yellow/action text 15.75:1; control border/well 5.51:1; error/alert 5.92:1. These are token measurements, not accessibility certification.

Subjective design review: **92/100** — hierarchy 24/25, grammar 19/20, original direction 13/15, interaction 14/15, accessibility 13/15, robustness 9/10. No critical failures were observed in tested states.

Evidence is in `design/screenshots/reference/`; authentic map frames are in `design/screenshots/map-source/`; media provenance is in `source/assets/ui/README.md`. Earlier comparison/flow images use v1.3.3/v1.3.4; final lobby captures use v1.4.1.

Limits: physical multi-PC SMB permissions/firewall behavior, native OS DPI scaling, prolonged FPS benchmarks and a full assistive-technology audit were not repeated. Rig and animation source files were not edited. The three production data/status flows and offline asset packing were verified directly.
