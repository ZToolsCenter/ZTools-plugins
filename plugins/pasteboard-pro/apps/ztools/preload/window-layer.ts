type WindowLayerHandle = Readonly<{
  isDestroyed(): boolean;
  setAlwaysOnTop?(flag: boolean, level?: "screen-saver"): void;
  moveTop?(): void;
}>;

/**
 * Request Electron's highest normal application layer while preserving the
 * constructor's alwaysOnTop fallback for hosts with older window APIs.
 */
export function applyWindowTopLevel(handle: WindowLayerHandle): void {
  if (handle.isDestroyed() || handle.setAlwaysOnTop === undefined) return;

  try {
    handle.setAlwaysOnTop(true, "screen-saver");
  } catch {
    try {
      handle.setAlwaysOnTop(true);
    } catch {
      // BrowserWindowOptions.alwaysOnTop remains the compatibility fallback.
    }
  }
}

/** Raise only when a window is intentionally revealed, so panels can take over. */
export function moveWindowToTop(handle: WindowLayerHandle): void {
  if (handle.isDestroyed() || handle.moveTop === undefined) return;

  try {
    handle.moveTop();
  } catch {
    // Older hosts may expose moveTop without supporting it for this window.
  }
}
