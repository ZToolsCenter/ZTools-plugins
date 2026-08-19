import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type InlineCodeBoundaryEdge = "start" | "end";
export type InlineCodeBoundaryPhase = "inside" | "outside";

export type InlineCodeBoundaryState = {
  edge: InlineCodeBoundaryEdge;
  phase: InlineCodeBoundaryPhase;
  pos: number;
} | null;

export type InlineCodeBoundaryArrowAction =
  | "advance"
  | "enter"
  | "exit"
  | "to-inside"
  | "to-outside";

type InlineCodeCaret = {
  code: HTMLElement;
  textAfterCaret: string;
  textBeforeCaret: string;
  textNode: Text;
};

type VisualCaretHandle = {
  caret: InlineCodeCaret;
  code: HTMLElement;
  destroy: () => void;
  edge: InlineCodeBoundaryEdge;
  phase: InlineCodeBoundaryPhase;
};

const PLUGIN_KEY = new PluginKey<InlineCodeBoundaryState>(
  "goose-inline-code-boundary-navigation",
);

function getParentElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentElement;
}

function firstTextNode(element: HTMLElement): Text | null {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  return walker.nextNode() as Text | null;
}

function inlineCodeCaretAtDocumentPosition(
  view: EditorView,
  pos: number,
  textBeforeCaret: string,
): InlineCodeCaret | null {
  for (const bias of [-1, 1] as const) {
    const domPosition = view.domAtPos(pos, bias);
    const candidates = [
      domPosition.node,
      domPosition.node.childNodes[domPosition.offset] ?? null,
      domPosition.node.childNodes[domPosition.offset - 1] ?? null,
    ];

    for (const node of candidates) {
      const parent = getParentElement(node);
      const code = parent?.closest("code");
      if (!(code instanceof HTMLElement)) continue;
      if (!view.dom.contains(code)) continue;
      if (!code.closest(".bn-inline-content") || code.closest("pre")) continue;

      const textNode = firstTextNode(code);
      if (textNode) {
        return {
          code,
          textAfterCaret: code.textContent?.slice(textBeforeCaret.length) ?? "",
          textBeforeCaret,
          textNode,
        };
      }
    }
  }

  return null;
}

function segmentGraphemes(text: string): string[] {
  if (!text) return [];

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity: "grapheme" },
      ) => {
        segment: (value: string) => Iterable<{ segment: string }>;
      };
    }
  ).Segmenter;

  if (Segmenter) {
    const segments = new Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(text);
    const values: string[] = [];
    for (const value of segments) values.push(value.segment);
    return values;
  }

  // 旧版 uTools Chromium 没有 Intl.Segmenter 时，至少正确处理代理对字符。
  return Array.from(text);
}

function hasGraphemeCount(text: string, expectedCount: number): boolean {
  if (expectedCount < 1) return false;
  return segmentGraphemes(text).length === expectedCount;
}

export function edgeGraphemeLength(
  text: string,
  edge: InlineCodeBoundaryEdge,
): number {
  const graphemes = segmentGraphemes(text);
  if (graphemes.length === 0) return 0;
  const grapheme =
    edge === "start" ? graphemes[0] : graphemes[graphemes.length - 1];
  return grapheme?.length ?? 0;
}

export function isSingleGrapheme(text: string): boolean {
  return hasGraphemeCount(text, 1);
}

export function isTwoGraphemes(text: string): boolean {
  return hasGraphemeCount(text, 2);
}

export function resolveHeldInlineCodeBoundary(
  heldBoundary: InlineCodeBoundaryState,
  visualEdge: InlineCodeBoundaryEdge | null,
  visualPhase: InlineCodeBoundaryPhase | null,
  domEdge: InlineCodeBoundaryEdge | null,
  selectionPos: number,
): Exclude<InlineCodeBoundaryState, null> | null {
  if (!visualEdge || !visualPhase) return null;

  if (
    heldBoundary?.edge === visualEdge &&
    heldBoundary.phase === visualPhase &&
    (heldBoundary.pos === selectionPos ||
      (heldBoundary.phase === "inside" && domEdge === heldBoundary.edge))
  ) {
    return heldBoundary;
  }

  // uTools 旧 Chromium 可能把 code 内末端重新映射到相邻的
  // ProseMirror 位置，导致 edge state 被清空。真实 DOM 光标仍在
  // 同一视觉边界时，恢复该状态以完成第二次方向键。
  if (!heldBoundary && domEdge === visualEdge) {
    return { edge: visualEdge, phase: "inside", pos: selectionPos };
  }

  return null;
}

export function heldInlineCodeBoundaryArrowAction(
  edge: InlineCodeBoundaryEdge,
  phase: InlineCodeBoundaryPhase,
  direction: "left" | "right",
): InlineCodeBoundaryArrowAction {
  if (edge === "end" && phase === "outside") {
    return direction === "right" ? "advance" : "to-inside";
  }
  if (edge === "end" && direction === "right") return "to-outside";
  return edge === "start" && direction === "left" ? "exit" : "enter";
}

/**
 * 右边界退出时的两阶段语义（不依赖 visual caret 是否仍挂着）。
 *
 * - inside / 无 held：第一次右键 → to-outside
 * - outside held：第二次右键 → advance 进入后续正文
 * - 已在 code|plain 边界外侧（无 DOM code caret）：直接 advance
 */
export function inlineCodeEndRightArrowAction(options: {
  heldPhase: InlineCodeBoundaryPhase | null;
  domAtCodeEnd: boolean;
  atCodePlainBoundary: boolean;
}): "advance" | "to-outside" | null {
  const { heldPhase, domAtCodeEnd, atCodePlainBoundary } = options;

  // held 优先：outside 丢失 DOM 时仍可 advance；inside 在旧内核重映射后仍 to-outside
  if (heldPhase === "outside") return "advance";
  if (heldPhase === "inside") return "to-outside";
  if (domAtCodeEnd) return "to-outside";
  if (atCodePlainBoundary) return "advance";
  return null;
}

/**
 * 点击落在「code 结束 | 后续 plain」文档边界时，优先外侧（不进 code）。
 * 左边界 code 起点不在此处理，避免破坏从左侧点入。
 */
export function preferOutsideInlineCodeEndClick(options: {
  nodeBeforeHasCode: boolean;
  nodeAfterHasCode: boolean;
  nodeAfterIsText: boolean;
}): boolean {
  return (
    options.nodeBeforeHasCode &&
    !options.nodeAfterHasCode &&
    options.nodeAfterIsText
  );
}

/**
 * 点击/松手后是否要把光标钉在 code 右缘外侧。
 *
 * 旧 Chromium / ProseMirror selectionToDOM 会把「code 结束 | 后续 plain」
 * 同一个文档位置画回 <code> 内末端。本地文件夹里常见 ` (`server`) `
 * 这种「芯片 + 标点」，mousedown 光标在外侧，mouseup 就被吸进去。
 *
 * - 文档已在 code|plain 边界：钉外侧
 * - DOM 已被映到 code 文本末端，且点击 X 落在内容右缘或更右（含 padding）：钉外侧
 * - 点在末字符上（X 仍在内容盒内）：不钉，允许进 code 编辑
 */
export function shouldForceCaretOutsideInlineCodeEnd(options: {
  atCodePlainBoundary: boolean;
  domAtCodeEnd: boolean;
  clientX: number | null;
  contentRight: number | null;
  codeRight: number | null;
}): boolean {
  if (options.atCodePlainBoundary) return true;
  if (!options.domAtCodeEnd) return false;
  if (options.clientX === null) return false;
  const threshold = options.contentRight ?? options.codeRight;
  if (threshold === null) return false;
  return options.clientX >= threshold;
}

/** mouseup 时 PM 选区可能仍是按下前的旧位置，优先用点击坐标反查的 pos。 */
export function resolveMouseupInlineCodePos(
  selectionPos: number,
  coordsPos: number | null | undefined,
): number {
  return typeof coordsPos === "number" ? coordsPos : selectionPos;
}

/**
 * 一行里多颗行内代码时，命中「左缘不超过点击 X、右缘最近」的那颗。
 * 避免 `glob` + `server` 同行时把松手纠正应用到左侧芯片。
 */
export function pickInlineCodeChipIndexForEndClick(
  chips: Array<{ left: number; right: number }>,
  clientX: number,
): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    if (clientX < chip.left) continue;
    const dist = Math.abs(chip.right - clientX);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

export function adjacentInlineCodeTextIndex(
  codeIndexes: number[],
  textNodeCount: number,
  direction: "after" | "before",
): number | null {
  if (codeIndexes.length === 0) return null;
  const index = direction === "after"
    ? codeIndexes[codeIndexes.length - 1] + 1
    : codeIndexes[0] - 1;
  return index >= 0 && index < textNodeCount ? index : null;
}

/**
 * 读取浏览器当前的真实 DOM 光标位置。
 *
 * ProseMirror 会把「code 内首字符前」和「code 外左侧」映射到同一个文档位置，
 * 因此这里必须保留 DOM 侧信息，不能只看 TextSelection.from。
 */
export function getInlineCodeCaret(
  selection: Selection | null,
  editorDom: HTMLElement,
): InlineCodeCaret | null {
  if (
    !selection ||
    !selection.isCollapsed ||
    !selection.anchorNode ||
    selection.anchorNode !== selection.focusNode ||
    selection.anchorOffset !== selection.focusOffset
  ) {
    return null;
  }

  const parent = getParentElement(selection.anchorNode);
  const code = parent?.closest("code");
  if (!(code instanceof HTMLElement)) return null;
  if (!editorDom.contains(code)) return null;
  if (!code.closest(".bn-inline-content") || code.closest("pre")) return null;

  const textNode = firstTextNode(code);
  if (!textNode) return null;

  const range = code.ownerDocument.createRange();
  range.setStart(code, 0);
  try {
    range.setEnd(selection.anchorNode, selection.anchorOffset);
  } catch {
    return null;
  }

  const afterRange = code.ownerDocument.createRange();
  try {
    afterRange.setStart(selection.anchorNode, selection.anchorOffset);
    afterRange.setEnd(code, code.childNodes.length);
  } catch {
    return null;
  }

  return {
    code,
    textAfterCaret: afterRange.toString(),
    textBeforeCaret: range.toString(),
    textNode,
  };
}

function setDomCaretAtCodeStart(view: EditorView, caret: InlineCodeCaret) {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection || !caret.code.isConnected) return;

  const range = view.dom.ownerDocument.createRange();
  const contentContainer = Array.from(caret.code.childNodes).find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      node.hasAttribute("data-goose-inline-code-content"),
  );

  // 光标放在 boundary 与内容容器之间，而不是首文本节点的
  // offset=0。后者在 uTools 旧 Chromium 会被画到 code 外侧。
  if (contentContainer) {
    range.setStart(
      caret.code,
      Array.prototype.indexOf.call(caret.code.childNodes, contentContainer),
    );
  } else {
    range.setStart(caret.textNode, 0);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setDomCaretBeforeCode(view: EditorView, code: HTMLElement) {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection || !code.isConnected) return;

  const range = view.dom.ownerDocument.createRange();
  const textNode = adjacentEditableTextNode(code, "before");
  if (textNode) range.setStart(textNode, textNode.data.length);
  else range.setStartBefore(code);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setDomCaretAtCodeEnd(view: EditorView, caret: InlineCodeCaret) {
  setDomCaretAtTextOffset(view, caret, caret.textNode.data.length);
}

function setDomCaretAtTextOffset(
  view: EditorView,
  caret: InlineCodeCaret,
  offset: number,
) {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection || !caret.code.isConnected) return;

  const range = view.dom.ownerDocument.createRange();
  range.setStart(caret.textNode, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setDomCaretAfterCode(view: EditorView, code: HTMLElement) {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection || !code.isConnected) return;

  const range = view.dom.ownerDocument.createRange();
  const textNode = adjacentEditableTextNode(code, "after");
  if (textNode) range.setStart(textNode, 0);
  else range.setStartAfter(code);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function adjacentEditableTextNode(
  code: HTMLElement,
  direction: "after" | "before",
): Text | null {
  const inlineContent = code.closest(".bn-inline-content");
  if (!(inlineContent instanceof HTMLElement)) return null;

  const textNodes: Text[] = [];
  const walker = code.ownerDocument.createTreeWalker(
    inlineContent,
    NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (
      textNode.data.length > 0 &&
      !parent?.closest('[contenteditable="false"]')
    ) {
      textNodes.push(textNode);
    }
    node = walker.nextNode();
  }

  const codeIndexes = textNodes
    .map((textNode, index) => (code.contains(textNode) ? index : -1))
    .filter((index) => index >= 0);
  if (codeIndexes.length === 0) return null;

  const index = adjacentInlineCodeTextIndex(
    codeIndexes,
    textNodes.length,
    direction,
  );
  return index === null ? null : textNodes[index];
}

function edgeCharacterRect(
  textNode: Text,
  edge: InlineCodeBoundaryEdge,
): { height: number; left: number; top: number } | null {
  if (!textNode.data) return null;

  const range = textNode.ownerDocument.createRange();
  if (edge === "start") {
    range.setStart(textNode, 0);
    range.setEnd(textNode, Array.from(textNode.data)[0]?.length ?? 1);
  } else {
    const characters = Array.from(textNode.data);
    const lastCharacterLength =
      characters[characters.length - 1]?.length ?? 1;
    range.setStart(textNode, textNode.data.length - lastCharacterLength);
    range.setEnd(textNode, textNode.data.length);
  }
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect.height <= 0) return null;

  return {
    height: rect.height,
    left: edge === "start" ? rect.left : rect.right,
    top: rect.top,
  };
}

/**
 * 浏览器会把同一个 ProseMirror 文档位置画在 code 左侧，无法仅靠 Selection
 * 区分「首字符前」和「code 外」。边界停留期间用首字符的真实矩形绘制可见光标，
 * 原生光标保持透明；下一次左移后立即恢复原生光标。
 */
function showVisualCaret(
  view: EditorView,
  caret: InlineCodeCaret,
  edge: InlineCodeBoundaryEdge,
  phase: InlineCodeBoundaryPhase = "inside",
): VisualCaretHandle {
  const doc = view.dom.ownerDocument;
  const win = doc.defaultView;
  const element = doc.createElement("span");
  element.className = "goose-inline-code-visual-caret";
  element.setAttribute("aria-hidden", "true");
  doc.body.appendChild(element);
  caret.code.setAttribute("data-goose-inline-code-caret-active", "");
  view.dom.setAttribute("data-goose-inline-code-caret-active", "");

  let frameId: number | null = null;
  let destroyed = false;

  const update = () => {
    if (destroyed || !win) return;

    const rect = edgeCharacterRect(caret.textNode, edge);
    const isVisible =
      rect !== null &&
      caret.code.isConnected &&
      doc.hasFocus() &&
      view.hasFocus();

    element.hidden = !isVisible;
    if (rect && isVisible) {
      const codeRect = caret.code.getBoundingClientRect();
      const left = phase === "outside"
        ? edge === "end" ? codeRect.right : codeRect.left
        : rect.left;
      element.style.left = `${left}px`;
      element.style.top = `${rect.top}px`;
      element.style.height = `${rect.height}px`;
      element.style.backgroundColor = win.getComputedStyle(view.dom).color;
    }

    frameId = win.requestAnimationFrame(update);
  };

  update();

  return {
    caret,
    code: caret.code,
    edge,
    phase,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== null && win) win.cancelAnimationFrame(frameId);
      caret.code.removeAttribute("data-goose-inline-code-caret-active");
      view.dom.removeAttribute("data-goose-inline-code-caret-active");
      element.remove();
    },
  };
}

function inlineCodeBoundaryNavigationPlugin() {
  let visualCaret: VisualCaretHandle | null = null;

  const clearVisualCaret = () => {
    visualCaret?.destroy();
    visualCaret = null;
  };

  /** 文档位置上的 advance 步长：优先用 PM 文本节点，DOM 仅作兜底。 */
  const advanceStepFromBoundaryPos = (
    view: EditorView,
    boundaryPos: number,
    code: HTMLElement | null,
  ): { firstLength: number; trailingText: Text | null; targetPos: number } => {
    const $pos = view.state.doc.resolve(boundaryPos);
    const nodeAfter = $pos.nodeAfter;
    const fromDoc = nodeAfter?.isText ? (nodeAfter.text ?? "") : "";
    let firstLength = edgeGraphemeLength(fromDoc, "start");
    let trailingText = code ? adjacentEditableTextNode(code, "after") : null;

    // 单字符 code + 后续单字符时，旧 Chromium 的 DOM walker 偶发找不到
    // 相邻正文；文档侧 nodeAfter 仍可靠。
    if (firstLength === 0 && trailingText) {
      firstLength = edgeGraphemeLength(trailingText.data, "start");
    }
    if (!trailingText && code) {
      trailingText = adjacentEditableTextNode(code, "after");
    }

    return {
      firstLength,
      trailingText,
      targetPos: boundaryPos + Math.max(firstLength, 0),
    };
  };

  const placeOutsideCodeEnd = (
    view: EditorView,
    boundaryPos: number,
    code: HTMLElement,
    caret: InlineCodeCaret | null,
    keepVisualOutside: boolean,
  ) => {
    const tr = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, boundaryPos))
      .setStoredMarks([])
      .setMeta(PLUGIN_KEY, {
        edge: "end" as const,
        phase: "outside" as const,
        pos: boundaryPos,
      })
      .setMeta("addToHistory", false);
    view.dispatch(tr);
    setDomCaretAfterCode(view, code);
    clearVisualCaret();
    if (keepVisualOutside && caret) {
      visualCaret = showVisualCaret(view, caret, "end", "outside");
    }
  };

  const advancePastCodeEnd = (
    view: EditorView,
    boundaryPos: number,
    code: HTMLElement | null,
  ) => {
    const { firstLength, trailingText, targetPos } = advanceStepFromBoundaryPos(
      view,
      boundaryPos,
      code,
    );
    // 有后续 plain：进入其首字素后。无后续时只清 held、保持边界外侧，
    // 不强制 +1，避免块末误跳到下一节点。
    const clampedPos =
      firstLength > 0
        ? Math.min(targetPos, view.state.doc.content.size)
        : boundaryPos;

    const tr = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, clampedPos))
      .setStoredMarks([])
      .setMeta(PLUGIN_KEY, null)
      .setMeta("addToHistory", false);
    view.dispatch(tr);

    const domSelection = view.dom.ownerDocument.getSelection();
    if (trailingText && firstLength > 0 && domSelection) {
      const range = view.dom.ownerDocument.createRange();
      range.setStart(trailingText, firstLength);
      range.collapse(true);
      domSelection.removeAllRanges();
      domSelection.addRange(range);
    } else if (firstLength > 0 && domSelection) {
      // DOM walker 未找到相邻正文时，用 PM 映射强制落到 advance 后的位置。
      try {
        const domPos = view.domAtPos(clampedPos);
        const range = view.dom.ownerDocument.createRange();
        range.setStart(domPos.node, domPos.offset);
        range.collapse(true);
        domSelection.removeAllRanges();
        domSelection.addRange(range);
      } catch {
        if (code) setDomCaretAfterCode(view, code);
      }
    } else if (code) {
      setDomCaretAfterCode(view, code);
    }
    clearVisualCaret();
  };

  /**
   * 右键离开 code 末端：不依赖 visual caret 是否仍挂着。
   * 覆盖 held 两阶段、DOM 末端、以及 code|plain 边界外侧。
   */
  const handleCodeEndRightArrow = (
    view: EditorView,
    event: KeyboardEvent,
  ): boolean => {
    const { selection } = view.state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    const codeMark = view.state.schema.marks.code;
    if (!codeMark) return false;

    const held = PLUGIN_KEY.getState(view.state);
    const domCaret = getInlineCodeCaret(
      view.dom.ownerDocument.getSelection(),
      view.dom,
    );
    const domAtCodeEnd = !!domCaret && domCaret.textAfterCaret.length === 0;

    const $from = selection.$from;
    const nodeBefore = $from.nodeBefore;
    const nodeAfter = $from.nodeAfter;
    const beforeHasCode = !!(
      nodeBefore &&
      nodeBefore.isText &&
      codeMark.isInSet(nodeBefore.marks)
    );
    const afterIsPlainText = !!(
      nodeAfter?.isText && !codeMark.isInSet(nodeAfter.marks)
    );
    // 仅当后续是 plain 文本时才把「边界外侧」当成可 advance，
    // 避免在块末尾把右键误当成 advance。
    const atCodePlainBoundary = beforeHasCode && afterIsPlainText;

    let heldPhase: InlineCodeBoundaryPhase | null =
      held?.edge === "end" ? held.phase : null;
    let boundaryPos = held?.edge === "end" ? held.pos : selection.from;

    if (visualCaret?.code.isConnected && visualCaret.edge === "end") {
      let domEdge: InlineCodeBoundaryEdge | null = null;
      if (domCaret?.code === visualCaret.code) {
        if (domCaret.textBeforeCaret.length === 0) domEdge = "start";
        else if (domCaret.textAfterCaret.length === 0) domEdge = "end";
      }
      const resolved = resolveHeldInlineCodeBoundary(
        held ?? null,
        visualCaret.edge,
        visualCaret.phase,
        domEdge,
        selection.from,
      );
      if (resolved?.edge === "end") {
        heldPhase = resolved.phase;
        boundaryPos = resolved.pos;
      }
    }

    // DOM 在 code 文本末端：boundary = mark 结束位置。
    // 单字符 code 时 selection.from 通常已是 markEnd；若旧内核把光标
    // 映到 mark 内最后偏移，用 textBefore 长度反推 markEnd。
    if (domAtCodeEnd && domCaret) {
      if (beforeHasCode) {
        boundaryPos = selection.from;
      } else if (domCaret.textBeforeCaret.length > 0) {
        // 仍在 mark 内且 after 为空 → from 即 markEnd（PM 对 inclusive 边界）
        boundaryPos = selection.from;
      }
    }

    const action = inlineCodeEndRightArrowAction({
      heldPhase,
      domAtCodeEnd,
      atCodePlainBoundary,
    });
    if (!action) return false;

    let code: HTMLElement | null =
      (visualCaret?.code.isConnected ? visualCaret.code : null) ??
      domCaret?.code ??
      null;
    if (!code && nodeBefore?.isText) {
      const probe = inlineCodeCaretAtDocumentPosition(
        view,
        Math.max(0, selection.from - 1),
        nodeBefore.text ?? "",
      );
      code = probe?.code ?? null;
    }

    if (action === "to-outside") {
      event.preventDefault();
      if (code) {
        const textNode = firstTextNode(code);
        const stableCaret: InlineCodeCaret | null = textNode
          ? {
              code,
              textNode,
              textBeforeCaret: textNode.data,
              textAfterCaret: "",
            }
          : visualCaret?.caret ?? domCaret;
        placeOutsideCodeEnd(view, boundaryPos, code, stableCaret, true);
      } else {
        // DOM 未解析到 code 时仍清 marks 并保持 outside held，下一次右键可 advance
        const tr = view.state.tr
          .setSelection(TextSelection.create(view.state.doc, boundaryPos))
          .setStoredMarks([])
          .setMeta(PLUGIN_KEY, {
            edge: "end" as const,
            phase: "outside" as const,
            pos: boundaryPos,
          })
          .setMeta("addToHistory", false);
        view.dispatch(tr);
        clearVisualCaret();
      }
      return true;
    }

    event.preventDefault();
    advancePastCodeEnd(view, boundaryPos, code);
    return true;
  };

  const handleHeldBoundaryKeyDown = (
    view: EditorView,
    event: KeyboardEvent,
  ): boolean => {
    const isLeftArrow = event.key === "ArrowLeft" || event.keyCode === 37;
    const isRightArrow = event.key === "ArrowRight" || event.keyCode === 39;
    if (
      (!isLeftArrow && !isRightArrow) ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.isComposing ||
      view.composing
    ) {
      return false;
    }

    const { selection } = view.state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    // 右键退出 code 末端：统一走不依赖 visual caret 的路径
    if (isRightArrow) {
      if (handleCodeEndRightArrow(view, event)) return true;
    }

    if (!visualCaret?.code.isConnected) {
      return false;
    }

    const domCaret = getInlineCodeCaret(
      view.dom.ownerDocument.getSelection(),
      view.dom,
    );
    let domEdge: InlineCodeBoundaryEdge | null = null;
    if (domCaret?.code === visualCaret.code) {
      if (domCaret.textBeforeCaret.length === 0) domEdge = "start";
      else if (domCaret.textAfterCaret.length === 0) domEdge = "end";
    }

    const heldBoundary = resolveHeldInlineCodeBoundary(
      PLUGIN_KEY.getState(view.state) ?? null,
      visualCaret.edge,
      visualCaret.phase,
      domEdge,
      selection.from,
    );
    if (!heldBoundary) return false;

    // end+right 已由 handleCodeEndRightArrow 处理
    if (heldBoundary.edge === "end" && isRightArrow) return false;

    const direction = isLeftArrow ? "left" : "right";
    const action = heldInlineCodeBoundaryArrowAction(
      heldBoundary.edge,
      heldBoundary.phase,
      direction,
    );
    const code = visualCaret.code;
    const caret = visualCaret.caret;
    const codeMark = view.state.schema.marks.code;

    if (action === "to-inside") {
      if (!codeMark) return false;
      event.preventDefault();
      const tr = view.state.tr
        .setSelection(TextSelection.create(view.state.doc, heldBoundary.pos))
        .setStoredMarks([codeMark.create()])
        .setMeta(PLUGIN_KEY, {
          edge: "end",
          phase: "inside",
          pos: heldBoundary.pos,
        })
        .setMeta("addToHistory", false);
      view.dispatch(tr);
      setDomCaretAtCodeEnd(view, caret);
      clearVisualCaret();
      visualCaret = showVisualCaret(view, caret, "end", "inside");
      return true;
    }

    if (action === "exit") {
      event.preventDefault();
      const tr = view.state.tr
        .setSelection(
          TextSelection.create(view.state.doc, heldBoundary.pos),
        )
        .setStoredMarks([])
        .setMeta(PLUGIN_KEY, null)
        .setMeta("addToHistory", false);
      view.dispatch(tr);
      setDomCaretBeforeCode(view, code);
      return true;
    }

    const edgeLength = edgeGraphemeLength(
      caret.textNode.data,
      heldBoundary.edge,
    );
    if (!codeMark || edgeLength === 0) return false;

    event.preventDefault();
    const targetPos =
      heldBoundary.edge === "start"
        ? heldBoundary.pos + edgeLength
        : heldBoundary.pos - edgeLength;
    const textOffset =
      heldBoundary.edge === "start"
        ? edgeLength
        : caret.textNode.data.length - edgeLength;
    const tr = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, targetPos))
      .setStoredMarks([codeMark.create()])
      .setMeta(PLUGIN_KEY, null)
      .setMeta("addToHistory", false);
    view.dispatch(tr);
    setDomCaretAtTextOffset(view, caret, textOffset);
    return true;
  };

  /** 从文档位置扫描最近的 code mark 结束点（nodeBefore 带 code、nodeAfter 不带）。 */
  const findCodeMarkEndNear = (
    view: EditorView,
    around: number,
    codeMark: NonNullable<EditorView["state"]["schema"]["marks"]["code"]>,
  ): number | null => {
    const size = view.state.doc.content.size;
    const start = Math.max(1, around - 8);
    const end = Math.min(size, around + 8);
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let p = start; p <= end; p++) {
      const $p = view.state.doc.resolve(p);
      const nb = $p.nodeBefore;
      const na = $p.nodeAfter;
      if (
        nb &&
        nb.isText &&
        codeMark.isInSet(nb.marks) &&
        (!na || !codeMark.isInSet(na.marks))
      ) {
        const dist = Math.abs(p - around);
        if (dist < bestDist) {
          best = p;
          bestDist = dist;
        }
      }
    }
    return best;
  };

  const findCodeMarkEndForElement = (
    view: EditorView,
    code: HTMLElement,
    codeMark: NonNullable<EditorView["state"]["schema"]["marks"]["code"]>,
  ): number | null => {
    try {
      const start = view.posAtDOM(code, 0);
      const textLen =
        code.querySelector("[data-goose-inline-code-content]")?.textContent
          ?.length ??
        code.textContent?.length ??
        0;
      const guessed = Math.min(start + textLen, view.state.doc.content.size);
      const $guessed = view.state.doc.resolve(guessed);
      const nb = $guessed.nodeBefore;
      if (
        nb?.isText &&
        codeMark.isInSet(nb.marks) &&
        (!$guessed.nodeAfter || !codeMark.isInSet($guessed.nodeAfter.marks))
      ) {
        return guessed;
      }
      return findCodeMarkEndNear(view, guessed, codeMark);
    } catch {
      return findCodeMarkEndNear(view, view.state.selection.from, codeMark);
    }
  };

  /**
   * 用点击坐标判断是否落在 code 芯片右缘外侧（含 end boundary 区域）。
   * 旧 Chromium 常把该区域的 pos 映进 mark 内部。
   */
  const resolveCodeEndBoundaryFromClick = (
    view: EditorView,
    pos: number,
    clientX: number | null,
  ): { boundaryPos: number; code: HTMLElement | null } | null => {
    const codeMark = view.state.schema.marks.code;
    if (!codeMark) return null;

    const $pos = view.state.doc.resolve(pos);
    const nodeBefore = $pos.nodeBefore;
    const nodeAfter = $pos.nodeAfter;
    const beforeHasCode = !!(
      nodeBefore &&
      nodeBefore.isText &&
      codeMark.isInSet(nodeBefore.marks)
    );
    const afterHasCode = !!(nodeAfter && codeMark.isInSet(nodeAfter.marks));
    const afterIsText = !!nodeAfter?.isText;

    // 文档位置已在 code|plain 边界：直接外侧
    if (
      preferOutsideInlineCodeEndClick({
        nodeBeforeHasCode: beforeHasCode,
        nodeAfterHasCode: afterHasCode,
        nodeAfterIsText: afterIsText,
      })
    ) {
      const codeText = nodeBefore?.isText ? (nodeBefore.text ?? "") : "";
      const caret = inlineCodeCaretAtDocumentPosition(
        view,
        Math.max(0, pos - Math.max(edgeGraphemeLength(codeText, "end"), 1)),
        codeText,
      );
      return { boundaryPos: pos, code: caret?.code ?? null };
    }

    // 点击坐标在 code 右缘外侧，但 pos 被映到 mark 内：纠正到 markEnd。
    // 也覆盖「mousedown 在外侧、mouseup 把 DOM 映回 code 末端」的本地文件夹场景。
    const domCaret = getInlineCodeCaret(
      view.dom.ownerDocument.getSelection(),
      view.dom,
    );
    const probePositions = [
      pos,
      Math.max(0, pos - 1),
      Math.min(pos + 1, view.state.doc.content.size),
    ];
    const codeCandidates: HTMLElement[] = [];
    if (domCaret?.code) codeCandidates.push(domCaret.code);
    for (const probe of probePositions) {
      const caret = inlineCodeCaretAtDocumentPosition(view, probe, "");
      if (caret?.code && !codeCandidates.includes(caret.code)) {
        codeCandidates.push(caret.code);
      }
    }

    let ordered = codeCandidates;
    if (clientX !== null && codeCandidates.length > 1) {
      const picked = pickInlineCodeChipIndexForEndClick(
        codeCandidates.map((code) => {
          const rect = code.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
        clientX,
      );
      if (picked !== null) {
        ordered = [codeCandidates[picked]];
      }
    }

    for (const code of ordered) {
      const content = code.querySelector(
        "[data-goose-inline-code-content]",
      );
      const contentRect =
        content instanceof HTMLElement
          ? content.getBoundingClientRect()
          : null;
      const codeRect = code.getBoundingClientRect();
      const endBoundary = code.querySelector(
        '[data-goose-inline-code-boundary="end"]',
      );
      const endRect =
        endBoundary instanceof HTMLElement
          ? endBoundary.getBoundingClientRect()
          : null;
      const contentRight =
        contentRect?.right ??
        (endRect && endRect.left > 0 ? endRect.left : null) ??
        codeRect.right;
      const endThreshold =
        endRect && endRect.left > 0
          ? endRect.left
          : codeRect.right - Math.min(6, Math.max(2, codeRect.width * 0.25));

      const forceByDomEnd = shouldForceCaretOutsideInlineCodeEnd({
        atCodePlainBoundary: false,
        domAtCodeEnd:
          !!domCaret &&
          domCaret.code === code &&
          domCaret.textAfterCaret.length === 0,
        clientX,
        contentRight,
        codeRight: codeRect.right,
      });
      const forceByClickX = clientX !== null && clientX >= endThreshold;
      if (!forceByDomEnd && !forceByClickX) continue;

      const boundaryPos = findCodeMarkEndForElement(view, code, codeMark);
      if (boundaryPos === null) continue;

      const $boundary = view.state.doc.resolve(boundaryPos);
      const afterNode = $boundary.nodeAfter;
      // 仅在后续为 plain 文本时纠正（1`2`3 场景）；块末由其它路径处理
      if (!afterNode?.isText || codeMark.isInSet(afterNode.marks)) continue;

      return { boundaryPos, code };
    }

    return null;
  };

  const pinCaretAfterCode = (view: EditorView, code: HTMLElement) => {
    if (!code.isConnected) return;
    setDomCaretAfterCode(view, code);
    const pin = () => {
      const held = PLUGIN_KEY.getState(view.state);
      if (held?.edge !== "end" || held.phase !== "outside") return;
      if (!code.isConnected) return;
      const remapped = getInlineCodeCaret(
        view.dom.ownerDocument.getSelection(),
        view.dom,
      );
      if (remapped?.code === code && remapped.textAfterCaret.length === 0) {
        setDomCaretAfterCode(view, code);
      }
    };
    void Promise.resolve().then(pin);
    const win = view.dom.ownerDocument.defaultView;
    win?.requestAnimationFrame(pin);
  };

  const applyClickOutsideCodeEndAffinity = (
    view: EditorView,
    pos: number,
    clientX: number | null = null,
  ): boolean => {
    const resolved = resolveCodeEndBoundaryFromClick(view, pos, clientX);
    if (!resolved) return false;

    const { boundaryPos, code } = resolved;
    if (code?.isConnected) {
      placeOutsideCodeEnd(view, boundaryPos, code, null, false);
      pinCaretAfterCode(view, code);
    } else {
      const tr = view.state.tr
        .setSelection(TextSelection.create(view.state.doc, boundaryPos))
        .setStoredMarks([])
        .setMeta(PLUGIN_KEY, {
          edge: "end" as const,
          phase: "outside" as const,
          pos: boundaryPos,
        })
        .setMeta("addToHistory", false);
      view.dispatch(tr);
    }
    return true;
  };

  const plugin = new Plugin<InlineCodeBoundaryState>({
    key: PLUGIN_KEY,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(PLUGIN_KEY);
        if (meta !== undefined) return meta as InlineCodeBoundaryState;
        if (!value) return null;
        if (tr.docChanged || tr.selection.from !== value.pos) {
          return null;
        }
        return value;
      },
    },
    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (handleHeldBoundaryKeyDown(view, event)) return true;

        const isLeftArrow = event.key === "ArrowLeft" || event.keyCode === 37;
        const isRightArrow =
          event.key === "ArrowRight" || event.keyCode === 39;
        if (
          (!isLeftArrow && !isRightArrow) ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.isComposing ||
          view.composing
        ) {
          return false;
        }

        const { selection } = view.state;
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return false;
        }

        const heldBoundary = PLUGIN_KEY.getState(view.state);

        const domSelection = view.dom.ownerDocument.getSelection();
        const domCaret = getInlineCodeCaret(domSelection, view.dom);

        if (
          isLeftArrow &&
          heldBoundary?.pos === selection.from &&
          domCaret?.textBeforeCaret.length === 0
        ) {
          event.preventDefault();
          const tr = view.state.tr
            .setStoredMarks([])
            .setMeta(PLUGIN_KEY, null)
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretBeforeCode(view, domCaret.code);
          return true;
        }

        const codeMark = view.state.schema.marks.code;
        if (!codeMark) return false;

        if (isRightArrow && !domCaret) {
          const nodeAfter = selection.$from.nodeAfter;
          const codeText = nodeAfter?.isText ? (nodeAfter.text ?? "") : "";
          if (!nodeAfter || !codeMark.isInSet(nodeAfter.marks) || !codeText) {
            return false;
          }

          const firstLength = edgeGraphemeLength(codeText, "start");
          const caret = inlineCodeCaretAtDocumentPosition(
            view,
            selection.from + firstLength,
            "",
          );
          if (!caret || firstLength === 0) return false;

          // 从代码外先进入左边界，下一次右移才越过首字素。
          event.preventDefault();
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, selection.from))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, {
              edge: "start",
              phase: "inside",
              pos: selection.from,
            })
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtCodeStart(view, caret);
          clearVisualCaret();
          visualCaret = showVisualCaret(view, caret, "start");
          return true;
        }

        if (
          isRightArrow &&
          domCaret?.textBeforeCaret.length === 0
        ) {
          const codeText = domCaret.textNode.data;
          const firstLength = edgeGraphemeLength(codeText, "start");
          if (firstLength === 0) return false;

          event.preventDefault();
          const targetPos = selection.from + firstLength;
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, targetPos))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, null)
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtTextOffset(view, domCaret, firstLength);
          return true;
        }

        if (isLeftArrow && !domCaret) {
          const nodeBefore = selection.$from.nodeBefore;
          const codeText = nodeBefore?.isText ? (nodeBefore.text ?? "") : "";
          if (!nodeBefore || !codeMark.isInSet(nodeBefore.marks) || !codeText) {
            return false;
          }

          const lastLength = edgeGraphemeLength(codeText, "end");
          const caret = inlineCodeCaretAtDocumentPosition(
            view,
            selection.from - lastLength,
            codeText,
          );
          if (!caret || lastLength === 0) return false;

          // 从代码外先进入右边界，下一次左移才越过末字素。
          event.preventDefault();
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, selection.from))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, {
              edge: "end",
              phase: "inside",
              pos: selection.from,
            })
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtCodeEnd(view, caret);
          clearVisualCaret();
          visualCaret = showVisualCaret(view, caret, "end");
          return true;
        }

        if (isLeftArrow && domCaret?.textAfterCaret.length === 0) {
          const codeText = domCaret.textNode.data;
          const lastLength = edgeGraphemeLength(codeText, "end");
          if (lastLength === 0) return false;

          event.preventDefault();
          const targetPos = selection.from - lastLength;
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, targetPos))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, null)
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtTextOffset(
            view,
            domCaret,
            domCaret.textNode.data.length - lastLength,
          );
          return true;
        }

        if (isRightArrow) {
          // 已在末端的右移由 handleCodeEndRightArrow 处理；
          // 这里只负责「还剩一个字素 → 进入 end/inside 两阶段」。
          if (!domCaret || !isSingleGrapheme(domCaret.textAfterCaret)) {
            return false;
          }

          const markEnd = selection.from + domCaret.textAfterCaret.length;
          const nodeBefore = view.state.doc.resolve(markEnd).nodeBefore;
          if (!nodeBefore || !codeMark.isInSet(nodeBefore.marks)) return false;

          event.preventDefault();
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, markEnd))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, {
              edge: "end",
              phase: "inside",
              pos: markEnd,
            })
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtCodeEnd(view, domCaret);
          clearVisualCaret();
          visualCaret = showVisualCaret(view, domCaret, "end");
          return true;
        }

        let caret = domCaret;
        let textBeforeCaret = domCaret?.textBeforeCaret ?? "";

        if (
          !isSingleGrapheme(textBeforeCaret) &&
          !isTwoGraphemes(textBeforeCaret)
        ) {
          const nodeBefore = selection.$from.nodeBefore;
          const nodeAfter = selection.$from.nodeAfter;
          const textBefore = nodeBefore?.isText ? (nodeBefore.text ?? "") : "";

          // 块末尾的 code 在旧 Chromium 中会把「p 后」映射到 code 外侧，
          // DOM Selection 因而无法识别。此时文档位置仍明确位于同一 code mark
          // 的首字符与剩余字符之间，可安全恢复内部左边界。要求 nodeAfter 仍带
          // code mark，可避免破坏单字符 code 的正常右边界。
          if (
            (!isSingleGrapheme(textBefore) &&
              !isTwoGraphemes(textBefore)) ||
            !nodeBefore ||
            !codeMark.isInSet(nodeBefore.marks) ||
            !nodeAfter ||
            !codeMark.isInSet(nodeAfter.marks)
          ) {
            return false;
          }

          textBeforeCaret = textBefore;
          caret = inlineCodeCaretAtDocumentPosition(
            view,
            selection.from,
            textBeforeCaret,
          );
        }

        if (!caret) return false;

        const markStart = selection.from - textBeforeCaret.length;
        if (markStart < 0) return false;

        if (isTwoGraphemes(textBeforeCaret)) {
          const nodeAfter = selection.$from.nodeAfter;
          if (!nodeAfter || !codeMark.isInSet(nodeAfter.marks)) return false;

          const firstLength = edgeGraphemeLength(
            caret.textNode.data,
            "start",
          );
          if (firstLength === 0) return false;

          // 旧 Chromium 可能把这一步直接合并到 code 外，显式落到首字素后。
          event.preventDefault();
          const targetPos = markStart + firstLength;
          const tr = view.state.tr
            .setSelection(TextSelection.create(view.state.doc, targetPos))
            .setStoredMarks([codeMark.create()])
            .setMeta(PLUGIN_KEY, null)
            .setMeta("addToHistory", false);
          view.dispatch(tr);
          setDomCaretAtTextOffset(view, caret, firstLength);
          return true;
        }

        if (!isSingleGrapheme(textBeforeCaret)) return false;

        const nodeAfter = view.state.doc.resolve(markStart).nodeAfter;
        if (!nodeAfter || !codeMark.isInSet(nodeAfter.marks)) return false;

        event.preventDefault();
        const tr = view.state.tr
          .setSelection(TextSelection.create(view.state.doc, markStart))
          .setStoredMarks([codeMark.create()])
          .setMeta(PLUGIN_KEY, {
            edge: "start",
            phase: "inside",
            pos: markStart,
          })
          .setMeta("addToHistory", false);
        view.dispatch(tr);
        setDomCaretAtCodeStart(view, caret);
        clearVisualCaret();
        visualCaret = showVisualCaret(view, caret, "start");
        return true;
      },
      /**
       * 点击落在 code 结束与后续 plain 的文档边界时，偏向外侧：
       * 清空 stored marks，并把 DOM 光标放到 code 后、后续正文首字前。
       * 不处理左边界，避免破坏「点在 code 起点内侧」。
       */
      handleClick(view: EditorView, pos: number, event: MouseEvent): boolean {
        if (event.button !== 0 || event.detail > 1) return false;
        return applyClickOutsideCodeEndAffinity(view, pos, event.clientX);
      },
      handleDOMEvents: {
        pointerdown() {
          return false;
        },
        // 旧 Chromium 有时在 mouseup 后才把 selection 映进 code；
        // 再同步一次外侧亲和（不 preventDefault，仅纠正）。
        // 注意：此时 PM selection 可能仍是 mousedown 前的旧位置，必须用点击坐标。
        mouseup(view: EditorView, event: MouseEvent) {
          if (event.button !== 0 || event.detail > 1) return false;
          const { selection } = view.state;
          if (!(selection instanceof TextSelection) || !selection.empty) {
            return false;
          }
          const coords = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          applyClickOutsideCodeEndAffinity(
            view,
            resolveMouseupInlineCodePos(selection.from, coords?.pos),
            event.clientX,
          );
          return false;
        },
      },
    },
    view(editorView) {
      const captureBoundaryKeyDown = (event: KeyboardEvent) => {
        if (!plugin.props.handleKeyDown?.call(plugin, editorView, event)) return;
        event.stopImmediatePropagation();
      };
      editorView.dom.addEventListener(
        "keydown",
        captureBoundaryKeyDown,
        true,
      );

      const pinIfHeldOutside = () => {
        const held = PLUGIN_KEY.getState(editorView.state);
        if (held?.edge !== "end" || held.phase !== "outside") return;
        const { selection } = editorView.state;
        if (!(selection instanceof TextSelection) || !selection.empty) return;
        const domSelection = editorView.dom.ownerDocument.getSelection();
        if (!domSelection?.isCollapsed) return;
        const remapped = getInlineCodeCaret(domSelection, editorView.dom);
        if (!remapped || remapped.textAfterCaret.length !== 0) return;
        setDomCaretAfterCode(editorView, remapped.code);
      };

      const onSelectionChange = () => pinIfHeldOutside();
      editorView.dom.ownerDocument.addEventListener(
        "selectionchange",
        onSelectionChange,
      );

      return {
        update(view) {
          if (!PLUGIN_KEY.getState(view.state)) {
            clearVisualCaret();
            return;
          }
          pinIfHeldOutside();
        },
        destroy() {
          editorView.dom.removeEventListener(
            "keydown",
            captureBoundaryKeyDown,
            true,
          );
          editorView.dom.ownerDocument.removeEventListener(
            "selectionchange",
            onSelectionChange,
          );
          clearVisualCaret();
        },
      };
    },
  });

  return plugin;
}

export const gooseInlineCodeBoundaryNavigationExtension = createExtension({
  key: "goose-inline-code-boundary-navigation",
  prosemirrorPlugins: [inlineCodeBoundaryNavigationPlugin()],
});
