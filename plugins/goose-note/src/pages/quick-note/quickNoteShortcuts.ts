import type { QuickNoteSlot } from "@/stores/useQuickNote";
import { getPlatformKind } from "@/lib/utils";

interface QuickNoteSlotShortcutEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

interface QuickNoteShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** 原生表单和非正文 contenteditable 保留浏览器自己的编辑快捷键。 */
export function shouldQuickNoteEditableTargetOwnShortcut(
  target: QuickNoteShortcutTarget | null,
) {
  if (!target) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "")) {
    return true;
  }
  if (target.closest?.(".bn-editor")) return false;
  return target.isContentEditable === true;
}

export function isWindowsQuickNotePlatform(): boolean {
  return getPlatformKind() === "windows";
}

export function getQuickNoteSlotShortcut(
  event: QuickNoteSlotShortcutEvent,
  isWindows = isWindowsQuickNotePlatform(),
): QuickNoteSlot | null {
  if (event.shiftKey || event.repeat || event.isComposing) return null;

  const codeMatch = /^Digit([1-5])$/.exec(event.code);
  const keyMatch = /^([1-5])$/.exec(event.key);
  const slotText = codeMatch?.[1] ?? keyMatch?.[1];
  if (!slotText) return null;

  const commandShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
  const windowsAltShortcut =
    isWindows && event.altKey && !event.metaKey && !event.ctrlKey;
  if (!commandShortcut && !windowsAltShortcut) return null;

  return Number(slotText) as QuickNoteSlot;
}
