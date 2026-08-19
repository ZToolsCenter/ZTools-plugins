// BlockNote xl-ai 的 ChatTransport 适配器：把项目现有 AI Settings 桥到 Vercel AI SDK。
// 同时支持 OpenAI Responses、OpenAI-compatible Chat Completions 与 Anthropic。
//
// 关键硬化点：
// 1. 强制关闭 thinking/reasoning（DeepSeek V4 Flash 默认 Thinking 会拒绝 tool_choice=required）
// 2. 透传 abortSignal，使菜单 Stop 能中断流式请求
// 3. toolChoice required 失败时，对 tool_choice/Thinking 类错误做一次 auto 重试

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  aiDocumentFormats,
  getProviderOverrides,
  injectDocumentStateMessages,
  toolDefinitionsToToolSet,
} from "@blocknote/xl-ai";
import {
  convertToModelMessages,
  streamText,
  type ChatTransport,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { AISettingsLike } from "@/lib/ai-provider/types";
import {
  getCustomAIApiKey,
  getCustomAIBaseURL,
  resolveActiveProtocol,
  getApiKeyMissingMessage,
} from "@/lib/ai-provider";
import {
  isToolChoiceThinkingError,
  wrapFetchToDisableThinking,
} from "./thinkingDisableFetch";

export {
  decodeFetchBody,
  forceDisableThinkingOnBody,
  wrapFetchToDisableThinking,
} from "./thinkingDisableFetch";

/** openai-compatible 路径的 provider name，需与 createOpenAICompatible({ name }) 一致。 */
const OPENAI_COMPAT_PROVIDER_NAME = "goose-openai";

/**
 * 与 createGooseAITransport 共用的模型构建：OpenAI Responses / OpenAI 兼容 / Anthropic。
 * 行内 Markdown rewrite 等无 tool 路径也应走此函数，避免重复 provider 逻辑。
 */
export function buildGooseAIModel(
  settings: AISettingsLike,
  modelId: string,
  fetchImpl: typeof fetch,
): LanguageModel {
  if (!settings.enabled) {
    throw new Error("AI 助手尚未开启，请先到设置中打开");
  }

  const resolvedModelId = modelId.trim();
  if (!resolvedModelId) {
    throw new Error("请先选择模型后再使用行内 AI");
  }

  const protocol = resolveActiveProtocol(settings, {
    selectedModelId: resolvedModelId,
  });
  const apiKey = getCustomAIApiKey(settings, protocol);
  if (!apiKey) {
    throw new Error(getApiKeyMissingMessage());
  }
  const baseURL = getCustomAIBaseURL(settings, protocol).replace(/\/+$/, "");

  if (protocol === "openai-responses") {
    const provider = createOpenAI({
      baseURL,
      apiKey,
      fetch: fetchImpl,
    });
    return provider.responses(resolvedModelId);
  }

  if (protocol === "openai") {
    const provider = createOpenAICompatible({
      name: OPENAI_COMPAT_PROVIDER_NAME,
      baseURL,
      apiKey,
      fetch: fetchImpl,
    });
    return provider.chatModel(resolvedModelId);
  }

  // Anthropic
  const provider = createAnthropic({
    baseURL,
    apiKey,
    headers: {
      // 浏览器侧 Anthropic CORS 需要这个 header
      "anthropic-dangerous-direct-browser-access": "true",
    },
    fetch: fetchImpl,
  });
  return provider(resolvedModelId);
}

/** @deprecated 使用 buildGooseAIModel；保留别名以免外部误用旧名时静默分叉 */
const buildModel = buildGooseAIModel;

/** html 格式系统提示：补充多列表项必须拆成多次操作，避免单 update 塞多个 li。 */
const GOOSE_HTML_SYSTEM_PROMPT = (() => {
  // 小窗构建把 xl-ai alias 成 stub；systemPrompt 可能是 Proxy 而非 string。
  // 只在拿到真字符串时拼入，避免 Array.join 触发 primitive 转换崩溃。
  const base = aiDocumentFormats?.html?.systemPrompt;
  const baseText = typeof base === "string" ? base : "";
  const extra =
    "When creating N list items, emit N separate operations (update first item, then add remaining items). Never put multiple <li> in one update block.";
  return baseText ? `${baseText}\n${extra}` : extra;
})();

export interface CreateGooseAITransportOptions {
  getSettings: () => AISettingsLike;
  getModelId: () => string;
  /**
   * 宿主注入的 fetch（如 Tauri plugin-http，绕过 WebView CORS）。
   * 未提供时回退 globalThis.fetch。
   */
  getCustomFetch?: () => typeof fetch | undefined;
}

/**
 * 读取 UI message stream 的首块，以便把即时 API 错误（如 400）从流中抬升为 throw，
 * 便于在 transport 层做 toolChoice 重试；随后把首块回灌进新流。
 */
async function openStreamSurfacingEarlyError(
  stream: ReadableStream<UIMessageChunk>,
): Promise<ReadableStream<UIMessageChunk>> {
  const reader = stream.getReader();
  let first: ReadableStreamReadResult<UIMessageChunk> | null;
  try {
    first = await reader.read();
  } catch (err) {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    throw err;
  }

  // error chunk 也视为失败（部分路径不 throw）
  if (
    first &&
    !first.done &&
    first.value &&
    typeof first.value === "object" &&
    "type" in first.value &&
    (first.value as { type: string }).type === "error"
  ) {
    const errChunk = first.value as { type: "error"; errorText?: string };
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    throw new Error(errChunk.errorText || "AI 流式响应错误");
  }

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        if (first != null) {
          const f = first;
          first = null;
          if (f.done) {
            controller.close();
            try {
              reader.releaseLock();
            } catch {
              /* ignore */
            }
            return;
          }
          controller.enqueue(f.value);
          return;
        }

        const next = await reader.read();
        if (next.done) {
          controller.close();
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
          return;
        }
        controller.enqueue(next.value);
      } catch (err) {
        controller.error(err);
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// 工厂：自定义 ChatTransport（对齐 xl-ai ClientSideTransport），并补上 abort / 重试 / thinking 关闭。
export function createGooseAITransport(
  options: CreateGooseAITransportOptions,
): ChatTransport<UIMessage> {
  const sendMessages: ChatTransport<UIMessage>["sendMessages"] = async (
    params,
  ) => {
    const settings = options.getSettings();
    const modelId = options.getModelId();
    const baseFetch = options.getCustomFetch?.() ?? globalThis.fetch;
    const fetchImpl = wrapFetchToDisableThinking(baseFetch);
    const model = buildModel(settings, modelId, fetchImpl);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolDefinitions = (params.body as any)?.toolDefinitions;
    const tools = await toolDefinitionsToToolSet(toolDefinitions);
    const modelMessages = await convertToModelMessages(
      injectDocumentStateMessages(params.messages),
    );

    const providerOverrides =
      typeof model === "string" ? {} : getProviderOverrides(model);

    const runStream = (toolChoice: "required" | "auto") => {
      const result = streamText({
        model,
        system: GOOSE_HTML_SYSTEM_PROMPT,
        messages: modelMessages,
        tools,
        abortSignal: params.abortSignal,
        maxRetries: 1,
        ...providerOverrides,
        // 放在 overrides 之后，避免被覆盖
        toolChoice,
      });
      return result.toUIMessageStream() as ReadableStream<UIMessageChunk>;
    };

    try {
      // 先 required（xl-ai 文档写操作依赖强制 tool call）
      return await openStreamSurfacingEarlyError(runStream("required"));
    } catch (err) {
      if (params.abortSignal?.aborted) {
        throw err;
      }
      if (!isToolChoiceThinkingError(err)) {
        throw err;
      }
      // 兜底：thinking 仍拒绝 required 时，降级为 auto 再试一次
      // （fetch 层通常已关 thinking 并可能已改 tool_choice；此处再走 streamText 参数）
      try {
        return await openStreamSurfacingEarlyError(runStream("auto"));
      } catch (retryErr) {
        // 保持中文可操作提示语义（GooseAIMenu 也会再映射 tool_choice/Thinking）
        if (isToolChoiceThinkingError(retryErr)) {
          throw new Error(
            "当前模型的思考模式不支持强制工具调用，请换非思考模型或关闭思考后再试",
          );
        }
        throw retryErr;
      }
    }
  };

  const reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] =
    async () => null;

  return {
    sendMessages,
    reconnectToStream,
  };
}
