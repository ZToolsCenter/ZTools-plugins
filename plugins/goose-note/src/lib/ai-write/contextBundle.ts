import type { Page } from "@/types";
import { extractBlocksInRange } from "@/lib/ai-block-scope";
import { extractStructureSummary } from "@/components/editor/utils/content-text-extractor";
import { jsonContentToMarkdown } from "@/lib/export";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import {
  formatAiReferenceContextBlock,
  resolveAiReferenceContexts,
  type AiComposerPayload,
} from "@/components/editor/ai/composer/referenceLookup";
import type { AiContextBundle, AiResolvedTarget } from "./targetResolution";

// ── Internal helpers ─────────────────────────────────────────────────────────

function getPageContextBlock(page: Page | undefined, label: string) {
  if (!page || page.isFolder) return "";

  // 使用结构摘要替代全文，大幅节省 token
  const summary = extractStructureSummary(page.content);
  if (!summary || summary === "（空白页面）") return "";
  return `${label}：\n${summary}`;
}

function getWriteInstruction(resolvedTarget: AiResolvedTarget) {
  switch (resolvedTarget.action) {
    case "replace_page":
      return `写入目标：替换页面「${resolvedTarget.pageTitle || "当前页面"}」的全部内容。请输出完整 Markdown 页面内容，第一行必须是一级标题。不要解释，不要使用代码围栏。`;
    case "append_page":
      return `写入目标：把内容追加到页面「${resolvedTarget.pageTitle || "当前页面"}」末尾。请输出用于追加的 Markdown 片段，不要以一级标题开头。不要解释，不要使用代码围栏。`;
    case "replace_block_range":
      return `写入目标：仅替换页面「${resolvedTarget.pageTitle || "当前页面"}」中「${resolvedTarget.range?.rangeLabel ?? "指定范围"}」对应的 ${resolvedTarget.range?.blockCount ?? "若干"} 个块。只输出替换后的 Markdown 片段，不要包含一级标题，不要解释，不要使用代码围栏。可以根据需要把内容调整为段落、有序/无序列表、二级及以下标题等结构。`;
    case "create_root_page":
      return `写入目标：在笔记本「${resolvedTarget.notebookName || "当前笔记本"}」根目录创建新页面。请输出完整 Markdown 页面，第一行必须是一级标题作为页面标题。不要解释，不要使用代码围栏。`;
    case "create_child_page":
      return `写入目标：在「${resolvedTarget.pageTitle || "目标页面"}」下面创建新页面。请输出完整 Markdown 页面，第一行必须是一级标题作为页面标题。不要解释，不要使用代码围栏。`;
    default:
      return "";
  }
}

function getRangeContextBlock(resolvedTarget: AiResolvedTarget): string {
  if (resolvedTarget.action !== "replace_block_range") return "";
  if (!resolvedTarget.pageId || !resolvedTarget.range) return "";
  const page = usePages.getState().pages[resolvedTarget.pageId];
  if (!page) return "";
  const blocks = Array.isArray(page.content)
    ? (page.content as any[])
    : Array.isArray((page.content as any)?.content)
      ? ((page.content as any).content as any[])
      : [];
  const slice = extractBlocksInRange(
    blocks,
    resolvedTarget.range.startBlockId,
    resolvedTarget.range.endBlockId,
  );
  if (!slice?.length) return "";
  const markdown = jsonContentToMarkdown(slice as any).trim();
  if (!markdown) return "";
  return `以下是要重写的区段（${resolvedTarget.range.rangeLabel} · 共 ${resolvedTarget.range.blockCount} 块）：\n${markdown}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildAiContextBundle(params: {
  payload: AiComposerPayload;
  resolvedTarget: AiResolvedTarget;
  originPageId?: string | null;
}): AiContextBundle {
  const destinationPageId =
    params.resolvedTarget.action === "replace_page" ||
    params.resolvedTarget.action === "append_page"
      ? params.resolvedTarget.pageId
      : params.resolvedTarget.action === "create_child_page"
        ? params.resolvedTarget.parentId
        : undefined;

  const filteredReferences = params.payload.references.filter(
    (reference) => reference.pageId !== destinationPageId,
  );

  return {
    referenceContextBlock: formatAiReferenceContextBlock(
      resolveAiReferenceContexts(filteredReferences, usePages.getState().pages, useNotebooks.getState().notebooks),
    ),
    originContextBlock: getPageContextBlock(
      params.originPageId
        ? usePages.getState().pages[params.originPageId]
        : undefined,
      "当前页面内容",
    ),
    targetContextBlock: getPageContextBlock(
      destinationPageId
        ? usePages.getState().pages[destinationPageId]
        : undefined,
      params.resolvedTarget.action === "create_child_page"
        ? "父页面内容"
        : "目标页面当前内容",
    ),
  } satisfies AiContextBundle;
}

export function buildAiWorkspaceUserPrompt(params: {
  promptText: string;
  resolvedTarget: AiResolvedTarget;
  contextBundle: AiContextBundle;
}) {
  if (params.resolvedTarget.action === "chat_only") {
    return [
      "用户问题：",
      params.promptText,
      params.contextBundle.originContextBlock,
      params.contextBundle.referenceContextBlock
        ? `补充上下文：\n${params.contextBundle.referenceContextBlock}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "用户需求：",
    params.promptText,
    getWriteInstruction(params.resolvedTarget),
    getRangeContextBlock(params.resolvedTarget),
    params.contextBundle.originContextBlock,
    params.contextBundle.targetContextBlock,
    params.contextBundle.referenceContextBlock
      ? `补充上下文：\n${params.contextBundle.referenceContextBlock}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
