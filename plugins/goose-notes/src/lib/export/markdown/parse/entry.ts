import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { ImportResult } from "../parse";
import {
  normalizeBlockContent,
  normalizePageContent,
  createEmptyBlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { markdownToJsonContent } from "./block";

export function importFromMarkdown(
  markdown: string,
  filename?: string,
  options?: {
    /**
     * 保持解析结构原样：不做「首块提升为 H1」的标题注入。
     * local-folder 导入用——无 H1 的文件首块保持段落，避免打开即改写内容。
     * 默认 false（内部导入仍走标题提升，行为不变）。
     */
    preserveStructure?: boolean;
  },
): ImportResult {
  try {
    const legacyContent = markdownToJsonContent(markdown);
    const content = normalizePageContent(legacyContent, {
      ensureFirstTitle: options?.preserveStructure !== true,
    });

    let title = filename || "导入的页面";
    if (!filename) {
      const h1Match = markdown.match(/^#\s+(.+)$/m);
      if (h1Match) {
        title = h1Match[1].trim();
      }
    }

    return { title, content, success: true };
  } catch (e) {
    return {
      title: "",
      content: createEmptyBlockNoteContent(),
      success: false,
      error: "解析 Markdown 失败",
    };
  }
}

export function importMarkdownFragment(markdown: string): BlockNoteContent | null {
  try {
    const parsed = markdownToJsonContent(markdown);
    const content = normalizeBlockContent(
      Array.isArray(parsed) ? parsed : parsed?.content,
    );
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
