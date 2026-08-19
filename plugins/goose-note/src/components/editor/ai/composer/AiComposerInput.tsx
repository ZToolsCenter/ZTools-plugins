import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isImeKeyboardEvent } from "@/hooks/useImeInput";
import {
  type AiComposerPayload,
  type AiComposerToken,
  type AiFileReferenceAttrs,
  type AiImageAttachmentAttrs,
  type AiReferenceSuggestionItem,
  type AiSkillCommandAttrs,
} from "./referenceLookup";
import { ComposerSuggestionsList } from "@/components/editor/ai/composer/ComposerSuggestionsList";
import {
  createChipElement,
  useReferenceMentions,
} from "./useReferenceMentions";
import { useEditorPageContext } from "@/components/editor/platform/hostContext";
import { useSettings } from "@/stores/useSettings";
import {
  createSkillChipElement,
  ensureComposerCaretAnchors,
  isComposerZwspOnlyText,
  navigateComposerChipArrow,
  placeCaretAfterNode,
  placeCaretBeforeNode,
  pruneEmptyComposerTextNodes,
  stripComposerCaretZwsp,
  useSkillCommands,
} from "./useSkillCommands";
import { SkillSuggestionsList } from "./SkillSuggestionsList";
import type { JSONContent } from "@/types";
import {
  calculateImageSha256,
  ImageDedupTracker,
} from "./imageDedup";
import { warmLocalSkillsCache } from "@/lib/notebook-ai/localContext";
import { extractClipboardImageFiles } from "@/components/editor/utils/pasteClipboardImage";

/**
 * 是否允许在本次 input 里同步做 React setState / 写草稿 / 探测 @/。
 *
 * 微信输入法 + contenteditable + 旧 Chromium 的坑：
 * - 经常不发 compositionstart/end，只给 keyCode 229
 * - InputEvent.isComposing 也可能一直是 false
 * - 组合过程中任何 React 重渲染都可能卡死候选窗 / 整页
 */
export function shouldProcessComposerInput(options: {
  isComposingFlag: boolean;
  imeSessionActive?: boolean;
  inputEventIsComposing?: boolean;
}): boolean {
  return !(
    options.isComposingFlag ||
    options.imeSessionActive === true ||
    options.inputEventIsComposing === true
  );
}

/**
 * 非 IME 输入防抖：避免快打/连删时同步 setState + 扫 DOM + 写 uTools。
 * 注意：IME 会话绝不能靠短超时自动结束——选词窗停住时无按键，
 * 超时 flush 会在组合中 setState，微信输入法必卡。
 */
export const COMPOSER_INPUT_FLUSH_MS = 200;
/** 整行/全选删除、剪切等批量变更：更长防抖，等浏览器改完 DOM 再扫 */
export const COMPOSER_DELETE_FLUSH_MS = 350;
/** 有 chip 时自定义删除：再稍长一点，避开 contenteditable 内部慢路径 */
export const COMPOSER_CHIP_DELETE_FLUSH_MS = 400;

export const COMPOSER_CHIP_SELECTOR =
  "[data-ai-mention-attrs], [data-ai-image-attrs], [data-ai-skill-attrs]";

export function isComposerDeleteInputType(inputType: string | undefined) {
  if (!inputType) return false;
  return (
    inputType.startsWith("delete") ||
    inputType === "historyUndo" ||
    inputType === "historyRedo"
  );
}

export function isComposerChipElement(node: Node | null): node is HTMLElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;
  return (
    el.dataset.aiMentionAttrs != null ||
    el.dataset.aiImageAttrs != null ||
    el.dataset.aiSkillAttrs != null
  );
}

export function editorHasComposerChips(editor: HTMLElement): boolean {
  return Boolean(editor.querySelector(COMPOSER_CHIP_SELECTOR));
}

/** selection 是否覆盖编辑器全部内容（全选删除） */
export function selectionCoversEntireEditor(
  editor: HTMLElement,
  range: Range,
): boolean {
  try {
    const full = document.createRange();
    full.selectNodeContents(editor);
    return (
      range.compareBoundaryPoints(Range.START_TO_START, full) <= 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, full) >= 0
    );
  } catch {
    return false;
  }
}

/** 选区是否与任一 mention/image chip 相交 */
export function rangeContainsComposerChip(
  range: Range,
  editor?: HTMLElement | null,
): boolean {
  const root =
    editor ??
    (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement);
  if (!root) return false;
  const scope =
    (root.closest?.("[data-ai-composer-editor]") as HTMLElement | null) ??
    root;
  const chips = scope.querySelectorAll?.(COMPOSER_CHIP_SELECTOR);
  if (!chips) return false;
  for (const chip of chips) {
    try {
      if (range.intersectsNode(chip)) return true;
    } catch {
      // detached / invalid boundary
    }
  }
  return false;
}

function skipEmptyTextSiblings(
  node: Node | null,
  direction: "previous" | "next",
): Node | null {
  let current = node;
  while (current && current.nodeType === Node.TEXT_NODE) {
    const text = current.textContent ?? "";
    // 空节点或纯 ZWSP 锚点：对 chip 边界探测视为“无内容”
    if (text.length > 0 && !isComposerZwspOnlyText(text)) break;
    current =
      direction === "previous"
        ? current.previousSibling
        : current.nextSibling;
  }
  return current;
}

/** 折叠光标紧贴 chip 左侧边界时，返回该 chip（Backspace / ← 目标） */
export function getComposerChipBeforeCaret(
  editor: HTMLElement,
  range?: Range | null,
): HTMLElement | null {
  const live =
    range ??
    (window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : null);
  if (!live || !live.collapsed || !editor.contains(live.startContainer)) {
    return null;
  }
  const { startContainer, startOffset } = live;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? "";
    const onlyZwsp = isComposerZwspOnlyText(text);
    // 普通文本中间：不算紧贴 chip
    if (startOffset > 0 && !onlyZwsp) return null;
    // 纯 ZWSP 内任意 offset，或 offset===0：向左跳过空/ZWSP 找 chip
    let node: Node | null = startContainer;
    while (node && node !== editor) {
      const prev = skipEmptyTextSiblings(node.previousSibling, "previous");
      if (isComposerChipElement(prev)) return prev;
      if (prev) return null;
      node = node.parentNode;
    }
    return null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const el = startContainer as HTMLElement;
    let i = startOffset - 1;
    while (i >= 0) {
      const child = el.childNodes[i];
      if (isComposerChipElement(child)) return child;
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent ?? "";
        if (!t.length || isComposerZwspOnlyText(t)) {
          i -= 1;
          continue;
        }
      }
      return null;
    }
  }
  return null;
}

/** 折叠光标紧贴 chip 右侧边界时，返回该 chip（Delete / → 目标） */
export function getComposerChipAfterCaret(
  editor: HTMLElement,
  range?: Range | null,
): HTMLElement | null {
  const live =
    range ??
    (window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0)
      : null);
  if (!live || !live.collapsed || !editor.contains(live.startContainer)) {
    return null;
  }
  const { startContainer, startOffset } = live;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? "";
    const len = text.length;
    const onlyZwsp = isComposerZwspOnlyText(text);
    // 普通文本中间：不算紧贴 chip
    if (startOffset < len && !onlyZwsp) return null;
    let node: Node | null = startContainer;
    while (node && node !== editor) {
      const next = skipEmptyTextSiblings(node.nextSibling, "next");
      if (isComposerChipElement(next)) return next;
      if (next) return null;
      node = node.parentNode;
    }
    return null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const el = startContainer as HTMLElement;
    let i = startOffset;
    while (i < el.childNodes.length) {
      const child = el.childNodes[i];
      if (isComposerChipElement(child)) return child;
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent ?? "";
        if (!t.length || isComposerZwspOnlyText(t)) {
          i += 1;
          continue;
        }
      }
      return null;
    }
  }
  return null;
}

export type ComposerBeforeInputDeleteAction =
  | "ignore"
  | "clear-editor"
  | "delete-selection-chips"
  | "remove-chip-before"
  | "remove-chip-after";

/**
 * beforeinput 删除决策（纯函数，便于单测）。
 * IME 会话中必须 ignore，绝不自定义删。
 */
export function resolveComposerBeforeInputDelete(options: {
  inputType: string | undefined;
  imeActive: boolean;
  hasChips: boolean;
  selectionCoversEntire: boolean;
  rangeCollapsed: boolean;
  rangeContainsChip: boolean;
  chipBeforeCaret: boolean;
  chipAfterCaret: boolean;
}): ComposerBeforeInputDeleteAction {
  if (options.imeActive) return "ignore";
  if (!isComposerDeleteInputType(options.inputType)) return "ignore";
  if (!options.hasChips) return "ignore";

  if (options.selectionCoversEntire) return "clear-editor";

  if (!options.rangeCollapsed && options.rangeContainsChip) {
    return "delete-selection-chips";
  }

  if (options.rangeCollapsed) {
    const type = options.inputType ?? "";
    const backward =
      type === "deleteContentBackward" ||
      type === "deleteWordBackward" ||
      type === "deleteSoftLineBackward" ||
      type === "deleteHardLineBackward";
    const forward =
      type === "deleteContentForward" ||
      type === "deleteWordForward" ||
      type === "deleteSoftLineForward" ||
      type === "deleteHardLineForward";

    if (backward && options.chipBeforeCaret) return "remove-chip-before";
    if (forward && options.chipAfterCaret) return "remove-chip-after";
  }

  return "ignore";
}

function removeComposerChipsIntersectingRange(
  editor: HTMLElement,
  range: Range,
) {
  const chips = Array.from(
    editor.querySelectorAll<HTMLElement>(COMPOSER_CHIP_SELECTOR),
  );
  for (const chip of chips) {
    try {
      if (range.intersectsNode(chip)) {
        chip.remove();
      }
    } catch {
      // ignore
    }
  }
}

function placeCaretInEditor(editor: HTMLElement, atStart: boolean) {
  const selection = window.getSelection();
  if (!selection) return;
  const caret = document.createRange();
  caret.selectNodeContents(editor);
  caret.collapse(atStart);
  selection.removeAllRanges();
  selection.addRange(caret);
}

/** 是否已无文本且无 chip（只读 DOM，不建 token；ZWSP 锚点不算内容） */
function isEditorDomEmpty(el: HTMLElement) {
  if (el.querySelector(COMPOSER_CHIP_SELECTOR)) {
    return false;
  }
  return !stripComposerCaretZwsp(el.textContent ?? "").trim();
}

// ─── Image registry ─────────────────────────────────────────────────────────

/**
 * 内联图片的实体：chip 只携带可序列化 attrs，
 * 真实 File / previewUrl 由每个 composer 实例的注册表维护。
 */
export interface ComposerImageEntry {
  file: File;
  previewUrl: string;
}

export type ComposerImageRegistry = Map<string, ComposerImageEntry>;

/** hover 预览关闭延迟：从 chip 移到浮层时不闪断 */
const IMAGE_PREVIEW_HIDE_MS = 120;

function parseImageChipAttrs(
  chip: HTMLElement,
): AiImageAttachmentAttrs | null {
  try {
    return JSON.parse(
      chip.dataset.aiImageAttrs ?? "",
    ) as AiImageAttachmentAttrs;
  } catch {
    return null;
  }
}

/** 从事件目标解析可预览的 image chip；落在移除按钮上则视为不可预览 */
function getPreviewableImageChip(
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-ai-image-remove]")) return null;
  return target.closest<HTMLElement>("[data-ai-image-attrs]");
}

function createImagePreviewPortal(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "ai-composer-image-preview";
  el.dataset.aiImagePreviewPortal = "true";
  el.setAttribute("role", "img");
  el.setAttribute("aria-hidden", "true");
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
}

function positionImagePreview(preview: HTMLElement, chip: HTMLElement) {
  const rect = chip.getBoundingClientRect();
  const gap = 8;
  const pw = preview.offsetWidth;
  const ph = preview.offsetHeight;
  let left = rect.left + rect.width / 2 - pw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  let top = rect.top - ph - gap;
  if (top < 8) {
    top = rect.bottom + gap;
  }
  if (top + ph > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - ph - 8);
  }
  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function createImageChipElement(
  attrs: AiImageAttachmentAttrs,
  registry: ComposerImageRegistry,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.aiImageAttrs = JSON.stringify(attrs);
  // 高度/行高/垂直对齐由 notebook-ai.css 与编辑器行高对齐；勿加 leading-none/h-*
  span.className =
    "ai-composer-chip inline-flex items-center justify-center gap-1 rounded text-[11px] font-medium" +
    " bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] border border-border" +
    " select-none";

  const entry = registry.get(attrs.imageId);
  if (entry) {
    // 有预览 URL 时 chip 可 hover 预览
    span.classList.add("cursor-pointer");
    span.dataset.aiImagePreviewable = "true";
    const img = document.createElement("img");
    img.src = entry.previewUrl;
    img.alt = "";
    img.draggable = false;
    img.className = "ai-composer-chip-thumb h-3.5 w-3.5 shrink-0 rounded-[3px] object-cover";
    span.appendChild(img);
  }

  const label = document.createElement("span");
  label.className = "max-w-[140px] truncate leading-none";
  label.textContent = attrs.fileName;
  span.appendChild(label);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.dataset.aiImageRemove = attrs.imageId;
  removeBtn.setAttribute("aria-label", `移除图片 ${attrs.fileName}`);
  removeBtn.title = `移除 ${attrs.fileName}`;
  removeBtn.className =
    "ai-composer-chip-remove ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] cursor-pointer" +
    " text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground";
  removeBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  span.appendChild(removeBtn);

  return span;
}

function createImageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `img-${globalThis.crypto.randomUUID()}`;
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── DOM helpers ────────────────────────────────────────────────────────────

function readTokensFromDom(container: HTMLElement): AiComposerToken[] {
  const tokens: AiComposerToken[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // 剥掉光标锚点 ZWSP，避免进 prompt / 气泡
      const text = stripComposerCaretZwsp(node.textContent ?? "");
      if (text) tokens.push({ type: "text", text });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        tokens.push({ type: "text", text: "\n" });
      } else if (el.dataset.aiMentionAttrs) {
        try {
          const attrs = JSON.parse(
            el.dataset.aiMentionAttrs,
          ) as AiFileReferenceAttrs;
          tokens.push({ type: "reference", reference: attrs });
        } catch {
          // ignore malformed chip
        }
      } else if (el.dataset.aiImageAttrs) {
        try {
          const attrs = JSON.parse(
            el.dataset.aiImageAttrs,
          ) as AiImageAttachmentAttrs;
          tokens.push({ type: "image", image: attrs });
        } catch {
          // ignore malformed chip
        }
      } else if (el.dataset.aiSkillAttrs) {
        try {
          const attrs = JSON.parse(
            el.dataset.aiSkillAttrs,
          ) as AiSkillCommandAttrs;
          tokens.push({ type: "skill", skill: attrs });
        } catch {
          // ignore malformed chip
        }
      } else {
        el.childNodes.forEach(walk);
      }
    }
  }

  container.childNodes.forEach(walk);
  return tokens;
}

function buildPayloadFromTokens(tokens: AiComposerToken[]): AiComposerPayload {
  const references: AiFileReferenceAttrs[] = [];
  const images: AiImageAttachmentAttrs[] = [];
  const skills: AiSkillCommandAttrs[] = [];
  let promptText = "";
  let freeformText = "";

  for (const token of tokens) {
    if (token.type === "text") {
      promptText += token.text;
      freeformText += token.text;
    } else if (token.type === "reference") {
      references.push(token.reference);
      promptText += `@${token.reference.titleSnapshot}`;
    } else if (token.type === "image") {
      images.push(token.image);
      promptText += `[图片 ${token.image.fileName}]`;
    } else if (token.type === "skill") {
      skills.push(token.skill);
      // 与 @ 对称：chip 标签进 promptText，不进 freeformText
      promptText += `/${token.skill.name}`;
    }
  }

  return {
    promptText: promptText.trim(),
    freeformText: freeformText.trim(),
    references,
    images,
    skills,
    tokens,
  };
}

function buildJsonContentFromTokens(
  tokens: AiComposerToken[],
): JSONContent | null {
  if (!tokens.length) return null;

  const paragraphs: AiComposerToken[][] = [[]];

  for (const token of tokens) {
    if (token.type === "text") {
      const parts = token.text.split("\n");
      if (parts[0])
        paragraphs[paragraphs.length - 1].push({
          type: "text",
          text: parts[0],
        });
      for (let i = 1; i < parts.length; i++) {
        paragraphs.push([]);
        if (parts[i])
          paragraphs[paragraphs.length - 1].push({
            type: "text",
            text: parts[i],
          });
      }
    } else {
      paragraphs[paragraphs.length - 1].push(token);
    }
  }

  if (!paragraphs.some((p) => p.length > 0)) return null;

  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: line.map((token) => {
        if (token.type === "text") return { type: "text", text: token.text };
        if (token.type === "reference")
          return { type: "aiFileReference", attrs: token.reference };
        if (token.type === "skill")
          return { type: "aiSkillCommand", attrs: token.skill };
        return { type: "aiImageAttachment", attrs: token.image };
      }),
    })),
  };
}

function setDomFromJsonContent(
  container: HTMLElement,
  content: JSONContent | null | undefined,
  registry: ComposerImageRegistry,
) {
  container.innerHTML = "";
  if (!content?.content?.length) return;

  content.content.forEach((block: any, blockIdx: number) => {
    if (blockIdx > 0) container.appendChild(document.createElement("br"));
    (block.content ?? []).forEach((node: any) => {
      if (node.type === "text") {
        container.appendChild(document.createTextNode(node.text ?? ""));
      } else if (node.type === "aiFileReference" && node.attrs) {
        container.appendChild(
          createChipElement(node.attrs as AiFileReferenceAttrs),
        );
      } else if (node.type === "aiImageAttachment" && node.attrs) {
        container.appendChild(
          createImageChipElement(
            node.attrs as AiImageAttachmentAttrs,
            registry,
          ),
        );
      } else if (node.type === "aiSkillCommand" && node.attrs) {
        container.appendChild(
          createSkillChipElement(node.attrs as AiSkillCommandAttrs),
        );
      }
    });
  });
  // 水合后补 ZWSP 锚点，避免只有 chip 时光标不可见
  ensureComposerCaretAnchors(container);
}

/**
 * Scroll the contenteditable composer so the current caret stays in view.
 * Uses Selection/Range client rects and adjusts editor.scrollTop only
 * (avoids page-level scrollIntoView).
 */
function scrollComposerCaretIntoView(editor: HTMLElement): void {
  if (editor.scrollHeight <= editor.clientHeight + 1) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    editor.scrollTop = editor.scrollHeight;
    return;
  }

  const range = selection.getRangeAt(0);
  if (
    editor !== range.commonAncestorContainer &&
    !editor.contains(range.commonAncestorContainer)
  ) {
    return;
  }

  let caretTop: number | null = null;
  let caretBottom: number | null = null;

  const acceptRect = (rect: DOMRect | ClientRect): boolean => {
    // Collapsed carets often report 0×0 at (0,0) — treat as missing.
    if (
      rect.width === 0 &&
      rect.height === 0 &&
      rect.top === 0 &&
      rect.left === 0
    ) {
      return false;
    }
    caretTop = rect.top;
    caretBottom = rect.bottom;
    return true;
  };

  const rects = range.getClientRects();
  if (rects.length > 0) {
    acceptRect(rects[rects.length - 1]!);
  }
  if (caretTop === null) {
    acceptRect(range.getBoundingClientRect());
  }

  if (caretTop === null) {
    // Temporary marker when collapsed caret has no geometry (common after <br>).
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    marker.style.cssText =
      "display:inline-block;width:0;height:1em;padding:0;margin:0;border:0;overflow:hidden;vertical-align:baseline;";

    const probe = range.cloneRange();
    probe.collapse(true);
    probe.insertNode(marker);
    acceptRect(marker.getBoundingClientRect());
    const parent = marker.parentNode;
    parent?.removeChild(marker);
    try {
      parent?.normalize();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Range may be stale after DOM probe; fall through to scrollHeight.
    }
  }

  if (caretTop === null || caretBottom === null) {
    editor.scrollTop = editor.scrollHeight;
    return;
  }

  const editorRect = editor.getBoundingClientRect();
  const overflowBottom = caretBottom - editorRect.bottom;
  const overflowTop = editorRect.top - caretTop;

  if (overflowBottom > 0) {
    editor.scrollTop += overflowBottom;
  } else if (overflowTop > 0) {
    editor.scrollTop -= overflowTop;
  }
}

/**
 * Insert a soft line break into the contenteditable composer.
 * Prefer native insertLineBreak / insertText; fall back to a trailing-safe <br>.
 * A lone trailing <br> often fails to create a visible new line in Chromium.
 */
function insertComposerLineBreak(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  const selectionInsideEditor =
    selection.rangeCount > 0 &&
    (editor === selection.anchorNode ||
      editor.contains(selection.anchorNode));

  if (!selectionInsideEditor) {
    editor.focus();
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(endRange);
  }

  const finish = (ok: boolean): boolean => {
    if (ok) {
      // Layout after insert may not be flushed yet; scroll now and once after paint.
      scrollComposerCaretIntoView(editor);
      requestAnimationFrame(() => {
        scrollComposerCaretIntoView(editor);
      });
    }
    return ok;
  };

  try {
    if (document.execCommand("insertLineBreak")) return finish(true);
  } catch {
    // fall through
  }

  // whitespace-pre-wrap makes a real newline text node render correctly
  try {
    if (document.execCommand("insertText", false, "\n")) return finish(true);
  } catch {
    // fall through
  }

  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (
    editor !== range.commonAncestorContainer &&
    !editor.contains(range.commonAncestorContainer)
  ) {
    return false;
  }

  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);

  // Trailing <br> needs a following anchor node so the caret can sit on the new line
  if (!br.nextSibling) {
    const anchor = document.createElement("br");
    br.parentNode?.insertBefore(anchor, br.nextSibling);
  }

  const nextRange = document.createRange();
  nextRange.setStartAfter(br);
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return finish(true);
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface AiComposerInputHandle {
  focus: () => void;
  clear: () => void;
  getPayload: () => AiComposerPayload;
  /** 解析 payload 中的内联图片 token → 真实 File 附件，按出现顺序 */
  resolveImages: (payload: AiComposerPayload) => { file: File; previewUrl: string }[];
  /** 在光标处插入图片 chip（无光标时追加到末尾） */
  insertImages: (files: File[]) => void;
  /** 在光标处插入页面引用 chip（无光标时追加到末尾） */
  insertReference: (reference: AiFileReferenceAttrs) => void;
}

interface AiComposerInputProps {
  placeholder: string;
  placeholderOverlayText?: string;
  autoFocusToken: number;
  onSubmit: () => void;
  onEscape: () => void;
  initialContent?: JSONContent | null;
  onContentChange?: (content: JSONContent | null) => void;
  onIsEmptyChange?: (isEmpty: boolean) => void;
  onReferenceAdded?: (reference: AiFileReferenceAttrs) => void;
  searchPages?: (query: string) => AiReferenceSuggestionItem[];
  referencePlacement?: "inline" | "external";
  variant?: "compact" | "panel";
  compactWidthClass?: string;
  disabled?: boolean;
  /** 单张图片最大字节数，超出触发 onImageRejected */
  maxImageBytes?: number;
  /** 输入框内最多同时存在的图片数量，超出触发 onImageRejected */
  maxImageCount?: number;
  onImageRejected?: (message: string) => void;
}

export const AiComposerInput = forwardRef<
  AiComposerInputHandle,
  AiComposerInputProps
>(
  (
    {
      placeholder,
      placeholderOverlayText,
      autoFocusToken,
      onSubmit,
      onEscape,
      initialContent,
      onContentChange,
      onIsEmptyChange,
      onReferenceAdded,
      searchPages,
      referencePlacement = "inline",
      variant = "compact",
      compactWidthClass,
      disabled,
      maxImageBytes,
      maxImageCount,
      onImageRejected,
    },
    ref,
  ) => {
    const { onOpenPage } = useEditorPageContext();
    const readLocalSkills = useSettings((state) => state.ai.readLocalSkills);
    /**
     * contenteditable 必须命令式挂载：一旦由 React 调和 className/aria，
     * 微信输入法在字一多时必卡。host 只是空壳，真正编辑器永不走 reconcile。
     */
    const editorHostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);
    const placeholderRef = useRef<HTMLDivElement | null>(null);
    const nativeHandlersRef = useRef<{
      onBeforeInput: (event: Event) => void;
      onInput: (event: Event) => void;
      onKeyDown: (event: KeyboardEvent) => void;
      onClick: (event: MouseEvent) => void;
      onMouseOver: (event: MouseEvent) => void;
      onMouseOut: (event: MouseEvent) => void;
      onPaste: (event: ClipboardEvent) => void;
      onBlur: () => void;
      onCompositionStart: () => void;
      onCompositionEnd: () => void;
    } | null>(null);
    /** 标准 composition 标记 */
    const isComposingRef = useRef(false);
    /**
     * 微信输入法等：可能没有 composition 事件，靠 keyCode 229 维持会话。
     * 会话期间禁止任何 setState / 写 store。
     */
    const imeSessionRef = useRef(false);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushRafRef = useRef<number | null>(null);
    const pendingFlushRef = useRef(false);
    const isEmptyRef = useRef(true);
    // Track the most recent content we emitted upward so we can ignore the echo
    // back via `initialContent` — otherwise the sync useEffect rebuilds the DOM
    // on every keystroke, invalidating the live selection and any cached ranges.
    const lastEmittedContentRef = useRef<JSONContent | null | undefined>(
      initialContent,
    );
    // imageId → { file, previewUrl }；chip 只携带可序列化 attrs
    const imageRegistryRef = useRef<ComposerImageRegistry>(new Map());
    const imageDedupRef = useRef(new ImageDedupTracker());
    /** body 级图片 hover 预览浮层（命令式，非 React） */
    const imagePreviewElRef = useRef<HTMLDivElement | null>(null);
    const imagePreviewHideTimerRef = useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
    const activePreviewImageIdRef = useRef<string | null>(null);
    const activePreviewChipRef = useRef<HTMLElement | null>(null);

    const [isEmpty, setIsEmpty] = useState(true);

    /** 占位符只用 DOM 显隐，避免 IME 中途 setState 触发 React 重渲染 */
    const setPlaceholderVisible = useCallback((visible: boolean) => {
      const node = placeholderRef.current;
      if (!node) return;
      node.style.display = visible ? "" : "none";
    }, []);

    const syncEmptyState = useCallback(
      (empty: boolean) => {
        setPlaceholderVisible(empty);
        if (isEmptyRef.current === empty) return;
        isEmptyRef.current = empty;
        setIsEmpty(empty);
        onIsEmptyChange?.(empty);
      },
      [onIsEmptyChange, setPlaceholderVisible],
    );

    const countImageTokens = useCallback((): number => {
      const el = editorRef.current;
      if (!el) return 0;
      return readTokensFromDom(el).filter((token) => token.type === "image")
        .length;
    }, []);

    const gcStaleImages = useCallback((liveIds: Set<string>) => {
      const activeId = activePreviewImageIdRef.current;
      // 被 GC 的图片若正在预览，直接关掉浮层（不依赖后方 hideImagePreview 声明顺序）
      if (activeId && !liveIds.has(activeId)) {
        if (imagePreviewHideTimerRef.current != null) {
          clearTimeout(imagePreviewHideTimerRef.current);
          imagePreviewHideTimerRef.current = null;
        }
        activePreviewImageIdRef.current = null;
        activePreviewChipRef.current = null;
        const preview = imagePreviewElRef.current;
        if (preview) {
          preview.style.display = "none";
          preview.replaceChildren();
          preview.setAttribute("aria-hidden", "true");
        }
      }
      imageRegistryRef.current.forEach((entry, imageId) => {
        if (liveIds.has(imageId)) return;
        URL.revokeObjectURL(entry.previewUrl);
        imageRegistryRef.current.delete(imageId);
        imageDedupRef.current.release(imageId);
      });
    }, []);

    const emitCurrentContent = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;

      // 整行删光：轻量路径，避免全量 walk + 同帧 setState 堆在 delete 后面
      if (isEditorDomEmpty(el)) {
        syncEmptyState(true);
        if (lastEmittedContentRef.current != null) {
          lastEmittedContentRef.current = null;
          onContentChange?.(null);
        }
        // 图片 GC 放到空闲时段，别堵删除
        const registry = imageRegistryRef.current;
        if (registry.size > 0) {
          const runGc = () => {
            // 清空前关掉预览，避免 blob URL 已 revoke 仍挂着
            if (imagePreviewHideTimerRef.current != null) {
              clearTimeout(imagePreviewHideTimerRef.current);
              imagePreviewHideTimerRef.current = null;
            }
            activePreviewImageIdRef.current = null;
            activePreviewChipRef.current = null;
            const preview = imagePreviewElRef.current;
            if (preview) {
              preview.style.display = "none";
              preview.replaceChildren();
              preview.setAttribute("aria-hidden", "true");
            }
            registry.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
            registry.clear();
            imageDedupRef.current.clear();
          };
          if (typeof requestIdleCallback === "function") {
            requestIdleCallback(runGc, { timeout: 800 });
          } else {
            setTimeout(runGc, 0);
          }
        }
        return;
      }

      const tokens = readTokensFromDom(el);
      const liveIds = new Set(
        tokens
          .filter((token) => token.type === "image")
          .map((token) => token.image.imageId),
      );
      // 删除后的 GC 异步做，减少主线程尖峰
      if (liveIds.size < imageRegistryRef.current.size) {
        const snapshot = new Set(liveIds);
        const runGc = () => gcStaleImages(snapshot);
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(runGc, { timeout: 800 });
        } else {
          setTimeout(runGc, 0);
        }
      }

      const payload = buildPayloadFromTokens(tokens);
      const empty =
        payload.promptText.length === 0 &&
        payload.references.length === 0 &&
        payload.images.length === 0 &&
        payload.skills.length === 0;
      syncEmptyState(empty);
      const nextContent = buildJsonContentFromTokens(tokens);
      lastEmittedContentRef.current = nextContent;
      onContentChange?.(nextContent);
    }, [onContentChange, syncEmptyState, gcStaleImages]);

    const {
      mention,
      mentionItems,
      detectMention,
      insertMention,
      handleMentionKeyDown,
      handleMentionBlur,
      cancelMentionBlurTimer,
      clearMentionState,
    } = useReferenceMentions({
      editorRef,
      isComposingRef,
      onContentMutation: emitCurrentContent,
      onReferenceAdded,
      searchPages,
      referencePlacement,
    });

    const {
      command,
      items: commandItems,
      detectCommand,
      insertCommand,
      handleCommandKeyDown,
      clearCommandState,
    } = useSkillCommands({
      editorRef,
      isComposingRef,
      enabled: readLocalSkills,
      onContentMutation: emitCurrentContent,
    });

    const flushComposerSideEffects = useCallback(() => {
      pendingFlushRef.current = false;
      const el = editorRef.current;
      // 先探测 @ /，再 emit，避免菜单被内容同步拖慢
      if (el && !isEditorDomEmpty(el)) {
        detectMention();
        detectCommand();
      } else {
        clearMentionState();
        clearCommandState();
      }
      emitCurrentContent();
    }, [
      emitCurrentContent,
      detectMention,
      detectCommand,
      clearMentionState,
      clearCommandState,
    ]);

    const cancelFlushTimer = useCallback(() => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
    }, []);

    const cancelDetectTimer = useCallback(() => {
      if (detectTimerRef.current != null) {
        clearTimeout(detectTimerRef.current);
        detectTimerRef.current = null;
      }
    }, []);

    /**
     * 仅探测 @ / Skill，不写 store。输入 `/` `@` 时用短延迟立刻开菜单，
     * 完整内容 emit 仍走 scheduleFlush 防抖。
     */
    const scheduleDetectOnly = useCallback(
      (delayMs: number) => {
        cancelDetectTimer();
        detectTimerRef.current = setTimeout(() => {
          detectTimerRef.current = null;
          if (imeSessionRef.current || isComposingRef.current) return;
          const el = editorRef.current;
          if (!el || isEditorDomEmpty(el)) {
            clearMentionState();
            clearCommandState();
            return;
          }
          detectMention();
          detectCommand();
        }, delayMs);
      },
      [
        cancelDetectTimer,
        clearMentionState,
        clearCommandState,
        detectMention,
        detectCommand,
      ],
    );

    /**
     * 防抖 + 双 rAF：删除整行时浏览器先改 DOM，我们等布局稳定再扫，
     * 避免和 contenteditable 内部删除抢主线程。
     */
    const scheduleFlush = useCallback(
      (delayMs: number) => {
        cancelFlushTimer();
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          if (imeSessionRef.current || isComposingRef.current) {
            pendingFlushRef.current = true;
            return;
          }
          flushRafRef.current = requestAnimationFrame(() => {
            flushRafRef.current = requestAnimationFrame(() => {
              flushRafRef.current = null;
              if (imeSessionRef.current || isComposingRef.current) {
                pendingFlushRef.current = true;
                return;
              }
              flushComposerSideEffects();
            });
          });
        }, delayMs);
      },
      [cancelFlushTimer, flushComposerSideEffects],
    );

    /**
     * 开启 IME 会话：期间禁止一切 setState / 写 store。
     * 只由 compositionend、非 229 按键、blur 结束——绝不用短超时，
     * 否则选词窗停住时会中途 setState，微信输入法直接卡死。
     */
    const touchImeSession = useCallback(() => {
      imeSessionRef.current = true;
      isComposingRef.current = true;
      pendingFlushRef.current = true;
      cancelFlushTimer();
      setPlaceholderVisible(false);
    }, [cancelFlushTimer, setPlaceholderVisible]);

    const endImeSession = useCallback(() => {
      if (!imeSessionRef.current && !isComposingRef.current) {
        if (pendingFlushRef.current) scheduleFlush(0);
        return;
      }
      imeSessionRef.current = false;
      isComposingRef.current = false;
      // 延后一拍 flush，避开选词提交与 React 同帧
      scheduleFlush(0);
    }, [scheduleFlush]);

    useEffect(() => {
      return () => {
        cancelFlushTimer();
        cancelDetectTimer();
      };
    }, [cancelFlushTimer, cancelDetectTimer]);

    // 空闲预热本地 Skill 列表，避免首次输入 `/` 同步读盘卡住
    useEffect(() => {
      if (!readLocalSkills) return;
      const warm = () => {
        try {
          warmLocalSkillsCache();
        } catch {
          // 预热失败不影响输入
        }
      };
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(warm, { timeout: 1500 });
        return () => cancelIdleCallback(id);
      }
      const timer = setTimeout(warm, 0);
      return () => clearTimeout(timer);
    }, [readLocalSkills]);

    // ── image helpers ────────────────────────────────────────────────────────

    const cancelImagePreviewHide = useCallback(() => {
      if (imagePreviewHideTimerRef.current != null) {
        clearTimeout(imagePreviewHideTimerRef.current);
        imagePreviewHideTimerRef.current = null;
      }
    }, []);

    const hideImagePreview = useCallback(() => {
      cancelImagePreviewHide();
      activePreviewImageIdRef.current = null;
      activePreviewChipRef.current = null;
      const preview = imagePreviewElRef.current;
      if (!preview) return;
      preview.style.display = "none";
      preview.replaceChildren();
      preview.removeAttribute("aria-label");
      preview.setAttribute("aria-hidden", "true");
    }, [cancelImagePreviewHide]);

    const scheduleHideImagePreview = useCallback(() => {
      cancelImagePreviewHide();
      imagePreviewHideTimerRef.current = setTimeout(() => {
        imagePreviewHideTimerRef.current = null;
        hideImagePreview();
      }, IMAGE_PREVIEW_HIDE_MS);
    }, [cancelImagePreviewHide, hideImagePreview]);

    const showImagePreview = useCallback(
      (chip: HTMLElement, imageId: string, previewUrl: string, fileName: string) => {
        cancelImagePreviewHide();
        activePreviewImageIdRef.current = imageId;
        activePreviewChipRef.current = chip;

        const preview = imagePreviewElRef.current;
        // portal 在 editor mount 时创建；卸载后不再展示
        if (!preview?.isConnected) return;

        let img = preview.querySelector("img");
        if (!img) {
          img = document.createElement("img");
          img.alt = "";
          img.draggable = false;
          preview.appendChild(img);
        }
        if (img.src !== previewUrl) {
          img.src = previewUrl;
        }
        img.alt = fileName || "图片预览";
        preview.setAttribute("aria-label", `预览 ${fileName || "图片"}`);
        preview.removeAttribute("aria-hidden");
        preview.style.visibility = "hidden";
        preview.style.display = "block";

        const place = () => {
          if (activePreviewImageIdRef.current !== imageId) return;
          if (!activePreviewChipRef.current?.isConnected) {
            hideImagePreview();
            return;
          }
          positionImagePreview(preview, activePreviewChipRef.current);
          preview.style.visibility = "visible";
        };

        if (img.complete && img.naturalWidth > 0) {
          place();
        } else {
          img.onload = () => place();
          // 即便 onload 失败也先按当前尺寸放一次
          place();
        }
      },
      [cancelImagePreviewHide, hideImagePreview],
    );

    const releaseAllImages = useCallback(() => {
      hideImagePreview();
      imageRegistryRef.current.forEach((entry) =>
        URL.revokeObjectURL(entry.previewUrl),
      );
      imageRegistryRef.current.clear();
      imageDedupRef.current.clear();
    }, [hideImagePreview]);

    const removeImageChip = useCallback(
      (imageId: string) => {
        if (activePreviewImageIdRef.current === imageId) {
          hideImagePreview();
        }
        const el = editorRef.current;
        const chip = el
          ?.querySelector<HTMLElement>(`[data-ai-image-remove="${imageId}"]`)
          ?.closest("[data-ai-image-attrs]");
        const entry = imageRegistryRef.current.get(imageId);
        if (entry) {
          URL.revokeObjectURL(entry.previewUrl);
          imageRegistryRef.current.delete(imageId);
        }
        imageDedupRef.current.release(imageId);
        if (chip?.parentNode) {
          chip.parentNode.removeChild(chip);
          emitCurrentContent();
        }
      },
      [emitCurrentContent, hideImagePreview],
    );

    const insertImages = useCallback(
      (files: File[]) => {
        const el = editorRef.current;
        if (!el || files.length === 0) return;

        const currentCount = countImageTokens();
        const capacity =
          maxImageCount !== undefined
            ? Math.max(0, maxImageCount - currentCount)
            : files.length;

        if (capacity <= 0) {
          onImageRejected?.(`每次最多添加 ${maxImageCount} 张图片。`);
          return;
        }

        const accepted: { file: File; attrs: AiImageAttachmentAttrs }[] = [];
        let oversized = 0;
        let duplicates = 0;
        for (const file of files) {
          if (accepted.length >= capacity) break;
          if (maxImageBytes !== undefined && file.size > maxImageBytes) {
            oversized += 1;
            continue;
          }

          const attrs: AiImageAttachmentAttrs = {
            imageId: createImageId(),
            fileName: file.name || "图片",
            mediaType: file.type || "image/*",
            size: file.size,
          };
          if (!imageDedupRef.current.claim(attrs.imageId, file)) {
            duplicates += 1;
            continue;
          }
          accepted.push({ file, attrs });
        }

        if (oversized > 0) {
          onImageRejected?.(
            `有 ${oversized} 张图片超过 ${Math.round(maxImageBytes! / 1024 / 1024)}MB，未添加。`,
          );
        }
        if (duplicates > 0) {
          onImageRejected?.(`有 ${duplicates} 张重复图片，未添加。`);
        }
        if (accepted.length === 0) return;
        if (accepted.length < files.length - oversized - duplicates) {
          onImageRejected?.(`已添加 ${accepted.length} 张图片。`);
        }

        // 确保 selection 落在编辑器内（否则追加到末尾）
        const selection = window.getSelection();
        const inside =
          selection &&
          selection.rangeCount > 0 &&
          (el === selection.anchorNode || el.contains(selection.anchorNode));
        if (!inside) {
          el.focus();
          const endRange = document.createRange();
          endRange.selectNodeContents(el);
          endRange.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(endRange);
        }

        const range = window.getSelection()!.getRangeAt(0);
        range.deleteContents();

        // Spacing via CSS margin on .ai-composer-chip; no spacer text nodes.
        const frag = document.createDocumentFragment();
        let lastChip: HTMLSpanElement | null = null;
        for (const { file, attrs } of accepted) {
          imageRegistryRef.current.set(attrs.imageId, {
            file,
            previewUrl: URL.createObjectURL(file),
          });
          lastChip = createImageChipElement(attrs, imageRegistryRef.current);
          frag.appendChild(lastChip);
        }
        range.insertNode(frag);
        pruneEmptyComposerTextNodes(el);
        ensureComposerCaretAnchors(el);

        if (lastChip) {
          // 落在 ZWSP/文本节点上，旧 Chromium 才能画出 caret
          placeCaretAfterNode(lastChip);
        }

        emitCurrentContent();

        for (const { file, attrs } of accepted) {
          void calculateImageSha256(file).then((contentHash) => {
            if (!contentHash || !imageDedupRef.current.has(attrs.imageId)) return;
            const duplicateId = imageDedupRef.current.resolveContentHash(
              attrs.imageId,
              contentHash,
            );
            if (!duplicateId) return;
            removeImageChip(duplicateId);
            onImageRejected?.("检测到重复图片，已移除后加入的图片。");
          });
        }
      },
      [
        countImageTokens,
        emitCurrentContent,
        maxImageBytes,
        maxImageCount,
        onImageRejected,
        removeImageChip,
      ],
    );

    const insertReference = useCallback(
      (reference: AiFileReferenceAttrs) => {
        const el = editorRef.current;
        if (!el) return;

        const selection = window.getSelection();
        const inside =
          selection &&
          selection.rangeCount > 0 &&
          (el === selection.anchorNode || el.contains(selection.anchorNode));
        if (!inside) {
          el.focus();
          const endRange = document.createRange();
          endRange.selectNodeContents(el);
          endRange.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(endRange);
        }

        const range = window.getSelection()!.getRangeAt(0);
        range.deleteContents();

        // 间距靠 CSS；ZWSP 锚点保证旧 Chromium 光标可见。
        const chip = createChipElement(reference);
        range.insertNode(chip);
        pruneEmptyComposerTextNodes(el);
        ensureComposerCaretAnchors(el);
        placeCaretAfterNode(chip);

        emitCurrentContent();
      },
      [emitCurrentContent],
    );

    // ── imperative handle ────────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = editorRef.current;
          if (!el) return;
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        },
        clear: () => {
          const el = editorRef.current;
          if (!el) return;
          el.innerHTML = "";
          lastEmittedContentRef.current = null;
          releaseAllImages();
          setPlaceholderVisible(true);
          isEmptyRef.current = true;
          setIsEmpty(true);
          clearMentionState();
          clearCommandState();
          onIsEmptyChange?.(true);
          onContentChange?.(null);
        },
        getPayload: (): AiComposerPayload => {
          const el = editorRef.current;
          if (!el)
            return {
              promptText: "",
              freeformText: "",
              references: [],
              images: [],
              skills: [],
              tokens: [],
            };
          return buildPayloadFromTokens(readTokensFromDom(el));
        },
        resolveImages: (payload: AiComposerPayload) =>
          payload.images
            .map((attrs) => {
              const entry = imageRegistryRef.current.get(attrs.imageId);
              return entry ? { file: entry.file, previewUrl: entry.previewUrl } : null;
            })
            .filter(
              (item): item is { file: File; previewUrl: string } => item !== null,
            ),
        insertImages,
        insertReference,
      }),
      [
        clearMentionState,
        clearCommandState,
        onIsEmptyChange,
        onContentChange,
        releaseAllImages,
        insertImages,
        insertReference,
        setPlaceholderVisible,
      ],
    );

    // ── unmount: release object URLs + 预览浮层 ──────────────────────────────

    useEffect(() => {
      const registry = imageRegistryRef.current;
      const dedup = imageDedupRef.current;
      return () => {
        if (imagePreviewHideTimerRef.current != null) {
          clearTimeout(imagePreviewHideTimerRef.current);
          imagePreviewHideTimerRef.current = null;
        }
        const preview = imagePreviewElRef.current;
        if (preview?.isConnected) {
          preview.remove();
        }
        imagePreviewElRef.current = null;
        activePreviewImageIdRef.current = null;
        activePreviewChipRef.current = null;
        registry.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
        registry.clear();
        dedup.clear();
      };
    }, []);

    // ── sync initialContent → DOM ────────────────────────────────────────────

    useEffect(() => {
      // Skip the echo of our own emission — the DOM is already up to date and
      // rebuilding it would wipe the live text node our cached range points at.
      if (initialContent === lastEmittedContentRef.current) return;
      lastEmittedContentRef.current = initialContent;
      const el = editorRef.current;
      if (!el) return;
      setDomFromJsonContent(el, initialContent, imageRegistryRef.current);
      const tokens = readTokensFromDom(el);
      const empty = buildPayloadFromTokens(tokens).promptText.length === 0;
      setIsEmpty(empty);
      onIsEmptyChange?.(empty);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialContent]);

    // ── auto-focus ───────────────────────────────────────────────────────────

    useEffect(() => {
      if (autoFocusToken > 0) editorRef.current?.focus();
    }, [autoFocusToken]);

    // ── native input / keyboard（挂到命令式节点上，不经 React 合成事件） ──

    /**
     * 有 chip 时拦截原生删除：旧 Chromium 对 contenteditable=false 节点
     * 走 deleteByCut / 跨边界删除极易卡死。IME 会话绝不拦截。
     */
    const handleBeforeInputNative = useCallback(
      (event: Event) => {
        const native = event as InputEvent;
        const inputType = native.inputType ?? "";
        if (!isComposerDeleteInputType(inputType)) return;

        const imeActive =
          imeSessionRef.current ||
          isComposingRef.current ||
          native.isComposing === true ||
          inputType === "deleteCompositionText" ||
          inputType === "deleteByComposition";

        const el = editorRef.current;
        if (!el) return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer) && el !== range.commonAncestorContainer) {
          // 选区不在编辑器内
          if (!el.contains(range.startContainer)) return;
        }

        const hasChips = editorHasComposerChips(el);
        const coversEntire = selectionCoversEntireEditor(el, range);
        const containsChip = rangeContainsComposerChip(range, el);
        const chipBefore = getComposerChipBeforeCaret(el, range);
        const chipAfter = getComposerChipAfterCaret(el, range);

        const action = resolveComposerBeforeInputDelete({
          inputType,
          imeActive,
          hasChips,
          selectionCoversEntire: coversEntire,
          rangeCollapsed: range.collapsed,
          rangeContainsChip: containsChip,
          chipBeforeCaret: Boolean(chipBefore),
          chipAfterCaret: Boolean(chipAfter),
        });

        if (action === "ignore") return;

        event.preventDefault();

        if (action === "clear-editor") {
          el.innerHTML = "";
          placeCaretInEditor(el, true);
          setPlaceholderVisible(true);
          scheduleFlush(COMPOSER_CHIP_DELETE_FLUSH_MS);
          return;
        }

        if (action === "delete-selection-chips") {
          removeComposerChipsIntersectingRange(el, range);
          try {
            // chip 摘掉后再删文本；包 try 防 range 失效
            if (!range.collapsed) range.deleteContents();
          } catch {
            // ignore
          }
          setPlaceholderVisible(isEditorDomEmpty(el));
          scheduleFlush(COMPOSER_CHIP_DELETE_FLUSH_MS);
          return;
        }

        if (action === "remove-chip-before" && chipBefore) {
          chipBefore.remove();
          setPlaceholderVisible(isEditorDomEmpty(el));
          scheduleFlush(COMPOSER_CHIP_DELETE_FLUSH_MS);
          return;
        }

        if (action === "remove-chip-after" && chipAfter) {
          chipAfter.remove();
          setPlaceholderVisible(isEditorDomEmpty(el));
          scheduleFlush(COMPOSER_CHIP_DELETE_FLUSH_MS);
        }
      },
      [scheduleFlush, setPlaceholderVisible],
    );

    const handleInputNative = useCallback(
      (event: Event) => {
        const native = event as InputEvent;
        const inputType = native.inputType ?? "";
        // 组合态删除仍属 IME，不能当普通 delete 去 flush
        const looksLikeImeInput =
          native.isComposing === true ||
          inputType === "insertCompositionText" ||
          inputType === "deleteCompositionText" ||
          inputType === "insertFromComposition" ||
          inputType === "deleteByComposition";

        if (looksLikeImeInput) {
          touchImeSession();
          return;
        }

        if (
          !shouldProcessComposerInput({
            isComposingFlag: isComposingRef.current,
            imeSessionActive: imeSessionRef.current,
            inputEventIsComposing: native.isComposing,
          })
        ) {
          pendingFlushRef.current = true;
          return;
        }

        // 只动 DOM 占位，不 setState；整行删光立刻显示占位
        const el = editorRef.current;
        if (el && isEditorDomEmpty(el)) {
          setPlaceholderVisible(true);
          clearMentionState();
          clearCommandState();
          scheduleFlush(COMPOSER_DELETE_FLUSH_MS);
          return;
        }
        setPlaceholderVisible(false);
        const isDelete = isComposerDeleteInputType(inputType);
        const deleteDelay =
          el && editorHasComposerChips(el)
            ? COMPOSER_CHIP_DELETE_FLUSH_MS
            : COMPOSER_DELETE_FLUSH_MS;
        scheduleFlush(isDelete ? deleteDelay : COMPOSER_INPUT_FLUSH_MS);
        // 非删除：立刻探测 @ /，菜单不跟 200ms 内容防抖绑死
        if (!isDelete) {
          scheduleDetectOnly(0);
        }
      },
      [
        scheduleFlush,
        scheduleDetectOnly,
        setPlaceholderVisible,
        touchImeSession,
        clearMentionState,
        clearCommandState,
      ],
    );

    const handleKeyDownNative = useCallback(
      (event: KeyboardEvent) => {
        if (isImeKeyboardEvent(event)) {
          touchImeSession();
          return;
        }

        if (isComposingRef.current || imeSessionRef.current) {
          endImeSession();
          if (event.key === "Escape") {
            event.preventDefault();
            onEscape();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
            return;
          }
        }

        // mention/command 仍吃 React 风格事件；用最小 shim 复用现有逻辑
        const reactLike = {
          key: event.key,
          shiftKey: event.shiftKey,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
          nativeEvent: event,
        } as unknown as React.KeyboardEvent<HTMLDivElement>;

        if (handleMentionKeyDown(reactLike)) return;
        if (handleCommandKeyDown(reactLike)) return;

        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
          return;
        }

        // 左右方向键：一次跨过一个 chip（原子跳），避免 ZWSP 双档/双锚点连按 3 下。
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.ctrlKey
        ) {
          const el = editorRef.current;
          if (el && editorHasComposerChips(el)) {
            const handled = navigateComposerChipArrow(
              el,
              event.key === "ArrowLeft" ? "left" : "right",
              getComposerChipBeforeCaret,
              getComposerChipAfterCaret,
            );
            if (handled) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }

        if (event.key !== "Enter") return;

        if (event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          const el = editorRef.current;
          if (!el) return;
          if (insertComposerLineBreak(el)) {
            scheduleFlush(0);
          }
          return;
        }

        cancelFlushTimer();
        flushComposerSideEffects();
        event.preventDefault();
        onSubmit();
      },
      [
        handleMentionKeyDown,
        handleCommandKeyDown,
        onSubmit,
        onEscape,
        touchImeSession,
        endImeSession,
        scheduleFlush,
        cancelFlushTimer,
        flushComposerSideEffects,
      ],
    );

    const handleClickNative = useCallback(
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const removeBtn = target.closest<HTMLElement>("[data-ai-image-remove]");
        if (removeBtn) {
          event.preventDefault();
          // 移除前先关预览，避免悬空浮层
          hideImagePreview();
          removeImageChip(removeBtn.dataset.aiImageRemove!);
          return;
        }
        const mentionChip = target.closest<HTMLElement>("[data-ai-mention-id]");
        const mentionId = mentionChip?.dataset.aiMentionId;
        if (mentionId) {
          event.preventDefault();
          onOpenPage(mentionId);
        }
      },
      [hideImagePreview, onOpenPage, removeImageChip],
    );

    /** 图片 chip hover 预览：委托到 contenteditable，remove 按钮区域不触发 */
    const handleImagePreviewOver = useCallback(
      (event: MouseEvent) => {
        const chip = getPreviewableImageChip(event.target);
        if (!chip || chip.dataset.aiImagePreviewable !== "true") {
          // 移入 remove 按钮：若当前在同 chip 上预览则关闭
          if (
            event.target instanceof Element &&
            event.target.closest("[data-ai-image-remove]")
          ) {
            scheduleHideImagePreview();
          }
          return;
        }
        const attrs = parseImageChipAttrs(chip);
        if (!attrs) return;
        const entry = imageRegistryRef.current.get(attrs.imageId);
        if (!entry?.previewUrl) return;
        if (activePreviewImageIdRef.current === attrs.imageId) {
          cancelImagePreviewHide();
          return;
        }
        showImagePreview(chip, attrs.imageId, entry.previewUrl, attrs.fileName);
      },
      [cancelImagePreviewHide, scheduleHideImagePreview, showImagePreview],
    );

    const handleImagePreviewOut = useCallback(
      (event: MouseEvent) => {
        const related = event.relatedTarget;
        // 仍在同一 chip 内（除 remove 外）或进入预览浮层：保持
        if (related instanceof Node) {
          const preview = imagePreviewElRef.current;
          if (preview?.contains(related)) {
            cancelImagePreviewHide();
            return;
          }
          const fromChip = getPreviewableImageChip(event.target);
          const toChip = getPreviewableImageChip(related);
          if (fromChip && toChip && fromChip === toChip) {
            cancelImagePreviewHide();
            return;
          }
        }
        if (activePreviewImageIdRef.current) {
          scheduleHideImagePreview();
        }
      },
      [cancelImagePreviewHide, scheduleHideImagePreview],
    );

    const handleBlurNative = useCallback(() => {
      endImeSession();
      handleMentionBlur();
      clearCommandState();
      // 失焦时关掉图片预览，避免浮层悬空
      hideImagePreview();
    }, [endImeSession, handleMentionBlur, clearCommandState, hideImagePreview]);

    /**
     * 焦点在 contenteditable 内时粘贴：命令式节点不走 React 冒泡时 dock onPaste 可能丢。
     * Mac 截图常只有 clipboardData.items，此处与 dock 共用 extractClipboardImageFiles。
     */
    const handlePasteNative = useCallback(
      (event: ClipboardEvent) => {
        if (disabled) return;
        const imageFiles = extractClipboardImageFiles(event.clipboardData);
        if (imageFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        insertImages(imageFiles);
      },
      [disabled, insertImages],
    );

    // 始终指向最新 handler，mount 时只绑一次原生监听
    nativeHandlersRef.current = {
      onBeforeInput: handleBeforeInputNative,
      onInput: handleInputNative,
      onKeyDown: handleKeyDownNative,
      onClick: handleClickNative,
      onMouseOver: handleImagePreviewOver,
      onMouseOut: handleImagePreviewOut,
      onPaste: handlePasteNative,
      onBlur: handleBlurNative,
      onCompositionStart: () => {
        touchImeSession();
      },
      onCompositionEnd: () => {
        endImeSession();
      },
    };

    // ── 命令式创建 contenteditable（生命周期内不销毁，避免 React 改属性） ──

    useLayoutEffect(() => {
      const host = editorHostRef.current;
      if (!host || editorRef.current) return;

      const el = document.createElement("div");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-label", "AI 输入");
      el.setAttribute("aria-multiline", "true");
      el.dataset.aiComposerEditor = "true";
      el.dataset.aiComposerVariant = variant;
      el.spellcheck = false;
      // 类名只写一次；之后禁用态用 classList 改，不整段替换
      el.className = [
        "block w-full bg-transparent p-0 text-foreground outline-none",
        "overflow-y-auto break-words whitespace-pre-wrap",
        variant === "panel"
          ? "min-h-[24px] max-h-[144px] text-[13px] leading-6"
          : "min-h-[20px] max-h-[88px] text-[12px] leading-[20px]",
      ].join(" ");
      el.contentEditable = "true";

      const onBeforeInput = (event: Event) =>
        nativeHandlersRef.current?.onBeforeInput(event);
      const onInput = (event: Event) =>
        nativeHandlersRef.current?.onInput(event);
      const onKeyDown = (event: KeyboardEvent) =>
        nativeHandlersRef.current?.onKeyDown(event);
      const onClick = (event: MouseEvent) =>
        nativeHandlersRef.current?.onClick(event);
      const onMouseOver = (event: MouseEvent) =>
        nativeHandlersRef.current?.onMouseOver(event);
      const onMouseOut = (event: MouseEvent) =>
        nativeHandlersRef.current?.onMouseOut(event);
      const onBlur = () => nativeHandlersRef.current?.onBlur();
      const onPaste = (event: ClipboardEvent) =>
        nativeHandlersRef.current?.onPaste(event);
      const onCompositionStart = () =>
        nativeHandlersRef.current?.onCompositionStart();
      const onCompositionEnd = () =>
        nativeHandlersRef.current?.onCompositionEnd();

      // 预览浮层：进入时取消关闭，离开时延迟关闭（每实例独立 portal）
      const previewEl = createImagePreviewPortal();
      imagePreviewElRef.current = previewEl;
      const onPreviewEnter = () => {
        if (imagePreviewHideTimerRef.current != null) {
          clearTimeout(imagePreviewHideTimerRef.current);
          imagePreviewHideTimerRef.current = null;
        }
      };
      const onPreviewLeave = () => {
        if (imagePreviewHideTimerRef.current != null) {
          clearTimeout(imagePreviewHideTimerRef.current);
        }
        imagePreviewHideTimerRef.current = setTimeout(() => {
          imagePreviewHideTimerRef.current = null;
          const preview = imagePreviewElRef.current;
          if (!preview) return;
          preview.style.display = "none";
          preview.replaceChildren();
          preview.setAttribute("aria-hidden", "true");
          activePreviewImageIdRef.current = null;
          activePreviewChipRef.current = null;
        }, IMAGE_PREVIEW_HIDE_MS);
      };

      el.addEventListener("beforeinput", onBeforeInput);
      el.addEventListener("input", onInput);
      el.addEventListener("keydown", onKeyDown);
      el.addEventListener("click", onClick);
      el.addEventListener("mouseover", onMouseOver);
      el.addEventListener("mouseout", onMouseOut);
      el.addEventListener("paste", onPaste);
      el.addEventListener("blur", onBlur);
      el.addEventListener("compositionstart", onCompositionStart);
      el.addEventListener("compositionend", onCompositionEnd);
      previewEl.addEventListener("mouseenter", onPreviewEnter);
      previewEl.addEventListener("mouseleave", onPreviewLeave);

      host.appendChild(el);
      editorRef.current = el;

      // 首次种子（若有）
      if (lastEmittedContentRef.current) {
        setDomFromJsonContent(
          el,
          lastEmittedContentRef.current,
          imageRegistryRef.current,
        );
        const tokens = readTokensFromDom(el);
        const payload = buildPayloadFromTokens(tokens);
        const empty =
          payload.promptText.length === 0 &&
          payload.references.length === 0 &&
          payload.images.length === 0 &&
          payload.skills.length === 0;
        setPlaceholderVisible(empty);
        isEmptyRef.current = empty;
        setIsEmpty(empty);
      }

      return () => {
        el.removeEventListener("beforeinput", onBeforeInput);
        el.removeEventListener("input", onInput);
        el.removeEventListener("keydown", onKeyDown);
        el.removeEventListener("click", onClick);
        el.removeEventListener("mouseover", onMouseOver);
        el.removeEventListener("mouseout", onMouseOut);
        el.removeEventListener("paste", onPaste);
        el.removeEventListener("blur", onBlur);
        el.removeEventListener("compositionstart", onCompositionStart);
        el.removeEventListener("compositionend", onCompositionEnd);
        previewEl.removeEventListener("mouseenter", onPreviewEnter);
        previewEl.removeEventListener("mouseleave", onPreviewLeave);
        if (imagePreviewHideTimerRef.current != null) {
          clearTimeout(imagePreviewHideTimerRef.current);
          imagePreviewHideTimerRef.current = null;
        }
        // 仅当本实例持有该 portal 时移除，避免多 composer 互相拆掉
        if (imagePreviewElRef.current === previewEl) {
          previewEl.remove();
          imagePreviewElRef.current = null;
        }
        activePreviewImageIdRef.current = null;
        activePreviewChipRef.current = null;
        el.remove();
        editorRef.current = null;
      };
      // variant 固定按实例；禁止依赖变化重建节点
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // disabled 只改属性，不重建节点、不碰 className 整串
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      el.contentEditable = disabled ? "false" : "true";
      el.setAttribute("aria-disabled", disabled ? "true" : "false");
      el.classList.toggle("cursor-not-allowed", Boolean(disabled));
      el.classList.toggle("opacity-60", Boolean(disabled));
    }, [disabled]);

    return (
      <div
        className={cn(
          "relative min-w-0 flex-1",
          variant === "panel" ? "w-full px-0" : compactWidthClass,
        )}
      >
        {placeholderOverlayText || placeholder ? (
          <div
            ref={placeholderRef}
            className={cn(
              "pointer-events-none absolute left-0 right-0 z-[1] text-muted-foreground opacity-70",
              variant === "panel"
                ? "top-0 line-clamp-3 text-[13px] leading-6"
                : "top-0 pr-8 text-[12px] leading-[20px]",
            )}
            style={isEmpty ? undefined : { display: "none" }}
          >
            {placeholderOverlayText ?? placeholder}
          </div>
        ) : null}

        {/* 空壳：真正 contenteditable 在 useLayoutEffect 里 append，React 永不 reconcile 它 */}
        <div ref={editorHostRef} className="relative min-w-0" />

        {mention.active && mention.anchorRect ? (
          <ComposerSuggestionsList
            items={mentionItems}
            activeIndex={mention.activeIndex}
            listKey={mention.query}
            anchorRect={mention.anchorRect}
            onSelect={insertMention}
            onMouseDownCapture={cancelMentionBlurTimer}
          />
        ) : null}

        {command.active && command.anchorRect ? (
          <SkillSuggestionsList
            items={commandItems}
            activeIndex={command.activeIndex}
            listKey={command.query}
            anchorRect={command.anchorRect}
            onSelect={insertCommand}
          />
        ) : null}
      </div>
    );
  },
);

AiComposerInput.displayName = "AiComposerInput";
