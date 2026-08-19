import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { searchLocalSkills, type LocalSkill } from "@/lib/notebook-ai/localContext";
import type { AiSkillCommandAttrs } from "./referenceLookup";

interface DetectedCommand {
  query: string;
  range: Range;
}

const INACTIVE = { active: false, query: "", anchorRect: null as DOMRect | null, activeIndex: 0 };

/**
 * 当前 text node 内 `/query` 探测（与 @ 一致：任意位置，前一字符须为空白或行首）。
 * query 中不能有空白。
 */
export function parseSlashCommandBeforeCaret(beforeCaret: string): {
  query: string;
  slashIndex: number;
} | null {
  const slashIndex = beforeCaret.lastIndexOf("/");
  if (slashIndex === -1) return null;
  if (slashIndex > 0 && !/[\s\n]/.test(beforeCaret[slashIndex - 1])) return null;
  const query = beforeCaret.slice(slashIndex + 1);
  if (/\s/.test(query)) return null;
  return { query, slashIndex };
}

function detectCommandAtCaret(container: HTMLElement): DetectedCommand | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;
  const anchor = selection.anchorNode;
  if (!anchor || anchor.nodeType !== Node.TEXT_NODE || !container.contains(anchor)) return null;
  const beforeCaret = (anchor.textContent ?? "").slice(0, selection.anchorOffset);
  const parsed = parseSlashCommandBeforeCaret(beforeCaret);
  if (!parsed) return null;
  const range = document.createRange();
  range.setStart(anchor, parsed.slashIndex);
  range.setEnd(anchor, selection.anchorOffset);
  return { query: parsed.query, range };
}

/**
 * 零宽锚点：contenteditable=false 的 chip 两侧必须有文本节点，
 * 否则旧 Chromium（uTools）setStartAfter(chip) 后左右方向键光标不可见。
 * 序列化时会剥掉；视觉宽度为 0，不产生“假空格”。
 */
export const COMPOSER_CARET_ZWSP = "\u200B";

export function isComposerZwspOnlyText(text: string): boolean {
  return text.length > 0 && text.replace(/\u200B/g, "") === "";
}

export function stripComposerCaretZwsp(text: string): string {
  return text.replace(/\u200B/g, "");
}

function placeCaretInTextNode(textNode: Text, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const safe = Math.max(0, Math.min(offset, textNode.data.length));
  range.setStart(textNode, safe);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 规范单个 ZWSP 锚点：长度恒为 1。
 * 注意：ZWSP 有 offset 0/1 两个插入点但视觉相同；
 * 统一用 offset 0 表示「节点起始」，避免 ← 时多按一次（1→0）。
 */
function ensureSingleZwspText(text: Text): Text {
  text.data = COMPOSER_CARET_ZWSP;
  return text;
}

/** 光标放到 node 之后（落在真实文本或 ZWSP 锚点上，保证 caret 可见） */
export function placeCaretAfterNode(node: Node) {
  const parent = node.parentNode;
  if (!parent) return;
  const next = node.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE) {
    const text = next as Text;
    if (text.data.length > 0 && !isComposerZwspOnlyText(text.data)) {
      // 真实文字：贴在文字开头（chip 右侧槽）
      placeCaretInTextNode(text, 0);
      return;
    }
    // 纯 ZWSP：只用 offset 0，杜绝 0/1 双档
    ensureSingleZwspText(text);
    placeCaretInTextNode(text, 0);
    return;
  }
  const anchor = document.createTextNode(COMPOSER_CARET_ZWSP);
  parent.insertBefore(anchor, next);
  placeCaretInTextNode(anchor, 0);
}

/** 光标放到 node 之前（同样落在文本节点上） */
export function placeCaretBeforeNode(node: Node) {
  const parent = node.parentNode;
  if (!parent) return;
  const prev = node.previousSibling;
  if (prev && prev.nodeType === Node.TEXT_NODE) {
    const text = prev as Text;
    if (text.data.length > 0 && !isComposerZwspOnlyText(text.data)) {
      // 真实文字：贴在文字末尾（chip 左侧槽）
      placeCaretInTextNode(text, text.data.length);
      return;
    }
    // 纯 ZWSP：offset 0（与 after 侧同一套，相邻 chip 中间只有一个槽）
    ensureSingleZwspText(text);
    placeCaretInTextNode(text, 0);
    return;
  }
  const anchor = document.createTextNode(COMPOSER_CARET_ZWSP);
  parent.insertBefore(anchor, node);
  placeCaretInTextNode(anchor, 0);
}

const CHIP_SELECTOR =
  "[data-ai-mention-attrs], [data-ai-image-attrs], [data-ai-skill-attrs]";

function isChipElement(node: Node | null): node is HTMLElement {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).matches?.(CHIP_SELECTOR) === true
  );
}

/**
 * 合并相邻纯 ZWSP / 空文本，保证 chip 之间只有一个锚点槽。
 * 否则 ←→ 会在「看不见的空档」上连按多次。
 */
export function collapseComposerZwspNodes(editor: HTMLElement) {
  let node: ChildNode | null = editor.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      const raw = text.data;
      const onlyZwspOrEmpty =
        raw.length === 0 || isComposerZwspOnlyText(raw);
      if (onlyZwspOrEmpty && next && next.nodeType === Node.TEXT_NODE) {
        const nextText = next as Text;
        const nextOnly =
          nextText.data.length === 0 || isComposerZwspOnlyText(nextText.data);
        if (nextOnly) {
          // 合并为一个 ZWSP
          ensureSingleZwspText(text);
          nextText.remove();
          continue;
        }
      }
      if (raw.length === 0) {
        // 空节点：若两侧是 chip 则变成 ZWSP，否则删掉
        if (isChipElement(node.previousSibling) || isChipElement(next)) {
          ensureSingleZwspText(text);
        } else {
          text.remove();
          node = next;
          continue;
        }
      } else if (isComposerZwspOnlyText(raw) && raw !== COMPOSER_CARET_ZWSP) {
        ensureSingleZwspText(text);
      }
    }
    node = node.nextSibling;
  }
}

/**
 * 保证每个 chip 两侧有可落点的文本（相邻 chip 之间恰好一个 ZWSP）。
 * 插入 / 水合后调用，避免“只有 chip 时光标消失”，并去掉多余空档。
 */
export function ensureComposerCaretAnchors(editor: HTMLElement) {
  const chips = Array.from(
    editor.querySelectorAll<HTMLElement>(CHIP_SELECTOR),
  );
  for (const chip of chips) {
    const prev = chip.previousSibling;
    if (!prev) {
      editor.insertBefore(document.createTextNode(COMPOSER_CARET_ZWSP), chip);
    } else if (prev.nodeType === Node.TEXT_NODE) {
      const t = prev as Text;
      if (t.data.length === 0 || isComposerZwspOnlyText(t.data)) {
        ensureSingleZwspText(t);
      }
    } else if (isChipElement(prev)) {
      editor.insertBefore(document.createTextNode(COMPOSER_CARET_ZWSP), chip);
    }

    const next = chip.nextSibling;
    if (!next) {
      editor.appendChild(document.createTextNode(COMPOSER_CARET_ZWSP));
    } else if (next.nodeType === Node.TEXT_NODE) {
      const t = next as Text;
      if (t.data.length === 0 || isComposerZwspOnlyText(t.data)) {
        ensureSingleZwspText(t);
      }
    } else if (isChipElement(next)) {
      editor.insertBefore(document.createTextNode(COMPOSER_CARET_ZWSP), next);
    }
  }
  collapseComposerZwspNodes(editor);
}

/**
 * 左右方向键：一次按键跨过恰好一个 chip（原子跳）。
 * 解决 ZWSP offset 0/1 双档、双 ZWSP 导致「从 chip 缝跑到左侧要按 3 下」。
 * @returns true 表示已处理并应 preventDefault
 */
export function navigateComposerChipArrow(
  editor: HTMLElement,
  direction: "left" | "right",
  getChipBefore: (editor: HTMLElement) => HTMLElement | null,
  getChipAfter: (editor: HTMLElement) => HTMLElement | null,
): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (
    range.startContainer !== editor &&
    !editor.contains(range.startContainer)
  ) {
    return false;
  }

  // 真实文本中间：交给浏览器逐字移动
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent ?? "";
    if (!isComposerZwspOnlyText(text)) {
      if (direction === "left" && range.startOffset > 0) return false;
      if (direction === "right" && range.startOffset < text.length) {
        return false;
      }
    }
  }

  if (direction === "left") {
    const chip = getChipBefore(editor);
    if (!chip) return false;
    placeCaretBeforeNode(chip);
    return true;
  }

  const chip = getChipAfter(editor);
  if (!chip) return false;
  placeCaretAfterNode(chip);
  return true;
}

/** Skill chip：contentEditable=false，样式对齐 mention chip */
export function createSkillChipElement(
  attrs: AiSkillCommandAttrs,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.aiSkillAttrs = JSON.stringify(attrs);
  // 高度/行高/垂直对齐由 notebook-ai.css 与编辑器行高对齐；勿加 leading-none/h-*
  span.className =
    "ai-composer-chip inline-flex items-center justify-center rounded text-[11px] font-medium" +
    " bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] border border-border" +
    " cursor-pointer hover:bg-[var(--goose-interactive-hover)] select-none";
  span.textContent = `/${attrs.name}`;
  return span;
}

/** 去掉 contenteditable 里删 range 后残留的空文本节点（保留 ZWSP 锚点） */
export function pruneEmptyComposerTextNodes(editor: HTMLElement) {
  const remove: ChildNode[] = [];
  editor.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "") === "") {
      remove.push(node);
    }
  });
  remove.forEach((node) => node.parentNode?.removeChild(node));
}

function toSkillAttrs(skill: LocalSkill): AiSkillCommandAttrs {
  return {
    name: skill.name,
    path: skill.path,
    description: skill.description,
  };
}

export function useSkillCommands(options: {
  editorRef: RefObject<HTMLDivElement | null>;
  isComposingRef: RefObject<boolean>;
  enabled: boolean;
  onContentMutation: () => void;
}) {
  const { editorRef, isComposingRef, enabled, onContentMutation } = options;
  const lastDetectedRef = useRef<DetectedCommand | null>(null);
  const [command, setCommand] = useState(INACTIVE);
  const items = useMemo(
    () => (enabled && command.active ? searchLocalSkills(command.query) : []),
    [command.active, command.query, enabled],
  );
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const clearCommandState = useCallback(() => {
    lastDetectedRef.current = null;
    setCommand(INACTIVE);
  }, []);

  const detectCommand = useCallback(() => {
    if (!enabled) return clearCommandState();
    const editor = editorRef.current;
    if (!editor || isComposingRef.current) return;
    const detected = detectCommandAtCaret(editor);
    if (!detected) return clearCommandState();
    lastDetectedRef.current = detected;
    const rect = detected.range.getBoundingClientRect();
    setCommand((previous) => ({
      active: true,
      query: detected.query,
      anchorRect: rect.width || rect.height ? rect : editor.getBoundingClientRect(),
      activeIndex: detected.query === previous.query ? previous.activeIndex : 0,
    }));
  }, [clearCommandState, editorRef, enabled, isComposingRef]);

  const insertCommand = useCallback((skill: LocalSkill) => {
    const editor = editorRef.current;
    const detected = lastDetectedRef.current ?? (editor ? detectCommandAtCaret(editor) : null);
    clearCommandState();
    if (!editor || !detected) return;

    try {
      detected.range.deleteContents();
      // 间距靠 CSS；插入后用 ZWSP 锚点保证旧 Chromium 光标可见。
      const chip = createSkillChipElement(toSkillAttrs(skill));
      detected.range.insertNode(chip);
      pruneEmptyComposerTextNodes(editor);
      ensureComposerCaretAnchors(editor);
      editor.focus();
      placeCaretAfterNode(chip);
    } catch {
      return;
    }

    onContentMutation();
  }, [clearCommandState, editorRef, onContentMutation]);

  const handleCommandKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!command.active) return false;
    const currentItems = itemsRef.current;
    const count = Math.max(1, currentItems.length);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setCommand((previous) => ({ ...previous, activeIndex: (previous.activeIndex + delta + count) % count }));
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const skill = currentItems[command.activeIndex];
      if (!skill) {
        clearCommandState();
        return false;
      }
      event.preventDefault();
      insertCommand(skill);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearCommandState();
      return true;
    }
    return false;
  }, [clearCommandState, command.active, command.activeIndex, insertCommand]);

  return { command, items, detectCommand, insertCommand, handleCommandKeyDown, clearCommandState };
}
