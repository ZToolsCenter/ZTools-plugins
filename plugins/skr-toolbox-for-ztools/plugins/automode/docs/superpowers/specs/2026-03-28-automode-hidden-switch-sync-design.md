# AutoMode Hidden Switch And Theme Sync Design

## Goal

Implement three coordinated behavior changes:

1. Scheduled and immediate theme switching must avoid flashing a visible terminal window.
2. The plugin window must track system light/dark changes while it remains open.
3. Time inputs in schedule mode must become read-only while schedule mode is enabled.

## Current Context

- `preload.js` generates `.ps1` and `.vbs` switch scripts, but scheduled tasks and immediate switching still execute PowerShell directly.
- `lib/utils.js` generates scheduled-task XML used by both fixed-time and sunrise/sunset scheduling.
- `index.html` applies the plugin theme only during initialization and manual theme switch, so the UI can drift after external system theme changes.
- Schedule input editability is not derived from saved or current scheduler state.

## Chosen Approach

Use the existing `.vbs` wrappers as the stable hidden execution boundary for all theme-switch actions. Keep the sunrise/sunset updater on PowerShell because it is not user-triggered frequently and already runs hidden, but add a VBS wrapper for the two theme-switch scripts. For plugin theme sync, use browser-level `matchMedia('(prefers-color-scheme: dark)')` change events as the primary signal and a lightweight polling fallback that re-reads `window.themeAPI.getCurrentTheme()` to catch cases where the browser event is missed. For schedule input locking, centralize the UI state in a dedicated helper that toggles the four number inputs whenever the saved config, mode toggle, or active mode changes.

## File Responsibilities

- `lib/utils.js`
  Generate scheduled-task XML that now launches `wscript.exe` with the packaged `.vbs` path.
- `test/utils.test.js`
  Prove XML now targets `wscript.exe` and `switch-*.vbs`.
- `test/schedule-ui.test.js`
  Cover the pure state helper that decides whether schedule inputs should be disabled.
- `preload.js`
  Route immediate switching through `.vbs` wrappers and keep script generation aligned with the XML contract.
- `index.html`
  Add theme listeners/fallback refresh and apply schedule input locking consistently.

## Error Handling

- If `.vbs` launch fails, surface the existing error path from `switchImmediate()` and task creation.
- Theme refresh must fail soft: keep the current UI theme if either `themeAPI.getCurrentTheme()` or browser theme detection throws.
- Schedule input locking must be purely presentational and must not block scheduler disable operations.

## Testing

- Add test-first coverage for XML command generation and schedule-lock state derivation.
- Re-run the existing Node test suite after implementation.
- Manual verification on Windows:
  - Trigger manual dark/light switch and confirm no terminal flashes.
  - Leave the plugin open, toggle Windows theme externally, and confirm the plugin theme updates.
  - Enable schedule mode and confirm the four time inputs are disabled until schedule mode is turned off.
