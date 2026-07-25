import {
  PasteItemSchema,
  reducePasteStack,
  reduceSelection,
  searchPasteItems,
  type PasteItem,
  type PasteStackAction,
  type PasteStackDirection,
  type PasteStackState,
  type SelectionAction,
  type SelectionState,
} from "@pasteboard-pro/core";
import {
  pasteboardTokens,
  type DockEdge,
} from "@pasteboard-pro/design-tokens";

export type PasteboardKeyboardEvent = Readonly<{
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}>;

export type ShelfDensity = "expanded" | "compact";

export type PasteboardKeyboardEffect =
  | Readonly<{ type: "quick-paste"; itemId: string; plainText: boolean }>
  | Readonly<{ type: "paste"; itemIds: string[]; plainText: boolean }>
  | Readonly<{ type: "preview"; itemId: string }>;

export type PasteboardStateInput = Readonly<{
  items: readonly unknown[];
  orderedIds?: readonly string[];
  selection?: Readonly<{
    selected: readonly string[];
    anchor?: string;
    focus?: string;
  }>;
  pasteStack?: Readonly<{
    direction: PasteStackDirection;
    itemIds: readonly string[];
  }>;
  dockEdge?: DockEdge;
  density?: ShelfDensity;
}>;

export function keyboardAction(
  event: PasteboardKeyboardEvent,
  orderedIds: readonly string[],
): SelectionAction | null {
  if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
    return { type: "select-all", orderedIds };
  }
  if (!event.metaKey && !event.altKey && event.shiftKey) {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      return { type: "extend", orderedIds, direction: -1 };
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      return { type: "extend", orderedIds, direction: 1 };
    }
  }
  if (
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    event.key === "Escape"
  ) {
    return { type: "clear" };
  }
  return null;
}

export function visualState(
  edge: DockEdge,
  density: ShelfDensity,
): Readonly<{
  dockClass: string;
  cardWidth: number;
  transitionMs: number;
}> {
  return {
    dockClass: `shelf--${edge}`,
    cardWidth:
      density === "compact"
        ? pasteboardTokens.compactCardWidth
        : pasteboardTokens.expandedCardWidth,
    transitionMs: pasteboardTokens.dockTransitionMs,
  };
}

function cloneSelection(
  selection: PasteboardStateInput["selection"],
): SelectionState {
  return selection === undefined
    ? { selected: [] }
    : {
        selected: [...selection.selected],
        ...(selection.anchor === undefined ? {} : { anchor: selection.anchor }),
        ...(selection.focus === undefined ? {} : { focus: selection.focus }),
      };
}

function clonePasteStack(
  pasteStack: PasteboardStateInput["pasteStack"],
): PasteStackState {
  return pasteStack === undefined
    ? { direction: "forward", itemIds: [] }
    : {
        direction: pasteStack.direction,
        itemIds: [...pasteStack.itemIds],
      };
}

export function pasteStackSnapshot(
  pasteStack: Readonly<PasteStackState>,
): PasteStackState {
  return {
    direction: pasteStack.direction,
    itemIds: [...pasteStack.itemIds],
  };
}

export class PasteboardState {
  private items: PasteItem[];
  private readonly explicitOrder: ReadonlyMap<string, number> | undefined;
  private query = "";

  selection: SelectionState;
  pasteStack: PasteStackState;
  dockEdge: DockEdge;
  density: ShelfDensity;

  constructor(input: PasteboardStateInput) {
    this.items = input.items.map((item) => PasteItemSchema.parse(item));
    this.explicitOrder =
      input.orderedIds === undefined
        ? undefined
        : new Map(input.orderedIds.map((id, index) => [id, index] as const));
    this.selection = cloneSelection(input.selection);
    this.pasteStack = clonePasteStack(input.pasteStack);
    this.dockEdge = input.dockEdge ?? "floating";
    this.density = input.density ?? "expanded";
  }

  get visibleItems(): PasteItem[] {
    const items = searchPasteItems(this.items, this.query);
    if (this.query.trim().length > 0 || this.explicitOrder === undefined) {
      return items;
    }

    return items.sort((left, right) => {
      const leftIndex = this.explicitOrder?.get(left.id);
      const rightIndex = this.explicitOrder?.get(right.id);
      if (leftIndex === undefined && rightIndex === undefined) {
        return 0;
      }
      if (leftIndex === undefined) {
        return 1;
      }
      if (rightIndex === undefined) {
        return -1;
      }
      return leftIndex - rightIndex;
    });
  }

  setQuery(query: string): void {
    this.query = query;
    const orderedIds = this.visibleItems.map((item) => item.id);
    this.selection = reduceSelection(this.selection, {
      type: "restore",
      orderedIds,
      ...(orderedIds[0] === undefined ? {} : { fallbackId: orderedIds[0] }),
    });
  }

  replaceItems(items: readonly unknown[]): void {
    this.items = items.map((item) => PasteItemSchema.parse(item));
    const orderedIds = this.visibleItems.map((item) => item.id);
    this.selection = reduceSelection(this.selection, {
      type: "restore",
      orderedIds,
      ...(orderedIds[0] === undefined ? {} : { fallbackId: orderedIds[0] }),
    });
  }

  replaceSelection(itemId: string): void {
    if (!this.visibleItems.some((item) => item.id === itemId)) {
      throw new RangeError("Cannot select an item outside the visible timeline");
    }
    this.selection = reduceSelection(this.selection, {
      type: "replace",
      itemId,
    });
  }

  toggleSelection(itemId: string): void {
    if (!this.visibleItems.some((item) => item.id === itemId)) {
      throw new RangeError("Cannot select an item outside the visible timeline");
    }
    this.selection = reduceSelection(this.selection, {
      type: "toggle",
      itemId,
    });
  }

  restoreSelection(orderedIds: readonly string[]): void {
    const scopedIds = this.scopedOrderedIds(orderedIds);
    this.selection = reduceSelection(this.selection, {
      type: "restore",
      orderedIds: scopedIds,
      ...(scopedIds[0] === undefined ? {} : { fallbackId: scopedIds[0] }),
    });
  }

  extendSelectionTo(
    itemId: string,
    orderedIds: readonly string[] = this.visibleItems.map((item) => item.id),
  ): void {
    const scopedIds = this.scopedOrderedIds(orderedIds);
    const targetIndex = scopedIds.indexOf(itemId);
    if (targetIndex < 0) {
      throw new RangeError("Cannot extend to an item outside the visible timeline");
    }
    const currentFocus = this.selection.focus ?? this.selection.anchor;
    const currentIndex =
      currentFocus === undefined ? targetIndex : scopedIds.indexOf(currentFocus);
    if (currentIndex < 0) {
      this.replaceSelection(itemId);
      return;
    }
    const direction: -1 | 1 = targetIndex < currentIndex ? -1 : 1;
    let next = this.selection;
    for (let index = currentIndex; index !== targetIndex; index += direction) {
      next = reduceSelection(next, {
        type: "extend",
        orderedIds: scopedIds,
        direction,
      });
    }
    this.selection = next;
  }

  dispatchPasteStack(action: PasteStackAction): void {
    this.pasteStack = reducePasteStack(this.pasteStack, action);
  }

  setPasteStack(
    pasteStack: PasteStackState,
    clearSelectionWhenEmpty = false,
  ): void {
    const hadQueuedItems = this.pasteStack.itemIds.length > 0;
    this.pasteStack = pasteStackSnapshot(pasteStack);
    if (
      clearSelectionWhenEmpty &&
      hadQueuedItems &&
      this.pasteStack.itemIds.length === 0
    ) {
      this.selection = { selected: [] };
    }
  }

  selectionPasteQueue(): string[] {
    return this.selection.selected.length > 1 ? [...this.selection.selected] : [];
  }

  setDockEdge(edge: DockEdge): void {
    this.dockEdge = edge;
  }

  setDensity(density: ShelfDensity): void {
    this.density = density;
  }

  handleKeyboard(
    event: PasteboardKeyboardEvent,
    orderedIds: readonly string[] = this.visibleItems.map((item) => item.id),
  ): PasteboardKeyboardEffect | null {
    const scopedIds = this.scopedOrderedIds(orderedIds);
    const selectionAction = keyboardAction(event, scopedIds);
    if (selectionAction !== null) {
      this.selection = reduceSelection(this.selection, selectionAction);
      return null;
    }

    if (event.metaKey && !event.altKey && /^[1-9]$/u.test(event.key)) {
      const itemId = scopedIds[Number(event.key) - 1];
      return itemId === undefined
        ? null
        : { type: "quick-paste", itemId, plainText: event.shiftKey };
    }

    if (!event.metaKey && !event.shiftKey && !event.altKey) {
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        this.moveSelection(
          event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1,
          scopedIds,
        );
        return null;
      }

      if (event.key === "Enter") {
        const available = new Set(scopedIds);
        const selected = this.selection.selected.filter((id) => available.has(id));
        return selected.length === 0
          ? null
          : { type: "paste", itemIds: selected, plainText: false };
      }

      if (event.key === " ") {
        const itemId =
          this.selection.focus ??
          scopedIds.find((id) => this.selection.selected.includes(id));
        return itemId === undefined ? null : { type: "preview", itemId };
      }
    }

    if (!event.metaKey && event.shiftKey && !event.altKey && event.key === "Enter") {
      const available = new Set(scopedIds);
      const selected = this.selection.selected.filter((id) => available.has(id));
      return selected.length === 0
        ? null
        : { type: "paste", itemIds: selected, plainText: true };
    }

    return null;
  }

  private scopedOrderedIds(orderedIds: readonly string[]): string[] {
    const available = new Set(this.visibleItems.map((item) => item.id));
    return [...new Set(orderedIds)].filter((id) => available.has(id));
  }

  private moveSelection(direction: -1 | 1, orderedIds: readonly string[]): void {
    if (orderedIds.length === 0) {
      this.selection = { selected: [] };
      return;
    }

    const focus =
      this.selection.focus ??
      orderedIds.find((id) => this.selection.selected.includes(id));
    const focusIndex = focus === undefined ? -1 : orderedIds.indexOf(focus);
    const nextIndex =
      focusIndex < 0
        ? direction < 0
          ? orderedIds.length - 1
          : 0
        : Math.max(0, Math.min(orderedIds.length - 1, focusIndex + direction));
    const nextId = orderedIds[nextIndex]!;
    this.selection = reduceSelection(this.selection, {
      type: "replace",
      itemId: nextId,
    });
  }
}

export function createPasteboardState(
  input: PasteboardStateInput,
): PasteboardState {
  return new PasteboardState(input);
}
