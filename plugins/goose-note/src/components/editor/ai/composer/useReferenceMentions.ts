import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  type AiFileReferenceAttrs,
  type AiReferenceSuggestionItem,
} from "./referenceLookup";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import {
  ensureComposerCaretAnchors,
  placeCaretAfterNode,
  pruneEmptyComposerTextNodes,
} from "./useSkillCommands";

interface DetectedMention {
  query: string;
  range: Range;
}

interface MentionState {
  active: boolean;
  query: string;
  anchorRect: DOMRect | null;
  activeIndex: number;
}

interface UseReferenceMentionsOptions {
  editorRef: RefObject<HTMLDivElement | null>;
  isComposingRef: RefObject<boolean>;
  onContentMutation: () => void;
  onReferenceAdded?: (reference: AiFileReferenceAttrs) => void;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  referencePlacement?: "inline" | "external";
}

const INACTIVE_MENTION: MentionState = {
  active: false,
  query: "",
  anchorRect: null,
  activeIndex: 0,
};

function detectMentionAtCaret(container: HTMLElement): DetectedMention | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;

  const anchor = selection.anchorNode;
  if (!anchor || anchor.nodeType !== Node.TEXT_NODE) return null;
  if (!container.contains(anchor)) return null;

  const text = anchor.textContent ?? "";
  const offset = selection.anchorOffset;
  const beforeCaret = text.slice(0, offset);

  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex === -1) return null;

  if (atIndex > 0 && !/[\s\n]/.test(beforeCaret[atIndex - 1])) return null;

  const query = beforeCaret.slice(atIndex + 1);
  if (/[\s\n]/.test(query)) return null;

  const range = document.createRange();
  range.setStart(anchor, atIndex);
  range.setEnd(anchor, offset);

  return { query, range };
}

/** 解析 @ 菜单锚点；range 为空时退到 caret / 编辑器矩形，避免菜单飞到左上角。 */
function resolveMentionAnchorRect(
  range: Range,
  editor: HTMLElement,
): DOMRect {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return rect;
  }

  const clientRects = range.getClientRects();
  if (clientRects.length > 0) {
    const first = clientRects[0];
    if (first.width > 0 || first.height > 0) {
      return first;
    }
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const caretRect = selection.getRangeAt(0).getBoundingClientRect();
    if (caretRect.width > 0 || caretRect.height > 0) {
      return caretRect;
    }
  }

  return editor.getBoundingClientRect();
}

export function createChipElement(
  attrs: AiFileReferenceAttrs,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.aiMentionId = attrs.pageId;
  span.dataset.aiMentionAttrs = JSON.stringify(attrs);
  // 垂直对齐：chip 用 inline-flex + items-center；高度与行高由 notebook-ai.css 统一。
  // 高度/行高/垂直对齐由 notebook-ai.css 与编辑器行高对齐；勿加 leading-none/h-*
  span.className =
    "ai-composer-chip inline-flex items-center justify-center rounded text-[11px] font-medium" +
    " bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] border border-border" +
    " cursor-pointer hover:bg-[var(--goose-interactive-hover)] select-none";
  span.textContent = `@${attrs.titleSnapshot}`;
  return span;
}

export function useReferenceMentions({
  editorRef,
  isComposingRef,
  onContentMutation,
  onReferenceAdded,
  searchPages: searchPagesOverride,
  referencePlacement = "inline",
}: UseReferenceMentionsOptions) {
  const { searchPages } = useEditorPageContext();
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDetectedRef = useRef<DetectedMention | null>(null);
  const [mention, setMention] = useState<MentionState>(INACTIVE_MENTION);

  const mentionItems = useMemo(
    () =>
      mention.active
        ? (searchPagesOverride ?? searchPages)(mention.query).filter(
            (item) => !item.isFolder,
          )
        : [],
    [mention.active, mention.query, searchPages, searchPagesOverride],
  );

  // Keep a ref so keyboard handler always sees current items without stale closure
  const mentionItemsRef = useRef(mentionItems);
  useEffect(() => {
    mentionItemsRef.current = mentionItems;
  }, [mentionItems]);

  const clearMentionState = useCallback(() => {
    lastDetectedRef.current = null;
    setMention(INACTIVE_MENTION);
  }, []);

  const detectMention = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    if (isComposingRef.current) return;

    const detected = detectMentionAtCaret(el);
    if (detected) {
      lastDetectedRef.current = detected;
      const rect = resolveMentionAnchorRect(detected.range, el);
      setMention((prev) => ({
        active: true,
        query: detected.query,
        anchorRect: rect,
        activeIndex: detected.query !== prev.query ? 0 : prev.activeIndex,
      }));
    } else {
      lastDetectedRef.current = null;
      setMention((prev) => (prev.active ? INACTIVE_MENTION : prev));
    }
  }, [editorRef, isComposingRef]);

  const insertMention = useCallback(
    (item: AiReferenceSuggestionItem) => {
      const el = editorRef.current;
      if (!el) return;

      setMention(INACTIVE_MENTION);

      // Prefer the range captured at detection time — by the time we get here,
      // React may have re-rendered (popover mounting) and Chromium can reset the
      // live selection's anchor to the contenteditable container, which would
      // make a fresh detectMentionAtCaret() return null.
      const detected = lastDetectedRef.current ?? detectMentionAtCaret(el);
      lastDetectedRef.current = null;
      if (!detected) return;

      try {
        detected.range.deleteContents();
        if (referencePlacement === "inline") {
          // 间距靠 CSS；ZWSP 锚点保证旧 Chromium 光标可见。
          const chip = createChipElement(item);
          detected.range.insertNode(chip);
          pruneEmptyComposerTextNodes(el);
          ensureComposerCaretAnchors(el);
          // Focus BEFORE placing the cursor — calling focus() after addRange()
          // resets the selection in some browsers.
          el.focus();
          placeCaretAfterNode(chip);
        } else {
          // Notebook AI keeps page context outside the editable prompt, so the
          // typed @query is removed and the caret stays at that position.
          const caretRange = document.createRange();
          caretRange.setStart(
            detected.range.startContainer,
            detected.range.startOffset,
          );
          caretRange.collapse(true);
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(caretRange);
          }
        }
      } catch {
        return;
      }

      onContentMutation();
      onReferenceAdded?.(item);
    },
    [editorRef, onContentMutation, onReferenceAdded, referencePlacement],
  );

  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!mention.active) return false;

      const items = mentionItemsRef.current;
      const count = Math.max(1, items.length);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMention((prev) => ({
          ...prev,
          activeIndex: (prev.activeIndex + 1) % count,
        }));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMention((prev) => ({
          ...prev,
          activeIndex: (prev.activeIndex - 1 + count) % count,
        }));
        return true;
      }
      // Shift+Enter 留给 composer 做换行；仅普通 Enter 确认 @ 引用
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const item = items[mention.activeIndex];
        if (item) {
          insertMention(item);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(INACTIVE_MENTION);
        return true;
      }

      return false;
    },
    [mention.active, mention.activeIndex, insertMention],
  );

  const handleMentionBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      setMention(INACTIVE_MENTION);
    }, 150);
  }, []);

  const cancelMentionBlurTimer = useCallback(() => {
    if (blurTimerRef.current !== null) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, []);

  return {
    mention,
    mentionItems,
    detectMention,
    insertMention,
    handleMentionKeyDown,
    handleMentionBlur,
    cancelMentionBlurTimer,
    clearMentionState,
  };
}
