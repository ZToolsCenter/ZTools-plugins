import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  inferProviderIdFromSettings,
  isAIProviderId,
  type AIModelOption,
  type AIProviderId,
  type AIReasoningLevel,
  type CustomAIProtocol,
} from "@/lib/ai-provider";

export interface SearchProvider {
  id: string;
  name: string;
  urlTemplate: string;
  isEnabled: boolean;
  isCustom?: boolean;
}
export type Theme = "light" | "dark" | "system";
export const ACCENT_COLORS = [
  "mono",
  "iris",
  "ocean",
  "pine",
  "amber",
  "coral",
  "rose",
  "grape",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
export const DEFAULT_ACCENT_COLOR: AccentColor = "mono";

export type CodeStyle =
  | "default"
  | "github"
  | "catppuccin"
  | "modern"
  | "night"
  | "dracula"
  | "nord"
  | "nord-light";

export interface UToolsSettings {
  globalSearchEnabled: boolean;
  openSearchInUtools: boolean;
  /** 默认 false：图片交给系统默认查看器；开启后使用应用内灯箱。 */
  useInternalImageViewer: boolean;
  windowHeight: number;
}

/** Agent 运行时：pi = Pi harness；legacy = 自研 ToolLoopAgent。 */
export type AIAgentRuntime = "legacy" | "pi";

export interface AISettings {
  enabled: boolean;
  readGlobalPrompt: boolean;
  readLocalSkills: boolean;
  /** Agent 运行时；默认 pi。可用 localStorage goose-ai-runtime 覆盖。 */
  runtime: AIAgentRuntime;
  selectedModelId: string | null;
  workspaceSelectedModelId: string | null;
  workspaceReasoningLevel: AIReasoningLevel;
  /** 供应商预设（DeepSeek / GLM / MiniMax / 自定义…） */
  customProviderId: AIProviderId;
  customProtocol: CustomAIProtocol;
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: AIModelOption[];
}

export type DesktopHotkeyStatusState =
  | "idle"
  | "active"
  | "occupied"
  | "invalid"
  | "disabled"
  | "error";

export interface DesktopHotkeyStatus {
  state: DesktopHotkeyStatusState;
  message?: string;
  rawError?: string;
}

export interface DesktopSettings {
  wakeHotkey: string;
  wakeHotkeyEnabled: boolean;
  searchHotkey: string;
  searchHotkeyEnabled: boolean;
  wakeHotkeyStatus: DesktopHotkeyStatus;
  searchHotkeyStatus: DesktopHotkeyStatus;
}

export interface PrivacySettings {
  autoOpenLastNote: boolean;
  autoCloseInactiveTabs: boolean;
  autoCloseInactiveTabsHours: number;
}

export interface FontConfig {
  label: string | null;
  font: string | null;
}

export interface CustomFonts {
  default: FontConfig;
  serif: FontConfig;
  mono: FontConfig;
}

export interface CustomAction {
  id: string;
  name: string;
  pluginName?: string;
  command: string;
  isEnabled: boolean;
}

// 界面字体大小选项：small 对应"标准"，normal 对应"放大"
export type UIFontSize = "small" | "normal";

// 编辑器字体大小边界
export const EDITOR_FONT_SIZE_MIN = 12;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_FONT_SIZE_DEFAULT = 16;
export const DEFAULT_WAKE_HOTKEY = "CmdOrCtrl+Alt+N";
export const DEFAULT_SEARCH_HOTKEY = "CmdOrCtrl+Shift+K";
export const DEFAULT_CLOSE_TAB_SHORTCUT = "";
export const DEFAULT_SEARCH_PANEL_CLOSE_SHORTCUT = "";
export const UTOOLS_WINDOW_HEIGHT_MIN = 600;
export const UTOOLS_WINDOW_HEIGHT_MAX = 1200;
export const UTOOLS_WINDOW_HEIGHT_DEFAULT = 800;
export const AUTO_CLOSE_INACTIVE_TABS_HOURS_MIN = 1;
export const AUTO_CLOSE_INACTIVE_TABS_HOURS_MAX = 720;
export const AUTO_CLOSE_INACTIVE_TABS_HOURS_DEFAULT = 24;

export const DEFAULT_UI_FONT_SIZE: UIFontSize = "small";
export const LEGACY_DEFAULT_CUSTOM_ACTION_ID = "default-translate";

export const DEFAULT_SEARCH_PROVIDERS: SearchProvider[] = [
  {
    id: "baidu",
    name: "百度",
    urlTemplate: "https://www.baidu.com/s?wd=%s",
    isEnabled: true,
  },
  {
    id: "google",
    name: "Google",
    urlTemplate: "https://www.google.com/search?q=%s",
    isEnabled: false,
  },
  {
    id: "quark",
    name: "夸克",
    urlTemplate: "https://ai.quark.cn/s?q=%s",
    isEnabled: true,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    urlTemplate: "https://www.xiaohongshu.com/search_result?keyword=%s",
    isEnabled: true,
  },
  {
    id: "bilibili",
    name: "哔哩哔哩",
    urlTemplate: "https://search.bilibili.com/all?keyword=%s",
    isEnabled: false,
  },
  {
    id: "douyin",
    name: "抖音",
    urlTemplate: "https://www.douyin.com/search/%s",
    isEnabled: false,
  },
  {
    id: "perplexity",
    name: "Perplexity",
    urlTemplate: "https://www.perplexity.ai/search?q=%s",
    isEnabled: false,
  },
  {
    id: "bing",
    name: "Bing",
    urlTemplate: "https://www.bing.com/search?q=%s",
    isEnabled: false,
  },
  {
    id: "metaso",
    name: "秘塔",
    urlTemplate: "https://metaso.cn/?q=%s",
    isEnabled: false,
  },
];

export const CODE_STYLE_MIGRATION_MAP: Record<string, CodeStyle> = {
  default: "github",
  vivid: "nord",
};

export const DEFAULT_HOTKEY_STATUS: DesktopHotkeyStatus = {
  state: "idle",
};

export function normalizeDesktopHotkeyStatus(
  status: Partial<DesktopHotkeyStatus> | undefined,
): DesktopHotkeyStatus {
  const state = status?.state;
  if (
    state !== "idle" &&
    state !== "active" &&
    state !== "occupied" &&
    state !== "invalid" &&
    state !== "disabled" &&
    state !== "error"
  ) {
    return DEFAULT_HOTKEY_STATUS;
  }

  return {
    state,
    message: status?.message,
    rawError: status?.rawError,
  };
}

export function normalizeCodeStyle(codeStyle: string | undefined): CodeStyle {
  if (!codeStyle) return "github";
  if (codeStyle in CODE_STYLE_MIGRATION_MAP) {
    return CODE_STYLE_MIGRATION_MAP[codeStyle];
  }
  if (
    codeStyle === "github" ||
    codeStyle === "catppuccin" ||
    codeStyle === "modern" ||
    codeStyle === "night" ||
    codeStyle === "dracula" ||
    codeStyle === "nord" ||
    codeStyle === "nord-light"
  ) {
    return codeStyle;
  }
  return "github";
}

export function normalizeAccentColor(accentColor: unknown): AccentColor {
  if (accentColor === "teal") return "mono";
  return typeof accentColor === "string" &&
    (ACCENT_COLORS as readonly string[]).includes(accentColor)
    ? (accentColor as AccentColor)
    : DEFAULT_ACCENT_COLOR;
}

export function resolveCodeTheme(
  codeStyle: CodeStyle,
  isDark: boolean,
): string {
  switch (codeStyle) {
    case "modern":
      return isDark ? "one-dark" : "one-light";
    case "catppuccin":
      return isDark ? "catppuccin-mocha" : "catppuccin-latte";
    case "night":
      return isDark ? "tokyo-night" : "github-light-mod";
    case "dracula":
      // Dracula 没有官方浅色版；浅色模式搭配项目已有的柔和亮色主题。
      return isDark ? "dracula" : "github-light-mod";
    case "nord":
    case "nord-light":
      return isDark ? "nord" : "nord-light";
    case "default":
    case "github":
    default:
      return isDark ? "github-dark" : "github-light";
  }
}

export function normalizeUIFontSize(
  uiFontSize: string | undefined,
): UIFontSize {
  if (uiFontSize === "small") return "small";
  if (uiFontSize === "normal" || uiFontSize === "large") return "normal";
  return DEFAULT_UI_FONT_SIZE;
}

export function normalizeAutoCloseInactiveTabsHours(hours: unknown): number {
  if (typeof hours !== "number" || !Number.isFinite(hours)) {
    return AUTO_CLOSE_INACTIVE_TABS_HOURS_DEFAULT;
  }

  return Math.min(
    AUTO_CLOSE_INACTIVE_TABS_HOURS_MAX,
    Math.max(AUTO_CLOSE_INACTIVE_TABS_HOURS_MIN, Math.round(hours)),
  );
}

export function mergeSearchProvidersWithDefaults(
  searchProviders: SearchProvider[] | undefined,
): SearchProvider[] {
  if (!searchProviders || searchProviders.length === 0) {
    return DEFAULT_SEARCH_PROVIDERS;
  }

  const defaultMap = new Map(
    DEFAULT_SEARCH_PROVIDERS.map((provider) => [provider.id, provider]),
  );
  const merged: SearchProvider[] = [];
  const seenIds = new Set<string>();

  searchProviders.forEach((provider) => {
    if (
      !provider ||
      typeof provider !== "object" ||
      typeof provider.id !== "string"
    )
      return;

    const id = provider.id.trim();
    if (!id || seenIds.has(id)) return;

    const defaultProvider = defaultMap.get(id);
    if (defaultProvider) {
      merged.push({
        ...defaultProvider,
        isEnabled: Boolean(provider.isEnabled),
      });
      seenIds.add(id);
      return;
    }

    const name =
      typeof provider.name === "string"
        ? provider.name.trim().slice(0, 30)
        : "";
    const urlTemplate =
      typeof provider.urlTemplate === "string"
        ? provider.urlTemplate.trim()
        : "";
    if (!name || getSearchProviderTemplateError(urlTemplate)) return;

    merged.push({
      id,
      name,
      urlTemplate,
      isEnabled: Boolean(provider.isEnabled),
      isCustom: true,
    });
    seenIds.add(id);
  });

  const existingIds = new Set(merged.map((provider) => provider.id));
  DEFAULT_SEARCH_PROVIDERS.forEach((provider) => {
    if (!existingIds.has(provider.id)) {
      merged.push(provider);
    }
  });

  return merged;
}

export function getSearchProviderTemplateError(
  urlTemplate: string,
): string | null {
  const template = urlTemplate.trim();
  if (!template) return "请输入搜索网址";

  const placeholderCount = template.split("%s").length - 1;
  if (placeholderCount !== 1) return "搜索网址需要包含一个 %s";

  try {
    const url = new URL(template.replace("%s", "goose-note-search"));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "搜索网址仅支持 http 或 https";
    }
  } catch {
    return "请输入有效的网址";
  }

  return null;
}

export function normalizeCustomActions(
  customActions: CustomAction[] | undefined,
): CustomAction[] {
  if (!Array.isArray(customActions)) {
    return [];
  }

  const normalized = customActions
    .filter((action): action is CustomAction =>
      Boolean(action && typeof action === "object"),
    )
    .map((action, index) => ({
      id:
        typeof action.id === "string" && action.id.trim()
          ? action.id.trim()
          : `custom-action-${Date.now()}-${index}`,
      name: typeof action.name === "string" ? action.name.trim() : "",
      pluginName:
        typeof action.pluginName === "string" && action.pluginName.trim()
          ? action.pluginName.trim()
          : undefined,
      command: typeof action.command === "string" ? action.command.trim() : "",
      isEnabled: Boolean(action.isEnabled),
    }));

  if (
    normalized.length === 1 &&
    normalized[0].id === LEGACY_DEFAULT_CUSTOM_ACTION_ID &&
    normalized[0].name === "跳转到翻译" &&
    normalized[0].command === "翻译" &&
    normalized[0].isEnabled &&
    !normalized[0].pluginName
  ) {
    return [];
  }

  return normalized;
}

export function normalizeAIModelOptions(
  modelOptions: AIModelOption[] | undefined,
): AIModelOption[] {
  if (!Array.isArray(modelOptions)) {
    return [];
  }

  return modelOptions
    .filter((item): item is AIModelOption =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id.trim() : "",
      label: typeof item.label === "string" ? item.label.trim() : "",
      description:
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : undefined,
    }))
    .filter((item) => item.id && item.label);
}

export function normalizeAIBaseURL(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeAIApiKey(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeAIReasoningLevel(value: unknown): AIReasoningLevel {
  if (
    value === "default" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  ) {
    return value;
  }
  return "default";
}

export function normalizeAISettings(
  ai: Partial<AISettings> | undefined,
): AISettings {
  const customModelOptions = normalizeAIModelOptions(ai?.customModelOptions);
  const storedSelectedModelId =
    typeof ai?.selectedModelId === "string" && ai.selectedModelId.trim()
      ? ai.selectedModelId.trim()
      : null;
  const storedWorkspaceSelectedModelId =
    typeof ai?.workspaceSelectedModelId === "string" &&
    ai.workspaceSelectedModelId.trim()
      ? ai.workspaceSelectedModelId.trim()
      : null;
  const legacyAI = (ai ?? {}) as Partial<AISettings> & {
    customBaseURL?: unknown;
    customApiKey?: unknown;
  };
  const legacyBaseURL =
    typeof legacyAI.customBaseURL === "string"
      ? legacyAI.customBaseURL.trim()
      : "";
  const legacyApiKey =
    typeof legacyAI.customApiKey === "string"
      ? legacyAI.customApiKey.trim()
      : "";
  const customProtocol: CustomAIProtocol =
    ai?.customProtocol === "openai-responses" ||
    ai?.customProtocol === "openai" ||
    ai?.customProtocol === "claude"
      ? ai.customProtocol
      : legacyApiKey || legacyBaseURL
        ? "openai"
        : "openai-responses";
  const selectedModelId =
    storedSelectedModelId &&
    (customModelOptions.length === 0 ||
      customModelOptions.some((item) => item.id === storedSelectedModelId))
      ? storedSelectedModelId
      : (customModelOptions[0]?.id ?? null);

  const runtime: AIAgentRuntime =
    ai?.runtime === "legacy" || ai?.runtime === "pi" ? ai.runtime : "pi";

  const customOpenAIResponsesBaseURL = normalizeAIBaseURL(
    ai?.customOpenAIResponsesBaseURL,
    customProtocol === "openai-responses" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_OPENAI_BASE_URL,
  );
  const customOpenAIBaseURL = normalizeAIBaseURL(
    ai?.customOpenAIBaseURL,
    customProtocol === "openai" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_OPENAI_BASE_URL,
  );
  const customClaudeBaseURL = normalizeAIBaseURL(
    ai?.customClaudeBaseURL,
    customProtocol === "claude" && legacyBaseURL
      ? legacyBaseURL
      : DEFAULT_CLAUDE_BASE_URL,
  );

  const customProviderId: AIProviderId = isAIProviderId(ai?.customProviderId)
    ? ai.customProviderId
    : inferProviderIdFromSettings({
        customProviderId: ai?.customProviderId,
        customProtocol,
        customOpenAIResponsesBaseURL,
        customOpenAIBaseURL,
        customClaudeBaseURL,
      });

  return {
    enabled: Boolean(ai?.enabled),
    readGlobalPrompt:
      typeof ai?.readGlobalPrompt === "boolean" ? ai.readGlobalPrompt : true,
    readLocalSkills:
      typeof ai?.readLocalSkills === "boolean" ? ai.readLocalSkills : true,
    runtime,
    selectedModelId,
    workspaceSelectedModelId: storedWorkspaceSelectedModelId,
    workspaceReasoningLevel: normalizeAIReasoningLevel(
      ai?.workspaceReasoningLevel,
    ),
    customProviderId,
    customProtocol,
    customOpenAIResponsesBaseURL,
    customOpenAIBaseURL,
    customClaudeBaseURL,
    customOpenAIResponsesApiKey: normalizeAIApiKey(
      ai?.customOpenAIResponsesApiKey,
      customProtocol === "openai-responses" ? legacyApiKey : "",
    ),
    customOpenAIApiKey: normalizeAIApiKey(
      ai?.customOpenAIApiKey,
      customProtocol === "openai" ? legacyApiKey : "",
    ),
    customClaudeApiKey: normalizeAIApiKey(
      ai?.customClaudeApiKey,
      customProtocol === "claude" ? legacyApiKey : "",
    ),
    customModelOptions,
  };
}
