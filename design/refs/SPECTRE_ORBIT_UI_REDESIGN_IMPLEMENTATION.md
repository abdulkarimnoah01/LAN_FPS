# SPECTRE ORBIT — Netrunner Hub UI/UX Overhaul

## Implementation brief for the coding agent

**Role:** Senior game-interface engineer, information architect, and UI art director. Overhaul the *existing* Spectre Orbit browser FPS UI (main menu, multiplayer flows, and in-game HUD) into an original, restrained cyberpunk/netrunner terminal. Execute the integration against the real game repository, not against a disconnected showcase.

**Reference deliverable:** `SPECTRE_ORBIT_Netrunner_Hub.html` is a standalone **interactive design prototype**, not the game itself. Open it in a browser to inspect the layout, styles, screens, side panels, shortcuts, and HUD concept. The HTML intentionally does not call matchmaking or run Babylon.js gameplay; wire the finished design to existing application state and actions. Use supplied screenshots as the original UI and style references.

**Project baseline supplied by context:** Spectre Orbit v1.4.7, Babylon 9/WebGPU/WebGL browser FPS, WebSocket matchmaking and WebRTC peer traffic. Repository: `https://github.com/abdulkarimnoah01/LAN_FPS`; local source *if present*: `X:\Projects\game\LAN_FPS`. There is a separate offline single-file build and a parallel Unreal port. Inspect the repository and verify current branches/version before changing anything; do **not** assume that v1.4.7 is still the latest baseline. Work on an isolated branch/worktree and preserve ongoing work. Do not touch the Unreal port. **Never shut down or restart the host machine.**

## North star

> **One terminal. Every route into the fight.**

The existing page exposes session flow, callsign, operative choice, mouse sensitivity, audio settings, networking, roomboard, hosting configuration, map selection, match rules, and help **all at once**. Make the landing page a *task launcher* rather than a giant configuration form. All primary paths must be discoverable immediately, without hunting through panels. Configuration should only appear when relevant.

### Navigation and hierarchy

- Persistent compact left rail on desktop: **Deploy / Operative / Loadout / Battlefields / Settings**. On small viewports, switch to a fixed bottom navigation.
- **Deploy (landing screen)**
  - Dominant **Quick Match** button (one-click search, with clear cancellable search/join states).
  - Secondary **Host Match** and **Join with Code** cards, both open compact right-hand drawers.
  - **Public Rooms** area shows a truthful loading state, populated results, empty state, refresh, and recoverable error.
  - **Practice Offline** gets a secondary one-click entry; no online dependency.
  - Right rail only: connection summary, active operative, small featured map preview. Nothing more.
- **Operative:** current character, callsign, role/specialization, real roster picker, persist selection.
- **Loadout:** existing weapon slots, selected gear, and relevant keybinds; do not invent an inventory system.
- **Battlefields:** actual map catalog with current valid thumbnails, descriptions, and host-on-map shortcut.
- **Settings:** sensitivity, audio, controls and any existing graphics/render options. Save immediately or provide a reliable Apply/Cancel state.
- **In-game HUD:** isolated from the main menu visually. HUD must be readable at 1080p and at common scaled sizes while leaving the center free for aiming.

### Two-click rule

From any main-menu screen, Quick Match, Host Match, Join by Code, and Offline Practice should be reachable in **at most two interactions**. Keep entry paths visible from Deploy, and consider a compact persistent Deploy shortcut elsewhere. Never force users to edit a callsign or enter an unrelated “identity step” before connecting if a valid callsign is already saved.

## Art direction — original netrunner OS, not an Arasaka copy

- Visual tone: **restrained cyberpunk-2077-adjacent Netrunner command hub**; industrial UI precision with calm, modern spacing. Inspiration from the references' information hierarchy, monospace telemetry, framing, and tactically placed accent color—not copied branding, logo, screens, type treatments, or proprietary textures.
- Palette: background `#060A0E`; surface `#0D151B`; raised surface `#111C23`; hairline border `#23323B`; primary text `#E9F4F6`; muted text `#A0B5BD`; dim metadata `#6B858E`; primary signal **cyan** `#66E9E3`; electric yellow/lime `#E2F475` reserved for urgent play emphasis/special states, not used in every border. Error is reserved and unambiguous; never use red as a blanket theme.
- Typography: bold contemporary sans-serif for section titles and action labels; neutral readable sans-serif for content; compact monospace for codes, map IDs, telemetry, and keyboard hints. Use locally installed/system fonts where possible, do not add a large font dependency.
- Identity: an **original ringed-planet emblem** drawn as clean geometry / SVG and a few sparse ASCII-style register marks. No stock sci-fi noise, grunge overlays, excessive glow, heavy scanlines, tiny illegible text, gratuitous tick marks, neon box around every object, or pseudo-technical clutter.
- Layout: 228px desktop navigation, generous content gutters, one dominant action card, two secondary action cards, low-contrast supporting panels. Use consistent 4/8/12/16/24/32 spacing rhythm and hairline separators.
- Emphasis: **only one accent-dominant CTA per region**. Use cyan for ready/action/selection and subtle neutrals for the rest. No animated distractions while choosing matchmaking options.
- Components: clear hit targets; obvious pressed/hover/focus/disabled/loading/connected/offline/error states; concise action labels; meaningful icons; keyboard navigable. Motion should be restrained and respect `prefers-reduced-motion`.

## Original → new information architecture

| Existing content | New location | Notes |
| --- | --- | --- |
| Yellow main menu header / title + ASCII scene | Brand + calm Deploy hero | Much less visual mass; original custom ringed planet, no other company's insignia |
| Operator profile + callsign + sensitivity + volume | Operative for callsign; Settings for input/audio | Do not mix unrelated configuration into launch flow |
| Network uplink / Quick Match / Bots / Join Code | Deploy quick actions | All visible above the fold at desktop |
| Match terminal / roomboard | Deploy preview + Room Browser drawer | Always display real room states, never invent room counts |
| Host form: name, battlefield, FFA, player count, privacy, kills | Host Match drawer | Defaults drawn from current game settings; validations and errors visible |
| Active operative, weapon summary, map preview | Compact right rail | Read-only shortcuts; editing through their dedicated screens |
| Controls manual | Settings and context-specific help | No full width instruction bar always visible |
| Gameplay status / scores / ammo | Minimal in-game HUD | Scoreboard on Tab, pause on Escape; maintain existing input bindings |

## Match state and functional contracts

**Quick Match:** `idle → searching → match_found → joining → lobby/game` plus `cancel`, `timeout`, `error`, and `offline`. Never indicate “connected” until the existing real network layer reports it. Disable duplicate requests. Show nonblocking feedback with a clear cancel action.

**Host:** right drawer collects room name, actual map ID, existing valid mode/FFA choices, max players allowed by engine (2–12 if supported; screenshot currently shows 2–6), privacy, and frag limit. Validate inputs, submit to current create-match function, show working lobby, copyable invite code, roster, launch/leave controls, and failure states. Populate settings from real game state.

**Join by Code:** direct code entry and submit by Enter or CTA; trim/normalize according to actual protocol; validate gracefully; show connecting and errors for invalid code, full match, disconnected host, incompatible version, and network failure. Do not silently join a random lobby.

**Room Browser:** load real data from existing roomboard; support explicit Refresh, loading/empty/results/error states; room list has grounded room name, map, mode, player count/capacity, and valid join actions. Do not hardcode or fake server availability.

**Offline:** Practice With Bots must use the existing fully offline path without WebSocket/WebRTC. Do not have offline practice blocked by online server presence.

**Operative / loadout / settings:** bind to the actual model and persistence layer; respect unlocked/available contents and existing IDs. Screen name changes should update HUD, room listings, scoreboard, and lobby where applicable. Do not hardcode Mina as the only operative in production; she is only the active character seen in the supplied screenshot.

## In-game HUD specification

- **Top left:** health and armor values with lightweight bars. Prefer numerals and accessible contrast; no massive stacked boxes.
- **Top center:** match timer, current kills/frags, kills to win / team score based on actual game mode. Switch format by mode.
- **Top right:** restrained ping/network indicator and optional FPS diagnostic, with a toggle for telemetry. No fabricated readings.
- **Center:** clean reticle; no decorative overlay near the aim zone.
- **Bottom left:** callsign / active operative (optional compact mode). Show critical status indicators only.
- **Bottom right:** current magazine/reserve ammo, active weapon, optional equipment count. Always wire to gameplay state.
- **Tab:** compact scoreboard populated with actual players, kills, deaths, ping. Hold-to-show if current binding expects it; do not break native keyboard behavior.
- **Escape:** pause menu with Resume, Settings, Controls (if present), and Leave Match. Returning from Settings must restore the paused session rather than accidentally opening the main menu or leaving a match.
- Test on 16:9, ultrawide, and 9:16; do not hide actionable HUD elements off-screen. Insets must account for browser safe areas and UI scale. Keep UI independent from game rendering framerate if feasible.

## Integration requirements

1. Inspect the game's HTML/CSS/JS, Babylon UI layer, matchmaker adapters, WebRTC signaling, local-storage flow, events, assets and public APIs. Document the actual integration points before replacing code.
2. Introduce a small shared `UIState`/router and reusable visual primitives, or adapt existing architecture if cleaner. Do **not** duplicate gameplay/network logic; each button calls the original controller/method.
3. Keep two output targets functional: production browser online multiplayer and the separate **offline single-file** distribution. Do not add unbundled assets, external CDNs, or hard prerequisites to the single-file build.
4. Responsive and accessible: keyboard focus, clear labels, readable text, contrast, screen-reader labels for major controls, mobile controls, reduced motion, safe areas.
5. Cleanly handle server disconnected/reconnecting, no public rooms, wrong join code, inability to host, WebGPU fallback to WebGL, and storage unavailability.
6. Make actual room data, counts, pings and network health **data-driven**. No fake connected metrics or fictional rooms.
7. Keep all existing game mechanics, weapon keys `1–6`, `WASD`, `G`, `R`, `Tab`, `Esc`, and multiplayer compatibility unless the codebase says otherwise. Preserve render-loop performance and input capture/pointer-lock behavior.
8. Use original assets/approved images only; the design prototype embeds crops from the user-supplied screenshot for the active operative and Foundry preview.
9. Keep a changelog and visual QA screenshots with before/after comparisons. Build and test both online and offline artifacts. Leave Unreal project untouched.

## Acceptance / QA checklist

- [ ] User can enter Quick Match, Host, Join, Room Browser, or Offline Practice from Deploy without scrolling or hunting.
- [ ] All visible interactions are functional, not cosmetic: no “fake” Join/Host/Deploy or settings-save success.
- [ ] Real matchmaking and peer connection verified with two browser clients; host-created rooms appear correctly.
- [ ] Empty-room state, server offline, invalid invite, connection loss, and retries tested.
- [ ] Each profile selection, callsign, loadout and setting persists as expected.
- [ ] Offline one-file build works without localhost server or network.
- [ ] HUD is legible in gameplay; no central-screen clutter and no inputs swallowed during combat.
- [ ] Scoreboard, pause, leave, resume, pointer lock, bots, audio, and weapons verified.
- [ ] Browser width checks at 390, 768, 1280, 1440, 1920 and ultrawide; no overflow.
- [ ] No regressions in online Babylon/WebGPU/WebGL performance or the original gameplay functions.
- [ ] Final result looks intentionally designed, not a text-heavy terminal skin or chaotic full-screen dashboard.

## Deliverables

- Integrated UI changes in the real repo on an isolated working branch.
- Updated online and offline build outputs; version/update notes.
- Screenshots: Deploy, Host drawer, Room Browser results/empty/error, Join, Operative, Loadout, Settings, actual gameplay HUD, scoreboard, pause, and mobile.
- Short implementation handoff: files changed, integration decisions, tested flows, known limitations, and any remaining tasks.

**Design veto:** if a UI element doesn't assist a current player action, immediate comprehension, or critical combat status, remove it from the default view or make it contextual. It is a *netrunner hub*, not a telemetry wall.
