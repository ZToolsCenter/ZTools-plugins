import { EditorSelection, EditorState, Prec, SelectionRange } from "@codemirror/state";
import { BlockType, EditorView, keymap } from "@codemirror/view";
import { navigationRevealLine, needsNavigationReveal, setNavigationRevealLine } from "./navigationReveal";
import { positionAtAdjacentVisualRow, positionAtVisualRow, visualLineHeight } from "./navigationCoordinates";
import { findPreviewParagraphAt } from "./softBreakPreview";

/**
 * Return the position of an adjacent empty logical line only when CM6's native
 * vertical candidate crossed past it. Empty lines have a single valid caret
 * position, so this correction preserves native movement everywhere else.
 */
export function findSkippedAdjacentEmptyLine(
  state: EditorState,
  current: SelectionRange,
  candidate: SelectionRange,
  forward: boolean,
  currentBlockRange?: { from: number; to: number }
): number | null {
  const currentLine = state.doc.lineAt(current.head);
  const currentLines = currentBlockRange
    ? sourceLinesForTextBlock(state, currentBlockRange)
    : { first: currentLine, last: currentLine, count: 1 };
  if (!currentLines) return null;
  const targetNumber = currentLines.first.number + (forward ? currentLines.count : -1);
  if (targetNumber < 1 || targetNumber > state.doc.lines) return null;

  const targetLine = state.doc.line(targetNumber);
  if (targetLine.length !== 0) return null;

  const passedTargetInDirection = forward ? candidate.head > targetLine.to : candidate.head < targetLine.from;
  const stayedInCurrentBlock = currentBlockRange
    ? candidate.head >= currentBlockRange.from && candidate.head <= currentBlockRange.to
    : currentLine.length === 0 && candidate.head === currentLine.from;
  return passedTargetInDirection || stayedInCurrentBlock ? targetLine.from : null;
}

export function correctSkippedAdjacentLine(view: EditorView, forward: boolean): boolean {
  const state = view.state;
  const selection = state.selection;
  const current = selection.main;
  if (selection.ranges.length !== 1 || !current.empty || state.readOnly
    || !state.facet(EditorView.editable) || view.composing || view.compositionStarted) return false;

  const currentBlock = view.lineBlockAt(current.head);
  if (currentBlock.type !== BlockType.Text) return false;
  const currentLines = sourceLinesForTextBlock(state, currentBlock);
  if (!currentLines) return false;
  const currentPreviewParagraph = findPreviewParagraphAt(state, current.head);
  // Soft-flow paragraphs are one rendered block across several source lines.
  // Native movement can jump from an interior visual row directly to the next
  // block, so first repair only candidates that left this merged block or
  // landed more than one visual row away.
  let mergedCandidate: SelectionRange | null = null;
  if (currentLines.count > 1 && currentPreviewParagraph?.from === currentBlock.from
    && currentPreviewParagraph.to === currentBlock.to) {
    const nativeCandidate = mergedCandidate = view.moveVertically(current, forward);
    if (nativeCandidateSkippedVisualRow(view, current, nativeCandidate, currentBlock, forward)) {
      const adjacent = positionAtAdjacentVisualRow(
        view,
        current,
        nativeCandidate.goalColumn ?? current.goalColumn ?? null,
        currentBlock,
        forward
      );
      if (adjacent && !isAtomicPosition(view, adjacent.pos)) {
        dispatchNavigationSelection(view, adjacent.pos, nativeCandidate, current, false, adjacent.assoc);
        return true;
      }
    }
  }

  const targetNumber = currentLines.first.number + (forward ? currentLines.count : -1);
  if (targetNumber < 1 || targetNumber > state.doc.lines) return false;
  const targetLine = state.doc.line(targetNumber);

  // An empty logical line has exactly one caret row. For text lines, compare
  // actual public caret geometry with the directional source-line endpoint;
  // CM6's moveToLineBoundary can itself skip an adjacent empty row here.
  if (!isAtCurrentVisualBoundary(view, current, currentBlock, forward)) return false;

  const revealField = state.field(navigationRevealLine, false);
  if (revealField === undefined) return false;

  const originalSelection = state.selection;
  const targetNeedsReveal = targetLine.length > 0 && needsNavigationReveal(state, targetLine, current.head);
  const previewParagraph = targetNeedsReveal ? findPreviewParagraphAt(state, targetLine.from) : null;
  const revealRange = previewParagraph ?? { from: targetLine.from, to: targetLine.to };
  let revealActive = false;
  try {
    if (targetNeedsReveal) {
      view.dispatch({ effects: setNavigationRevealLine.of(revealRange) });
      revealActive = true;
      if (view.state.doc !== state.doc || !view.state.selection.eq(originalSelection)) return false;
    }

    // Target replacement/reveal decorations can alter CM6's height map. Check
    // exact editable source-line blocks and calculate the native destination
    // only after the effect-only reveal transaction has rebuilt decorations.
    const targetBlock = view.lineBlockAt(targetLine.from);
    if (targetBlock.type !== BlockType.Text) return false;
    const targetLines = sourceLinesForTextBlock(state, targetBlock);
    if (!targetLines || targetLine.number < targetLines.first.number || targetLine.number > targetLines.last.number) return false;
    const candidate = targetNeedsReveal || !mergedCandidate
      ? view.moveVertically(current, forward)
      : mergedCandidate;
    const candidateInTarget = candidate.head >= targetBlock.from && candidate.head <= targetBlock.to;
    const candidateInCurrent = candidate.head >= currentBlock.from && candidate.head <= currentBlock.to;
    const passedTarget = forward ? candidate.head > targetBlock.to : candidate.head < targetBlock.from;
    const skippedTarget = !candidateInTarget && (candidateInCurrent || passedTarget);

    if (targetLine.length === 0) {
      const correction = findSkippedAdjacentEmptyLine(state, current, candidate, forward, currentBlock);
      if (correction === null || isAtomicPosition(view, correction)) return false;
      dispatchNavigationSelection(view, correction, candidate, current, revealActive);
      revealActive = false;
      return true;
    }

    if (!skippedTarget && !(candidateInTarget && targetNeedsReveal)) return false;

    const targetGeometry = { from: targetBlock.from, to: targetBlock.to };
    const hit = findTargetVisualRowPosition(view, current, candidate, targetGeometry, forward);
    if (!hit || isAtomicPosition(view, hit.pos)) return false;
    const destination = EditorSelection.cursor(
      hit.pos,
      hit.assoc,
      candidate.bidiLevel ?? undefined,
      candidate.goalColumn ?? current.goalColumn
    );
    view.dispatch({
      selection: EditorSelection.create([destination]),
      effects: revealActive ? setNavigationRevealLine.of(null) : undefined,
      scrollIntoView: true,
      userEvent: "select"
    });
    revealActive = false;
    return true;
  } finally {
    // The pre-reveal transaction never changes selection. Clear it synchronously
    // on every fallback path so no transient layout leaks into later editing.
    if (revealActive && view.state.doc === state.doc) {
      view.dispatch({ effects: setNavigationRevealLine.of(null) });
    }
  }
}

function isAtCurrentVisualBoundary(
  view: EditorView,
  current: SelectionRange,
  block: { from: number; to: number },
  forward: boolean
): boolean {
  if (block.from === block.to) return true;
  const currentCoords = view.coordsAtPos(current.head, current.assoc || (forward ? -1 : 1));
  const boundaryCoords = view.coordsAtPos(forward ? block.to : block.from, forward ? -1 : 1);
  if (!currentCoords || !boundaryCoords) return false;
  const currentCenter = (currentCoords.top + currentCoords.bottom) / 2;
  const boundaryCenter = (boundaryCoords.top + boundaryCoords.bottom) / 2;
  const rowHeight = Math.max(
    currentCoords.bottom - currentCoords.top,
    boundaryCoords.bottom - boundaryCoords.top
  );
  return Math.abs(currentCenter - boundaryCenter) <= Math.max(2, rowHeight * 0.4);
}

function nativeCandidateSkippedVisualRow(
  view: EditorView,
  current: SelectionRange,
  candidate: SelectionRange,
  block: { from: number; to: number },
  forward: boolean
): boolean {
  if (candidate.head < block.from || candidate.head > block.to) return true;
  if (typeof view.coordsAtPos !== "function") return false;
  const currentCoords = view.coordsAtPos(current.head, current.assoc || (forward ? 1 : -1));
  const candidateCoords = view.coordsAtPos(candidate.head, candidate.assoc || (forward ? 1 : -1));
  const lineHeight = visualLineHeight(view, current.head);
  if (!currentCoords || !candidateCoords || !Number.isFinite(lineHeight) || lineHeight <= 0) return false;
  const currentCenter = (currentCoords.top + currentCoords.bottom) / 2;
  const candidateCenter = (candidateCoords.top + candidateCoords.bottom) / 2;
  const expectedCenter = currentCenter + (forward ? lineHeight : -lineHeight);
  return Math.abs(candidateCenter - expectedCenter) > Math.max(2, lineHeight * 0.4);
}

/**
 * Map the adjacent first/last visual row using a small band of public screen
 * coordinates. The verification rejects hits that resolved to a neighboring
 * logical or visual row.
 */
function findTargetVisualRowPosition(
  view: EditorView,
  current: SelectionRange,
  candidate: SelectionRange,
  targetLine: { from: number; to: number },
  forward: boolean
): { pos: number; assoc: -1 | 1 } | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (contentRect.width <= 0) return null;

  const targetPos = forward ? targetLine.from : targetLine.to;
  const targetCoords = view.coordsAtPos(targetPos, forward ? 1 : -1);
  if (!targetCoords) return null;
  const currentCoords = view.coordsAtPos(current.head, current.assoc || (forward ? 1 : -1));
  const goalColumn = candidate.goalColumn ?? current.goalColumn;
  const x = goalColumn == null ? currentCoords?.left : contentRect.left + goalColumn;
  if (x == null) return null;
  const targetCenter = (targetCoords.top + targetCoords.bottom) / 2;
  const currentRowHeight = currentCoords ? currentCoords.bottom - currentCoords.top : 0;
  const rowHeight = Math.max(currentRowHeight, targetCoords.bottom - targetCoords.top);
  const radius = rowHeight * 0.75;
  const step = Math.max(1, rowHeight / 12);
  let best: { pos: number; assoc: -1 | 1; distance: number } | null = null;

  // Probe the intended row center first, then a fixed small symmetric band.
  // Exact center hits avoid needless DOM/layout work on ordinary boundaries.
  const probeCount = Math.ceil(radius / step);
  for (let probe = 0; probe <= probeCount * 2; probe++) {
    const offset = probe === 0 ? 0 : Math.ceil(probe / 2) * step * (probe % 2 === 1 ? 1 : -1);
    if (Math.abs(offset) > radius) continue;
    const y = targetCenter + offset;
    const hit = positionAtVisualRow(
      view,
      x,
      y,
      targetLine,
      targetCenter,
      Math.max(2, rowHeight * 0.4)
    );
    if (!hit) continue;
    if (!best || hit.distance < best.distance) best = hit;
    if (hit.distance <= 1) break;
  }
  return best ? { pos: best.pos, assoc: best.assoc } : null;
}

function sourceLinesForTextBlock(
  state: EditorState,
  block: { from: number; to: number }
): { first: { number: number }; last: { number: number }; count: number } | null {
  if (block.from < 0 || block.to < block.from || block.to > state.doc.length) return null;
  const first = state.doc.lineAt(block.from);
  let last = state.doc.lineAt(block.to);
  if (block.to > block.from && last.from === block.to) last = state.doc.line(last.number - 1);
  if (first.from !== block.from || last.to !== block.to) return null;
  return { first, last, count: last.number - first.number + 1 };
}

function dispatchNavigationSelection(
  view: EditorView,
  position: number,
  candidate: SelectionRange,
  current: SelectionRange,
  clearReveal = false,
  positionAssoc?: -1 | 1
): void {
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.cursor(position, positionAssoc ?? candidate.assoc, candidate.bidiLevel ?? undefined, candidate.goalColumn ?? current.goalColumn)
    ]),
    effects: clearReveal ? setNavigationRevealLine.of(null) : undefined,
    scrollIntoView: true,
    userEvent: "select"
  });
}

function isAtomicPosition(view: EditorView, pos: number): boolean {
  return view.state.facet(EditorView.atomicRanges).some((getRanges) => {
    let atomic = false;
    getRanges(view).between(Math.max(0, pos - 1), Math.min(view.state.doc.length, pos + 1), (from, to) => {
      if (from < to && from <= pos && pos < to) {
        atomic = true;
        return false;
      }
    });
    return atomic;
  });
}

/**
 * Keep CM6's native movement as the default and repair only a proven skipped
 * empty-line or short-text-row boundary. Prec.high leaves the editor's
 * Prec.highest slash-command menu in control before the default keymap.
 */
export const cm6VerticalNavigation = [navigationRevealLine, Prec.high(keymap.of([
  { key: "ArrowUp", run: (view) => correctSkippedAdjacentLine(view, false) },
  { key: "ArrowDown", run: (view) => correctSkippedAdjacentLine(view, true) }
]))];
