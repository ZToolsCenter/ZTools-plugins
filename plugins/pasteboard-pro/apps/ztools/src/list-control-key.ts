export type ListControlKeyboardEvent = Readonly<{
  key: string;
  metaKey: boolean;
  altKey: boolean;
}>;

export function shouldResumeListControl(
  event: ListControlKeyboardEvent,
): boolean {
  if (event.metaKey || event.altKey) return false;
  return isListNavigationKey(event.key) || event.key === "Enter";
}

export function isListNavigationKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}
