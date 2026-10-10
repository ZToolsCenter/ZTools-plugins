import { hasAnyCommandModifier } from "./platform-shortcuts";

export type ListControlKeyboardEvent = Readonly<{
  key: string;
  metaKey: boolean;
  ctrlKey?: boolean;
  altKey: boolean;
}>;

export function shouldResumeListControl(
  event: ListControlKeyboardEvent,
): boolean {
  if (hasAnyCommandModifier(event)) return false;
  return isListNavigationKey(event.key) || event.key === "Enter";
}

export function isListNavigationKey(key: string): boolean {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key);
}
