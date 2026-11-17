import { historyField } from "@codemirror/commands";
import { EditorState, Extension } from "@codemirror/state";

export interface CM6HistorySnapshot {
  documentId: string;
  content: string;
  state: Record<string, unknown>;
}

export function captureCM6HistorySnapshot(documentId: string, state: EditorState): CM6HistorySnapshot {
  return {
    documentId,
    content: state.doc.toString(),
    state: state.toJSON({ history: historyField }) as Record<string, unknown>
  };
}

export function isCM6HistorySnapshotFor(
  snapshot: CM6HistorySnapshot | null | undefined,
  documentId: string,
  content: string
): snapshot is CM6HistorySnapshot {
  return !!snapshot && snapshot.documentId === documentId && snapshot.content === content && snapshot.state.doc === content;
}

export function restoreCM6EditorState(
  documentId: string,
  content: string,
  extensions: Extension[],
  snapshot?: CM6HistorySnapshot | null
): EditorState {
  if (isCM6HistorySnapshotFor(snapshot, documentId, content)) {
    try {
      return EditorState.fromJSON(snapshot.state, { extensions }, { history: historyField });
    } catch {
      // A stale or incompatible history payload should never prevent editor startup.
    }
  }
  return EditorState.create({ doc: content, extensions });
}
