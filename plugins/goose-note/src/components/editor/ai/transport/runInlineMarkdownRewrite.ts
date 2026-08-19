/**
 * 行内 AI：对选区/光标块做 agent 对齐的 markdown 改写（非 xl-ai tool stream）。
 * 模型只返回 markdown 正文，由 applyMarkdownToInlineTarget 写回编辑器。
 */
import { generateText } from "ai";
import type { AISettingsLike } from "@/lib/ai-provider/types";
import {
  buildGooseAIModel,
  wrapFetchToDisableThinking,
} from "./blocknoteAITransport";

export interface RunInlineMarkdownRewriteOptions {
  settings: AISettingsLike;
  modelId: string;
  getCustomFetch?: () => typeof fetch | undefined;
  userPrompt: string;
  oldMarkdown: string;
  abortSignal?: AbortSignal;
}

const SYSTEM_PROMPT = [
  "你是笔记行内改写助手。根据用户指令改写给定的 Markdown 片段。",
  "只输出改写后的 Markdown 正文，不要解释、不要包代码围栏（除非正文本身是代码块）。",
  "保持合理的 Markdown 结构：列表项用独立的 `- ` / `1. ` / `- [ ] ` 行；列表项之间不要插空行。",
  "若用户要求生成 N 个列表项，输出 N 行列表语法，不要挤在一个段落里。",
  "不要输出页面标题（# 一级标题），只改写当前片段。",
].join("\n");

function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (match) return match[1].trim();
  return trimmed;
}

/**
 * 调用模型，将 oldMarkdown 按 userPrompt 改写为新 markdown 字符串。
 */
export async function runInlineMarkdownRewrite(
  options: RunInlineMarkdownRewriteOptions,
): Promise<string> {
  const {
    settings,
    modelId,
    getCustomFetch,
    userPrompt,
    oldMarkdown,
    abortSignal,
  } = options;

  const baseFetch = getCustomFetch?.() ?? globalThis.fetch;
  const fetchImpl = wrapFetchToDisableThinking(baseFetch);
  const model = buildGooseAIModel(settings, modelId, fetchImpl);

  const prompt = [
    "【当前片段 Markdown】",
    oldMarkdown.trim() ? oldMarkdown : "（空）",
    "",
    "【用户指令】",
    userPrompt.trim(),
    "",
    "请直接输出改写后的 Markdown：",
  ].join("\n");

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt,
    abortSignal,
    maxRetries: 1,
  });

  const text = stripOuterFence(result.text ?? "");
  if (!text) {
    throw new Error("AI 未返回可写入的内容。");
  }
  return text;
}
