import { createRequestID, isValidEnvelope, postToHost } from "./bridge";
import type { NativeAISelectionReplacement } from "./types";

interface PendingSelection { from: number; to: number; selectedText: string; }

const pendingSelections = new Map<string, PendingSelection>();

function nativeContext() {
  const context = window.__gooseBridgeContext;
  if (!context?.pageID || !window.webkit?.messageHandlers?.gooseNotes) return null;
  return context;
}

export function canRequestAISelection() { return nativeContext() !== null; }

export function requestAISelection(editor: any) {
  const context = nativeContext();
  if (!context) return false;
  const { selection, doc } = editor.prosemirrorState;
  const selectedText = selection.empty ? "" : doc.textBetween(selection.from, selection.to, "\n", "\n");
  if (!selectedText.trim() || selectedText.length > 16_000) return false;
  const requestID = createRequestID();
  pendingSelections.set(requestID, { from: selection.from, to: selection.to, selectedText });
  postToHost({ version: 1, type: "aiSelectionRequest", requestID, pageID: context.pageID, revision: context.revision, selectedText });
  return true;
}

export function applyAISelection(editor: any, replacement: NativeAISelectionReplacement) {
  if (!isValidEnvelope(replacement) || !replacement.selectionRequestID) return false;
  const context = nativeContext();
  if (!context || replacement.pageID !== context.pageID || replacement.revision !== context.revision) return false;
  const pending = pendingSelections.get(replacement.selectionRequestID);
  if (!pending) return false;
  const state = editor.prosemirrorState;
  if (pending.from < 0 || pending.to < pending.from || pending.to > state.doc.content.size) return false;
  if (state.doc.textBetween(pending.from, pending.to, "\n", "\n") !== pending.selectedText) return false;
  pendingSelections.delete(replacement.selectionRequestID);
  editor.prosemirrorView.dispatch(state.tr.insertText(replacement.replacement, pending.from, pending.to));
  editor.focus();
  return true;
}

export function invalidateAISelections() { pendingSelections.clear(); }
