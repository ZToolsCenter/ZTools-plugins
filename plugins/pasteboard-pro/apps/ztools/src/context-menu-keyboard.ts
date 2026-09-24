type ContextMenuKeyboardEvent = Pick<KeyboardEvent, "key" | "stopPropagation">;

export function containContextMenuKeydown(
  event: ContextMenuKeyboardEvent,
  close: () => void,
): void {
  event.stopPropagation();
  if (event.key === "Escape") close();
}
