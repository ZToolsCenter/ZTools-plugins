import type {
  PasteStackAction,
  PasteStackState,
} from "@pasteboard-pro/core";

import { pasteStackSnapshot } from "./state";

export type PasteStackControllerState = {
  readonly pasteStack: Readonly<PasteStackState>;
  selectionPasteQueue(): string[];
  dispatchPasteStack(action: PasteStackAction): void;
  setPasteStack(pasteStack: PasteStackState): void;
  clearSelection(): void;
};

export type PasteStackControllerDependencies = {
  state: PasteStackControllerState;
  saveStack(snapshot: PasteStackState): Promise<PasteStackState | undefined>;
  reportStatus(message: string): void;
  closeShelf(): void;
  supportsGlobalQueue: boolean;
};

function sameStack(
  actual: Readonly<PasteStackState> | undefined,
  expected: Readonly<PasteStackState>,
): boolean {
  return actual !== undefined &&
    actual.direction === expected.direction &&
    actual.itemIds.length === expected.itemIds.length &&
    actual.itemIds.every((itemId, index) => itemId === expected.itemIds[index]);
}

export function createPasteStackController(
  dependencies: PasteStackControllerDependencies,
) {
  let persistence = Promise.resolve();

  function persist(snapshot: PasteStackState): Promise<PasteStackState | undefined> {
    const pending = persistence.then(async () => {
      const saved = await dependencies.saveStack(snapshot);
      if (saved !== undefined) dependencies.state.setPasteStack(saved);
      return saved;
    });
    persistence = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function update(action: PasteStackAction): Promise<void> {
    dependencies.state.dispatchPasteStack(action);
    await persist(pasteStackSnapshot(dependencies.state.pasteStack));
  }

  async function syncSelection(itemIds: readonly string[]): Promise<boolean> {
    if (itemIds.length < 2) return false;

    const previous = pasteStackSnapshot(dependencies.state.pasteStack);
    dependencies.state.dispatchPasteStack({ type: "replace", itemIds });
    const expected = pasteStackSnapshot(dependencies.state.pasteStack);
    try {
      const saved = await persist(expected);
      if (!sameStack(saved, expected)) {
        const savedCount = saved?.itemIds.length ?? 0;
        throw new Error(
          saved === undefined
            ? `队列保存未返回结果，${itemIds.length} 项未确认持久化`
            : `队列保存不完整：请求 ${expected.itemIds.length} 项，实际返回 ${savedCount} 项`,
        );
      }
      dependencies.reportStatus(`已按选择顺序生成 ${itemIds.length} 项粘贴队列`);
      return true;
    } catch (error) {
      dependencies.state.setPasteStack(previous);
      let restoreConfirmed = false;
      let clearedInstead = false;
      try {
        const restored = await persist(previous);
        restoreConfirmed = sameStack(restored, previous);
      } catch {
        // Try clearing a potentially partial runtime queue if restoring the old
        // queue could not be confirmed.
      }
      if (!restoreConfirmed) {
        const emptyStack: PasteStackState = {
          direction: previous.direction,
          itemIds: [],
        };
        dependencies.state.setPasteStack(emptyStack);
        try {
          const cleared = await persist(emptyStack);
          restoreConfirmed = sameStack(cleared, emptyStack);
          clearedInstead = restoreConfirmed;
        } catch {
          // Keep the local queue non-partial; surface that persistence is uncertain.
        }
        if (!restoreConfirmed) dependencies.state.setPasteStack(previous);
      }

      const failure = error instanceof Error ? error.message : "粘贴队列保存失败";
      dependencies.reportStatus(
        restoreConfirmed
          ? `${failure}；${clearedInstead ? "已清空未完整保存的队列" : "已恢复此前队列"}`
          : `${failure}；无法确认恢复状态，请检查粘贴队列后再继续`,
      );
      return false;
    }
  }

  async function startSelection(
    selectedItemIds: readonly string[] = dependencies.state.selectionPasteQueue(),
  ): Promise<boolean> {
    const itemIds = [...selectedItemIds];
    if (itemIds.length < 2) return false;

    if (!dependencies.supportsGlobalQueue) {
      dependencies.reportStatus("当前平台暂不支持逐项粘贴队列，请分次选择粘贴");
      return false;
    }

    if (!await syncSelection(itemIds)) return false;
    dependencies.closeShelf();
    return true;
  }

  async function clearSelection(): Promise<void> {
    dependencies.state.clearSelection();
    await update({ type: "clear" });
  }

  return { update, startSelection, clearSelection };
}
