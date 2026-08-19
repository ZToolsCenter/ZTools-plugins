import type { JSONContent } from "@/types";
import { extractTextFromContent, extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { importFromMarkdown, importMarkdownFragment } from "@/lib/export";
import type { AiResolvedTarget, AiWritePlan } from "./targetResolution";

// ── Internal helpers ─────────────────────────────────────────────────────────

function cloneContent<T>(value: T): T {
  return structuredClone(value) as T;
}

function createPlainTextDoc(text: string, title?: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({
      type: "paragraph",
      content: [{ type: "text", text: item }],
    }));

  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        ...(title
          ? {
              content: [{ type: "text", text: title }],
            }
          : {}),
      },
      ...paragraphs,
    ],
  } satisfies JSONContent;
}

function setTitleOnContent(content: JSONContent, title: string) {
  const next = cloneContent(content);
  const blocks = next.content ?? [];
  const titleBlock = {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }],
  } satisfies JSONContent;

  if (blocks[0]?.type === "heading" && blocks[0].attrs?.level === 1) {
    blocks[0] = titleBlock;
  } else {
    blocks.unshift(titleBlock);
  }

  next.content = blocks;
  return next;
}

function stripLeadingTitle(content: JSONContent) {
  const next = cloneContent(content);
  const blocks = next.content ?? [];
  if (blocks[0]?.type === "heading" && blocks[0].attrs?.level === 1) {
    next.content = blocks.slice(1);
  }
  return next;
}

export function inferTitleFromContent(content: JSONContent, fallback = "AI 生成") {
  const title = extractTitleFromContent(content).trim();
  if (title && title !== "无标题") return title;

  const fallbackText = extractTextFromContent(content)
    .split(/\n+/)
    .map((item) => item.trim())
    .find(Boolean);
  return (fallbackText || fallback).slice(0, 40) || fallback;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildAiWritePlan(params: {
  markdown: string;
  promptText: string;
  resolvedTarget: AiResolvedTarget;
}): AiWritePlan | null {
  if (params.resolvedTarget.action === "chat_only") return null;

  if (params.resolvedTarget.action === "replace_block_range") {
    const fragment = importMarkdownFragment(params.markdown);
    const fragmentContent: JSONContent | null =
      fragment && fragment.length ? (cloneContent(fragment) as JSONContent) : null;
    const fallbackContent =
      fragmentContent ?? createPlainTextDoc(params.markdown);
    const previewTitle =
      params.resolvedTarget.range?.rangeLabel
        ? `重写：${params.resolvedTarget.range.rangeLabel}`
        : "重写选中范围";

    return {
      action: params.resolvedTarget.action,
      target: params.resolvedTarget,
      promptText: params.promptText,
      outputMarkdown: params.markdown.trim(),
      previewTitle,
      content: fallbackContent,
      status: "pending",
    } satisfies AiWritePlan;
  }

  const imported = importFromMarkdown(params.markdown);
  let content =
    imported.success && imported.content.length
      ? cloneContent(imported.content)
      : createPlainTextDoc(params.markdown);

  let previewTitle = inferTitleFromContent(content);

  if (params.resolvedTarget.action === "replace_page") {
    previewTitle = params.resolvedTarget.pageTitle || previewTitle;
    content = setTitleOnContent(content, previewTitle);
  } else if (params.resolvedTarget.action === "append_page") {
    previewTitle = params.resolvedTarget.pageTitle || previewTitle;
    content = stripLeadingTitle(content);
  } else {
    previewTitle = inferTitleFromContent(content, previewTitle);
    content = setTitleOnContent(content, previewTitle);
  }

  return {
    action: params.resolvedTarget.action,
    target: params.resolvedTarget,
    promptText: params.promptText,
    outputMarkdown: params.markdown.trim(),
    previewTitle,
    content,
    status: "pending",
  } satisfies AiWritePlan;
}
