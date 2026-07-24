<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import {
  PinboardSchema,
  type PasteItem,
  type PasteStackAction,
  type PasteStackState,
  type Pinboard,
} from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";
import type { SaveSyncConfigurationInput } from "../preload/sync-config";
import {
  defaultPrivacySettings,
  type PrivacySettings,
} from "../preload/privacy";
import { defaultSyncSettings, type SyncSettings } from "../preload/sync-store";
import {
  defaultWindowPreferences,
  type WindowPreferences,
} from "../preload/window-preferences";

import Shelf from "./components/Shelf.vue";
import Preview from "./components/Preview.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import TextEditor from "./components/TextEditor.vue";
import { combinedTextPasteContent } from "./batch-paste";
import {
  createPasteboardState,
  pasteStackSnapshot,
  type PasteboardKeyboardEffect,
} from "./state";

const params = new URLSearchParams(window.location.search);
const panel = params.get("panel");
const panelMode =
  panel === "privacy" ||
  panel === "sync" ||
  panel === "preview" ||
  panel === "editor"
    ? panel
    : undefined;
const isShelfMode = params.get("shelf") === "1";
const dockValue = params.get("dock");
const edge: DockEdge =
  dockValue === "top" ||
  dockValue === "bottom" ||
  dockValue === "left" ||
  dockValue === "right"
    ? dockValue
    : "floating";

const state = reactive(
  createPasteboardState({
    items: [],
    dockEdge: edge,
  }),
);
const pinboards = ref<Pinboard[]>([]);
const query = ref("");
const paused = ref(false);
const activePinboardId = ref<string>();
const previewItemId = ref<string>();
const status = ref("本地历史已就绪");
const syncSettings = ref<SyncSettings>(structuredClone(defaultSyncSettings));
const privacySettings = ref<PrivacySettings>(structuredClone(defaultPrivacySettings));
const windowPreferences = ref<WindowPreferences>(structuredClone(defaultWindowPreferences));
const settingsOpen = ref(false);
const settingsSaving = ref(false);
const settingsInitialTab = ref<"general" | "privacy" | "sync">("general");
const editor = ref<{
  mode: "create" | "edit" | "rename";
  itemId?: string;
  title: string;
  text: string;
}>();
const editorSaving = ref(false);
let shelfHasFocused = false;
let pasteStackPersistence = Promise.resolve();

async function loadDevelopmentFixtures(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const { historyFixture, pinboardFixture } = await import(
    "@pasteboard-pro/contract-fixtures"
  );
  state.replaceItems(historyFixture);
  pinboards.value = pinboardFixture.map((pinboard) => structuredClone(pinboard));
}

const visibleItems = computed(() => {
  const items = state.visibleItems;
  return activePinboardId.value === undefined
    ? items
    : items.filter((item) => item.pinboardId === activePinboardId.value);
});
const previewItem = computed(() =>
  visibleItems.value.find((item) => item.id === previewItemId.value),
);
const focusedItem = computed<PasteItem | undefined>(() => {
  const itemId = state.selection.focus ?? state.selection.selected[0];
  return visibleItems.value.find((item) => item.id === itemId);
});

function updateQuery(value: string): void {
  query.value = value;
  state.setQuery(value);
}

function selectItem(itemId: string, extend: boolean, toggle: boolean): void {
  if (extend) {
    state.extendSelectionTo(itemId);
  } else if (toggle) {
    state.toggleSelection(itemId);
  } else {
    state.replaceSelection(itemId);
  }
  if (state.pasteStack.itemIds.length > 0) {
    void updatePasteStack({ type: "clear" });
  }
}

function focusLatestItem(itemId: string): void {
  if (query.value.trim().length > 0 || activePinboardId.value !== undefined) return;
  if (visibleItems.value.some((item) => item.id === itemId)) {
    state.replaceSelection(itemId);
  }
}

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

async function pasteItems(itemIds: readonly string[], plainText = false): Promise<void> {
  const items = itemIds.flatMap((itemId) => {
    const item = visibleItems.value.find((candidate) => candidate.id === itemId);
    return item === undefined ? [] : [item];
  });
  const combinedContent =
    items.length === itemIds.length && items.length > 1
      ? combinedTextPasteContent(items)
      : undefined;
  if (combinedContent !== undefined) {
    try {
      const result = await window.pasteboardPro?.pasteContent(combinedContent);
      status.value =
        result?.status === "accessibility_required"
          ? "已复制多条内容；授权辅助功能后可直接粘贴"
          : `已一次性粘贴 ${items.length} 条内容`;
      if (isShelfMode) window.close();
    } catch (error) {
      status.value = error instanceof Error ? error.message : "批量粘贴失败";
    }
    return;
  }
  for (const itemId of itemIds) {
    await pasteItem(itemId, plainText, false);
  }
  if (itemIds.length > 0 && isShelfMode) window.close();
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
  window.pasteboardPro?.openPanel("editor", { mode: "create" });
}

function editItem(itemId: string): void {
  window.pasteboardPro?.openPanel("editor", { mode: "edit", itemId });
}

function renameItem(itemId: string): void {
  window.pasteboardPro?.openPanel("editor", { mode: "rename", itemId });
}

function openPreview(itemId: string): void {
  window.pasteboardPro?.openPanel("preview", { itemId });
}

async function saveEditor(value: { title: string; text: string }): Promise<void> {
  const current = editor.value;
  if (current === undefined) return;
  editorSaving.value = true;
  try {
    if (current.mode === "create") {
      await window.pasteboardPro?.createTextItem(value.text, value.title || undefined);
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

function persistPasteStack(): Promise<void> {
  const snapshot = pasteStackSnapshot(state.pasteStack);
  const pending = pasteStackPersistence.then(async () => {
    const saved = await window.pasteboardPro?.savePasteStack(snapshot);
    if (saved !== undefined) state.setPasteStack(saved);
  });
  pasteStackPersistence = pending.catch(() => undefined);
  return pending;
}

async function updatePasteStack(action: PasteStackAction): Promise<void> {
  state.dispatchPasteStack(action);
  await persistPasteStack();
}

async function syncPasteStackToSelection(): Promise<void> {
  const itemIds = state.selectionPasteQueue();
  state.dispatchPasteStack({ type: "set-direction", direction: "forward" });
  state.dispatchPasteStack({ type: "replace", itemIds });
  try {
    await persistPasteStack();
    if (itemIds.length > 1) {
      status.value = `已按选择顺序生成 ${itemIds.length} 项粘贴队列`;
    }
  } catch (error) {
    status.value = error instanceof Error ? error.message : "粘贴队列保存失败";
  }
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
    await syncPasteStackToSelection();
    if (isShelfMode) window.close();
    return;
  }
  if (state.pasteStack.itemIds.length > 0) {
    await updatePasteStack({ type: "clear" });
  }
  await pasteItems(effect.itemIds, effect.plainText);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Escape" && (isShelfMode || panelMode !== undefined)) {
    event.preventDefault();
    window.close();
    return;
  }
  if (!isShelfMode) return;
  if (event.metaKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    document.querySelector<HTMLInputElement>("[data-pb-search]")?.focus();
    return;
  }
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createTextItem();
    return;
  }
  const isTextControl =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement;
  if (isTextControl && event.key !== "Enter") {
    return;
  }
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    void copySelection();
    return;
  }
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    void togglePause();
    return;
  }
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "e" && focusedItem.value !== undefined) {
    event.preventDefault();
    editItem(focusedItem.value.id);
    return;
  }
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "r" && focusedItem.value !== undefined) {
    event.preventDefault();
    renameItem(focusedItem.value.id);
    return;
  }
  const previousSelection = state.selection.selected.join("\0");
  const effect = state.handleKeyboard({
    key: event.key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  const selectionChanged = state.selection.selected.join("\0") !== previousSelection;
  if (
    effect !== null ||
    selectionChanged ||
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
  ) {
    event.preventDefault();
  }
  if (selectionChanged && state.pasteStack.itemIds.length > 0) {
    void updatePasteStack({ type: "clear" });
  }
  void handleEffect(effect);
}

async function togglePause(): Promise<void> {
  const next = !paused.value;
  const settings = await window.pasteboardPro?.setCapturePause({ paused: next });
  paused.value = settings?.pause.paused ?? next;
  status.value = paused.value ? "剪贴板捕获已暂停" : "剪贴板捕获已继续";
}

function onMirrored(event: Event): void {
  const detail = (event as CustomEvent<{ imported: number }>).detail;
  status.value = detail.imported > 0 ? `已导入 ${detail.imported} 条记录` : "历史已同步";
}

async function loadHistory(): Promise<void> {
  const history = await window.pasteboardPro?.searchHistory("", 10_000);
  if (history !== undefined) {
    state.replaceItems(history.items);
    status.value = `已载入 ${history.total} 条记录`;
  }
}

async function loadPinboards(): Promise<void> {
  const values = await window.pasteboardPro?.listPinboards();
  if (values !== undefined) {
    pinboards.value = values.map((value) => PinboardSchema.parse(value));
  }
}

async function createPinboard(name: string): Promise<void> {
  await window.pasteboardPro?.createPinboard(name, "#6F61EA");
  await loadPinboards();
  status.value = `已创建分组：${name}`;
}

async function renamePinboard(id: string, name: string): Promise<void> {
  await window.pasteboardPro?.renamePinboard(id, name);
  await loadPinboards();
  status.value = `已重命名分组：${name}`;
}

async function updatePinboardColor(id: string, color: string): Promise<void> {
  await window.pasteboardPro?.updatePinboardColor(id, color);
  await loadPinboards();
  status.value = "已更新分组颜色";
}

async function movePinboard(id: string, direction: -1 | 1): Promise<void> {
  const index = pinboards.value.findIndex((pinboard) => pinboard.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= pinboards.value.length) return;
  const remaining = pinboards.value.filter((pinboard) => pinboard.id !== id);
  const beforeId = remaining[target - 1]?.id;
  const afterId = remaining[target]?.id;
  await window.pasteboardPro?.movePinboard(id, beforeId, afterId);
  await loadPinboards();
  status.value = "已调整分组顺序";
}

async function deletePinboard(id: string): Promise<void> {
  const pinboard = pinboards.value.find((candidate) => candidate.id === id);
  if (
    pinboard === undefined ||
    !window.confirm(`删除分组“${pinboard.name}”？其中内容会保留在全部历史。`)
  ) return;
  const result = await window.pasteboardPro?.deletePinboard(id);
  if (activePinboardId.value === id) activePinboardId.value = undefined;
  await Promise.all([loadPinboards(), loadHistory()]);
  status.value = `已删除分组，保留 ${result?.unassignedItems ?? 0} 项历史`;
}

async function assignPinboard(
  pinboardId: string | undefined,
  draggedItemId: string,
): Promise<void> {
  const itemIds = state.selection.selected.includes(draggedItemId)
    ? state.selection.selected
    : [draggedItemId];
  await window.pasteboardPro?.assignItemsToPinboard(itemIds, pinboardId);
  await loadHistory();
  status.value =
    pinboardId === undefined
      ? `已将 ${itemIds.length} 项移出分组`
      : `已将 ${itemIds.length} 项加入分组`;
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
    status.value = "已在 Quick Look 中打开";
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Quick Look 打开失败";
  }
}

type SettingsTab = "general" | "privacy" | "sync";

async function loadSettings(tab: SettingsTab): Promise<void> {
  const [privacy, preferences, sync] = await Promise.all([
    window.pasteboardPro?.getPrivacySettings(),
    window.pasteboardPro?.getWindowPreferences(),
    window.pasteboardPro?.getSyncSettings(),
  ]);
  privacySettings.value = privacy ?? structuredClone(defaultPrivacySettings);
  windowPreferences.value = preferences ?? structuredClone(defaultWindowPreferences);
  syncSettings.value = sync ?? structuredClone(defaultSyncSettings);
  settingsInitialTab.value = tab;
  settingsOpen.value = true;
}

async function openSettings(tab: SettingsTab): Promise<void> {
  if (panelMode === undefined && window.pasteboardPro !== undefined) {
    window.pasteboardPro.openPanel(tab === "sync" ? "sync" : "privacy", { tab });
    return;
  }
  await loadSettings(tab);
}

async function retrySync(): Promise<void> {
  status.value = "正在重新同步…";
  const settings = await window.pasteboardPro?.retrySync();
  if (settings !== undefined) syncSettings.value = settings;
  status.value = settings?.status.state === "success" ? "同步完成" : "同步仍需处理";
}

function openPrivacySettings(): void {
  void openSettings("general");
}

async function saveSettings(
  settings: PrivacySettings,
  preferences: WindowPreferences,
  syncInput: SaveSyncConfigurationInput,
): Promise<void> {
  settingsSaving.value = true;
  try {
    const currentSync = syncSettings.value;
    const syncChanged =
      syncInput.enabled !== currentSync.enabled ||
      syncInput.baseUrl.trim() !== currentSync.baseUrl ||
      syncInput.username.trim() !== currentSync.username ||
      syncInput.syncFileContents !== currentSync.syncFileContents ||
      syncInput.webdavPassword !== undefined ||
      syncInput.syncPassword !== undefined;
    const [saved, savedPreferences, savedSync] = await Promise.all([
      window.pasteboardPro?.savePrivacySettings(settings),
      window.pasteboardPro?.saveWindowPreferences(preferences),
      syncChanged
        ? window.pasteboardPro?.saveSyncSettings(syncInput)
        : Promise.resolve(undefined),
    ]);
    privacySettings.value = saved ?? settings;
    windowPreferences.value = savedPreferences ?? preferences;
    if (savedSync !== undefined) syncSettings.value = savedSync;
    if (
      windowPreferences.value.multiPasteMode === "batch" &&
      state.pasteStack.itemIds.length > 0
    ) {
      await updatePasteStack({ type: "clear" });
    }
    paused.value = privacySettings.value.pause.paused;
    status.value = "设置已保存";
    closeSettings();
  } catch (error) {
    status.value = error instanceof Error ? error.message : "设置保存失败";
  } finally {
    settingsSaving.value = false;
  }
}

function closeSettings(): void {
  if (panelMode === "privacy" || panelMode === "sync") {
    window.close();
    return;
  }
  settingsOpen.value = false;
}

function closeWindow(): void {
  window.close();
}

function onWindowFocus(): void {
  if (isShelfMode) shelfHasFocused = true;
}

function onWindowBlur(): void {
  if (isShelfMode && shelfHasFocused) window.close();
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pasteboard-pro:paste-stack-changed", onPasteStackChanged);
  await loadDevelopmentFixtures();
  if (isShelfMode) {
    shelfHasFocused = document.hasFocus();
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("blur", onWindowBlur);
  }
  if (panelMode === "sync" || panelMode === "privacy") {
    const requestedTab = params.get("tab");
    await loadSettings(
      panelMode === "sync"
        ? "sync"
        : requestedTab === "privacy"
          ? "privacy"
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
      editor.value = { mode, title: "", text: "" };
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
  window.addEventListener("pasteboard-pro:history-changed", loadHistory);
  const settings = await window.pasteboardPro?.getPrivacySettings();
  paused.value = settings?.pause.paused ?? false;
  const pasteStack = await window.pasteboardPro?.getPasteStack();
  if (pasteStack !== undefined) state.setPasteStack(pasteStack);
  await loadHistory();
  await loadPinboards();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pasteboard-pro:paste-stack-changed", onPasteStackChanged);
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("pasteboard-pro:history-mirrored", onMirrored);
  window.removeEventListener("pasteboard-pro:history-changed", loadHistory);
});
</script>

<template>
  <main
    class="stage"
    :class="{
      'stage--panel': panelMode !== undefined,
      'stage--primary': !isShelfMode && panelMode === undefined,
    }"
  >
    <Shelf
      v-if="isShelfMode"
      :items="visibleItems"
      :pinboards="pinboards"
      :selected-ids="state.selection.selected"
      :focused-item-id="state.selection.focus"
      :query="query"
      :paused="paused"
      :edge="state.dockEdge"
      :density="state.density"
      :active-pinboard-id="activePinboardId"
      :paste-stack-count="state.pasteStack.itemIds.length"
      :paste-stack-direction="state.pasteStack.direction"
      @update:query="updateQuery"
      @select="selectItem"
      @paste="pasteItem"
      @preview="openPreview"
      @latest-visible="focusLatestItem"
      @select-pinboard="activePinboardId = $event"
      @create-pinboard="createPinboard"
      @rename-pinboard="renamePinboard"
      @update-pinboard-color="updatePinboardColor"
      @move-pinboard="movePinboard"
      @delete-pinboard="deletePinboard"
      @assign-pinboard="assignPinboard"
      @toggle-pause="togglePause"
      @toggle-compact="state.setDensity(state.density === 'compact' ? 'expanded' : 'compact')"
      @toggle-stack-direction="updatePasteStack({ type: 'set-direction', direction: state.pasteStack.direction === 'forward' ? 'reverse' : 'forward' })"
      @clear-stack="updatePasteStack({ type: 'clear' })"
      @open-privacy-settings="openPrivacySettings"
      @create-text="createTextItem"
      @edit-item="editItem"
      @rename-item="renameItem"
    />
    <SettingsPanel
      v-if="settingsOpen && (panelMode === undefined || panelMode === 'privacy' || panelMode === 'sync')"
      :standalone="panelMode === 'privacy' || panelMode === 'sync'"
      :initial-tab="settingsInitialTab"
      :privacy-settings="privacySettings"
      :sync-settings="syncSettings"
      :window-preferences="windowPreferences"
      :saving="settingsSaving"
      @close="closeSettings"
      @save="saveSettings"
      @retry="retrySync"
    />
    <TextEditor
      v-if="panelMode === 'editor' && editor"
      standalone
      :mode="editor.mode"
      :title="editor.title"
      :text="editor.text"
      :saving="editorSaving"
      @close="closeWindow"
      @save="saveEditor"
    />
    <Preview
      v-if="panelMode === 'preview' && previewItem"
      standalone
      :item="previewItem"
      @close="closeWindow"
      @paste="pasteItem"
      @ocr="recognizeItem"
      @rotate="rotateImage($event.itemId, $event.quarterTurns)"
      @quick-look="quickLookItem"
      @edit="editItem"
      @rename="renameItem"
    />
    <p v-if="isShelfMode" class="status" aria-live="polite">{{ status }}</p>
  </main>
</template>

<style>
@import "./styles/tokens.css";
@import "./styles/glass.css";
@import "./styles/layout.css";

.stage {
  display: grid;
  height: 100%;
  min-height: 100%;
  padding: 0;
  place-items: end center;
}

.stage--panel {
  position: relative;
  height: 100%;
  min-height: 0;
  padding: 0;
  place-items: center;
  background: var(--pb-window-bg);
}

.stage--primary {
  display: none;
}

.status {
  position: fixed;
  left: 50%;
  bottom: 2px;
  margin: 0;
  color: var(--pb-muted);
  font-size: 9px;
  transform: translateX(-50%);
}

body:has(.shelf--bottom) .stage {
  padding-bottom: 0;
}

body:has(.shelf--top) .stage {
  padding-top: 0;
  place-items: start center;
}

body:has(.shelf--left) .stage {
  padding-left: 0;
  place-items: center start;
}

body:has(.shelf--right) .stage {
  padding-right: 0;
  place-items: center end;
}
</style>
