import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { parseLocalFrontmatterBlob } from "@/lib/local-frontmatter";

/**
 * 历史只比较用户可见的编辑器内容。
 * BlockNote 的块 id、空 children 占位，以及偶尔混入的选择/更新时间都不应制造版本。
 * 标题、正文、块类型、可见样式和非空子块仍完整参与比较。
 */
export function getHistoryContentSignature(content: BlockNoteContent): string {
  try {
    return JSON.stringify(content ?? null, (key, value) => {
      if (key === "id" || key === "updatedAt" || key === "selection") {
        return undefined;
      }
      if (key === "children" && Array.isArray(value) && value.length === 0) {
        return undefined;
      }
      return value;
    });
  } catch {
    return "__goose-note-unserializable-history-content__";
  }
}

/** 本地文件历史额外比较会影响界面的 goose 设置，忽略任意业务 YAML 元数据。 */
export function getHistoryVisibleSignature(
  content: BlockNoteContent,
  localFrontmatter?: string,
): string {
  const settings =
    localFrontmatter === undefined
      ? null
      : parseLocalFrontmatterBlob(localFrontmatter).settings;
  return JSON.stringify({
    content: getHistoryContentSignature(content),
    settings,
  });
}
