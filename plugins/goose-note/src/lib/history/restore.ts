import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { resolveHistoryBackend } from "./backend";

/** 读取某个版本的完整内容。MVP 仅支持 snapshot 版本，直接返回 content。 */
export async function materializeVersion(
  pageId: string,
  versionId: string,
): Promise<{ content: BlockNoteContent; localFrontmatter?: string } | null> {
  const backend = resolveHistoryBackend(pageId);
  const version = await backend.loadVersion(pageId, versionId);
  if (!version) return null;
  return {
    content: version.content,
    ...(version.localFrontmatter !== undefined
      ? { localFrontmatter: version.localFrontmatter }
      : {}),
  };
}
