# AutoMode Taskbar Theme Sync Design

## Goal

Make Windows taskbar and shell chrome follow the same light/dark change that AutoMode already applies to apps.

## Root Cause

The current switch scripts in `preload.js` write both `AppsUseLightTheme` and `SystemUsesLightTheme`, so the registry values are not the problem. The failure is the follow-up shell refresh call: the generated PowerShell declares `DllImport` methods named `S` and `FW` without `EntryPoint`, so Windows tries to resolve functions literally named `S` and `FW` in `user32.dll`. That fails at runtime, which means Explorer never receives a valid `WM_SETTINGCHANGE` broadcast for `ImmersiveColorSet`.

## Chosen Approach

Move theme-switch script generation into a pure helper in `lib/utils.js` and make it produce a valid User32 interop block. Each switch script will:

1. Write `AppsUseLightTheme` and `SystemUsesLightTheme`.
2. Declare `SendMessageTimeoutW` and `FindWindowW` with explicit `EntryPoint`.
3. Broadcast `WM_SETTINGCHANGE` with `ImmersiveColorSet` to `HWND_BROADCAST`.
4. Send the same message directly to `Shell_TrayWnd` as a taskbar-specific nudge.

This keeps the current VBS-hidden execution path intact and changes only the broken refresh mechanism.

## File Responsibilities

- `lib/utils.js`
  Own the pure script generator for dark/light theme switch scripts.
- `preload.js`
  Consume the helper when writing `switch-dark.ps1` and `switch-light.ps1`.
- `test/utils.test.js`
  Prove the generated script contains the correct registry writes and valid User32 broadcast calls.

## Testing

- Add failing tests first for the generated switch script content.
- Re-run the full Node test suite after the fix.
- Rebuild `AutoMode.zpx` and confirm packaging still succeeds.
- Manual Windows verification:
  - Trigger dark mode from the plugin.
  - Confirm the taskbar switches without restarting Explorer or signing out.
