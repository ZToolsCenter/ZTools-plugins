import type { JSONContent } from "@/types";
import { composerDraftHasContent } from "@/stores/useNotebookAiChats";

/**
 * 当前笔记只用于帮助空会话起步；历史会话和用户草稿都必须保持原样。
 */
export function shouldSeedCurrentPageReference(
  messageCount: number,
  draft: JSONContent | null | undefined,
) {
  return messageCount === 0 && !composerDraftHasContent(draft);
}
