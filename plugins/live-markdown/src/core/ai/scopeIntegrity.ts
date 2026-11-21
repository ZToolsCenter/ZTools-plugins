import type { AiDocumentSnapshot } from "../../types/aiEditing";

export interface AiRequestScope {
  snapshot: AiDocumentSnapshot;
  source: string;
  selected: boolean;
}

/** Returns null instead of silently widening an unmappable selection to the whole file. */
export function createAiRequestScope(
  snapshot: AiDocumentSnapshot | undefined,
  fallbackContent: string,
  selectedText: string
): AiRequestScope | null {
  if (!snapshot) {
    if (!fallbackContent) return null;
    return {
      snapshot: { documentId: "preview-only", revision: -1, content: fallbackContent, selection: null, cursor: null, readOnly: true },
      source: fallbackContent,
      selected: false
    };
  }

  const selection = snapshot.selection;
  if (selectedText.trim() && (!selection || selection.to === selection.from)) return null;
  if (snapshot.selectionValid === false && selectedText.trim()) return null;
  if (!selection) return { snapshot, source: snapshot.content, selected: false };
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to < selection.from || selection.to > snapshot.content.length) return null;
  if (selection.to === selection.from) return { snapshot, source: snapshot.content, selected: false };
  return { snapshot, source: snapshot.content.slice(selection.from, selection.to), selected: true };
}

export function isAiSnapshotCurrent(start: AiDocumentSnapshot, current: AiDocumentSnapshot | undefined): boolean {
  if (!current) return false;
  return start.documentId === current.documentId &&
    start.revision === current.revision &&
    start.content === current.content &&
    start.cursor === current.cursor &&
    start.readOnly === current.readOnly &&
    start.selectionValid === current.selectionValid &&
    start.selection?.from === current.selection?.from &&
    start.selection?.to === current.selection?.to;
}

export function requireCompleteAiChunks(results: string[], expectedCount: number): string[] {
  if (results.length !== expectedCount || results.some((result) => !result.trim())) {
    throw new Error("部分内容未完成生成，结果不可应用；请重试或缩小范围。");
  }
  return results;
}
