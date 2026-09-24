export type SelectionState = {
  selected: string[];
  anchor?: string;
  focus?: string;
};

export type SelectionAction =
  | { type: "replace"; itemId: string }
  | { type: "toggle"; itemId: string }
  | {
      type: "extend";
      orderedIds: readonly string[];
      direction: -1 | 1;
    }
  | {
      type: "restore";
      orderedIds: readonly string[];
      fallbackId?: string;
    }
  | { type: "select-all"; orderedIds: readonly string[] }
  | { type: "clear" };

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function selectedState(
  selected: string[],
  anchor: string,
  focus: string,
): SelectionState {
  return { selected, anchor, focus };
}

export function reduceSelection(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case "replace":
      return selectedState([action.itemId], action.itemId, action.itemId);

    case "toggle": {
      if (!state.selected.includes(action.itemId)) {
        return selectedState(
          uniqueIds([...state.selected, action.itemId]),
          action.itemId,
          action.itemId,
        );
      }

      const remaining = uniqueIds(
        state.selected.filter((id) => id !== action.itemId),
      );
      if (remaining.length === 0) {
        return { selected: [] };
      }

      const firstRemaining = remaining[0]!;
      const anchor =
        state.anchor !== undefined && remaining.includes(state.anchor)
          ? state.anchor
          : firstRemaining;
      const focus =
        state.focus !== undefined && remaining.includes(state.focus)
          ? state.focus
          : firstRemaining;

      return selectedState(remaining, anchor, focus);
    }

    case "extend": {
      const orderedIds = uniqueIds(action.orderedIds);
      if (orderedIds.length === 0) {
        return { selected: [] };
      }

      const orderedSet = new Set(orderedIds);
      const selectedInOrder = state.selected.find((id) => orderedSet.has(id));
      const firstOrdered = orderedIds[0]!;
      const anchor =
        state.anchor !== undefined && orderedSet.has(state.anchor)
          ? state.anchor
          : state.focus !== undefined && orderedSet.has(state.focus)
            ? state.focus
            : (selectedInOrder ?? firstOrdered);
      const focus =
        state.focus !== undefined && orderedSet.has(state.focus)
          ? state.focus
          : anchor;
      const focusIndex = orderedIds.indexOf(focus);
      const nextFocusIndex = Math.max(
        0,
        Math.min(orderedIds.length - 1, focusIndex + action.direction),
      );
      const nextFocus = orderedIds[nextFocusIndex]!;
      const anchorIndex = orderedIds.indexOf(anchor);
      const rangeStart = Math.min(anchorIndex, nextFocusIndex);
      const rangeEnd = Math.max(anchorIndex, nextFocusIndex);

      const range = orderedIds.slice(rangeStart, rangeEnd + 1);
      return selectedState(
        nextFocusIndex < anchorIndex ? range.reverse() : range,
        anchor,
        nextFocus,
      );
    }

    case "restore": {
      const orderedIds = uniqueIds(action.orderedIds);
      const orderedSet = new Set(orderedIds);
      const retained = uniqueIds(state.selected).filter((id) => orderedSet.has(id));

      if (retained.length > 0) {
        const firstRetained = retained[0]!;
        const anchor =
          state.anchor !== undefined && retained.includes(state.anchor)
            ? state.anchor
            : firstRetained;
        const focus =
          state.focus !== undefined && retained.includes(state.focus)
            ? state.focus
            : firstRetained;

        return selectedState(retained, anchor, focus);
      }

      if (
        action.fallbackId !== undefined &&
        orderedIds.includes(action.fallbackId)
      ) {
        return selectedState(
          [action.fallbackId],
          action.fallbackId,
          action.fallbackId,
        );
      }

      return { selected: [] };
    }

    case "select-all": {
      const orderedIds = uniqueIds(action.orderedIds);
      if (orderedIds.length === 0) {
        return { selected: [] };
      }

      return selectedState(
        orderedIds,
        orderedIds[0]!,
        orderedIds[orderedIds.length - 1]!,
      );
    }

    case "clear":
      return { selected: [] };
  }
}
