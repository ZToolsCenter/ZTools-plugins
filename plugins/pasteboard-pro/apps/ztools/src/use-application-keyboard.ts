import { nextTick } from "vue";
import { queryAfterTypeToSearch } from "./type-to-search";
import { isListNavigationKey, shouldResumeListControl } from "./list-control-key";
import { shelfKeyboardRoute } from "./keyboard-routing";
import { hasAnyCommandModifier, matchesPrimaryShortcut } from "./platform-shortcuts";
import type { ApplicationWindowContext } from "./application-window-context";
import type { ApplicationHistory } from "./use-application-history";
import type { ApplicationSettings } from "./use-application-settings";
import type { ApplicationActions } from "./use-application-actions";

export function createApplicationKeyboardHandler(
  context: ApplicationWindowContext,
  history: ApplicationHistory,
  settings: ApplicationSettings,
  actions: ApplicationActions,
  togglePause: () => Promise<void>,
  focusListCard: (itemId: string | undefined) => void,
) {
  const { isShelfMode, panelMode, shortcutPlatform } = context;
  const { state, query, queryPending, activePinboardId, visibleItems, pagedHistory, hasMoreHistory, focusedItem, updateQuery, reportHistoryError } = history;
  const { settingsSaving, settingsOpen } = settings;
  const { selectionPasteNotice, createTextItem, copySelection, editItem, renameItem, updatePasteStack, handleEffect } = actions;
  return async function onKeydown(event: KeyboardEvent): Promise<void> {
    if (event.isComposing || selectionPasteNotice.value !== undefined) return;
    if (settingsSaving.value && event.key === "Escape") { event.preventDefault(); return; }
    if (event.key === "Escape" && (context.shelfDrag.active || context.pointerReorderActive.value)) return;
    if (event.key === "Escape" && (isShelfMode || panelMode !== undefined)) {
      event.preventDefault();
      window.close();
      return;
    }
    if (!isShelfMode) return;
    if (settingsOpen.value) return;
    if (matchesPrimaryShortcut(event, shortcutPlatform, "f")) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("[data-pb-search]")?.focus();
      return;
    }
    if (matchesPrimaryShortcut(event, shortcutPlatform, "n")) {
      event.preventDefault();
      createTextItem();
      return;
    }
    const isTextControl =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable);
    const searchInput =
      event.target instanceof HTMLInputElement &&
        event.target.matches("[data-pb-search]")
        ? event.target
        : undefined;
    const resumeListControl =
      searchInput !== undefined && shouldResumeListControl(event);
    if (isTextControl && !resumeListControl) {
      return;
    }
    if (resumeListControl) {
      if (queryPending.value) {
        event.preventDefault();
        const requestedQuery = query.value;
        const requestedBoard = activePinboardId.value;
        await history.flushSearch();
        await history.whenSearchIdle()?.catch(reportHistoryError);
        if (requestedQuery !== query.value || requestedBoard !== activePinboardId.value) return;
      }
      searchInput.blur();
      const previousSelection = state.selection.selected.join("\0");
      const firstItemId = state.selectFirst(
        visibleItems.value.map((item) => item.id),
      );
      if (
        state.selection.selected.join("\0") !== previousSelection &&
        state.pasteStack.itemIds.length > 0
      ) {
        void updatePasteStack({ type: "clear" });
      }
      focusListCard(firstItemId);
      if (isListNavigationKey(event.key)) {
        event.preventDefault();
        return;
      }
    }
    if (matchesPrimaryShortcut(event, shortcutPlatform, "c")) {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (matchesPrimaryShortcut(event, shortcutPlatform, "t")) {
      event.preventDefault();
      void togglePause();
      return;
    }
    if (matchesPrimaryShortcut(event, shortcutPlatform, "e") && focusedItem.value !== undefined) {
      event.preventDefault();
      editItem(focusedItem.value.id);
      return;
    }
    if (matchesPrimaryShortcut(event, shortcutPlatform, "r") && focusedItem.value !== undefined) {
      event.preventDefault();
      renameItem(focusedItem.value.id);
      return;
    }
    const previousSelection = state.selection.selected.join("\0");
    const keyboardTarget = event.target instanceof Element ? event.target : undefined;
    const listCardTarget = keyboardTarget?.closest<HTMLElement>("[data-pb-item-id]");
    const keyboardRoute = shelfKeyboardRoute(event.key, {
      nativeControl:
        keyboardTarget !== undefined &&
        keyboardTarget.closest(
          "button, a[href], summary, [role='button'], [role='menuitem']",
        ) !== null,
      listCard: listCardTarget !== undefined && listCardTarget !== null,
    });
    if (keyboardRoute === "native-control") return;
    if (
      keyboardRoute === "list-card" &&
      !hasAnyCommandModifier(event) &&
      listCardTarget !== undefined &&
      listCardTarget !== null
    ) {
      const itemId = listCardTarget.dataset.pbItemId;
      if (itemId !== undefined && !state.selection.selected.includes(itemId)) {
        state.replaceSelection(itemId);
      }
    }
    const nextQuery = keyboardRoute === "list-card"
      ? undefined
      : queryAfterTypeToSearch(query.value, event);
    if (nextQuery !== undefined) {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("[data-pb-search]");
      updateQuery(nextQuery);
      input?.focus();
      void nextTick(() =>
        input?.setSelectionRange(nextQuery.length, nextQuery.length),
      );
      return;
    }
    if (pagedHistory && hasMoreHistory.value &&
      (event.key === "ArrowRight" || event.key === "ArrowDown") &&
      state.selection.focus === visibleItems.value.at(-1)?.id) {
      event.preventDefault();
      const currentQuery = query.value;
      const currentBoard = activePinboardId.value;
      try { await history.loadMoreForNavigation(); } catch (error) { reportHistoryError(error); return; }
      if (query.value !== currentQuery || activePinboardId.value !== currentBoard) return;
    }
    const effect = state.handleKeyboard(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      },
      visibleItems.value.map((item) => item.id),
    );
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
    if (selectionChanged && isListNavigationKey(event.key)) {
      focusListCard(state.selection.focus ?? state.selection.selected[0]);
    }
    void handleEffect(effect);
  }


}
