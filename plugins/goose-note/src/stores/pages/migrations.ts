import type { Page } from "@/types";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";

export function flattenLegacyTitleHeadingChildren(
  content: unknown,
): { content: unknown; repaired: boolean } {
  if (!Array.isArray(content) || content.length === 0) {
    return { content, repaired: false };
  }

  const firstBlock = content[0] as Record<string, unknown> | undefined;
  if (!firstBlock || firstBlock.type !== "heading") {
    return { content, repaired: false };
  }

  const nestedChildren = Array.isArray(firstBlock.children) ? firstBlock.children : [];
  if (nestedChildren.length === 0) {
    return { content, repaired: false };
  }

  const { children: _ignoredChildren, ...titleWithoutChildren } = firstBlock;
  const normalizedTitle = {
    ...titleWithoutChildren,
    props: {
      ...(typeof firstBlock.props === "object" && firstBlock.props
        ? (firstBlock.props as Record<string, unknown>)
        : {}),
      level: 1,
    },
  };

  return {
    content: [
      normalizedTitle,
      ...nestedChildren,
      ...content.slice(1),
    ],
    repaired: true,
  };
}

export function repairLegacyTitleChildrenInPages(
  pages: Record<string, Page>,
): { pages: Record<string, Page>; repairedPageIds: string[] } {
  let nextPages = pages;
  const repairedPageIds: string[] = [];

  Object.entries(pages).forEach(([pageId, page]) => {
    const repairResult = flattenLegacyTitleHeadingChildren(page.content);
    if (!repairResult.repaired) {
      return;
    }

    if (nextPages === pages) {
      nextPages = { ...pages };
    }

    nextPages[pageId] = {
      ...page,
      content: repairResult.content as Page["content"],
    };
    repairedPageIds.push(pageId);
  });

  return { pages: nextPages, repairedPageIds };
}

export function repairNormalizedContentInPages(
  pages: Record<string, Page>,
): { pages: Record<string, Page>; repairedPageIds: string[] } {
  let nextPages = pages;
  const repairedPageIds: string[] = [];

  Object.entries(pages).forEach(([pageId, page]) => {
    const normalizedContent = normalizePageContent(page.content);
    if (JSON.stringify(page.content) === JSON.stringify(normalizedContent)) {
      return;
    }

    if (nextPages === pages) {
      nextPages = { ...pages };
    }

    nextPages[pageId] = {
      ...page,
      content: normalizedContent,
    };
    repairedPageIds.push(pageId);
  });

  return { pages: nextPages, repairedPageIds };
}
