import { ref } from "vue";
import type { DockEdge } from "@pasteboard-pro/design-tokens";
import { resolveShortcutPlatform } from "./platform-shortcuts";
import { createShelfDragLifecycle } from "./shelf-drag-lifecycle";

export function createApplicationWindowContext() {
  const params = new URLSearchParams(window.location.search);
  const panel = params.get("panel");
  const panelMode =
    panel === "privacy" ||
      panel === "sync" ||
      panel === "preview" ||
      panel === "editor" ||
      panel === "whatsnew"
      ? panel
      : undefined;
  const isShelfMode = params.get("shelf") === "1";
  const hostCompatibility = window.pasteboardPro?.getHostCompatibility();
  const requiresHostUpgrade = hostCompatibility?.supported === false;
  const platformCapabilities = window.pasteboardPro?.getPlatformCapabilities();
  const shortcutPlatform = resolveShortcutPlatform(
    platformCapabilities?.platform,
  );
  const supportsScreenCapture =
    platformCapabilities?.supportsScreenCapture === true;
  const dockValue = params.get("dock");
  const edge: DockEdge =
    dockValue === "top" ||
      dockValue === "bottom" ||
      dockValue === "left" ||
      dockValue === "right"
      ? dockValue
      : "floating";


  const pointerReorderActive = ref(false);
  const shelfDrag = createShelfDragLifecycle(
    () => { if (isShelfMode) window.close(); },
    () => document.hasFocus(),
  );
  const interaction = { shelfHasFocused: false, nativeDialogOpen: false };
  return {
    params, panelMode, isShelfMode, hostCompatibility, requiresHostUpgrade,
    platformCapabilities, shortcutPlatform, supportsScreenCapture, edge,
    pointerReorderActive, shelfDrag, interaction,
  };
}
export type ApplicationWindowContext = ReturnType<typeof createApplicationWindowContext>;
