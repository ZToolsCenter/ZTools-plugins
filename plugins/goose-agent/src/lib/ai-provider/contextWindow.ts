import { getApiModelId } from "./modelRef";
import type { AIModelOption, CustomAIProtocol } from "./types";

/** 无更精确信息时的上下文窗口兜底（tokens） */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * 解析当前模型的上下文窗口大小（tokens）。
 * 优先用模型选项上的 `contextWindow`，否则按 modelId / 协议启发式。
 * modelId 可为 canonical `provider/model` 或裸 id。
 */
export function resolveContextWindowTokens(opts: {
  modelId: string | null | undefined;
  modelOptions?: AIModelOption[];
  protocol?: CustomAIProtocol;
  /** 用于剥离 canonical 前缀；缺省时仍尝试 parseModelRef */
  providerId?: string | null;
}): number {
  const raw = opts.modelId?.trim() || "";
  const bare = raw ? (getApiModelId(raw, opts.providerId) ?? raw) : "";
  if (raw && opts.modelOptions?.length) {
    const match = opts.modelOptions.find((m) => {
      if (m.id === raw || m.id === bare) return true;
      const optBare = getApiModelId(m.id, opts.providerId) ?? m.id;
      return optBare === bare;
    });
    if (
      match &&
      typeof match.contextWindow === "number" &&
      match.contextWindow > 0
    ) {
      return Math.floor(match.contextWindow);
    }
  }

  const modelId = bare || raw;
  if (modelId) {
    const id = modelId.toLowerCase();
    // Anthropic Claude
    if (id.includes("claude") || id.includes("anthropic")) {
      return 200_000;
    }
    // DeepSeek
    if (id.includes("deepseek")) {
      return 128_000;
    }
    // 智谱 GLM
    if (id.includes("glm") || id.startsWith("chatglm")) {
      return 128_000;
    }
    // MiniMax（M2.5 常见 204800）
    if (id.includes("minimax") || id.includes("abab")) {
      if (/m2\.5|m2-5|m2_5/i.test(modelId)) {
        return 204_800;
      }
      return 128_000;
    }
    // OpenAI GPT 系
    if (
      id.includes("gpt") ||
      id.startsWith("o1") ||
      id.startsWith("o3") ||
      id.startsWith("o4") ||
      id.includes("openai")
    ) {
      return 128_000;
    }
  }

  if (opts.protocol === "claude") {
    return 200_000;
  }
  if (
    opts.protocol === "openai" ||
    opts.protocol === "openai-responses"
  ) {
    return 128_000;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 格式化 token 数量：12.4K / 1.2M 等（UI 用）。
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    const text =
      k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
    return `${text}K`;
  }
  const m = n / 1_000_000;
  const text =
    m >= 100 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, "");
  return `${text}M`;
}
