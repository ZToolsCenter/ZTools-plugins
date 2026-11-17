import { AiDocumentSnapshot, AiEditProposal, AiEditPatch } from "../../types/aiEditing";
import { isMarkdownTableDelimiterRow } from "../markdownTable";
import { isSafeMarkdownBoundary } from "./intentTargets";

export function isCurrentAiSnapshot(
  proposed: AiDocumentSnapshot,
  current: AiDocumentSnapshot
): boolean {
  return proposed.documentId === current.documentId &&
    proposed.revision === current.revision &&
    proposed.content === current.content &&
    proposed.readOnly === current.readOnly &&
    proposed.selectionValid === current.selectionValid &&
    sameRange(proposed.selection, current.selection) &&
    proposed.cursor === current.cursor;
}

/** Checks only the snapshot inputs that the resolved proposal actually depends on. */
export function isAiProposalCurrent(proposal: AiEditProposal, current: AiDocumentSnapshot): boolean {
  const proposed = proposal.snapshot;
  if (proposed.documentId !== current.documentId || proposed.revision !== current.revision ||
      proposed.content !== current.content || proposed.readOnly !== current.readOnly) return false;
  if (proposal.dependency === "document") return true;
  if (proposal.dependency === "selection") {
    return proposed.selectionValid !== false && current.selectionValid !== false && sameRange(proposed.selection, current.selection);
  }
  if (proposal.dependency === "cursor") return proposed.cursor === current.cursor;
  return proposed.selectionValid !== false && current.selectionValid !== false && isCurrentAiSnapshot(proposed, current);
}

function sameRange(a: AiDocumentSnapshot["selection"], b: AiDocumentSnapshot["selection"]): boolean {
  return a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
}

function isBlockMarkdownFragment(text: string): boolean {
  const lines = text.split(/\r\n|\n|\r/);
  const meaningful = lines.filter((line) => line.trim());
  if (meaningful.length === 0) return false;
  const first = meaningful[0];
  const last = meaningful[meaningful.length - 1];

  const openingFence = first.match(/^ {0,3}(`{3,}|~{3,})/);
  const closingFence = last.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  if (openingFence && closingFence && openingFence[1][0] === closingFence[1][0] && closingFence[1].length >= openingFence[1].length) {
    return true;
  }
  if (/^ {0,3}\$\$/.test(first) && (/^ {0,3}\$\$\s*$/.test(last) || /^ {0,3}\$\$.*\$\$\s*$/.test(first))) {
    return true;
  }
  if (first.includes("|") && meaningful.length > 1 && isMarkdownTableDelimiterRow(meaningful[1])) return true;
  return /^ {0,3}(?:#{1,6}\s|>|(?:[-*+]|\d+\.)\s|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(first);
}

function lineEndingFor(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function countLeadingLineBreaks(text: string): number {
  return text.match(/^(?:\r\n|\n|\r)*/)?.[0].match(/\r\n|\n|\r/g)?.length || 0;
}

function countTrailingLineBreaks(text: string): number {
  return text.match(/(?:\r\n|\n|\r)*$/)?.[0].match(/\r\n|\n|\r/g)?.length || 0;
}

function resolveInsertionText(content: string, from: number, to: number, text: string): string {
  if (!isBlockMarkdownFragment(text)) return text;
  const prefix = content.slice(0, from);
  const suffix = content.slice(to);
  const separator = lineEndingFor(content);
  let insertion = text;
  if (prefix) {
    const existingBreaks = countTrailingLineBreaks(prefix) + countLeadingLineBreaks(insertion);
    if (existingBreaks < 2) insertion = separator.repeat(2 - existingBreaks) + insertion;
  }
  if (suffix) {
    const existingBreaks = countTrailingLineBreaks(insertion) + countLeadingLineBreaks(suffix);
    if (existingBreaks < 2) insertion += separator.repeat(2 - existingBreaks);
  }
  return insertion;
}

export function resolveAiEdit(proposal: AiEditProposal): { from: number; to: number; expectedText: string; insertText: string; content: string } | null {
  const { snapshot, text, mode } = proposal;
  if (snapshot.readOnly || typeof text !== "string") return null;
  if (proposal.patch) {
    const patch = resolveExplicitPatch(snapshot.content, proposal.patch);
    if (!patch) return null;
    return { ...patch, content: snapshot.content.slice(0, patch.from) + patch.insertText + snapshot.content.slice(patch.to) };
  }
  let from: number;
  let to: number;
  if (mode === "append") {
    from = to = snapshot.content.length;
  } else if (mode === "insert") {
    if (snapshot.cursor === null) return null;
    from = to = snapshot.cursor;
  } else {
    from = snapshot.selection?.from ?? 0;
    to = snapshot.selection?.to ?? snapshot.content.length;
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > snapshot.content.length) return null;
  const expectedText = snapshot.content.slice(from, to);
  const insertText = (mode === "insert" || mode === "append")
    ? resolveInsertionText(snapshot.content, from, to, text)
    : text;
  return {
    from,
    to,
    expectedText,
    insertText,
    content: snapshot.content.slice(0, from) + insertText + snapshot.content.slice(to)
  };
}

function resolveExplicitPatch(content: string, patch: AiEditPatch): Omit<AiEditPatch, "insertText"> & Pick<AiEditPatch, "insertText"> | null {
  const { from, to, expectedText, insertText } = patch;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > content.length ||
      !isSafeMarkdownBoundary(content, from) || !isSafeMarkdownBoundary(content, to) ||
      typeof expectedText !== "string" || typeof insertText !== "string" || content.slice(from, to) !== expectedText) return null;
  return { from, to, expectedText, insertText };
}
