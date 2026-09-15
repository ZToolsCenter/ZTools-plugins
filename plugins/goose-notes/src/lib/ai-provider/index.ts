export type {
  CustomAIProtocol,
  AIProviderIdLike,
  AIModelOption,
  AIReasoningLevel,
  AISettingsLike,
  AIMessage,
  AIStreamPhase,
  AIStreamUpdate,
  AIRequestOverrides,
  RunAITextOptions,
  RunAITextStreamOptions,
} from "./types";

export type { AIProviderId, AIProviderPreset } from "./presets";

export {
  AI_PROVIDER_PRESETS,
  DEEPSEEK_BASE_URL,
  GLM_BASE_URL,
  MINIMAX_BASE_URL,
  getAIProviderPreset,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  inferProviderIdFromSettings,
  isAIProviderId,
  isDeepSeekProModel,
  resolveProtocolForProvider,
} from "./presets";

export {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_CLAUDE_BASE_URL,
  getDefaultCustomAIBaseURL,
  getCustomAIBaseURL,
  getCustomAIApiKey,
  getApiKeyMissingMessage,
  getStoredAIModelOptions,
  getAIAvailability,
  getSettingsProviderId,
  resolveActiveProtocol,
  fetchCustomAIModels,
} from "./modelCatalog";

import type {
  AISettingsLike,
  AIMessage,
  AIStreamPhase,
  AIStreamUpdate,
  AIRequestOverrides,
  RunAITextOptions,
  RunAITextStreamOptions,
} from "./types";
import { getAIAvailability, resolveActiveProtocol } from "./modelCatalog";
import { handleOpenAIStream } from "./providers/openai";
import { handleOpenAIResponsesStream } from "./providers/openaiResponses";
import { handleClaudeStream } from "./providers/claude";

async function handleCustomStream(
  settings: AISettingsLike,
  messages: AIMessage[],
  signal: AbortSignal,
  emit: (phase: AIStreamPhase, text: string, isReasoning: boolean) => void,
  requestOverrides?: AIRequestOverrides,
) {
  const protocol = resolveActiveProtocol(settings, requestOverrides);
  if (protocol === "openai-responses") {
    return handleOpenAIResponsesStream(
      settings,
      messages,
      signal,
      emit,
      requestOverrides,
    );
  }
  if (protocol === "openai") {
    return handleOpenAIStream(
      settings,
      messages,
      signal,
      emit,
      requestOverrides,
    );
  }
  return handleClaudeStream(settings, messages, signal, emit, requestOverrides);
}

export async function runAIText(
  settings: AISettingsLike,
  messages: AIMessage[],
  options: RunAITextOptions = {},
) {
  let finalResultText = "";
  await runAITextStream(settings, messages, {
    ...options,
    onUpdate: (update: AIStreamUpdate) => {
      if (
        update.phase === "finishing" ||
        update.phase === "generating" ||
        update.phase === "thinking"
      ) {
        if (update.text) {
          finalResultText = update.text;
        }
      }
    },
  });
  return finalResultText;
}

export async function runAITextStream(
  settings: AISettingsLike,
  rawMessages: AIMessage[],
  options: RunAITextStreamOptions = {},
) {
  const messages = rawMessages
    .filter((m) => typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanMessage: any = { role: m.role, content: m.content };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((m as any).reasoning_content) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cleanMessage.reasoning_content = (m as any).reasoning_content;
      }
      return cleanMessage;
    });

  const availability = getAIAvailability(settings, options.requestOverrides);
  if (!availability.ok) {
    throw new Error(availability.reason);
  }

  const abortController = new AbortController();
  const signal = options.abortSignal ?? abortController.signal;

  let currentPhase: AIStreamPhase = "connecting";
  let contentText = "";
  let reasoningText = "";

  const emit = (
    phaseMatch: string,
    contentUpdate: string,
    isReasoning: boolean,
  ) => {
    // Phase flow logic: connecting -> thinking -> generating
    if (
      currentPhase === "connecting" ||
      (isReasoning && currentPhase !== "thinking")
    ) {
      currentPhase = isReasoning ? "thinking" : "generating";
    }
    // Automatically jump to generating if payload has content and it's not reasoning
    if (!isReasoning && contentUpdate) {
      currentPhase = "generating";
    }

    if (isReasoning) {
      reasoningText += contentUpdate;
    } else {
      contentText += contentUpdate;
    }

    options.onUpdate?.({
      phase: currentPhase,
      text: contentText,
      reasoningText,
    });
  };

  if (options.onUpdate) {
    options.onUpdate({ phase: "connecting", text: "", reasoningText: "" });
  }

  try {
    const finalChunk = await handleCustomStream(
      settings,
      messages,
      signal,
      emit,
      options.requestOverrides,
    );

    if (options.onUpdate) {
      options.onUpdate({
        phase: "finishing",
        text: finalChunk.text,
        reasoningText: finalChunk.reasoningText,
      });
    }
    return finalChunk.text;
  } catch (err: unknown) {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    throw err;
  }
}
