# FIELDLINK UI overhaul

Implemented 29 October 2026 for the existing offline LAN_FPS game.

## Design intent

1. Audience: studio LAN players; choose identity, connect, enter a match, read combat status immediately.
2. Surface: existing HTML/CSS/JavaScript + Three.js, distributed as one offline HTML file.
3. Mode: FUSION.
4. Character: field-built, tactical, electric.
5. Signature instrument: the numbered identify → connect → deploy rail, bound to setup state.
6. P0: connection/deployment, health/ammunition. P1: operative, room information, scores. P2: configuration and build metadata.
7. Motion: short control feedback; manual preview spin; reduced motion freezes preview playback and removes UI transitions.
8. Constraints: preserve LAN/game rules and existing assets; native keyboard controls, visible focus, responsive menus, no new remote resources.

## Information map

Masthead → game identity and connection architecture → deployment rail → operator/network desk + match terminal → field manual.

Representative flows: connect/practice → discover/host → select operative → deploy; roster → inspect/equip → return to selection; match → settings/scores → return/leave.

The charcoal/oxblood housing separates warm amber actions from cyan data. Ivory headings and restrained monospace labels establish hierarchy. The connection diagram describes actual architecture; its dashed folder paths are discovery, and its solid peer connection is gameplay. The battlefield tile is illustrative artwork, not a navigation map.

## Typography and tokens

All fonts are system fallbacks, with no downloads. Bahnschrift/Arial Narrow serves headings and numeric clusters; Segoe UI serves controls and body text; Consolas serves compact measurements and identifiers.

| Specimen | Role | Example |
| --- | --- | --- |
| Display | Main identity | LAN_FPS |
| Heading | Screen/section | The operative roster. |
| Metric | Combat signal | 100 HP |
| Body | Operator action | Choose shared folder |
| Hint | Supporting explanation | Connect a shared folder to discover rooms. |
| Warning | Recovery/status | The host closed the room. |
| Terminal label | Provenance and connection | DIRECTORY / LOCAL PRACTICE |

Tokens live in `source/style.css`: background, panel, panel elevation, input well, oxblood housing, structural and quiet lines, ivory text, muted text, amber action, cyan data, danger, success, focus, and HUD opacity.

Measured sRGB contrast using WCAG relative luminance:

| Pair | Ratio |
| --- | ---: |
| Ivory text / panel | 14.23:1 |
| Muted text / oxblood | 6.41:1 |
| Cyan data / input well | 11.06:1 |
| Dark text / amber action | 11.54:1 |
| Danger text / alert surface | 6.03:1 |
| Control border / panel | 3.37:1 |

These are selected token measurements, not a claim that every pixel or accessibility criterion has been automatically audited.

## Functional component contract

| Component | Source | State mapping | Keyboard | Empty/error | Verification |
| --- | --- | --- | --- | --- | --- |
| Deployment rail | Folder connection result | Connect current → complete; deploy current | Native anchors, Tab/Enter | Explains folder selection | Practice connection changes rail |
| Network uplink | Existing folder handle / storage fallback | Unconnected, shared folder, local practice | Native buttons | Existing live message region | Local practice exercised |
| Room browser | `Lobby.rooms()` | Count, room metadata, full/available | Join button via Tab/Enter | Guided empty state; error prefix and text | Real second-tab listing and join |
| Match briefing | Existing map/mode selects | Five map descriptions; 10/25 target | Native selects and input | Hosting disabled before connection | Arena FFA and Aftermath TDM exercised |
| Operative archive | Existing characters and hero dossiers | Selected versus equipped | Native buttons; arrows; canvas orbit/zoom; Escape | Fallback profiles retained | Choose, equip, nested return |
| Settings | Existing settings/store | Pressed states, slider readouts, key recording | Native sliders, checkboxes, buttons | Binding capture can be cancelled | Rebind to J and reset to W/Up verified |
| Modal shell | Three existing overlays | Topmost owns focus; background inert | Tab wraps, Escape restores focus | Scrolls when taller than viewport | Settings wrap, roster canvas Escape, nested roster |
| Health/ammunition | Predicted player and weapon rules | Health bar, low-health border, reload color/text | Existing combat controls | Death/respawn status retained | Live match HUD and existing simulation tests |
| Weapons | Existing weapon inventory | Pressed active slot, real magazine counts | Native buttons + existing number keys | Knife infinity retained | Live inventory and switch unit tests |
| Scores | Authoritative snapshot | FFA or team table; local row | Existing Tab plus Scores button | Waiting/round-end states retained | Real host, guest, bot scoreboard |
| Disconnect alert | Existing session exit reason | Danger surface + explicit message | Returns to lobby | Host-closed recovery message | Real host departure observed |

Dossier ratings remain existing character lore and are now explicitly labeled as such; character choice does not change the shared combat rules.

## Verification and visual iterations

Build: `npm run build` succeeded. Existing suite: `npm test`, all 35 tests passed. `git diff --check` passed. A regression assertion now verifies that discovery preserves TDM metadata; previously the list labeled team rooms FFA.

Browser verification used the read-only loopback preview (`node source/tools/preview.mjs`). Direct file navigation was blocked by the browser tool's URL policy; a scoped HTTP preview served only the compiled game. The standalone distribution format and offline content policy remain intact.

Two actual browser tabs connected over WebRTC: the host reported one direct link, the guest reported a direct connection, and both displayed team scores. The host spawned a bot; the scoreboard showed the host, guest, and bot. Closing the host returned the guest to the lobby with “The host closed the room.”

Pixel review at 1440×1080, 768×1024, and 360×800 covered the lobby and combat HUD. The narrow roster was also inspected. Lobby document width did not exceed viewport width at those targets. Settings keyboard focus, modal focus wrapping/return, roster selection/equipment, nested deployment/roster selection, range keyboard input, binding reassignment/reset, and the reduced-motion checkbox were exercised.

First review findings and corrections:

- P1, lobby lower-left: the connection action fell too far below the desktop fold. Reduced masthead/hero and profile spacing so connection is visible at the 1080px target height.
- P0, HUD centre: native button foreground inherited dark action text over a dark resume surface. Set the foreground explicitly to the ivory token and recaptured it.
- P1, roster centre: preview camera cropped the stage and opened on the model's back. Adjusted preview-only framing and orientation; rotation starts paused.
- P1, roster keyboard: canvas focus prevented Escape dismissal. Allowed Escape through and verified focus returned to the launcher.
- P2, tablet HUD: the weapon name wrapped at its hyphen and the connection line compressed. Kept weapon names together and gave the tablet link readout a full line.

The second screenshot pass verified the revised hierarchy, readable resume action, complete operative, focus ring, and responsive controls. Subsequent checks caught the TDM room-label defect and confirmed its regression test.

Subjective rubric review: **91/100**, with no known critical failures in tested states. Hierarchy 23/25; tokens/grammar 19/20; original direction 13/15; interaction/feedback 14/15; accessibility/motion 13/15; robustness/regression 9/10. This is a design review aid, not certification.

## Evidence

Screenshots in `design/screenshots/`:

- `lobby-1440.jpg`, `lobby-768.jpg`, `lobby-360.jpg`: unconnected and guided empty state.
- `rooms-1440.jpg`: populated discovery list (captured before the TDM metadata correction).
- `roster-1440.jpg`: equipped operative and 3D inspection.
- `deployment-1440.jpg`: pre-match operative selection after nested roster equipment.
- `settings-1440.jpg`: settings and visible keyboard focus.
- `bindings-1440.jpg`: dense key binding editor.
- `hud-1440.jpg`, `hud-768.jpg`, `hud-360.jpg`: live HUD.
- `scoreboard-1440.jpg`: team scoreboard with a bot.
- `disconnected-1440.jpg`: actual host-disconnect error.

Screenshots show real running UI. Full-page images have longer heights than the listed browser viewport. Browser compositor updates can lag a resize; the narrow HUD was recaptured after geometry settled.

## Scope and remaining verification

UI implementation: `source/index.html`, `source/style.css`, `source/src/ui.js`, UI wiring in `source/src/main.js`, HUD presentation in `source/src/hud.js`, preview-only portions of `source/src/render.js`, and rebuilt `LAN_FPS.html`. The room mode metadata correction is in `source/src/net.js` with its assertion in `source/test/run.mjs`. Pre-existing uncommitted hero-roster work was preserved.

AGY is working on rig fixes in parallel. After the user identified that work, no further rig, animation, asset, or renderer edits were made. The UI bundle was built before that final coordination message; AGY's subsequent rig changes may require their normal rebuild.

Physical multi-PC SMB permissions/firewall behavior, native OS 125%/150% scaling, a full screen-reader audit, and automatic system-preference switching were not exercised. Reduced motion was tested through the in-game preference; system preference support is implemented through CSS and `matchMedia`. Transient connecting text was observed, but no timed loading screenshot was retained. Browser testing did not replace a prolonged hardware FPS/performance playtest.
