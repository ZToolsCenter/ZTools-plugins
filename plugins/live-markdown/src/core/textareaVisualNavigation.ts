/** Textarea visual-line navigation used by the live preview editor. */

export type VisualEdge = "first" | "last";
export type VerticalDirection = "up" | "down";
export const MAX_VISUAL_ROW_SAMPLES = 48;
const MAX_ROW_SEARCH_STEPS = 32;

export interface PendingVisualCursorIntent {
  targetBlockId: string;
  edge: VisualEdge;
  desiredX: number;
}

export function isSameVisualRow(
  currentY: number,
  boundaryY: number,
  lineHeight: number
): boolean {
  return Math.abs(currentY - boundaryY) <= Math.max(2, lineHeight * 0.2);
}

export function isAmbiguousSoftWrapCaret(input: {
  value: string;
  offset: number;
  beforeRowY: number;
  afterRowY: number;
  lineHeight: number;
}): boolean {
  const { value, offset, beforeRowY, afterRowY, lineHeight } = input;
  if (offset <= 0 || offset >= value.length) return false;
  if (value[offset - 1] === "\n" || value[offset] === "\n") return false;
  return !isSameVisualRow(beforeRowY, afterRowY, lineHeight);
}

const MIRRORED_TEXT_STYLES = [
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "word-spacing",
  "tab-size",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "box-sizing",
  "direction",
  "word-break"
];

interface TextLayoutMirror {
  element: HTMLDivElement;
  text: Text;
  sourceLength: number;
  lineHeight: number;
}

function createTextLayoutMirror(
  reference: HTMLTextAreaElement,
  value: string
): TextLayoutMirror | null {
  if (typeof document === "undefined" || !document.body) return null;

  const computed = window.getComputedStyle(reference);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "fixed";
  mirror.style.left = "-100000px";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  const wraps = reference.wrap !== "off";
  mirror.style.whiteSpace = wraps ? "pre-wrap" : "pre";
  // A textarea with wrap="soft" breaks long words at the available width;
  // mirror that explicitly because ordinary divs default to overflow-wrap: normal.
  mirror.style.overflowWrap = wraps ? "break-word" : "normal";
  mirror.style.wordBreak = computed.wordBreak;
  mirror.style.overflow = "hidden";
  mirror.style.margin = "0";
  mirror.style.width = `${reference.getBoundingClientRect().width}px`;

  for (const property of MIRRORED_TEXT_STYLES) {
    const styleValue = computed.getPropertyValue(property);
    if (styleValue) mirror.style.setProperty(property, styleValue);
  }

  // Keep a real line box for empty text and for a terminal newline. The marker
  // is zero-width, and sourceLength keeps it out of all returned offsets.
  const text = document.createTextNode(`${value}\u200b`);
  mirror.appendChild(text);
  document.body.appendChild(mirror);
  const parsedLineHeight = Number.parseFloat(computed.lineHeight);
  const fontSize = Number.parseFloat(computed.fontSize) || 16;
  return {
    element: mirror,
    text,
    sourceLength: value.length,
    lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.2
  };
}

function getCaretRect(mirror: TextLayoutMirror, offset: number): DOMRect | null {
  const range = document.createRange();
  const clamped = Math.min(mirror.sourceLength, Math.max(0, offset));
  range.setStart(mirror.text, clamped);
  range.collapse(true);
  let rect = range.getBoundingClientRect();
  if (!rect.height && !rect.width && clamped === mirror.sourceLength) {
    // A range immediately before the zero-width sentinel can have a zero rect
    // in some engines. Selecting the sentinel exposes the empty/trailing line.
    range.setEnd(mirror.text, mirror.sourceLength + 1);
    rect = range.getBoundingClientRect();
  }
  if (rect.height || rect.width) return rect;

  const box = mirror.element.getBoundingClientRect();
  return box.height ? box : null;
}

function getCaretRects(mirror: TextLayoutMirror, offset: number): DOMRect[] {
  const range = document.createRange();
  const clamped = Math.min(mirror.sourceLength, Math.max(0, offset));
  range.setStart(mirror.text, clamped);
  range.collapse(true);
  const rects = Array.from(range.getClientRects());
  if (rects.length > 0) return rects;
  const fallback = getCaretRect(mirror, clamped);
  return fallback ? [fallback] : [];
}

function getCharacterRect(mirror: TextLayoutMirror, offset: number): DOMRect | null {
  if (offset < 0 || offset >= mirror.sourceLength) return null;
  const range = document.createRange();
  range.setStart(mirror.text, offset);
  range.setEnd(mirror.text, offset + 1);
  const rect = range.getBoundingClientRect();
  return rect.height || rect.width ? rect : null;
}

function withTextLayout<T>(
  reference: HTMLTextAreaElement,
  value: string,
  callback: (mirror: TextLayoutMirror) => T
): T | null {
  const mirror = createTextLayoutMirror(reference, value);
  if (!mirror) return null;
  try {
    return callback(mirror);
  } finally {
    mirror.element.remove();
  }
}

/** Returns true only when the caret is on the actual first/last rendered row. */
export function isCaretAtVisualEdge(
  textarea: HTMLTextAreaElement,
  direction: VerticalDirection,
  offset = textarea.selectionStart
): boolean {
  if (!textarea.isConnected || textarea.selectionStart !== textarea.selectionEnd) return false;

  return withTextLayout(textarea, textarea.value, (mirror) => {
    const currentRects = getCaretRects(mirror, offset);
    const edgeRects = getCaretRects(
      mirror,
      direction === "up" ? 0 : mirror.sourceLength
    );
    if (currentRects.length === 0 || edgeRects.length === 0) return false;

    if (currentRects.length === 1) {
      // Some engines expose only one collapsed Range rect at a wrap boundary.
      const before = getCharacterRect(mirror, offset - 1);
      const after = getCharacterRect(mirror, offset);
      if (
        before &&
        after &&
        isAmbiguousSoftWrapCaret({
          value: textarea.value,
          offset,
          beforeRowY: before.top,
          afterRowY: after.top,
          lineHeight: mirror.lineHeight
        })
      ) {
        return false;
      }
    }

    const edgeTop = direction === "up"
      ? Math.min(...edgeRects.map((rect) => rect.top))
      : Math.max(...edgeRects.map((rect) => rect.top));
    const allPossibleRowsAtBoundary = currentRects.every((rect) =>
      isSameVisualRow(rect.top, edgeTop, mirror.lineHeight)
    );
    if (!allPossibleRowsAtBoundary) return false;
    return true;
  }) ?? false;
}

export function getCaretVisualColumnX(
  textarea: HTMLTextAreaElement,
  offset = textarea.selectionStart
): number | null {
  if (!textarea.isConnected) return null;
  return withTextLayout(textarea, textarea.value, (mirror) => {
    const caret = getCaretRect(mirror, offset);
    if (!caret) return null;
    const mirrorLeft = mirror.element.getBoundingClientRect().left;
    return caret.left - mirrorLeft;
  }) ?? null;
}

/**
 * Maps a pixel column into the first/last visual row of another Markdown block.
 * The mirror uses the active editor typography and wrapping width as an estimate.
 */
export function findOffsetOnVisualEdge(
  reference: HTMLTextAreaElement,
  value: string,
  edge: VisualEdge,
  desiredX: number
): number {
  return withTextLayout(reference, value, (mirror) => {
    const edgeOffset = edge === "first" ? 0 : mirror.sourceLength;
    const edgeRect = getCaretRect(mirror, edgeOffset);
    if (!edgeRect) return edgeOffset;
    const targetTop = edgeRect.top;
    const tolerance = Math.max(2, mirror.lineHeight * 0.2);

    // Locate this visual row's source interval with two logarithmic searches.
    const rowOffsets = getVisualRowSourceRange(
      mirror.sourceLength,
      lowerBoundOffset(mirror, (rect) => rect.top >= targetTop - tolerance),
      lowerBoundOffset(mirror, (rect) => rect.top > targetTop + tolerance)
    );
    const samples = getBoundedUnicodeSampleOffsets(
      value,
      rowOffsets.first,
      rowOffsets.last,
      MAX_VISUAL_ROW_SAMPLES
    );

    let bestOffset = rowOffsets.first;
    let bestDistance = Number.POSITIVE_INFINITY;
    const mirrorLeft = mirror.element.getBoundingClientRect().left;
    for (const offset of samples) {
      const rect = getCaretRect(mirror, offset);
      if (!rect) continue;
      if (isSameVisualRow(rect.top, targetTop, mirror.lineHeight)) {
        const distance = Math.abs(
          rect.left - mirrorLeft - desiredX
        );
        if (distance < bestDistance) {
          bestOffset = offset;
          bestDistance = distance;
        }
      }
    }
    return snapToCodePointBoundary(value, bestOffset);
  }) ?? (edge === "first" ? 0 : value.length);
}

export function resolvePendingVisualCursorIntent(
  textarea: HTMLTextAreaElement,
  blockId: string,
  intent: PendingVisualCursorIntent | null
): number | null {
  if (!intent || intent.targetBlockId !== blockId) return null;
  return findOffsetOnVisualEdge(textarea, textarea.value, intent.edge, intent.desiredX);
}

function lowerBoundOffset(
  mirror: TextLayoutMirror,
  predicate: (rect: DOMRect) => boolean
): number {
  let low = 0;
  let high = mirror.sourceLength + 1;
  let steps = 0;
  while (low < high && steps < MAX_ROW_SEARCH_STEPS) {
    steps += 1;
    const middle = Math.floor((low + high) / 2);
    const rect = getCaretRect(mirror, Math.min(middle, mirror.sourceLength));
    if (!rect || predicate(rect)) high = middle;
    else low = middle + 1;
  }
  // sourceLength + 1 is meaningful: no offset after the final row matched.
  return low;
}

export function getVisualRowSourceRange(
  sourceLength: number,
  firstOffset: number,
  afterLastOffset: number
): { first: number; last: number } {
  const first = Math.min(sourceLength, Math.max(0, firstOffset));
  const last = Math.max(
    first,
    Math.min(sourceLength, afterLastOffset - 1)
  );
  return { first, last };
}

function snapToCodePointBoundary(value: string, offset: number): number {
  const bounded = Math.min(value.length, Math.max(0, offset));
  if (
    bounded > 0 &&
    bounded < value.length &&
    value.charCodeAt(bounded - 1) >= 0xd800 &&
    value.charCodeAt(bounded - 1) <= 0xdbff &&
    value.charCodeAt(bounded) >= 0xdc00 &&
    value.charCodeAt(bounded) <= 0xdfff
  ) {
    return bounded - 1;
  }
  return bounded;
}

/** Produces a bounded set of caret offsets without splitting UTF-16 pairs. */
export function getBoundedUnicodeSampleOffsets(
  value: string,
  start: number,
  end: number,
  budget = MAX_VISUAL_ROW_SAMPLES
): number[] {
  const first = snapToCodePointBoundary(value, Math.min(start, end));
  const last = snapToCodePointBoundary(value, Math.max(start, end));
  const sampleCount = Math.max(1, Math.min(Math.floor(budget), last - first + 1));
  if (sampleCount === 1) return [first];

  const samples = new Set<number>();
  for (let index = 0; index < sampleCount; index += 1) {
    const rawOffset = Math.round(first + ((last - first) * index) / (sampleCount - 1));
    samples.add(snapToCodePointBoundary(value, rawOffset));
  }
  return [...samples].sort((left, right) => left - right);
}

/** Pure boundary policy, kept separate so modifiers and selections remain native. */
export function shouldNavigateAcrossVisualEdge(input: {
  direction: VerticalDirection;
  hasSelection: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  caretAtVisualEdge: boolean;
}): boolean {
  return (
    !input.hasSelection &&
    !input.shiftKey &&
    !input.metaKey &&
    !input.ctrlKey &&
    !input.altKey &&
    input.caretAtVisualEdge
  );
}

export function isImeCompositionKeyDown(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">
): boolean {
  return event.isComposing || event.keyCode === 229;
}
