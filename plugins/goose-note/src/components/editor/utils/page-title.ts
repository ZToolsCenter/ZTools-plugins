import type { JSONContent, Page } from "@/types";
import { extractTitleFromContent } from "./content-text-extractor";

export const UNTITLED_PAGE_TITLE = "未命名";

export function normalizePageTitle(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? "";
  return !trimmed || trimmed === "无标题" ? UNTITLED_PAGE_TITLE : trimmed;
}

/**
 * 极简工作区的内部页面仍把标题持久化在首个 H1 中，但标题只由顶栏编辑。
 * 正文编辑器可能持有改名前的文档快照；保存正文前用此函数合并最新标题，
 * 避免旧快照把刚改好的名称覆盖回去。
 */
export function withInternalPageTitle(
  content: JSONContent,
  title: string,
): JSONContent {
  const nextContent = structuredClone(content);
  const normalizedTitle = normalizePageTitle(title);

  if (Array.isArray(nextContent)) {
    const first = nextContent[0] as
      | {
          type?: string;
          props?: { level?: number };
          attrs?: { level?: number };
        }
      | undefined;
    const titleBlock = {
      type: "heading",
      props: { level: 1 },
      content: normalizedTitle,
    };
    if (
      first?.type === "heading" &&
      (first.props?.level === 1 || first.attrs?.level === 1)
    ) {
      nextContent[0] = { ...nextContent[0], content: normalizedTitle };
    } else {
      nextContent.unshift(titleBlock);
    }
    return nextContent;
  }

  const legacyContent = Array.isArray(nextContent.content)
    ? nextContent.content
    : [];
  const first = legacyContent[0];
  const titleInlineContent = [{ type: "text", text: normalizedTitle }];
  if (first?.type === "heading" && first.attrs?.level === 1) {
    legacyContent[0] = { ...first, content: titleInlineContent };
  } else {
    legacyContent.unshift({
      type: "heading",
      attrs: { level: 1 },
      content: titleInlineContent,
    });
  }
  return { ...nextContent, type: "doc", content: legacyContent };
}

export function getPageTitle(page: Page): string {
  if (page.localFilePath) {
    // 本地文件：tab/侧栏用文件名（去 .md/.markdown 后缀），不取编辑器内的 H1——
    // 文件名与文档标题是两件独立的事。
    const name = page.localFilePath.split(/[\\/]/).pop() || "";
    const stripped = name.replace(/\.(md|markdown)$/i, "").trim();
    return normalizePageTitle(stripped);
  }

  return normalizePageTitle(extractTitleFromContent(page.content));
}
