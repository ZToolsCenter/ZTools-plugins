import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";
import { defaultWindowPreferences } from "../preload/window-preferences";
import { markWindowReady } from "../window-ready";
import { shouldShowWhatsNew } from "./whats-new";
import type { ApplicationWindowContext } from "./application-window-context";
import type { ApplicationHistory } from "./use-application-history";
import type { ApplicationSettings } from "./use-application-settings";
import type { ApplicationActions } from "./use-application-actions";

export function useApplicationLifecycle(
  context: ApplicationWindowContext,
  history: ApplicationHistory,
  settings: ApplicationSettings,
  actions: ApplicationActions,
  options: {
    status: Ref<string>;
    paused: Ref<boolean>;
    startupError: Ref<string | undefined>;
    onKeydown: (event: KeyboardEvent) => Promise<void>;
    openWhatsNew: () => void;
  },
) {
  const { isShelfMode, panelMode, params, requiresHostUpgrade, pointerReorderActive, shelfDrag } = context;
  const { state, visibleItems, previewItemId, listOrders, loadDevelopmentFixtures, loadHistory, loadPinboards, onHistoryChanged } = history;
  const { windowPreferences, colorScheme, prefersDark, settingsSaving, loadSettings } = settings;
  const { queueSaving, editor, onPasteStackChanged } = actions;
  const { status, paused, startupError, onKeydown, openWhatsNew } = options;
  function onMirrored(event: Event): void {
    const detail = (event as CustomEvent<{ imported: number }>).detail;
    status.value = detail.imported > 0 ? `已导入 ${detail.imported} 条记录` : "历史已同步";
  }

  function onWindowFocus(): void {
    if (isShelfMode) {
      context.interaction.shelfHasFocused = true;
      context.interaction.nativeDialogOpen = false;
      if (shouldShowWhatsNew()) {
        openWhatsNew();
      }
    }
  }

  function onWindowBlur(): void {
    if (pointerReorderActive.value) return;
    if (isShelfMode && context.interaction.shelfHasFocused && !context.interaction.nativeDialogOpen && !queueSaving.value && !settingsSaving.value && !shelfDrag.deferBlur()) window.close();
  }

  function onColorSchemeChange(event: MediaQueryListEvent): void {
    prefersDark.value = event.matches;
  }

  async function onWindowPreferencesChanged(): Promise<void> {
    const preferences = await window.pasteboardPro?.getWindowPreferences();
    if (preferences !== undefined) windowPreferences.value = preferences;
  }

  async function initializeWindow(): Promise<void> {
    if (requiresHostUpgrade) return;
    if (!import.meta.env.DEV && window.pasteboardPro === undefined) {
      throw new Error("Paste preload bridge is unavailable");
    }
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("dragstart", shelfDrag.start);
    window.addEventListener("dragend", shelfDrag.end);
    window.addEventListener("pasteboard-pro:paste-stack-changed", onPasteStackChanged);
    window.addEventListener(
      "pasteboard-pro:window-preferences-changed",
      onWindowPreferencesChanged,
    );
    colorScheme.addEventListener("change", onColorSchemeChange);
    await loadDevelopmentFixtures();
    const preferences = await window.pasteboardPro?.getWindowPreferences();
    windowPreferences.value =
      preferences ?? structuredClone(defaultWindowPreferences);
    if (isShelfMode) {
      context.interaction.shelfHasFocused = document.hasFocus();
      window.addEventListener("focus", onWindowFocus);
      window.addEventListener("blur", onWindowBlur);
    }
    if (panelMode === "sync" || panelMode === "privacy") {
      const requestedTab = params.get("tab");
      await loadSettings(
        panelMode === "sync"
          ? "sync"
          : requestedTab === "appearance" || requestedTab === "privacy"
            ? requestedTab
            : "general",
      );
      return;
    }
    if (panelMode === "preview") {
      previewItemId.value = params.get("itemId") ?? undefined;
      await loadHistory();
      return;
    }
    if (panelMode === "editor") {
      const mode = params.get("mode");
      const itemId = params.get("itemId") ?? undefined;
      if (mode === "create") {
        editor.value = {
          mode,
          title: "",
          text: "",
          ...(params.get("pinboardId") === null
            ? {}
            : { pinboardId: params.get("pinboardId")! }),
        };
        return;
      }
      if ((mode === "edit" || mode === "rename") && itemId !== undefined) {
        await loadHistory();
        const item = visibleItems.value.find((candidate) => candidate.id === itemId);
        if (item !== undefined) {
          editor.value = {
            mode,
            itemId,
            title: item.title ?? "",
            text: item.payload.text ?? item.ocrText ?? "",
          };
        }
      }
      return;
    }
    if (!isShelfMode) return;
    window.addEventListener("pasteboard-pro:history-mirrored", onMirrored);
    window.addEventListener("pasteboard-pro:history-changed", onHistoryChanged);
    const [settings, savedListOrders] = await Promise.all([
      window.pasteboardPro?.getPrivacySettings(),
      window.pasteboardPro?.getListOrders(),
    ]);
    paused.value = settings?.pause.paused ?? false;
    listOrders.value = savedListOrders ?? {};
    const pasteStack = await window.pasteboardPro?.getPasteStack();
    const platformCapabilities = window.pasteboardPro?.getPlatformCapabilities();
    if (
      pasteStack !== undefined &&
      (platformCapabilities?.supportsGlobalPasteQueue ?? true)
    ) {
      state.setPasteStack(pasteStack);
    } else if (pasteStack !== undefined && pasteStack.itemIds.length > 0) {
      const cleared = { direction: pasteStack.direction, itemIds: [] as string[] };
      state.setPasteStack(cleared, true);
      await window.pasteboardPro?.savePasteStack(cleared);
      status.value = "已清理仅支持 macOS 的旧粘贴队列";
    }
    await loadHistory();
    await loadPinboards();
    if (panelMode === undefined && shouldShowWhatsNew()) {
      openWhatsNew();
    }
  }

  onMounted(async () => {
    try {
      await initializeWindow();
    } catch (error) {
      console.error("Paste initial content failed to load", error);
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      startupError.value = `加载失败，请关闭后重新打开 Paste (${detail})`;
    } finally {
      // nextTick includes child updates from the initial history and theme. Unlike
      // requestAnimationFrame, it also runs while an Electron window is hidden.
      await nextTick();
      markWindowReady();
    }
  });

  onBeforeUnmount(() => {
    history.dispose();
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("dragstart", shelfDrag.start);
    window.removeEventListener("dragend", shelfDrag.end);
    window.removeEventListener("pasteboard-pro:paste-stack-changed", onPasteStackChanged);
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("pasteboard-pro:history-mirrored", onMirrored);
    window.removeEventListener("pasteboard-pro:history-changed", onHistoryChanged);
    window.removeEventListener(
      "pasteboard-pro:window-preferences-changed",
      onWindowPreferencesChanged,
    );
    colorScheme.removeEventListener("change", onColorSchemeChange);
  });

}
