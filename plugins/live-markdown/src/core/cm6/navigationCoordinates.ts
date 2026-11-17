import { EditorView } from "@codemirror/view";
import type { SelectionRange } from "@codemirror/state";

export interface VisualRowTarget {
  from: number;
  to: number;
  number?: number;
}

export interface VisualRowPosition {
  pos: number;
  assoc: -1 | 1;
  distance: number;
}

type VisualRowCandidate = Pick<VisualRowPosition, "pos" | "assoc">;

/**
 * Resolve a screen point against the rendered editable DOM first. CM6's
 * heightmap lookup can map the last pixels of a short row to a neighboring
 * block, while the browser's caret hit-test still identifies the actual text.
 * The CM6 coordinate API remains the fallback for unsupported DOM APIs.
 */
export function positionAtVisualRow(
  view: EditorView,
  x: number,
  y: number,
  target: VisualRowTarget,
  targetCenter: number,
  tolerance: number
): VisualRowPosition | null {
  const rendered = nativeDOMPosition(view, x, y);
  const renderedPosition = rendered && validateVisualRowPosition(view, rendered, target, targetCenter, tolerance);
  if (renderedPosition) return renderedPosition;

  const cmPosition = view.posAndSideAtCoords({ x, y });
  return cmPosition
    ? validateVisualRowPosition(view, { pos: cmPosition.pos, assoc: cmPosition.assoc < 0 ? -1 : 1 }, target, targetCenter, tolerance)
    : null;
}

/** Find the adjacent rendered row inside a merged text block. */
export function positionAtAdjacentVisualRow(
  view: EditorView,
  current: SelectionRange,
  goalColumn: number | null,
  block: { from: number; to: number },
  forward: boolean
): VisualRowPosition | null {
  if (typeof view.coordsAtPos !== "function") return null;
  const currentCoords = view.coordsAtPos(current.head, current.assoc || (forward ? 1 : -1));
  if (!currentCoords) return null;

  const lineHeight = visualLineHeight(view, current.head);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const targetCenter = (currentCoords.top + currentCoords.bottom) / 2 + (forward ? lineHeight : -lineHeight);
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (contentRect.width <= 0) return null;
  const x = goalColumn == null ? currentCoords.left : contentRect.left + goalColumn;
  const tolerance = Math.max(2, lineHeight * 0.4);
  const radius = lineHeight * 0.75;
  const step = Math.max(1, lineHeight / 12);
  const probeCount = Math.ceil(radius / step);
  let best: VisualRowPosition | null = null;

  for (let probe = 0; probe <= probeCount * 2; probe++) {
    const offset = probe === 0 ? 0 : Math.ceil(probe / 2) * step * (probe % 2 === 1 ? 1 : -1);
    if (Math.abs(offset) > radius) continue;
    const hit = positionAtVisualRow(view, x, targetCenter + offset, block, targetCenter, tolerance);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
    if (hit.distance <= 1) break;
  }
  return best;
}

export function visualLineHeight(view: EditorView, pos: number): number {
  try {
    const { node } = view.domAtPos(pos);
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const line = element?.closest(".cm-line");
    if (!line || !view.contentDOM.contains(line)) return view.defaultLineHeight;
    const parsed = Number.parseFloat(line.ownerDocument.defaultView?.getComputedStyle(line).lineHeight ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : view.defaultLineHeight;
  } catch {
    return view.defaultLineHeight;
  }
}

function validateVisualRowPosition(
  view: EditorView,
  candidate: VisualRowCandidate,
  target: VisualRowTarget,
  targetCenter: number,
  tolerance: number
): VisualRowPosition | null {
  if (candidate.pos < target.from || candidate.pos > target.to
    || (target.number !== undefined && view.state.doc.lineAt(candidate.pos).number !== target.number)) return null;

  let best: VisualRowPosition | null = null;
  for (const assoc of [candidate.assoc, candidate.assoc === 1 ? -1 : 1] as const) {
    const coords = view.coordsAtPos(candidate.pos, assoc);
    if (!coords) continue;
    const distance = Math.abs((coords.top + coords.bottom) / 2 - targetCenter);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { pos: candidate.pos, assoc, distance };
    }
  }
  return best;
}

function nativeDOMPosition(view: EditorView, x: number, y: number): VisualRowCandidate | null {
  const documentRef = view.contentDOM.ownerDocument;
  try {
    const caretPosition = documentRef.caretPositionFromPoint?.(x, y);
    if (caretPosition && isWithinContent(view, caretPosition.offsetNode)) {
      const pos = view.posAtDOM(caretPosition.offsetNode, caretPosition.offset);
      if (Number.isInteger(pos)) return { pos, assoc: 1 };
    }
  } catch {
    // Detached or unsupported DOM nodes fall through to CM6's public hit-test.
  }

  try {
    const range = documentRef.caretRangeFromPoint?.(x, y);
    if (range && isWithinContent(view, range.startContainer)) {
      const pos = view.posAtDOM(range.startContainer, range.startOffset);
      if (Number.isInteger(pos)) return { pos, assoc: 1 };
    }
  } catch {
    // The CM6 coordinate lookup below remains the safe fallback.
  }
  return null;
}

function isWithinContent(view: EditorView, node: Node): boolean {
  return node === view.contentDOM || view.contentDOM.contains(node);
}
