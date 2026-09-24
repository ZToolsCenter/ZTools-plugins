<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    reducePasteStack,
    reduceSelection,
    type PasteItem,
    type PasteStackState,
    type Pinboard,
    type SelectionState,
  } from "@pasteboard-pro/core";
  import type { DockEdge } from "@pasteboard-pro/design-tokens";

  import { atoolsPasteboard, type PasteboardPreferences } from "./adapter";
  import Preferences from "./components/Preferences.svelte";
  import Shelf from "./components/Shelf.svelte";
  import TextEditor from "./components/TextEditor.svelte";

  let items = $state<PasteItem[]>([]);
  let pinboards = $state<Pinboard[]>([]);
  let selection = $state<SelectionState>({ selected: [] });
  let pasteStack = $state<PasteStackState>({ direction: "forward", itemIds: [] });
  let query = $state("");
  let activePinboardId = $state<string>();
  let previewId = $state<string>();
  let compact = $state(false);
  let paused = $state(false);
  let loading = $state(true);
  let status = $state("正在读取本地历史…");
  let syncState = $state("disabled");
  let dockEdge = $state<DockEdge>("bottom");
  let preferences = $state<PasteboardPreferences>({
    retentionDays: 90,
    blobBudgetBytes: 1_073_741_824,
    privacyLiterals: [],
    screenShareProtection: true,
  });
  let preferencesOpen = $state(false);
  let preferencesSaving = $state(false);
  let editor = $state<{
    mode: "create" | "edit" | "rename";
    itemId?: string;
    title: string;
    text: string;
  }>();
  let editorSaving = $state(false);
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  let previewItem = $derived(items.find((item) => item.id === previewId));
  let selectedItems = $derived(
    selection.selected.flatMap((id) => {
      const item = items.find((candidate) => candidate.id === id);
      return item === undefined ? [] : [item];
    }),
  );

  async function load(silent = false) {
    if (!silent) loading = true;
    try {
      const [nextItems, nextPinboards, sync, capture, windowState] = await Promise.all([
        atoolsPasteboard.listItems(query, activePinboardId),
        atoolsPasteboard.listPinboards(),
        atoolsPasteboard.syncSettings(),
        atoolsPasteboard.captureStatus(),
        atoolsPasteboard.windowState(),
      ]);
      items = nextItems;
      pinboards = nextPinboards;
      syncState = sync.state;
      paused = capture.paused;
      dockEdge = windowState.edge;
      const orderedIds = items.map((item) => item.id);
      selection = reduceSelection(selection, {
        type: "restore",
        orderedIds,
        ...(orderedIds[0] === undefined ? {} : { fallbackId: orderedIds[0] }),
      });
      if (!silent) status = items.length === 0 ? "复制内容后会出现在这里" : `${items.length} 项本地历史`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      if (!silent) loading = false;
    }
  }

  function updateQuery(value: string) {
    query = value;
    if (queryTimer !== undefined) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => void load(), 90);
  }

  function selectItem(itemId: string, extend: boolean, toggle: boolean) {
    const orderedIds = items.map((item) => item.id);
    if (toggle) {
      selection = reduceSelection(selection, { type: "toggle", itemId });
      return;
    }
    if (extend && selection.focus !== undefined) {
      const current = orderedIds.indexOf(selection.focus);
      const target = orderedIds.indexOf(itemId);
      if (current >= 0 && target >= 0) {
        let next = selection;
        const direction: -1 | 1 = target < current ? -1 : 1;
        for (let index = current; index !== target; index += direction) {
          next = reduceSelection(next, { type: "extend", orderedIds, direction });
        }
        selection = next;
        return;
      }
    }
    selection = reduceSelection(selection, { type: "replace", itemId });
  }

  async function pasteItem(itemId: string, plainText = false) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (item === undefined) return;
    try {
      status = plainText ? "正在粘贴纯文本…" : "正在粘贴…";
      await atoolsPasteboard.paste(item, plainText);
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function recognizeItem(itemId: string) {
    try {
      status = "正在使用本地 Vision 识别…";
      const text = await atoolsPasteboard.recognizeItem(itemId);
      await load(true);
      previewId = itemId;
      status = text.length > 0 ? "OCR 识别完成" : "未识别到文字";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function rotateImage(itemId: string, quarterTurns: -1 | 1) {
    try {
      status = quarterTurns < 0 ? "正在向左旋转…" : "正在向右旋转…";
      await atoolsPasteboard.rotateImage(itemId, quarterTurns);
      await load(true);
      previewId = itemId;
      status = quarterTurns < 0 ? "已向左旋转" : "已向右旋转";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function quickLookItem(itemId: string) {
    try {
      await atoolsPasteboard.quickLookItem(itemId);
      status = "已在 Quick Look 中打开";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function copySelection() {
    const item = selectedItems[0];
    if (item === undefined) return;
    try {
      await atoolsPasteboard.copy(item);
      status = "已复制回系统剪贴板";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function selectPinboard(id: string | undefined) {
    activePinboardId = id;
    await load();
  }

  async function createPinboard(name: string) {
    try {
      const created = await atoolsPasteboard.createPinboard(name);
      await load();
      activePinboardId = created.id;
      await load();
      status = `已创建分组：${created.name}`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function renamePinboard(id: string, name: string) {
    try {
      await atoolsPasteboard.renamePinboard(id, name);
      await load();
      status = `已重命名分组：${name}`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function updatePinboardColor(id: string, color: string) {
    try {
      await atoolsPasteboard.updatePinboard(id, { color });
      await load();
      status = "已更新分组颜色";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function movePinboard(id: string, direction: -1 | 1) {
    const index = pinboards.findIndex((pinboard) => pinboard.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pinboards.length) return;
    const remaining = pinboards.filter((pinboard) => pinboard.id !== id);
    const insertion = direction < 0 ? target : target;
    const beforeId = remaining[insertion - 1]?.id;
    const afterId = remaining[insertion]?.id;
    try {
      await atoolsPasteboard.movePinboard(id, beforeId, afterId);
      await load();
      status = "已调整分组顺序";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function deletePinboard(id: string) {
    const pinboard = pinboards.find((candidate) => candidate.id === id);
    if (pinboard === undefined || !window.confirm(`删除分组“${pinboard.name}”？其中内容会保留在全部历史。`)) return;
    try {
      const result = await atoolsPasteboard.deletePinboard(id);
      if (activePinboardId === id) activePinboardId = undefined;
      await load();
      status = `已删除分组，保留 ${result.unassignedItems} 项历史`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function assignPinboard(pinboardId: string | undefined, itemId: string) {
    const itemIds = selection.selected.includes(itemId) ? selection.selected : [itemId];
    try {
      await atoolsPasteboard.assignItems(itemIds, pinboardId);
      await load();
      status = pinboardId === undefined ? "已移出分组" : `已移动 ${itemIds.length} 项`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function syncNow() {
    try {
      status = "正在同步加密 vault…";
      const result = await atoolsPasteboard.syncNow();
      syncState = result.status;
      await load();
      status = result.status === "success"
        ? `同步完成：拉取 ${result.pulledObjects} 项，上传 ${result.pushedObjects} 项`
        : `${result.failedObjectIds.length} 项等待重试`;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function togglePause() {
    try {
      const capture = await atoolsPasteboard.setCapturePaused(!paused);
      paused = capture.paused;
      status = paused ? "已暂停捕获；暂停期间的内容不会补录" : "已恢复捕获";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function openPreferences() {
    try {
      preferences = await atoolsPasteboard.preferences();
      preferencesOpen = true;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  async function savePreferences(next: PasteboardPreferences) {
    preferencesSaving = true;
    try {
      preferences = await atoolsPasteboard.savePreferences(next);
      preferencesOpen = false;
      status = "隐私与历史保留设置已保存";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      preferencesSaving = false;
    }
  }

  function createTextItem() {
    editor = { mode: "create", title: "", text: "" };
  }

  function editItem(itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (item === undefined) return;
    editor = {
      mode: "edit",
      itemId,
      title: item.title ?? "",
      text: item.payload.text ?? item.ocrText ?? "",
    };
  }

  function renameItem(itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (item === undefined) return;
    editor = {
      mode: "rename",
      itemId,
      title: item.title ?? "",
      text: item.payload.text ?? "",
    };
  }

  async function saveEditor(value: { title: string; text: string }) {
    const current = editor;
    if (current === undefined) return;
    editorSaving = true;
    try {
      const item = current.mode === "create"
        ? await atoolsPasteboard.createTextItem(value.text, value.title || undefined)
        : current.mode === "edit" && current.itemId !== undefined
          ? await atoolsPasteboard.updateTextItem(current.itemId, value.text, value.title || undefined)
          : current.itemId !== undefined
            ? await atoolsPasteboard.updateItemTitle(current.itemId, value.title)
            : undefined;
      editor = undefined;
      await load(true);
      if (item !== undefined) {
        previewId = item.id;
        selection = reduceSelection(selection, { type: "replace", itemId: item.id });
      }
      status = current.mode === "create" ? "已新建文本" : current.mode === "rename" ? "已重命名" : "已保存编辑";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      editorSaving = false;
    }
  }

  function addSelectionToStack() {
    pasteStack = reducePasteStack(pasteStack, { type: "append", itemIds: selection.selected });
    status = `${pasteStack.itemIds.length} 项已加入粘贴队列`;
  }

  async function consumeStack() {
    const itemId = pasteStack.direction === "forward"
      ? pasteStack.itemIds[0]
      : pasteStack.itemIds.at(-1);
    if (itemId === undefined) return;
    await pasteItem(itemId);
    pasteStack = reducePasteStack(pasteStack, { type: "consume" });
  }

  async function startShelfDrag() {
    try {
      await atoolsPasteboard.startShelfDrag();
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const editable = target?.matches("input, textarea, [contenteditable='true']") === true;
    const orderedIds = items.map((item) => item.id);
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
    if (editable) return;
    const focusedItem = selectedItems[0];
    if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "e" && focusedItem !== undefined) {
      event.preventDefault();
      editItem(focusedItem.id);
      return;
    }
    if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "r" && focusedItem !== undefined) {
      event.preventDefault();
      renameItem(focusedItem.id);
      return;
    }
    if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      addSelectionToStack();
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === "v" && pasteStack.itemIds.length > 0) {
      event.preventDefault();
      void consumeStack();
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (event.metaKey && /^[1-9]$/.test(event.key)) {
      const item = items[Number(event.key) - 1];
      if (item !== undefined) {
        event.preventDefault();
        void pasteItem(item.id, event.shiftKey);
      }
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection = reduceSelection(selection, { type: "select-all", orderedIds });
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selection = reduceSelection(selection, {
        type: event.shiftKey ? "extend" : "extend",
        orderedIds,
        direction: event.key === "ArrowLeft" ? -1 : 1,
      });
      if (!event.shiftKey && selection.focus !== undefined) {
        selection = reduceSelection(selection, { type: "replace", itemId: selection.focus });
      }
      return;
    }
    if (event.key === "Enter" && selection.focus !== undefined) {
      event.preventDefault();
      void pasteItem(selection.focus, event.shiftKey);
      return;
    }
    if (event.key === " " && selection.focus !== undefined) {
      event.preventDefault();
      previewId = selection.focus;
      return;
    }
    if (event.key === "Escape") {
      if (previewId !== undefined) {
        previewId = undefined;
      } else {
        selection = reduceSelection(selection, { type: "clear" });
        void atoolsPasteboard.hideShelf();
      }
    }
  }

  onMount(() => {
    void load();
    refreshTimer = setInterval(() => void load(true), 1_000);
    window.addEventListener("keydown", onKeydown, { capture: true });
  });

  onDestroy(() => {
    if (queryTimer !== undefined) clearTimeout(queryTimer);
    if (refreshTimer !== undefined) clearInterval(refreshTimer);
    window.removeEventListener("keydown", onKeydown, { capture: true });
  });
</script>

<main>
  <Shelf
    {items}
    {pinboards}
    selectedIds={selection.selected}
    {query}
    {paused}
    {compact}
    {activePinboardId}
    {previewItem}
    {pasteStack}
    {status}
    {syncState}
    {loading}
    {dockEdge}
    ondrag={() => void startShelfDrag()}
    onquery={updateQuery}
    onselect={selectItem}
    onpaste={(id, plainText) => void pasteItem(id, plainText)}
    onocr={(id) => void recognizeItem(id)}
    onrotate={(id, quarterTurns) => void rotateImage(id, quarterTurns)}
    onquicklook={(id) => void quickLookItem(id)}
    onpreview={(id) => previewId = id}
    onclosepreview={() => previewId = undefined}
    onselectpinboard={(id) => void selectPinboard(id)}
    oncreatepinboard={(name) => void createPinboard(name)}
    onrenamepinboard={(id, name) => void renamePinboard(id, name)}
    onupdatepinboardcolor={(id, color) => void updatePinboardColor(id, color)}
    onmovepinboard={(id, direction) => void movePinboard(id, direction)}
    ondeletepinboard={(id) => void deletePinboard(id)}
    onassignpinboard={(id, itemId) => void assignPinboard(id, itemId)}
    ontogglepause={() => void togglePause()}
    ontogglecompact={() => compact = !compact}
    onsync={() => void syncNow()}
    onaddstack={addSelectionToStack}
    ontogglestack={() => pasteStack = reducePasteStack(pasteStack, { type: "set-direction", direction: pasteStack.direction === "forward" ? "reverse" : "forward" })}
    onclearstack={() => pasteStack = reducePasteStack(pasteStack, { type: "clear" })}
    onsettings={() => void openPreferences()}
    oncreate={createTextItem}
    onedit={editItem}
    onrename={renameItem}
  />
  {#if preferencesOpen}
    <Preferences
      {preferences}
      saving={preferencesSaving}
      onclose={() => preferencesOpen = false}
      onsave={(next) => void savePreferences(next)}
    />
  {/if}
  {#if editor !== undefined}
    <TextEditor
      mode={editor.mode}
      title={editor.title}
      text={editor.text}
      saving={editorSaving}
      onclose={() => editor = undefined}
      onsave={(value) => void saveEditor(value)}
    />
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body), :global(#app) { width: 100%; min-width: 0; min-height: 100%; margin: 0; }
  :global(body) {
    overflow: hidden;
    background: transparent;
    color: var(--pb-ink);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :global(button), :global(input) { font: inherit; }
  main { position: relative; min-width: 0; padding: 0; }
  :global(:root) {
    --pb-radius: 28px;
    --pb-ink: #f7f7fb;
    --pb-muted: rgba(235, 235, 245, 0.58);
    --pb-line: rgba(255, 255, 255, 0.14);
    --pb-glass: rgba(30, 31, 43, 0.72);
    --pb-glass-strong: rgba(40, 41, 56, 0.9);
    --pb-shadow: rgba(4, 5, 13, 0.42);
    --pb-violet: #8b80ff;
    --pb-blue: #63b8ff;
    --pb-coral: #ff8a70;
  }
  @media (prefers-color-scheme: light) {
    :global(:root) {
      --pb-ink: #191922;
      --pb-muted: rgba(35, 35, 48, 0.54);
      --pb-line: rgba(255, 255, 255, 0.7);
      --pb-glass: rgba(247, 247, 252, 0.68);
      --pb-glass-strong: rgba(255, 255, 255, 0.9);
      --pb-shadow: rgba(44, 39, 82, 0.18);
      --pb-violet: #6f61ea;
      --pb-blue: #278de2;
      --pb-coral: #e45f48;
    }
  }
</style>
