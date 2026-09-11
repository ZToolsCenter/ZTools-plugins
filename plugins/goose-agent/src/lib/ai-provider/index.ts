export type {
  CustomAIProtocol,
  AIProviderIdLike,
  AIModelOption,
  AIReasoningLevel,
  AIAuthModeLike,
  AIOAuthSessionLike,
  AISettingsLike,
  AIMessage,
  AIContentPart,
  AITextPart,
  AIImagePart,
  AIStreamPhase,
  AIStreamUpdate,
  AIRequestOverrides,
  RunAITextOptions,
  RunAITextStreamOptions,
} from "./types";

export type {
  AIProviderId,
  AIProviderPreset,
  AIProviderAuthMode,
} from "./presets";

export {
  AI_PROVIDER_PRESETS,
  DEEPSEEK_BASE_URL,
  GLM_BASE_URL,
  MINIMAX_BASE_URL,
  XAI_BASE_URL,
  XAI_CLI_SESSION_BASE_URL,
  getAIProviderPreset,
  getApiKeyProviderPresets,
  getProviderConsoleUrl,
  getProviderCredentialSlots,
  getProviderFixedBaseURL,
  inferProviderIdFromSettings,
  isAIProviderId,
  isDeepSeekProModel,
  isLegacyRemovedProviderId,
  providerAuthModes,
  providerSupportsApiKey,
  providerSupportsOAuth,
  resolveProtocolForProvider,
} from "./presets";

export type { LocalAuthHint, LocalAuthSource } from "./localAuthDetect";
export {
  detectLocalAuthHints,
  filterActionableLocalAuthHints,
  filterVisibleProviderPresets,
  importLocalOAuthSession,
  inspectCodexAuthJson,
  isActionableLocalAuthHint,
  isLocalPresenceProvider,
  loadGrokCliModelsFromCache,
  parseGrokAuthJson,
  parseGrokModelsCache,
  parseOpenCodexAuthJson,
} from "./localAuthDetect";

export type {
  AIAuthMode,
  AIOAuthSession,
  RequestCredential,
  OAuthDerivedStatus,
  ProviderOAuthAdapter,
} from "./auth";

export {
  isAIAuthMode,
  getPreferredAuthMode,
  hasValidOAuthSession,
  hasConfiguredCredential,
  hasActiveCredential,
  getRequestCredential,
  getActiveCredentialMissingMessage,
  deriveOAuthStatus,
  getOAuthAdapter,
} from "./auth";

export {
  buildCliProxyHeaders,
  withCliProxyHeaders,
  isCliChatProxyUrl,
  parseGrokCliVersionJson,
  resolveGrokCliClientVersion,
  resolveGrokCliClientVersionSync,
  cacheGrokCliClientVersion,
  clearGrokCliClientVersionCache,
  isGrokCliVersionError,
  formatGrokCliVersionErrorMessage,
  mapFetchErrorIfGrokCliVersion,
  GROK_CLI_VERSION_FALLBACK,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_TOKEN_AUTH,
} from "./cliProxyHeaders";

export {
  formatModelRef,
  parseModelRef,
  getProviderDisplayPrefix,
  normalizeModelRef,
  getApiModelId,
  modelIdsMatch,
  resolveEffectiveModelId,
  aggregateModelsByProvider,
  normalizeModelsByProvider,
  type ModelRef,
  type AggregatedModelOption,
  type ModelsByProvider,
} from "./modelRef";

export {
  hasProviderCredential,
  isProviderEnabled,
  enableProviderIfFirst,
  rebindSelectionAfterDisable,
  resolveModelsByProvider,
  getAggregatedComposerModels,
  resolveComposerSelectedRef,
  buildSelectComposerModelPatch,
  buildProviderCredentialHydration,
  readProviderApiKey,
  authModeForProvider,
} from "./providerModels";
export type { ProviderCredentialHydration } from "./providerModels";

export {
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindowTokens,
  formatTokenCount,
} from "./contextWindow";

export {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_CLAUDE_BASE_URL,
  getDefaultCustomAIBaseURL,
  getCustomAIBaseURL,
  getCustomAIApiKey,
  getApiKeyMissingMessage,
  getCredentialMissingMessage,
  getCustomProviderIncompleteMessage,
  hasUsableCustomProviderBase,
  getStoredAIModelOptions,
  mergeModelOptionsPreservingMeta,
  getAIAvailability,
  getSettingsProviderId,
  resolveActiveProtocol,
  fetchCustomAIModels,
} from "./modelCatalog";

export {
  modelSupportsVision,
  resolveModelVision,
  VISION_MODEL_ID_HINTS,
  type VisionCustomOption,
  type VisionResolution,
  type VisionResolutionSource,
} from "./visionCapability";

export {
  ensureModelsDevVisionCatalog,
  getModelsDevVisionCatalogSync,
  lookupModelsDevVision,
  mapProviderIdToModelsDev,
  parseModelsDevApiJson,
  MODELS_DEV_API_URL,
  MODELS_DEV_VISION_TTL_MS,
  type ModelsDevVisionCatalog,
} from "./modelsDevCatalog";

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
import { hasRenderableContent } from "./multimodal";
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
    .filter((m) => hasRenderableContent(m.content))
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
    _phaseMatch: string,
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
    return {
      text: finalChunk.text,
      reasoningText: finalChunk.reasoningText,
      /** provider 原始 usage 对象（若有）；由 agent 侧 parse* 解析 */
      usage: finalChunk.usage,
    };
  } catch (err: unknown) {
    if (signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    throw err;
  }
}
