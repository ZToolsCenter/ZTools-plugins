import type { AiDocumentSnapshot } from "../../types/aiEditing";

/** Editing remains available; computations tied to an older document stop early. */
export function isTaskDocumentCurrent(start: AiDocumentSnapshot, current: AiDocumentSnapshot | undefined, dependency: boolean | "document" | "selection" | "cursor"): boolean {
  if (!current) return start.documentId === "preview-only";
  if (start.documentId !== current.documentId || start.revision !== current.revision || start.content !== current.content || start.readOnly !== current.readOnly) return false;
  if (dependency === "cursor") return start.cursor === current.cursor;
  if (dependency !== true && dependency !== "selection") return true;
  return current.selectionValid !== false && start.selectionValid !== false && start.selection?.from === current.selection?.from && start.selection?.to === current.selection?.to;
}
