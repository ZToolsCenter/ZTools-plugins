export interface AiDocumentSnapshot {
  documentId: string;
  revision: number;
  content: string;
  /** Selection used as input scope; null means process the current document. */
  selection: { from: number; to: number } | null;
  cursor: number | null;
  /** False when a legacy editor cannot provide trustworthy source offsets. */
  selectionValid?: boolean;
  readOnly: boolean;
}

export interface AiEditProposal {
  snapshot: AiDocumentSnapshot;
  text: string;
  mode: "replace" | "insert" | "append";
  /** Explicit source patch; when present, mode is presentation metadata only. */
  patch?: AiEditPatch;
  summary?: string;
  dependency?: "document" | "selection" | "cursor";
}

export interface AiEditPatch {
  from: number;
  to: number;
  expectedText: string;
  insertText: string;
}
