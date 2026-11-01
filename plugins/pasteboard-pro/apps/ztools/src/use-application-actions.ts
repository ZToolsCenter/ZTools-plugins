import { ref, type Ref } from "vue";
import type { PasteStackAction, PasteStackState } from "@pasteboard-pro/core";
import type { PasteboardKeyboardEffect } from "./state";
import { createSelectionPasteController, type SelectionPasteNotice } from "./selection-paste-controller";
import { createPasteStackController } from "./paste-stack-controller";
import { isSmartPinboardId } from "./smart-pinboards";
import type { ApplicationWindowContext } from "./application-window-context";
import type { ApplicationHistory } from "./use-application-history";
import type { ApplicationSettings } from "./use-application-settings";

export function useApplicationActions(
  context: ApplicationWindowContext,
  history: ApplicationHistory,
  settings: ApplicationSettings,
  status: Ref<string>,
) {
  const { isShelfMode, panelMode, platformCapabilities } = context;
  const { state, pagedHistory, visibleItems, activePinboardId, loadHistory, previewItemId } = history;
  const { windowPreferences } = settings;
  const selectionPasteNotice = ref<SelectionPasteNotice>();
  const queueSaving = ref(false);
  const supportsGlobalQueue = platformCapabilities?.supportsGlobalPasteQueue !== false;
  const editor = ref<{
    mode: "create" | "edit" | "rename";
    itemId?: string;
    pinboardId?: string;
    title: string;
    text: string;
  }>();
  const editorSaving = ref(false);
  async function pasteItem(
    itemId: string,
    plainText = false,
    closeAfter = true,
  ): Promise<void> {
    const item = visibleItems.value.find((candidate) => candidate.id === itemId);
    if (item === undefined) return;
    try {
      const result = await window.pasteboardPro?.pasteItem(itemId, plainText);
      status.value =
        result?.status === "accessibility_required"
          ? "已复制；授权辅助功能后可直接粘贴"
          : `${plainText ? "已粘贴纯文本" : "已粘贴"}：${item.title ?? item.kind}`;
      if (closeAfter && (isShelfMode || panelMode === "preview")) window.close();
    } catch (error) {
      status.value = error instanceof Error ? error.message : "粘贴失败";
    }
  }

  const selectionPasteController = createSelectionPasteController({
    resolveItem: async (itemId) => pagedHistory
      ? window.pasteboardPro?.getHistoryItem?.(itemId)
      : visibleItems.value.find(item => item.id === itemId),
    pasteSingle: (itemId, plainText) => pasteItem(itemId, plainText),
    pasteContent: async (content) => window.pasteboardPro?.pasteContent(content),
    reportStatus: (message) => { status.value = message; },
    showNotice: (notice) => { selectionPasteNotice.value = notice; },
    closeShelf: () => { if (isShelfMode) window.close(); },
  });

  async function startSelectionQueue(itemIds = state.selectionPasteQueue()): Promise<void> {
    if (queueSaving.value) return;
    queueSaving.value = true;
    selectionPasteNotice.value = { kind: "queue", itemIds: [...itemIds] };
    try {
      if (await pasteStackController.startSelection(itemIds)) {
        selectionPasteNotice.value = undefined;
      } else {
        selectionPasteNotice.value = { kind: "queue", itemIds: [...itemIds], message: status.value };
      }
    } finally {
      queueSaving.value = false;
    }
  }

  async function copySelection(plainText = false): Promise<void> {
    const itemId = state.selection.focus ?? state.selection.selected[0];
    if (itemId === undefined) return;
    try {
      await window.pasteboardPro?.copyItem(itemId, plainText);
      status.value = plainText ? "已复制纯文本" : "已复制回系统剪贴板";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "复制失败";
    }
  }

  function createTextItem(): void {
    window.pasteboardPro?.openPanel("editor", {
      mode: "create",
      ...(activePinboardId.value === undefined || isSmartPinboardId(activePinboardId.value)
        ? {}
        : { pinboardId: activePinboardId.value }),
    });
  }

  function itemPanelParams(itemId: string): Record<string, string> {
    const item = visibleItems.value.find(candidate => candidate.id === itemId);
    return { itemId, ...(item === undefined ? {} : { fingerprint: item.contentFingerprint }) };
  }

  function editItem(itemId: string): void {
    window.pasteboardPro?.openPanel("editor", { mode: "edit", ...itemPanelParams(itemId) });
  }

  function renameItem(itemId: string): void {
    window.pasteboardPro?.openPanel("editor", { mode: "rename", ...itemPanelParams(itemId) });
  }

  function openPreview(itemId: string): void {
    window.pasteboardPro?.openPanel("preview", itemPanelParams(itemId));
  }

  async function saveEditor(value: { title: string; text: string }): Promise<void> {
    const current = editor.value;
    if (current === undefined) return;
    editorSaving.value = true;
    try {
      if (current.mode === "create") {
        await window.pasteboardPro?.createTextItem(
          value.text,
          value.title || undefined,
          current.pinboardId,
        );
      } else if (current.mode === "edit" && current.itemId !== undefined) {
        await window.pasteboardPro?.updateTextItem(
          current.itemId,
          value.text,
          value.title || undefined,
        );
      } else if (current.itemId !== undefined) {
        await window.pasteboardPro?.updateItemTitle(current.itemId, value.title);
      }
      editor.value = undefined;
      status.value = current.mode === "create" ? "已新建文本" : current.mode === "rename" ? "已重命名" : "已保存编辑";
      if (panelMode === "editor") window.close();
    } catch (error) {
      status.value = error instanceof Error ? error.message : "文本保存失败";
    } finally {
      editorSaving.value = false;
    }
  }

  const pasteStackController = createPasteStackController({
    state: {
      get pasteStack() {
        return state.pasteStack;
      },
      selectionPasteQueue: () => state.selectionPasteQueue(),
      dispatchPasteStack: (action) => state.dispatchPasteStack(action),
      setPasteStack: (pasteStack) => state.setPasteStack(pasteStack),
      clearSelection: () => state.clearSelection(),
    },
    saveStack: async (snapshot) => window.pasteboardPro?.savePasteStack(snapshot),
    reportStatus: (message) => {
      status.value = message;
    },
    closeShelf: () => {
      if (isShelfMode) window.close();
    },
    supportsGlobalQueue,
  });

  function updatePasteStack(action: PasteStackAction): Promise<void> {
    return pasteStackController.update(action);
  }

  function onPasteStackChanged(event: Event): void {
    const detail = (event as CustomEvent<PasteStackState>).detail;
    state.setPasteStack(detail, true);
  }

  async function handleEffect(effect: PasteboardKeyboardEffect | null): Promise<void> {
    if (effect === null) return;
    if (effect.type === "preview") {
      openPreview(effect.itemId);
      return;
    }
    if (effect.type === "quick-paste") {
      if (state.pasteStack.itemIds.length > 0) {
        await updatePasteStack({ type: "clear" });
      }
      await pasteItem(effect.itemId, effect.plainText);
      return;
    }
    if (
      effect.itemIds.length > 1 &&
      !effect.plainText &&
      windowPreferences.value.multiPasteMode === "queue"
    ) {
      await startSelectionQueue();
      return;
    }
    if (state.pasteStack.itemIds.length > 0) {
      await updatePasteStack({ type: "clear" });
    }
    await selectionPasteController.paste(effect.itemIds, effect.plainText);
  }

  async function captureScreen(): Promise<void> {
    status.value = "正在截取屏幕…";
    try {
      const result = await window.pasteboardPro?.captureScreenshot();
      if (result === undefined) throw new Error("当前 ZTools 版本不支持截图导入");
      const bounds = result.bounds;
      status.value = bounds === undefined
        ? "截图已写入剪贴板，正在载入时间线…"
        : `截图已写入剪贴板（${Math.round(bounds.width)} × ${Math.round(bounds.height)}），正在载入…`;

      window.setTimeout(() => {
        void loadHistory().then(() => {
          if (status.value.includes("正在")) {
            status.value = "截图已存入历史并写入剪贴板";
          }
        }).catch(() => undefined);
      }, 350);
      window.setTimeout(() => {
        void loadHistory().then(() => {
          if (status.value.includes("正在")) {
            status.value = "截图已存入历史并写入剪贴板";
          }
        }).catch(() => undefined);
      }, 850);
    } catch (error) {
      status.value = error instanceof Error ? error.message : "截图导入失败";
    }
  }

  async function recognizeItem(itemId: string): Promise<void> {
    status.value = "正在识别图片文字…";
    try {
      const text = await window.pasteboardPro?.recognizeItem(itemId);
      await loadHistory();
      status.value = text ? "OCR 识别完成" : "未识别到文字";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "OCR 识别失败";
    }
  }

  async function rotateImage(itemId: string, quarterTurns: -1 | 1): Promise<void> {
    status.value = quarterTurns < 0 ? "正在向左旋转…" : "正在向右旋转…";
    try {
      await window.pasteboardPro?.rotateImage(itemId, quarterTurns);
      await loadHistory();
      previewItemId.value = itemId;
      status.value = quarterTurns < 0 ? "已向左旋转" : "已向右旋转";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "图片旋转失败";
    }
  }

  async function quickLookItem(itemId: string): Promise<void> {
    try {
      await window.pasteboardPro?.quickLookItem(itemId);
      status.value = "已打开文件";
    } catch (error) {
      status.value = error instanceof Error ? error.message : "Quick Look 打开失败";
    }
  }


  return {
    selectionPasteNotice, queueSaving, supportsGlobalQueue, editor, editorSaving,
    pasteItem, startSelectionQueue, copySelection, createTextItem, editItem, renameItem,
    openPreview, saveEditor, pasteStackController, updatePasteStack, onPasteStackChanged,
    handleEffect, captureScreen, recognizeItem, rotateImage, quickLookItem,
  };
}
export type ApplicationActions = ReturnType<typeof useApplicationActions>;
