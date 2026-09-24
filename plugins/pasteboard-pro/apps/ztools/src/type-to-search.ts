export type TypeToSearchKeyboardEvent = Readonly<{
  key: string;
  isComposing: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}>;

export function queryAfterTypeToSearch(
  currentQuery: string,
  event: TypeToSearchKeyboardEvent,
): string | undefined {
  if (
    event.isComposing ||
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return undefined;
  }
  if (event.key === "Backspace") return currentQuery.slice(0, -1);
  if (event.key.length !== 1) return undefined;
  return `${currentQuery}${event.key}`;
}
