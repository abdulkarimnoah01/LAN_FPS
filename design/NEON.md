# FIELDLINK — neon palette correction

Published update: **v1.3.1**. The updater version, source fallbacks and rebuilt standalone file use the same release number. The screenshots below were captured during v1.3.0 verification; the release keeps that UI and includes the latest upstream character fixes.

The current direction replaces the green PHOSPHOR palette from `TERMINAL.md` with a Cyberpunk 2077–inspired NEON palette. The terminal layout and optional static CRT treatment remain.

- Near-black and wine-black surfaces; cool white body text.
- Electric yellow `#fcee0a` for the identity, actions and selection.
- Cyan `#6ce9f3` for readouts, connection data and health instruments.
- Rose-red `#ff7188` for errors, against dark wine surfaces.
- Cyan CRT scanlines and gentle glow, confined to existing UI surfaces. The toggle and saved preference are preserved; the world renderer is unfiltered.

The v1.3.0 roster update was fast-forwarded into the checkout while retaining local UI changes. The bundle includes Abdulkarim, his blue outfit, ElDeep, Gemy, Hamdy, Hooda, Mina and Romero, plus the built-in fallback. No rig or renderer edits were made for this correction.

`npm run build` succeeds for v1.3.0. All 35 tests pass. `git diff --check` passes. The current browser preview was reloaded and inspected at 1440×1080 with CRT on and off. Its CRT toggle was restored to on for review. Body and lobby filters were verified as `none`.

Measured token contrasts:

| Pair | Ratio |
| --- | ---: |
| Main text / panel | 15.58:1 |
| Muted text / panel | 9.42:1 |
| Cyan / input well | 13.42:1 |
| Yellow / action text | 15.75:1 |
| Control border / panel | 3.66:1 |
| Error / alert surface | 5.92:1 |

Evidence: `screenshots/neon/lobby-crt-1440.jpg` and `lobby-clean-1440.jpg`. These are actual browser captures. The previous terminal interaction/responsive review remains documented separately; this change alters palette tokens and the main title color, without changing geometry or controls. No new performance or accessibility certification is claimed.
