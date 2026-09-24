export interface PendingEditorCommitInput<T> {
  targetPageId: string | null | undefined;
  currentPageId: string | null;
  pending: boolean;
  content: T;
  signature: string;
  syncedSignature: string | null;
  commit: (content: T) => void;
}

export type PendingEditorCommitResult =
  | "committed"
  | "no-page"
  | "stale-page"
  | "not-pending"
  | "unchanged";

/** 同步提交编辑器最后一帧；页面 id 闸门防止旧编辑器把内容串到新页面。 */
export const commitPendingEditorChange = <T>(
  input: PendingEditorCommitInput<T>,
): PendingEditorCommitResult => {
  if (!input.targetPageId) return "no-page";
  if (input.targetPageId !== input.currentPageId) return "stale-page";
  if (!input.pending) return "not-pending";
  if (input.signature === input.syncedSignature) return "unchanged";
  input.commit(input.content);
  return "committed";
};
