import { createExtension } from "@blocknote/core";
import { getEditorPlatform } from "@/components/editor/platform/context";
import type { EditorSettings } from "@/components/editor/platform/hostContext";
import type { MutableRefObject } from "react";
import { isImeKeyboardEvent } from "@/hooks/useImeInput";

type LinkShortcutEvent = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "defaultPrevented"
> &
  Partial<Pick<KeyboardEvent, "isComposing" | "keyCode" | "which">> & {
    nativeEvent?: Pick<KeyboardEvent, "isComposing" | "keyCode" | "which">;
  };

/** uTools Windows WebView 中不依赖 ProseMirror 缓存的平台判断，直接匹配实际按键。 */
export function isPrimaryLinkShortcutEvent(event: LinkShortcutEvent) {
  return (
    !event.defaultPrevented &&
    !isImeKeyboardEvent(event.nativeEvent ?? {}) &&
    !isImeKeyboardEvent(event) &&
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    (event.key.toLowerCase() === "k" || event.code === "KeyK")
  );
}

function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export const createGooseLinkKeyboardExtension = (
  settingsRef: MutableRefObject<EditorSettings>,
) =>
  createExtension({
    key: "goose-link-keyboard",
    keyboardShortcuts: {
      "Mod-k": ({ editor }) => {
        const url = editor.getSelectedLinkUrl();
        if (url) {
          editor.deleteLink();
          return true;
        }
        const selectedText = editor.getSelectedText();
        if (selectedText) {
          document.dispatchEvent(new CustomEvent("goose-open-link-popover"));
          return true;
        }
        return false;
      },
      "Alt-Enter": ({ editor }) => {
        const url = editor.getSelectedLinkUrl();
        if (url) {
          const target = normalizeExternalUrl(url);
          if (target) {
            // 动态读取 React Ref 里的最新设置，避免闭包捕获陈旧状态
            void getEditorPlatform().shell.openUrl(
              target,
              settingsRef.current.openLinksInHost,
            );
          }
          return true;
        }
        return false;
      },
    },
  });
