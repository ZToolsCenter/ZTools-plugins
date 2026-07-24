export type PasteStackDirection = "forward" | "reverse";

export type PasteStackState = {
  direction: PasteStackDirection;
  itemIds: string[];
};

export type PasteStackAction =
  | { type: "replace"; itemIds: readonly string[] }
  | { type: "append"; itemIds: readonly string[] }
  | { type: "consume" }
  | { type: "remove"; itemId: string }
  | { type: "set-direction"; direction: PasteStackDirection }
  | { type: "clear" };

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function reducePasteStack(
  state: PasteStackState,
  action: PasteStackAction,
): PasteStackState {
  const itemIds = uniqueIds(state.itemIds);

  switch (action.type) {
    case "replace":
      return { direction: state.direction, itemIds: uniqueIds(action.itemIds) };

    case "append": {
      const seen = new Set(itemIds);
      const appended = [...itemIds];

      for (const itemId of action.itemIds) {
        if (!seen.has(itemId)) {
          seen.add(itemId);
          appended.push(itemId);
        }
      }

      return { direction: state.direction, itemIds: appended };
    }

    case "consume":
      return {
        direction: state.direction,
        itemIds:
          state.direction === "forward" ? itemIds.slice(1) : itemIds.slice(0, -1),
      };

    case "remove":
      return {
        direction: state.direction,
        itemIds: itemIds.filter((itemId) => itemId !== action.itemId),
      };

    case "set-direction":
      return { direction: action.direction, itemIds };

    case "clear":
      return { direction: state.direction, itemIds: [] };
  }
}
