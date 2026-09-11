import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Key,
} from "react";
import type { Selection } from "react-aria-components";
import * as LucideIcons from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Button,
  Dropdown,
  Input,
  Label,
} from "@/lib/heroui";
import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  detectLocalAuthHints,
  filterActionableLocalAuthHints,
  fetchCustomAIModels,
  getAIProviderPreset,
  getApiKeyProviderPresets,
  getProviderFixedBaseURL,
  getStoredAIModelOptions,
  deriveOAuthStatus,
  getPreferredAuthMode,
  importLocalOAuthSession,
  isAIProviderId,
  ensureModelsDevVisionCatalog,
  loadGrokCliModelsFromCache,
  mergeModelOptionsPreservingMeta,
  modelSupportsVision,
  providerSupportsApiKey,
  resolveProtocolForProvider,
  XAI_CLI_SESSION_BASE_URL,
  type AIAuthMode,
  type AIOAuthSession,
  type AIModelOption,
  type AIProviderId,
  type CustomAIProtocol,
  type LocalAuthHint,
} from "@/lib/ai-provider";
import type { AISettings } from "@/stores/settings";
import { SettingsSectionCard } from "./SettingsSectionCard";
import {
  ApiKeyPanel,
  LocalCliAuthList,
  localAuthSourceLabel,
  type ProviderOAuthStatus,
} from "./ProviderAuthTabs";
import { cn } from "@/lib/utils";

type SettingsAuthTab = "oauth" | "api_key";

interface SettingsAIProps {
  ai: AISettings;
  selectedModelId: string | null;
  setSelectedModelId: (modelId: string | null) => void;
  saveCustomConfig: (config: {
    providerId: AIProviderId;
    protocol?: CustomAIProtocol;
    baseURL: string;
    apiKey: string;
    modelOptions: AIModelOption[];
  }) => void;
  setPreferredAuthMode?: (mode: AIAuthMode) => void;
  setOAuthSession?: (session: AIOAuthSession | null) => void;
  setProviderEnabled?: (providerId: AIProviderId, enabled: boolean) => void;
}

/** 卡片内行：抬于 surface 的 bg，对比清晰（B 阶段） */
const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] border border-border-soft bg-bg";

const CUSTOM_AI_KEY_HINT = "请先填写 API Key";

/** 下拉触发器：设置行右侧；宽度需容纳最长供应商名（如「OpenAI Responses」） */
const SETTINGS_SELECT_TRIGGER_CLASS = cn(
  "inline-flex h-8 min-w-0 items-center justify-between gap-1.5",
  "rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-fg",
  "outline-none hover:bg-surface-hover",
  "transition-colors duration-150",
  "disabled:pointer-events-none disabled:opacity-50",
);

/** 供应商触发器：约 16.5rem 可完整显示当前最长 label，避免「OpenAI Resp…」截断 */
const SETTINGS_PROVIDER_TRIGGER_WIDTH = "w-[min(100%,16.5rem)]";
/** 弹出层与触发器同宽量级，略宽留给双行说明，避免相对触发器「过大」 */
const SETTINGS_PROVIDER_POPOVER_CLASS = "w-[min(100vw-2rem,16.5rem)] p-1.5";
/** 默认模型：与供应商触发器同宽，长 model id 可读 */
const SETTINGS_MODEL_TRIGGER_WIDTH = "w-[min(100%,16.5rem)]";
const SETTINGS_MODEL_POPOVER_CLASS =
  "w-[min(100vw-2rem,16.5rem)] p-1.5";

const PROVIDER_ICONS: Record<
  AIProviderId,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  deepseek: LucideIcons.Sparkles,
  xai: LucideIcons.Orbit,
  "custom-openai-responses": LucideIcons.Zap,
  "custom-openai": LucideIcons.Boxes,
  "custom-claude": LucideIcons.MessageSquare,
};

function ProviderIconTile({
  providerId,
  size = "md",
}: {
  providerId: AIProviderId;
  size?: "sm" | "md";
}) {
  const Icon = PROVIDER_ICONS[providerId] ?? LucideIcons.Server;
  const isSm = size === "sm";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-accent-subtle text-fg-muted",
        isSm ? "h-6 w-6 rounded-[7px]" : "h-8 w-8 rounded-[8px]",
      )}
      aria-hidden
    >
      <Icon
        className={isSm ? "h-3.5 w-3.5" : "h-4 w-4"}
        strokeWidth={1.75}
      />
    </span>
  );
}

interface ProviderConnection {
  providerId: AIProviderId;
  protocol: CustomAIProtocol;
  baseURL: string;
  apiKey: string;
}

function readStoredApiKey(
  ai: AISettings,
  providerId: AIProviderId,
  protocol: CustomAIProtocol,
): string {
  // 与 auth.readApiKey 一致：优先 per-provider 快照，再回退协议共享槽
  const snapKey = ai.providerCredentials?.[providerId]?.apiKey?.trim() ?? "";
  if (snapKey) return snapKey;

  // 双槽位供应商：任一端有 Key 即可
  if (providerId === "deepseek" || providerId === "xai") {
    return (
      ai.customOpenAIResponsesApiKey?.trim() ||
      ai.customOpenAIApiKey?.trim() ||
      ""
    );
  }
  if (protocol === "openai-responses") {
    return ai.customOpenAIResponsesApiKey?.trim() || "";
  }
  if (protocol === "openai") {
    return ai.customOpenAIApiKey?.trim() || "";
  }
  return ai.customClaudeApiKey?.trim() || "";
}

function readStoredBaseURL(
  ai: AISettings,
  providerId: AIProviderId,
  protocol: CustomAIProtocol,
): string {
  const fixed = getProviderFixedBaseURL(providerId);
  if (fixed) return fixed;

  const snapBase = ai.providerCredentials?.[providerId]?.baseURL?.trim() ?? "";
  if (snapBase) return snapBase;

  if (protocol === "openai-responses") {
    return ai.customOpenAIResponsesBaseURL || DEFAULT_OPENAI_BASE_URL;
  }
  if (protocol === "openai") {
    return ai.customOpenAIBaseURL || DEFAULT_OPENAI_BASE_URL;
  }
  return ai.customClaudeBaseURL || DEFAULT_CLAUDE_BASE_URL;
}

function firstSelectedKey(keys: Selection): Key | null {
  if (keys === "all") return null;
  for (const key of keys) return key;
  return null;
}

/** Key 页供应商列表（deepseek + customs） */
const API_KEY_PROVIDER_PRESETS = getApiKeyProviderPresets();

function resolveKeyTabProviderId(stored: string | null | undefined): AIProviderId {
  if (isAIProviderId(stored) && providerSupportsApiKey(stored)) {
    return stored;
  }
  return "deepseek";
}

export function SettingsAI({
  ai,
  selectedModelId,
  setSelectedModelId,
  saveCustomConfig,
  setPreferredAuthMode,
  setOAuthSession,
  setProviderEnabled,
}: SettingsAIProps) {
  const preferredFromStore = getPreferredAuthMode(ai);
  const initialTab: SettingsAuthTab =
    preferredFromStore === "oauth" ? "oauth" : "api_key";

  const [authTab, setAuthTab] = useState<SettingsAuthTab>(initialTab);

  const initialProviderId = resolveKeyTabProviderId(ai.customProviderId);
  const [providerId, setProviderId] = useState<AIProviderId>(initialProviderId);
  const [customBaseURL, setCustomBaseURL] = useState(() =>
    readStoredBaseURL(ai, initialProviderId, ai.customProtocol),
  );
  const [apiKeyDraft, setApiKeyDraft] = useState(() =>
    readStoredApiKey(ai, initialProviderId, ai.customProtocol),
  );
  const [savingCustomConfig, setSavingCustomConfig] = useState(false);
  const [customSaveError, setCustomSaveError] = useState<string | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  /** store 无 setPreferredAuthMode 时用本地兜底 */
  const [localPreferredAuthMode, setLocalPreferredAuthMode] =
    useState<AIAuthMode>(() => preferredFromStore);
  const [localAuthHints, setLocalAuthHints] = useState<LocalAuthHint[]>([]);
  const [localAuthReady, setLocalAuthReady] = useState(false);
  const [importingSource, setImportingSource] = useState<string | null>(null);
  const modelSectionRef = useRef<HTMLDivElement | null>(null);
  const modelRequestIdRef = useRef(0);
  /** BB 风格：本机有凭证时自动导入一次，防重复 */
  const autoImportAttemptedRef = useRef(false);

  const preferredAuthMode: AIAuthMode = setPreferredAuthMode
    ? getPreferredAuthMode(ai)
    : localPreferredAuthMode;

  const handlePreferredAuthModeChange = (mode: AIAuthMode) => {
    if (setPreferredAuthMode) {
      setPreferredAuthMode(mode);
      return;
    }
    setLocalPreferredAuthMode(mode);
  };

  // OAuth 会话（顶层本机账号，不绑 Key 页当前供应商）
  const oauthSession = ai.oauthSession ?? null;
  const oauthStatus: ProviderOAuthStatus = deriveOAuthStatus(oauthSession);
  const oauthAccountLabel = oauthSession?.accountLabel ?? null;
  const oauthProviderId =
    typeof oauthSession?.providerId === "string"
      ? oauthSession.providerId
      : null;

  const isOAuthActive =
    preferredAuthMode === "oauth" && oauthStatus === "connected";

  // 模型列表：oauth 激活且 session 为 xai 时用 store 列表；否则 Key 页当前供应商
  const effectiveProviderId: AIProviderId =
    isOAuthActive && oauthProviderId === "xai"
      ? "xai"
      : providerId;

  const storedCustomModels = getStoredAIModelOptions(ai);
  const customModels =
    effectiveProviderId === ai.customProviderId ||
    (isOAuthActive && ai.customProviderId === "xai")
      ? storedCustomModels
      : effectiveProviderId === ai.customProviderId
        ? storedCustomModels
        : [];

  // 更稳：store 的 customProviderId 与 effective 一致才展示
  const displayModels =
    ai.customProviderId === effectiveProviderId ? storedCustomModels : customModels;

  const selectedProvider = useMemo(
    () => getAIProviderPreset(providerId),
    [providerId],
  );
  const allowCustomBaseURL = selectedProvider.allowCustomBaseURL;
  const activeProtocol = resolveProtocolForProvider(
    providerId,
    selectedModelId,
    selectedProvider.protocol,
  );

  useEffect(() => {
    // store 切到 api_key 供应商时同步 Key 页选中
    if (isAIProviderId(ai.customProviderId) && providerSupportsApiKey(ai.customProviderId)) {
      setProviderId(ai.customProviderId);
      setCustomBaseURL(
        readStoredBaseURL(ai, ai.customProviderId, ai.customProtocol),
      );
      let nextKey = readStoredApiKey(
        ai,
        ai.customProviderId,
        ai.customProtocol,
      );
      const oauthTok = ai.oauthSession?.accessToken?.trim();
      if (oauthTok && nextKey.trim() === oauthTok) {
        nextKey = "";
      }
      setApiKeyDraft(nextKey);
    } else if (
      isAIProviderId(ai.customProviderId) &&
      ai.customProviderId === "xai"
    ) {
      // oauth 路径：Key 页保留上次 api_key 供应商草稿，不强制改 providerId
    } else {
      const fallback = resolveKeyTabProviderId(ai.customProviderId);
      setProviderId(fallback);
      setCustomBaseURL(readStoredBaseURL(ai, fallback, ai.customProtocol));
      setApiKeyDraft(readStoredApiKey(ai, fallback, ai.customProtocol));
    }
  }, [
    ai.customProviderId,
    ai.customProtocol,
    ai.customOpenAIResponsesBaseURL,
    ai.customOpenAIBaseURL,
    ai.customClaudeBaseURL,
    ai.customOpenAIResponsesApiKey,
    ai.customOpenAIApiKey,
    ai.customClaudeApiKey,
    ai.oauthSession,
  ]);

  // 与 store preferred 同步顶层 Tab
  useEffect(() => {
    const mode = getPreferredAuthMode(ai);
    setAuthTab(mode === "oauth" ? "oauth" : "api_key");
  }, [ai.preferredAuthMode, ai.customProviderId, ai.oauthSession]);

  /** models.dev vision catalog：24h TTL 后台刷新 */
  useEffect(() => {
    void ensureModelsDevVisionCatalog();
  }, []);

  /** 挂载时检测本机 CLI 登录 */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const hints = await detectLocalAuthHints();
        if (!cancelled) {
          // detect 已只返回可行动；再滤一次作双保险
          setLocalAuthHints(
            filterActionableLocalAuthHints(Array.isArray(hints) ? hints : []),
          );
          setLocalAuthReady(true);
        }
      } catch {
        if (!cancelled) {
          setLocalAuthHints([]);
          setLocalAuthReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (displayModels.length === 0) {
      return;
    }

    if (
      !selectedModelId ||
      !displayModels.some((item) => item.id === selectedModelId)
    ) {
      setSelectedModelId(displayModels[0]?.id ?? null);
    }
  }, [displayModels, selectedModelId, setSelectedModelId]);

  const currentModel =
    displayModels.find((item) => item.id === selectedModelId) ?? null;

  const getConnectionForProvider = (
    nextProviderId: AIProviderId,
    nextApiKey = apiKeyDraft,
    nextBaseURL = customBaseURL,
  ): ProviderConnection => {
    // xAI 账号登录：会话只对 cli-chat-proxy + Responses 有效
    if (nextProviderId === "xai" && preferredAuthMode === "oauth") {
      return {
        providerId: nextProviderId,
        protocol: "openai-responses",
        baseURL: XAI_CLI_SESSION_BASE_URL,
        apiKey: nextApiKey,
      };
    }
    const preset = getAIProviderPreset(nextProviderId);
    const protocol = resolveProtocolForProvider(
      nextProviderId,
      selectedModelId,
      preset.protocol,
    );
    const fixed = getProviderFixedBaseURL(nextProviderId);
    const fallback =
      protocol === "claude" ? DEFAULT_CLAUDE_BASE_URL : DEFAULT_OPENAI_BASE_URL;
    const baseURL = ((fixed ?? nextBaseURL.trim()) || fallback).replace(
      /\/+$/,
      "",
    );
    return {
      providerId: nextProviderId,
      protocol,
      baseURL: baseURL || fallback,
      apiKey: nextApiKey,
    };
  };

  const scrollToModelSection = () => {
    requestAnimationFrame(() => {
      const target = modelSectionRef.current;
      if (!target) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      target.focus({ preventScroll: true });
    });
  };

  const saveButtonReason = savingCustomConfig
    ? "正在保存并读取模型列表"
    : !apiKeyDraft.trim()
      ? CUSTOM_AI_KEY_HINT
      : allowCustomBaseURL && !customBaseURL.trim()
        ? "请填写 Base URL"
        : null;

  const modelButtonDisabled =
    savingCustomConfig || displayModels.length === 0;

  const modelButtonReason = savingCustomConfig
    ? "模型列表读取中，请稍候"
    : customSaveError
      ? customSaveError
      : displayModels.length === 0
        ? isOAuthActive
          ? "请先导入账号登录或同步模型列表"
          : "请先填写 API Key 并保存配置"
        : null;

  /**
   * xAI OAuth：从 Grok CLI models_cache 读模型，禁止用 OIDC 打 api.x.ai /models。
   */
  const resolveXaiOAuthModels = async (): Promise<{
    models: AIModelOption[];
    baseURL: string;
    protocol: CustomAIProtocol;
    fromCache: boolean;
  }> => {
    const cache = await loadGrokCliModelsFromCache();
    if (cache && cache.models.length > 0) {
      return {
        models: cache.models,
        baseURL: cache.baseURL || XAI_CLI_SESSION_BASE_URL,
        protocol: cache.protocol || "openai-responses",
        fromCache: true,
      };
    }
    const fallbackModels =
      getAIProviderPreset("xai").fallbackModels ?? [];
    return {
      models: fallbackModels,
      baseURL: XAI_CLI_SESSION_BASE_URL,
      protocol: "openai-responses",
      fromCache: false,
    };
  };

  /** 账号登录路径：刷新模型列表（仅 xai oauth） */
  const refreshXaiOAuthModels = async (action: "save" | "refresh") => {
    const requestId = modelRequestIdRef.current + 1;
    modelRequestIdRef.current = requestId;
    setSavingCustomConfig(true);
    setCustomSaveError(null);

    try {
      const resolved = await resolveXaiOAuthModels();
      if (requestId !== modelRequestIdRef.current) return;

      const previousModelOptions =
        ai.customProviderId === "xai" ? storedCustomModels : [];
      const merged = mergeModelOptionsPreservingMeta(
        resolved.models,
        previousModelOptions,
      );

      // 绝不把 OIDC token 写入 Key
      saveCustomConfig({
        providerId: "xai",
        protocol: resolved.protocol,
        baseURL: resolved.baseURL,
        apiKey: "",
        modelOptions: merged,
      });

      const nextModel =
        merged.find((model) => model.id === selectedModelId) ??
        merged[0] ??
        null;
      setSelectedModelId(nextModel?.id ?? null);
      scrollToModelSection();

      const provider = getAIProviderPreset("xai");
      if (merged.length === 0) {
        toast.warning(`${provider.label} 配置已保存`, {
          description: "未找到可用模型，请确认本机 Grok CLI 已登录并同步模型。",
        });
      } else {
        toast.success(
          action === "refresh"
            ? `${provider.label} 模型列表已更新`
            : `${provider.label} 已应用模型列表`,
          {
            description: resolved.fromCache
              ? `已从本机缓存读取 ${merged.length} 个模型`
              : `共 ${merged.length} 个模型`,
          },
        );
      }
    } catch (error) {
      if (requestId !== modelRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "读取模型列表失败";
      setCustomSaveError(message);
      toast.error(message, {
        description:
          action === "refresh"
            ? "模型列表未更新，已保留当前配置。"
            : "账号已登录，模型列表未能更新。",
      });
    } finally {
      if (requestId === modelRequestIdRef.current) {
        setSavingCustomConfig(false);
      }
    }
  };

  const refreshCustomModels = async (
    connection: ProviderConnection,
    action: "save" | "switch" | "refresh",
  ) => {
    if (connection.providerId === "xai" && preferredAuthMode === "oauth") {
      await refreshXaiOAuthModels(action === "refresh" ? "refresh" : "save");
      return;
    }

    const apiKey = connection.apiKey.trim();
    if (!apiKey) {
      toast.error(CUSTOM_AI_KEY_HINT);
      return;
    }

    const provider = getAIProviderPreset(connection.providerId);
    const requestId = modelRequestIdRef.current + 1;
    modelRequestIdRef.current = requestId;
    setSavingCustomConfig(true);
    setCustomSaveError(null);

    const previousModelOptions =
      connection.providerId === ai.customProviderId ? storedCustomModels : [];
    saveCustomConfig({
      providerId: connection.providerId,
      protocol: connection.protocol,
      baseURL: connection.baseURL,
      apiKey,
      modelOptions: previousModelOptions,
    });
    handlePreferredAuthModeChange("api_key");

    try {
      const listProtocol: CustomAIProtocol =
        connection.providerId === "deepseek" ? "openai" : connection.protocol;
      const modelOptions = await fetchCustomAIModels({
        protocol: listProtocol,
        baseURL: connection.baseURL,
        apiKey,
        providerId: connection.providerId,
      });
      if (requestId !== modelRequestIdRef.current) return;

      const merged = mergeModelOptionsPreservingMeta(
        modelOptions,
        previousModelOptions,
      );

      const nextModel =
        merged.find((model) => model.id === selectedModelId) ??
        merged[0] ??
        null;
      const nextProtocol = resolveProtocolForProvider(
        connection.providerId,
        nextModel?.id ?? null,
        connection.protocol,
      );

      saveCustomConfig({
        providerId: connection.providerId,
        protocol: nextProtocol,
        baseURL: connection.baseURL,
        apiKey,
        modelOptions: merged,
      });

      setSelectedModelId(nextModel?.id ?? null);
      scrollToModelSection();

      if (modelOptions.length === 0) {
        toast.warning(`${provider.label} 配置已保存`, {
          description: "已获取 0 个模型，请确认该服务是否提供模型列表接口。",
        });
      } else {
        const actionLabel =
          action === "switch"
            ? `已切换到 ${provider.label}`
            : action === "refresh"
              ? `${provider.label} 模型列表已更新`
              : `${provider.label} 配置已保存`;
        toast.success(actionLabel, {
          description: `已获取 ${modelOptions.length} 个模型，默认选择 ${nextModel?.label ?? nextModel?.id}。`,
        });
      }
    } catch (error) {
      if (requestId !== modelRequestIdRef.current) return;
      const message =
        error instanceof Error ? error.message : "保存 AI 配置失败";
      setCustomSaveError(message);
      toast.error(message, {
        description:
          action === "refresh"
            ? "模型列表未更新，已保留当前配置。"
            : "API Key 已保存，模型列表未能更新。",
      });
    } finally {
      if (requestId === modelRequestIdRef.current) {
        setSavingCustomConfig(false);
      }
    }
  };

  const handleSaveCustomConfig = async () => {
    if (saveButtonReason) {
      toast.error(saveButtonReason);
      return;
    }
    await refreshCustomModels(getConnectionForProvider(providerId), "save");
  };

  const handleProviderChange = (
    value: string,
    options?: { silent?: boolean },
  ) => {
    if (!isAIProviderId(value) || value === providerId) return;
    if (!providerSupportsApiKey(value)) return;
    setCustomSaveError(null);
    setProviderId(value);
    handlePreferredAuthModeChange("api_key");

    const nextPreset = getAIProviderPreset(value);
    // 从目标供应商快照/协议槽恢复，避免用当前草稿或默认 base 污染其它供应商
    const nextBaseURL = readStoredBaseURL(ai, value, nextPreset.protocol);
    const finalKey = readStoredApiKey(ai, value, nextPreset.protocol);
    setCustomBaseURL(nextBaseURL);
    setApiKeyDraft(finalKey);

    // 纯 UI 切换：无可用 Key 时只恢复草稿，不写空值进 persist
    if (!finalKey.trim()) {
      if (!options?.silent) {
        toast.info(`已切换到 ${nextPreset.label}`, {
          description: "填入 API Key 后保存并拉取模型。",
        });
      }
      return;
    }

    void refreshCustomModels(
      getConnectionForProvider(value, finalKey, nextBaseURL),
      "switch",
    );
  };

  /**
   * BB 风格自动导入：探测完成且有 importAllowed 材料、尚未 connected 时静默导入一次。
   * 仅 grok / opencodex xai。
   */
  useEffect(() => {
    if (!localAuthReady) return;
    if (autoImportAttemptedRef.current) return;
    if (importingSource) return;
    if (oauthStatus === "connected") return;

    const importable = localAuthHints.find(
      (h) =>
        h.importAllowed &&
        h.hasAuthMaterial &&
        (h.source === "grok_cli" || h.source === "opencodex"),
    );
    if (!importable) return;

    autoImportAttemptedRef.current = true;
    void handleImportLocalAuth(String(importable.source), { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot after detect
  }, [localAuthReady, oauthStatus, localAuthHints, importingSource]);

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    if (isOAuthActive) return;
    if (providerId !== "deepseek" || !apiKeyDraft.trim()) return;
    const connection = getConnectionForProvider(providerId);
    const protocol = resolveProtocolForProvider(
      providerId,
      modelId,
      connection.protocol,
    );
    saveCustomConfig({
      providerId,
      protocol,
      baseURL: connection.baseURL,
      apiKey: connection.apiKey.trim(),
      modelOptions: displayModels,
    });
  };

  const handleProviderSelectionChange = (keys: Selection) => {
    const key = firstSelectedKey(keys);
    if (key == null) return;
    handleProviderChange(String(key));
  };

  const handleModelSelectionChange = (keys: Selection) => {
    const key = firstSelectedKey(keys);
    if (key == null) return;
    handleModelChange(String(key));
  };

  /**
   * 本机 OAuth 导入：只写 oauthSession，绝不把 OIDC token 写入 API Key 槽。
   */
  const handleImportLocalAuth = async (
    source: string,
    options?: { silent?: boolean },
  ) => {
    if (importingSource) return;
    setImportingSource(source);
    try {
      const result = await importLocalOAuthSession(source);
      if (!result.ok) {
        if (!options?.silent) {
          toast.error(result.error || "导入本机登录失败");
        } else {
          console.warn("[SettingsAI] auto-import failed:", result.error);
        }
        return;
      }
      const session = result.session;
      if (!session.accessToken?.trim()) {
        if (!options?.silent) {
          toast.error("未找到可用的本机登录凭证");
        }
        return;
      }
      setOAuthSession?.({
        ...session,
        source: result.source ?? session.source,
      });
      const status = deriveOAuthStatus(session);
      const label =
        session.accountLabel?.trim() ||
        localAuthSourceLabel(result.source) ||
        "本机账号";

      // 清理历史污染：draft 若等于 OIDC token
      const token = session.accessToken.trim();
      if (apiKeyDraft.trim() === token) {
        setApiKeyDraft("");
      }

      if (status === "connected") {
        handlePreferredAuthModeChange("oauth");
        setAuthTab("oauth");

        let modelOptions: AIModelOption[] =
          getAIProviderPreset("xai").fallbackModels ?? [];
        let oauthProtocol: CustomAIProtocol = "openai-responses";
        let oauthBaseURL = XAI_CLI_SESSION_BASE_URL;
        let fromCache = false;

        if (session.providerId === "xai" || !session.providerId) {
          const resolved = await resolveXaiOAuthModels();
          modelOptions = resolved.models;
          oauthProtocol = resolved.protocol;
          oauthBaseURL = resolved.baseURL;
          fromCache = resolved.fromCache;
        }

        const previousModels =
          ai.customProviderId === "xai" ? storedCustomModels : [];
        const merged = mergeModelOptionsPreservingMeta(
          modelOptions,
          previousModels,
        );

        saveCustomConfig({
          providerId: "xai",
          protocol: oauthProtocol,
          baseURL: oauthBaseURL,
          apiKey: "",
          modelOptions: merged,
        });
        if (merged.length > 0) {
          const nextModel =
            merged.find((m) => m.id === selectedModelId) ??
            merged[0] ??
            null;
          setSelectedModelId(nextModel?.id ?? null);
          scrollToModelSection();
        }
        if (!options?.silent) {
          toast.success(`已导入 ${label}`, {
            description:
              merged.length > 0
                ? fromCache
                  ? `已从本机缓存读取 ${merged.length} 个模型`
                  : `已使用 ${merged.length} 个模型`
                : undefined,
          });
        }
      } else {
        handlePreferredAuthModeChange("api_key");
        if (!options?.silent) {
          toast.warning("登录已过期，请在 CLI 重新登录后再导入");
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "导入本机登录失败";
      if (!options?.silent) {
        toast.error(message);
      } else {
        console.warn("[SettingsAI] auto-import error:", message);
      }
    } finally {
      setImportingSource(null);
    }
  };

  /** OAuth 刷新：已连接同步模型；过期/无效 session 则尝试从本机 hints 重新导入 */
  const handleOAuthRefresh = async () => {
    if (
      oauthStatus === "connected" &&
      oauthSession?.accessToken?.trim() &&
      deriveOAuthStatus(oauthSession) === "connected"
    ) {
      await refreshXaiOAuthModels("refresh");
      return;
    }

    const source = oauthSession?.source?.trim();
    let targetHint = source
      ? localAuthHints.find(
          (h) =>
            String(h.source) === source &&
            h.importAllowed &&
            h.hasAuthMaterial,
        )
      : undefined;
    if (!targetHint) {
      targetHint = localAuthHints.find(
        (h) =>
          h.importAllowed &&
          h.hasAuthMaterial &&
          (h.source === "grok_cli" || h.source === "opencodex"),
      );
    }
    if (!targetHint) {
      toast.error("未检测到可导入的本机账号，请在 CLI 登录后重试");
      return;
    }
    await handleImportLocalAuth(String(targetHint.source));
  };

  const handleAuthTabChange = (next: SettingsAuthTab) => {
    setAuthTab(next);
    if (next === "api_key") {
      handlePreferredAuthModeChange("api_key");
      // 若当前 store 是 xai oauth-only，切 Key 页时落到 deepseek（不自动清 session）
      if (ai.customProviderId === "xai" || !providerSupportsApiKey(providerId)) {
        const fallback = resolveKeyTabProviderId(null);
        if (providerId !== fallback) {
          setProviderId(fallback);
          setCustomBaseURL(
            readStoredBaseURL(ai, fallback, "openai-responses"),
          );
          setApiKeyDraft(readStoredApiKey(ai, fallback, "openai-responses"));
        }
      }
    } else if (oauthStatus === "connected") {
      // 本机账号：若已连接则 preferred oauth
      handlePreferredAuthModeChange("oauth");
    }
  };

  const useOAuthRefresh =
    authTab === "oauth" || preferredAuthMode === "oauth";

  return (
    <div className="min-w-0 space-y-3.5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">
          模型
        </h3>
      </div>

      <SettingsSectionCard
        title={
          <span className="flex items-center gap-2">
            <LucideIcons.Bot
              className="h-3.5 w-3.5 shrink-0 text-fg-muted"
              strokeWidth={1.75}
            />
            供应商与凭证
          </span>
        }
      >
        <div className="min-w-0 space-y-3">
          {/*
            不用 HeroUI Tabs.Indicator：ListContainer 会拆掉 RAC SharedElementTransition，
            在 uTools 真机抛 SharedElement 错误。改用分段按钮（与双模式语义一致）。
          */}
          <div
            role="tablist"
            aria-label="鉴权方式"
            className="flex min-w-0 gap-1 rounded-[12px] border border-border-soft bg-bg p-1"
          >
            <Button
              size="sm"
              variant={authTab === "oauth" ? "primary" : "ghost"}
              className="min-w-0 flex-1"
              onPress={() => handleAuthTabChange("oauth")}
            >
              本机账号
            </Button>
            <Button
              size="sm"
              variant={authTab === "api_key" ? "primary" : "ghost"}
              className="min-w-0 flex-1"
              onPress={() => handleAuthTabChange("api_key")}
            >
              API 密钥
            </Button>
          </div>

          {authTab === "oauth" ? (
            <div className="min-w-0" role="tabpanel">
            <LocalCliAuthList
              hints={localAuthHints}
              oauthStatus={oauthStatus}
              oauthAccountLabel={oauthAccountLabel}
              oauthProviderId={oauthProviderId}
              oauthSource={oauthSession?.source ?? null}
              importingSource={importingSource}
              savingModels={savingCustomConfig}
              disabled={savingCustomConfig}
              onImport={(source) => {
                void handleImportLocalAuth(source);
              }}
              xaiProviderEnabled={ai.enabledProviders?.xai === true}
              onXaiProviderEnabledChange={
                setProviderEnabled
                  ? (enabled) => setProviderEnabled("xai", enabled)
                  : undefined
              }
            />
            </div>
          ) : (
          <div className="min-w-0 space-y-3" role="tabpanel">
            <div
              className={cn(
                "flex min-w-0 items-center justify-between gap-3 px-3 py-2.5",
                SETTINGS_OPTION_ROW_CLASS,
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <ProviderIconTile providerId={providerId} />
                <div className="min-w-0 space-y-0.5">
                  <Label className="text-[13px] font-medium text-fg">
                    供应商
                  </Label>
                  <p className="truncate text-[11.5px] text-fg-faint">
                    {selectedProvider.description}
                  </p>
                </div>
              </div>
              <Dropdown>
                <Dropdown.Trigger
                  isDisabled={savingCustomConfig}
                  aria-label="选择供应商"
                  className={cn(
                    SETTINGS_SELECT_TRIGGER_CLASS,
                    SETTINGS_PROVIDER_TRIGGER_WIDTH,
                    "min-w-0 max-w-full shrink",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <ProviderIconTile providerId={providerId} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {selectedProvider.label}
                    </span>
                  </span>
                  <LucideIcons.ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-60" />
                </Dropdown.Trigger>
                <Dropdown.Popover
                  placement="bottom end"
                  className={SETTINGS_PROVIDER_POPOVER_CLASS}
                >
                  <Dropdown.Menu
                    aria-label="供应商列表"
                    selectionMode="single"
                    selectedKeys={new Set([providerId])}
                    onSelectionChange={handleProviderSelectionChange}
                    disallowEmptySelection
                  >
                    {API_KEY_PROVIDER_PRESETS.map((option) => {
                      const selected = option.id === providerId;
                      return (
                        <Dropdown.Item
                          key={option.id}
                          id={option.id}
                          textValue={option.label}
                          className={cn(
                            "cursor-pointer gap-2.5 rounded-[10px] px-2 py-2",
                            selected && "bg-accent-subtle text-fg",
                          )}
                        >
                          <ProviderIconTile providerId={option.id} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium leading-5 text-fg">
                              {option.label}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] leading-4 text-fg-muted">
                              {option.description}
                            </div>
                          </div>
                          <Dropdown.ItemIndicator />
                        </Dropdown.Item>
                      );
                    })}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>

            {allowCustomBaseURL ? (
              <div
                className={cn("space-y-2 px-3 py-2.5", SETTINGS_OPTION_ROW_CLASS)}
              >
                <div className="flex items-center gap-2">
                  <LucideIcons.Globe
                    className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                    strokeWidth={1.75}
                  />
                  <Label
                    htmlFor="custom-ai-base-url"
                    className="text-[12.5px] font-medium text-fg"
                  >
                    Base URL
                  </Label>
                </div>
                <Input
                  id="custom-ai-base-url"
                  fullWidth
                  value={customBaseURL}
                  onChange={(event) => {
                    setCustomSaveError(null);
                    setCustomBaseURL(event.target.value);
                  }}
                  placeholder={
                    activeProtocol === "claude"
                      ? DEFAULT_CLAUDE_BASE_URL
                      : DEFAULT_OPENAI_BASE_URL
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}

            <ApiKeyPanel
              providerId={providerId}
              apiKeyDraft={apiKeyDraft}
              onApiKeyChange={(value) => {
                setCustomSaveError(null);
                setApiKeyDraft(value);
              }}
              apiKeyVisible={apiKeyVisible}
              onApiKeyVisibleChange={setApiKeyVisible}
              saveButtonReason={saveButtonReason}
              savingCustomConfig={savingCustomConfig}
              disabled={savingCustomConfig}
              onPreferApiKey={() => handlePreferredAuthModeChange("api_key")}
              onSaveAndFetch={() => {
                void handleSaveCustomConfig();
              }}
              showProviderEnabledSwitch={Boolean(
                setProviderEnabled &&
                  ((ai.modelsByProvider?.[providerId]?.length ?? 0) > 0 ||
                    (ai.customProviderId === providerId &&
                      ai.customModelOptions.length > 0) ||
                    Boolean(readStoredApiKey(ai, providerId, ai.customProtocol))),
              )}
              providerEnabled={ai.enabledProviders?.[providerId] === true}
              onProviderEnabledChange={
                setProviderEnabled
                  ? (enabled) => setProviderEnabled(providerId, enabled)
                  : undefined
              }
            />
          </div>
          )}
        </div>
      </SettingsSectionCard>

      <div
        ref={modelSectionRef}
        id="ai-model-settings"
        tabIndex={-1}
        className="scroll-mt-6 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <SettingsSectionCard
          title={
            <span className="flex items-center gap-2">
              <LucideIcons.Brain
                className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                strokeWidth={1.75}
              />
              模型
            </span>
          }
          description={
            <span
              className="block text-[11.5px] text-fg-faint"
              role="status"
              aria-live="polite"
            >
              {savingCustomConfig
                ? "正在获取…"
                : customSaveError
                  ? `失败：${customSaveError}`
                  : displayModels.length > 0
                    ? `${displayModels.length} 个可用${currentModel ? ` · ${currentModel.label}` : ""}`
                    : isOAuthActive
                      ? "导入账号登录后可从本机缓存读取模型"
                      : "保存 Key 后自动拉取"}
            </span>
          }
          actions={
            <Button
              variant="secondary"
              size="sm"
              isDisabled={
                savingCustomConfig ||
                (useOAuthRefresh ? false : Boolean(saveButtonReason))
              }
              onPress={() => {
                if (useOAuthRefresh) {
                  void handleOAuthRefresh();
                  return;
                }
                void refreshCustomModels(
                  getConnectionForProvider(providerId),
                  "refresh",
                );
              }}
            >
              {savingCustomConfig ? (
                <LucideIcons.LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <LucideIcons.RefreshCw className="h-4 w-4" />
              )}
              {savingCustomConfig ? "获取中…" : "刷新"}
            </Button>
          }
        >
          <div
            className={cn(
              "flex min-w-0 items-center justify-between gap-3 px-3 py-2.5",
              SETTINGS_OPTION_ROW_CLASS,
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <LucideIcons.Cpu
                className="h-3.5 w-3.5 shrink-0 text-fg-muted"
                strokeWidth={1.75}
              />
              <Label className="text-[12.5px] font-medium text-fg">
                默认模型
              </Label>
            </div>
            <div
              className={cn("min-w-0 shrink-0", SETTINGS_MODEL_TRIGGER_WIDTH)}
              title={modelButtonReason ?? undefined}
            >
              <Dropdown>
                <Dropdown.Trigger
                  isDisabled={modelButtonDisabled}
                  aria-label="选择默认模型"
                  className={cn(
                    SETTINGS_SELECT_TRIGGER_CLASS,
                    "h-8 w-full min-w-0 shrink-0",
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-left">
                      {currentModel?.label ??
                        selectedModelId ??
                        modelButtonReason ??
                        "请选择模型"}
                    </span>
                  </span>
                  <LucideIcons.ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-60" />
                </Dropdown.Trigger>
                <Dropdown.Popover
                  placement="bottom end"
                  shouldFlip
                  className={cn(SETTINGS_MODEL_POPOVER_CLASS, "z-50")}
                >
                  <Dropdown.Menu
                    aria-label="默认模型列表"
                    selectionMode="single"
                    selectedKeys={
                      selectedModelId ? new Set([selectedModelId]) : new Set()
                    }
                    onSelectionChange={handleModelSelectionChange}
                    disallowEmptySelection
                    className="max-h-[min(320px,var(--available-height))]"
                  >
                    {displayModels.map((model) => {
                      const selected = model.id === selectedModelId;
                      const secondary =
                        model.description &&
                        model.description !== model.label
                          ? model.description
                          : model.id !== model.label
                            ? model.id
                            : null;
                      const showsVision = modelSupportsVision(
                        model.id,
                        displayModels,
                        effectiveProviderId,
                      );
                      return (
                        <Dropdown.Item
                          key={model.id}
                          id={model.id}
                          textValue={model.label}
                          className={cn(
                            "cursor-pointer gap-2.5 rounded-[10px] px-2 py-2",
                            selected && "bg-accent-subtle text-fg",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium leading-5 text-fg">
                                {model.label}
                              </span>
                              {showsVision ? (
                                <span
                                  className="shrink-0 rounded px-1 py-px text-[10px] font-medium leading-4 text-fg-faint"
                                  title="支持视觉"
                                >
                                  视觉
                                </span>
                              ) : null}
                            </div>
                            {secondary ? (
                              <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-fg-muted">
                                {secondary}
                              </div>
                            ) : null}
                          </div>
                          <Dropdown.ItemIndicator />
                        </Dropdown.Item>
                      );
                    })}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </div>

        </SettingsSectionCard>
      </div>
    </div>
  );
}
