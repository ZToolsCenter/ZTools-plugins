/**
 * Provider usage 解析与 turn 级汇总。
 *
 * 策略（hybrid）：优先用 provider 回传的 usage；缺失时用文本估算。
 * 不计算费用。
 */

export type UsageSource = "provider" | "estimate" | "hybrid";

export type AgentTokenUsage = {
  /** Input / prompt tokens（末次请求或 turn 累加） */
  promptTokens: number;
  completionTokens: number;
  /** prompt + completion（+ 若 provider 计入的 reasoning） */
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** 本轮 system prompt 文本的估算 token 数 */
  systemPromptTokens?: number;
  /** turn 或末次 completion 墙钟时间 */
  durationMs?: number;
  /** completionTokens / (durationMs/1000)，二者皆知时 */
  tokensPerSecond?: number;
  source: UsageSource;
  updatedAt: number;
};

/** 有限数字；否则 undefined。 */
function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/**
 * 粗估 token 数（CJK 感知）：
 * - CJK 统一汉字 / 假名 / 韩文 / 全角 ≈ 1 token/字
 * - 其余非空白字符 ≈ 1 token / 4 字符
 * - 空串 → 0
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
      (code >= 0xff00 && code <= 0xffef) // Fullwidth forms
    ) {
      cjk += 1;
    } else if (ch.trim() === "") {
      // 空白不计入
    } else {
      other += 1;
    }
  }
  const n = cjk + Math.ceil(other / 4);
  return n > 0 ? n : 0;
}

/**
 * 粗估 image part 的 token 数（无 provider usage 时的本地 fallback）。
 * base64 长度 / 750，下限 85（接近常见 vision tile 下限量级）。
 * 空串 → 0。
 */
export function estimateTokensFromImageBase64(dataBase64: string): number {
  if (!dataBase64) return 0;
  return Math.max(85, Math.ceil(dataBase64.length / 750));
}

/**
 * OpenAI Chat Completions `usage` 字段。
 * - prompt_tokens / completion_tokens / total_tokens
 * - prompt_tokens_details.cached_tokens → cacheReadTokens
 * - completion_tokens_details.reasoning_tokens → reasoningTokens
 */
export function parseOpenAIChatUsage(
  json: unknown,
): Partial<AgentTokenUsage> | null {
  const root = asRecord(json);
  if (!root) return null;
  const usage = asRecord(root.usage);
  if (!usage) return null;

  const promptTokens = asFiniteNumber(usage.prompt_tokens);
  const completionTokens = asFiniteNumber(usage.completion_tokens);
  const totalTokens = asFiniteNumber(usage.total_tokens);
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }

  const promptDetails = asRecord(usage.prompt_tokens_details);
  const completionDetails = asRecord(usage.completion_tokens_details);

  const partial: Partial<AgentTokenUsage> = {
    source: "provider",
  };
  if (promptTokens !== undefined) partial.promptTokens = promptTokens;
  if (completionTokens !== undefined) {
    partial.completionTokens = completionTokens;
  }
  if (totalTokens !== undefined) {
    partial.totalTokens = totalTokens;
  } else if (promptTokens !== undefined || completionTokens !== undefined) {
    partial.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  const cached = asFiniteNumber(promptDetails?.cached_tokens);
  if (cached !== undefined) partial.cacheReadTokens = cached;
  const reasoning = asFiniteNumber(completionDetails?.reasoning_tokens);
  if (reasoning !== undefined) partial.reasoningTokens = reasoning;

  return partial;
}

/**
 * OpenAI Responses API `usage`（常见于 response.completed）。
 * - input_tokens / output_tokens / total_tokens
 * - input_tokens_details.cached_tokens
 * - output_tokens_details.reasoning_tokens
 */
export function parseOpenAIResponsesUsage(
  json: unknown,
): Partial<AgentTokenUsage> | null {
  const root = asRecord(json);
  if (!root) return null;
  // 既接受 { usage } 也接受直接 usage 对象
  const usage = asRecord(root.usage) ?? (root.input_tokens !== undefined || root.output_tokens !== undefined
    ? root
    : null);
  if (!usage) return null;

  const promptTokens = asFiniteNumber(usage.input_tokens);
  const completionTokens = asFiniteNumber(usage.output_tokens);
  const totalTokens = asFiniteNumber(usage.total_tokens);
  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }

  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);

  const partial: Partial<AgentTokenUsage> = {
    source: "provider",
  };
  if (promptTokens !== undefined) partial.promptTokens = promptTokens;
  if (completionTokens !== undefined) {
    partial.completionTokens = completionTokens;
  }
  if (totalTokens !== undefined) {
    partial.totalTokens = totalTokens;
  } else if (promptTokens !== undefined || completionTokens !== undefined) {
    partial.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  const cached = asFiniteNumber(inputDetails?.cached_tokens);
  if (cached !== undefined) partial.cacheReadTokens = cached;
  const reasoning = asFiniteNumber(outputDetails?.reasoning_tokens);
  if (reasoning !== undefined) partial.reasoningTokens = reasoning;

  return partial;
}

/**
 * Anthropic Messages `usage`。
 * - input_tokens / output_tokens
 * - cache_read_input_tokens / cache_creation_input_tokens
 *
 * 流式：message_start.message.usage 与 message_delta.usage 可分别传入后 merge。
 */
export function parseClaudeUsage(
  json: unknown,
): Partial<AgentTokenUsage> | null {
  const root = asRecord(json);
  if (!root) return null;

  // 兼容 { usage }、message.usage、或直接 usage 字段
  let usage = asRecord(root.usage);
  if (!usage) {
    const message = asRecord(root.message);
    usage = message ? asRecord(message.usage) : null;
  }
  if (!usage && (root.input_tokens !== undefined || root.output_tokens !== undefined)) {
    usage = root;
  }
  if (!usage) return null;

  const promptTokens = asFiniteNumber(usage.input_tokens);
  const completionTokens = asFiniteNumber(usage.output_tokens);
  const cacheRead = asFiniteNumber(usage.cache_read_input_tokens);
  const cacheWrite = asFiniteNumber(usage.cache_creation_input_tokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return null;
  }

  const partial: Partial<AgentTokenUsage> = {
    source: "provider",
  };
  if (promptTokens !== undefined) partial.promptTokens = promptTokens;
  if (completionTokens !== undefined) {
    partial.completionTokens = completionTokens;
  }
  if (promptTokens !== undefined || completionTokens !== undefined) {
    partial.totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  }
  if (cacheRead !== undefined) partial.cacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) partial.cacheWriteTokens = cacheWrite;

  return partial;
}

function sumOptional(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * 多步 tool loop 累加 usage。
 * 数值字段相加；source：任一步为 provider 则 provider，否则取 next 优先。
 */
export function mergeUsage(
  base: Partial<AgentTokenUsage> | null | undefined,
  next: Partial<AgentTokenUsage> | null | undefined,
): AgentTokenUsage {
  const b = base ?? {};
  const n = next ?? {};

  const promptTokens = (b.promptTokens ?? 0) + (n.promptTokens ?? 0);
  const completionTokens =
    (b.completionTokens ?? 0) + (n.completionTokens ?? 0);

  let totalTokens: number;
  if (b.totalTokens !== undefined || n.totalTokens !== undefined) {
    totalTokens = (b.totalTokens ?? 0) + (n.totalTokens ?? 0);
  } else {
    totalTokens = promptTokens + completionTokens;
  }

  let source: UsageSource = "estimate";
  if (b.source === "provider" || n.source === "provider") {
    source = "provider";
  } else if (b.source === "hybrid" || n.source === "hybrid") {
    source = "hybrid";
  } else if (n.source) {
    source = n.source;
  } else if (b.source) {
    source = b.source;
  }

  const updatedAt =
    asFiniteNumber(n.updatedAt) ??
    asFiniteNumber(b.updatedAt) ??
    Date.now();

  const out: AgentTokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens,
    source,
    updatedAt,
  };

  const cacheRead = sumOptional(b.cacheReadTokens, n.cacheReadTokens);
  if (cacheRead !== undefined) out.cacheReadTokens = cacheRead;
  const cacheWrite = sumOptional(b.cacheWriteTokens, n.cacheWriteTokens);
  if (cacheWrite !== undefined) out.cacheWriteTokens = cacheWrite;
  const reasoning = sumOptional(b.reasoningTokens, n.reasoningTokens);
  if (reasoning !== undefined) out.reasoningTokens = reasoning;

  // system / duration / tok/s：取 next 优先（非累加）
  const systemPromptTokens =
    asFiniteNumber(n.systemPromptTokens) ??
    asFiniteNumber(b.systemPromptTokens);
  if (systemPromptTokens !== undefined) {
    out.systemPromptTokens = systemPromptTokens;
  }
  const durationMs =
    asFiniteNumber(n.durationMs) ?? asFiniteNumber(b.durationMs);
  if (durationMs !== undefined) out.durationMs = durationMs;
  const tokensPerSecond =
    asFiniteNumber(n.tokensPerSecond) ?? asFiniteNumber(b.tokensPerSecond);
  if (tokensPerSecond !== undefined) out.tokensPerSecond = tokensPerSecond;

  return out;
}

/** 写入 durationMs 与 tokensPerSecond（基于 completionTokens）。 */
export function withSpeed(
  usage: AgentTokenUsage,
  durationMs: number,
): AgentTokenUsage {
  const safeDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : undefined;
  const tokensPerSecond =
    safeDuration !== undefined && usage.completionTokens > 0
      ? usage.completionTokens / (safeDuration / 1000)
      : undefined;
  return {
    ...usage,
    durationMs: safeDuration ?? (durationMs >= 0 ? durationMs : undefined),
    tokensPerSecond,
  };
}

/**
 * 无 provider usage 时的 turn 级估算。
 * prompt ≈ system + 输入消息；completion ≈ 本轮流式 assistant 文本。
 */
export function estimateTurnUsage(opts: {
  systemPrompt: string;
  messages: Array<{ content: string }>;
  completionText: string;
  systemPromptTokens?: number;
}): AgentTokenUsage {
  const systemPromptTokens =
    opts.systemPromptTokens ?? estimateTokensFromText(opts.systemPrompt);
  const messagesText = opts.messages.map((m) => m.content ?? "").join("\n");
  const promptTokens =
    systemPromptTokens + estimateTokensFromText(messagesText);
  const completionTokens = estimateTokensFromText(opts.completionText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    systemPromptTokens,
    source: "estimate",
    updatedAt: Date.now(),
  };
}
