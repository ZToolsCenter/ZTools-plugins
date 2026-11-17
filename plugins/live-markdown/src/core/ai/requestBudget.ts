import { estimateAiTokens } from "./markdownChunker";

export const LOCAL_AI_CONTEXT_LIMIT = 4096;
export const LOCAL_AI_MAX_OUTPUT_TOKENS = 2048;
export const LOCAL_AI_SAFETY_TOKENS = 160;

export interface LocalAiBudget {
  contextTokens: number;
  maxTokens: number;
}

export function calculateLocalAiBudget(prompt: string, systemPrompt: string, maxTokens = 1024, contextLimit = LOCAL_AI_CONTEXT_LIMIT): LocalAiBudget {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > LOCAL_AI_MAX_OUTPUT_TOKENS) {
    throw new Error(`本地模型输出预算必须为 1–${LOCAL_AI_MAX_OUTPUT_TOKENS} tokens。`);
  }
  const effectiveLimit = Math.min(contextLimit, LOCAL_AI_CONTEXT_LIMIT);
  const contextTokens = estimateAiTokens(prompt) + estimateAiTokens(systemPrompt) + maxTokens + LOCAL_AI_SAFETY_TOKENS;
  if (contextTokens > effectiveLimit) throw new Error(`请求超过本地模型 ${effectiveLimit} token 上下文预算，请缩小处理范围。`);
  return { contextTokens, maxTokens };
}
