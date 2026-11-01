import { computed, ref } from "vue";
import type { PasteStackAction } from "@pasteboard-pro/core";
import { markWhatsNewSeen } from "./whats-new";
import { createApplicationWindowContext } from "./application-window-context";
import { useApplicationHistory } from "./use-application-history";
import { useApplicationSettings } from "./use-application-settings";
import { useApplicationActions } from "./use-application-actions";
import { createApplicationKeyboardHandler } from "./use-application-keyboard";
import { useApplicationLifecycle } from "./use-application-lifecycle";

export function usePasteboardApplication() {
  const context = createApplicationWindowContext();
  const status = ref("本地历史已就绪");
  const paused = ref(false);
  const startupError = ref<string>();
  // The application needs only Shelf's exposed focus handle, not its SFC type.
  const shelfView = ref<{ focusItem(itemId: string): Promise<void> | void }>();
  const history = useApplicationHistory(context, status,
    (): Promise<void> => actions.updatePasteStack({ type: "clear" }));
  const settings = useApplicationSettings(context, history.state, status, paused,
    (action: PasteStackAction): Promise<void> => actions.updatePasteStack(action));
  const actions = useApplicationActions(context, history, settings, status);
  const canCaptureScreen = computed(() => context.supportsScreenCapture && !paused.value);

  function focusListCard(itemId: string | undefined): void {
    if (itemId === undefined) return;
    void shelfView.value?.focusItem(itemId);
  }
  function openWhatsNew(): void { window.pasteboardPro?.openPanel("whatsnew"); }
  function closeWindow(): void { window.close(); }
  function closeWhatsNew(): void { markWhatsNewSeen(); closeWindow(); }
  async function togglePause(): Promise<void> {
    const next = !paused.value;
    const saved = await window.pasteboardPro?.setCapturePause({ paused: next });
    paused.value = saved?.pause.paused ?? next;
    status.value = paused.value ? "剪贴板捕获已暂停" : "剪贴板捕获已继续";
  }
  async function onHistoryCleared(): Promise<void> {
    history.state.setPasteStack({
      itemIds: [],
      direction: "forward",
    });
    await history.loadHistory();
    status.value = "剪贴板历史已清空";
  }
  const onKeydown = createApplicationKeyboardHandler(
    context, history, settings, actions, togglePause, focusListCard,
  );
  useApplicationLifecycle(context, history, settings, actions,
    { status, paused, startupError, onKeydown, openWhatsNew });
  return {
    ...history, ...settings, ...actions,
    panelMode: context.panelMode, isShelfMode: context.isShelfMode,
    hostCompatibility: context.hostCompatibility, requiresHostUpgrade: context.requiresHostUpgrade,
    shortcutPlatform: context.shortcutPlatform, pointerReorderActive: context.pointerReorderActive,
    status, paused, startupError, shelfView, canCaptureScreen, togglePause,
    openWhatsNew, closeWhatsNew, closeWindow, onHistoryCleared,
  };
}
