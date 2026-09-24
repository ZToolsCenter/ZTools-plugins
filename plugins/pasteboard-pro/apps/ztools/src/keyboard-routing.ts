export type ShelfKeyboardTarget = Readonly<{
  nativeControl: boolean;
  listCard: boolean;
}>;

export type ShelfKeyboardRoute = "native-control" | "list-card" | undefined;

/**
 * Keeps Enter/Space on buttons and menu items native while routing card
 * activation through the single window-level list state machine.
 */
export function shelfKeyboardRoute(
  key: string,
  target: ShelfKeyboardTarget,
): ShelfKeyboardRoute {
  if (key !== "Enter" && key !== " ") return undefined;
  if (target.nativeControl) return "native-control";
  if (target.listCard) return "list-card";
  return undefined;
}
