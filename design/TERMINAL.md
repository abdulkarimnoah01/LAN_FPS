# FIELDLINK terminal refinement

Historical PHOSPHOR design/verification notes. The current released palette is NEON; see `NEON.md` for the final colors and v1.3.1 release details.

29 October 2026. Final build uses v1.2.2, including the current character/outfit and updater changes. The shared checkout advanced from v1.2.1 during implementation; those changes were retained.

## Design intent

- Audience/task: LAN players configuring identity and uplink, joining/hosting, and reading combat status.
- Surface: existing offline HTML/CSS/JavaScript game; preserve gameplay and networking.
- Mode: PHOSPHOR.
- Character: utilitarian, readable, terminal-native.
- Signature: the live `session.setup` status line.
- Priority: P0 connection/deployment and combat vitals; P1 rooms/operatives; P2 configuration.
- Motion: level 1 control feedback; optional static CRT treatment, no flicker or rolling scan.
- Constraints: keyboard/focus, responsive menus, system fonts, no new network/dependencies, rig/rendering work untouched.

Information hierarchy: terminal masthead → game identity + real station configuration → session status → identify/connect/deploy → operator/uplink desk and match terminal → field manual. Existing deployment, roster, settings, and HUD flows remain functional.

## Changes

The display uses one system monospace family with pale green text, a near-black green canvas, warm action fills, square controls, dashed separators, indexed headings, and bracketed shortcut labels. Red and blue teams remain explicitly labeled and visually distinct.

Type roles: `LAN_FPS` is the command heading; `100 HP` is a stable metric; “Choose shared folder” is an action; supporting explanations are smaller muted prose; errors include text and `!`; station rows use aligned key/value columns. Typography remains real selectable HTML.

The station readout tracks callsign, configured uplink and discovered room count. The session line mirrors actual connection/recovery messages, including preparing a direct link and host departure. It is the single live announcement region; the detailed message remains below the controls.

CRT is **off by default**. Use **CRT: OFF/ON** in the header or **CRT screen effect** in settings. Both controls reflect the same saved `lanfps.crt` preference. Missing/unavailable storage falls back safely to an unsaved preference. The effect adds static scanlines to menu/HUD backgrounds and restrained glow to headings/readouts. It adds no timers, flicker, moving scan bars, viewport filters, canvas processing, or new sounds. Inputs and select text have no glow. Reduced-motion mode remains supported; CRT itself is static.

## Component contract

| Component | Source | States | Keyboard | Evidence |
| --- | --- | --- | --- | --- |
| CRT controls | Saved `lanfps.crt` | Off/on; synchronized pressed/checked | Enter/Space, native checkbox | Initial off, on across reload, Space off, header synchronization |
| Station readout | Name input, folder result, room listing | Unassigned/unconfigured/connected, real counts | Native callsign input | Input reflected immediately; one room found in guest tab |
| Session line | Existing message element and hosting availability | Setup, ready, connecting, error | Live status announced; no fake command prompt | Real join progress and host-close error |
| Terminal sections | Existing setup/deployment/settings/roster | Existing selected/disabled/busy/error states | Native controls and existing shortcuts | Settings, outfit/equip, nested deployment, Scores |
| HUD instruments | Existing live player/snapshot state | Health/ammo, reload, stance, FFA/TDM | Existing combat keys and native weapon buttons | Live team match and bot scoreboard |

## Verification

- `npm run build` succeeds for v1.2.2, producing the standalone `LAN_FPS.html` with current bundled assets.
- All 35 existing tests pass. Gameplay/network code was not changed for this refinement.
- `git diff --check` passes.
- Real two-tab WebRTC join succeeded with the current build. Guest displayed a direct link and TDM scores. The host spawned a bot; Scores displayed the live standings. Closing the host returned the guest to the lobby and updated the top error line to “The host closed the room.”
- The updated registry/outfit flow was exercised: choose Blue Palm Shirt, equip, Escape from the canvas, return to deployment, deploy.
- CRT initial default, persistence after reload, native keyboard toggle, header/settings synchronization, modal focus wrap and Escape return were verified. Reduced motion was enabled during the inspection and remained compatible with static CRT.
- Pixel review covered desktop 1440×1080, tablet 768×1024, narrow 360×800, and a normal browser viewport of approximately 1265×713 for the populated roomboard. No horizontal overflow was measured at 360/768 widths. The responsive HUD and narrow settings were inspected directly.

Measured sRGB token contrasts (WCAG relative luminance):

| Pair | Ratio |
| --- | ---: |
| Main text / panel | 14.81:1 |
| Muted text / panel | 8.74:1 |
| Data / input well | 14.95:1 |
| Action fill / dark text | 12.48:1 |
| Control border / panel | 3.68:1 |
| Error / alert surface | 8.17:1 |

These are selected token measurements, not a complete accessibility certification.

## Visual review and iterations

First pass findings:

1. P2, responsive hero subtitle: hiding the line break joined two sentences without a space. Added whitespace and verified the second narrow capture.
2. P1, error feedback: the existing detailed recovery message appeared below the fold, while the new top line could continue to say ready. Bound the top line to actual messages and kept one live announcement region. A real host departure now shows a textual error at the top of the narrow screen.
3. P2, desktop vertical density: terminal chrome used the earlier banner spacing. Reduced hero padding and inspected the revised command desk and connection action.

The second pass checked the corrected subtitle/status line, the current outfit controls, a populated roomboard, live HUD, and narrow settings. The CRT treatment remains optional; clean form fields and the world canvas were visually checked.

Subjective rubric review: **90/100** (hierarchy 23/25; grammar 18/20; original direction 13/15; interaction 14/15; accessibility 13/15; robustness 9/10). No critical failures were observed in tested states. This score is a design review aid.

## Artifacts and limits

Final desktop comparisons: `screenshots/terminal/lobby-crt-off-1440-view.jpg` and `lobby-crt-on-1440-view.jpg`. Final narrow view: `lobby-360-view.jpg`. Additional captures cover settings, deployment, registry, scoreboard, populated roomboard, tablet/narrow HUD, and actual disconnection. Earlier full-page captures retain first-pass evidence. Some later full-page browser captures failed; final desktop evidence therefore uses viewport captures.

Changed UI sources: `source/index.html`, `source/style.css`, and `source/src/ui.js`; rebuilt distribution: `LAN_FPS.html`. No renderer, rigging, animation source, character asset, gameplay, network, updater, or version changes were authored for this refinement. Renderer and rig-tool SHA-256 values stayed unchanged between the two scope checks.

Physical multi-PC SMB permissions/firewall behavior, native OS DPI scaling, full assistive-technology testing, and prolonged FPS/performance playtesting were not repeated. No performance benchmark is claimed. The browser preview runs through the existing loopback-only `source/tools/preview.mjs`; offline distribution remains a single file.
