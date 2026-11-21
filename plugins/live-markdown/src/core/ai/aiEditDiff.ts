import type { DiffLine, DiffResult } from "../diffEngine";
import { computeDocumentDiff } from "../diffEngine";
import { isAiProposalCurrent, resolveAiEdit } from "./editProposal";
import type { AiEditProposal, AiDocumentSnapshot } from "../../types/aiEditing";

export interface AiEditDiffPreview {
  diffResult: DiffResult;
  unlocated: boolean;
  omittedBefore: boolean;
  omittedAfter: boolean;
  stale: boolean;
}

function lineWindow(content: string, from: number, to: number, context = 12): { start: number; end: number; lineOffset: number } {
  let start = Math.max(0, Math.min(from, content.length));
  let before = context;
  while (start > 0 && before > 0) {
    start -= 1;
    if (content[start] === "\n" || content[start] === "\r") {
      if (content[start] === "\n" && start > 0 && content[start - 1] === "\r") start -= 1;
      before -= 1;
    }
  }
  while (start > 0 && content[start - 1] !== "\n" && content[start - 1] !== "\r") start -= 1;
  let end = Math.max(0, Math.min(to, content.length));
  let after = context;
  while (end < content.length && after > 0) {
    if (content[end] === "\r" || content[end] === "\n") {
      if (content[end] === "\r" && content[end + 1] === "\n") end += 1;
      after -= 1;
    }
    end += 1;
  }
  while (end < content.length && content[end] !== "\r" && content[end] !== "\n") end += 1;
  const beforeText = content.slice(0, start);
  const lineOffset = (beforeText.match(/\r\n|\r|\n/g) || []).length;
  return { start, end, lineOffset };
}

function offsetLineNumbers(diff: DiffResult, offset: number): DiffResult {
  if (!offset) return diff;
  return {
    ...diff,
    lines: diff.lines.map((line) => ({ ...line,
      oldLineNo: line.oldLineNo === undefined ? undefined : line.oldLineNo + offset,
      newLineNo: line.newLineNo === undefined ? undefined : line.newLineNo + offset
    })),
    sideBySideRows: diff.sideBySideRows.map((row) => ({
      left: row.left && { ...row.left, lineNo: row.left.lineNo + offset },
      right: row.right && { ...row.right, lineNo: row.right.lineNo + offset }
    }))
  };
}

function addedOnlyDiff(text: string): DiffResult {
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  const diffLines: DiffLine[] = lines.map((content, index) => ({ type: "added", newLineNo: index + 1, content }));
  return {
    lines: diffLines,
    sideBySideRows: diffLines.map((line) => ({ right: { lineNo: line.newLineNo!, content: line.content, type: "added" } })),
    stats: { addedLines: lines.length, deletedLines: 0, unchangedLines: 0, addedChars: text.length, deletedChars: 0 }
  };
}

export function buildAiEditDiff(proposal: AiEditProposal, currentSnapshot?: AiDocumentSnapshot): AiEditDiffPreview {
  const { snapshot, text } = proposal;
  const stale = !!currentSnapshot && !isAiProposalCurrent(proposal, currentSnapshot);
  const edit = resolveAiEdit(proposal);
  if (!edit) {
    return { diffResult: addedOnlyDiff(text), unlocated: true, omittedBefore: false, omittedAfter: false, stale };
  }
  if (edit.from !== edit.to) {
    return { diffResult: computeDocumentDiff(edit.expectedText, edit.insertText), unlocated: false, omittedBefore: false, omittedAfter: false, stale };
  }
  return buildInsertionPreview(snapshot.content, edit.from, edit.to, edit.insertText, stale);
}

function buildInsertionPreview(content: string, from: number, to: number, insertText: string, stale: boolean): AiEditDiffPreview {
  const window = lineWindow(content, from, to);
  const prefix = content.slice(window.start, from);
  const suffix = content.slice(to, window.end);
  const oldText = prefix + suffix;
  const newText = prefix + insertText + suffix;
  const diffResult = offsetLineNumbers(computeDocumentDiff(oldText, newText), window.lineOffset);
  return {
    diffResult,
    unlocated: false,
    omittedBefore: window.start > 0,
    omittedAfter: window.end < content.length,
    stale
  };
}
