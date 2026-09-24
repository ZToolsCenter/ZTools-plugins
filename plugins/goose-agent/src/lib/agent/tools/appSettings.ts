/**
 * 应用设置读写工具（ADR 0024）。
 * getAppSettings / updateAppSettings；密钥脱敏；OAuth token 永不暴露。
 */

import { applyAppearanceFonts } from "@/lib/appearance/applyAppearance";
import {
  isCodeFontId,
  isFontSizeId,
  isUiFontId,
} from "@/lib/appearance/fonts";
import { applyUiZoom } from "@/lib/appearance/uiZoom";
import {
  isAIProviderId,
  type AIModelOption,
  type AIProviderId,
  type CustomAIProtocol,
} from "@/lib/ai-provider";
import { BUILTIN_PERSONAS } from "@/lib/agent/persona";
import {
  isPermissionMode,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
} from "@/lib/agent/permission";
import { applyWindowHeight } from "@/lib/platform/windowHeight";
import {
  useSettings,
  type AISettings,
  type AppearanceSettings,
  type PersonaSettings,
} from "@/stores/settings";
import { usePermissionMode } from "@/stores/usePermissionMode";
import type { AgentToolContext } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SettingsSection = "ai" | "persona" | "appearance" | "permission";

export type MaskedSecret = {
  hasKey: boolean;
  hint: string;
};

export type AppSettingsAccessors = {
  getAI: () => AISettings;
  getPersona: () => PersonaSettings;
  getAppearance: () => AppearanceSettings;
  getPermissionMode: () => PermissionMode;
  // AI actions
  setAISelectedModelId: (id: string | null) => void;
  setAIWorkspaceSelectedModelId: (id: string | null) => void;
  setAIWorkspaceReasoningLevel: (level: "low" | "medium" | "high") => void;
  setPreferredAuthMode: (mode: "api_key" | "oauth") => void;
  setAIReadGlobalPrompt: (v: boolean) => void;
  setAIReadLocalSkills: (v: boolean) => void;
  selectComposerModel: (refOrId: string) => void;
  saveAICustomConfig: (config: {
    providerId: AIProviderId;
    protocol?: CustomAIProtocol;
    baseURL: string;
    apiKey: string;
    modelOptions: AIModelOption[];
  }) => void;
  setProviderEnabled: (providerId: AIProviderId, enabled: boolean) => void;
  clearOAuthSession: () => void;
  // Persona
  setSelectedPersonaId: (id: string) => void;
  addCustomPersona: (p: {
    name: string;
    systemSnippet: string;
  }) => string;
  updateCustomPersona: (
    id: string,
    patch: { name?: string; systemSnippet?: string },
  ) => void;
  removeCustomPersona: (id: string) => void;
  // Appearance
  setUiFont: (id: AppearanceSettings["uiFont"]) => void;
  setCodeFont: (id: AppearanceSettings["codeFont"]) => void;
  setCustomCodeFont: (value: string) => void;
  setFontSize: (id: AppearanceSettings["fontSize"]) => void;
  setWindowHeight: (height: number) => void;
  setUiZoom: (zoom: number) => void;
  // Permission
  setPermissionMode: (mode: PermissionMode) => void;
};

// ─── Accessors (injectable for tests) ────────────────────────────────────────

function defaultAccessors(): AppSettingsAccessors {
  return {
    getAI: () => useSettings.getState().ai,
    getPersona: () => useSettings.getState().persona,
    getAppearance: () => useSettings.getState().appearance,
    getPermissionMode: () => usePermissionMode.getState().mode,
    setAISelectedModelId: (id) =>
      useSettings.getState().setAISelectedModelId(id),
    setAIWorkspaceSelectedModelId: (id) =>
      useSettings.getState().setAIWorkspaceSelectedModelId(id),
    setAIWorkspaceReasoningLevel: (level) =>
      useSettings.getState().setAIWorkspaceReasoningLevel(level),
    setPreferredAuthMode: (mode) =>
      useSettings.getState().setPreferredAuthMode(mode),
    setAIReadGlobalPrompt: (v) =>
      useSettings.getState().setAIReadGlobalPrompt(v),
    setAIReadLocalSkills: (v) =>
      useSettings.getState().setAIReadLocalSkills(v),
    selectComposerModel: (ref) =>
      useSettings.getState().selectComposerModel(ref),
    saveAICustomConfig: (cfg) =>
      useSettings.getState().saveAICustomConfig(cfg),
    setProviderEnabled: (id, enabled) =>
      useSettings.getState().setProviderEnabled(id, enabled),
    clearOAuthSession: () => useSettings.getState().clearOAuthSession(),
    setSelectedPersonaId: (id) =>
      useSettings.getState().setSelectedPersonaId(id),
    addCustomPersona: (p) => useSettings.getState().addCustomPersona(p),
    updateCustomPersona: (id, patch) =>
      useSettings.getState().updateCustomPersona(id, patch),
    removeCustomPersona: (id) =>
      useSettings.getState().removeCustomPersona(id),
    setUiFont: (id) => useSettings.getState().setUiFont(id),
    setCodeFont: (id) => useSettings.getState().setCodeFont(id),
    setCustomCodeFont: (v) => useSettings.getState().setCustomCodeFont(v),
    setFontSize: (id) => useSettings.getState().setFontSize(id),
    setWindowHeight: (h) => useSettings.getState().setWindowHeight(h),
    setUiZoom: (z) => useSettings.getState().setUiZoom(z),
    setPermissionMode: (mode) => usePermissionMode.getState().setMode(mode),
  };
}

let accessors: AppSettingsAccessors = defaultAccessors();

/** 测试注入；传 null 恢复默认 */
export function setAppSettingsAccessorsForTests(
  next: AppSettingsAccessors | null,
): void {
  accessors = next ?? defaultAccessors();
}

// ─── maskSecret ──────────────────────────────────────────────────────────────

/**
 * 密钥脱敏。
 * - 空 → hasKey false, hint ""
 * - 有值长度 ≤8 → hasKey true, hint "••••"
 * - 否则前 2–4 + … + 后 4
 */
export function maskSecret(value: string): MaskedSecret {
  const v = typeof value === "string" ? value : "";
  if (!v.trim()) {
    return { hasKey: false, hint: "" };
  }
  if (v.length <= 8) {
    return { hasKey: true, hint: "••••" };
  }
  // 前缀：优先 4，短于 12 时用 2，避免与后 4 重叠过多
  const prefixLen = v.length >= 12 ? 4 : 2;
  return {
    hasKey: true,
    hint: `${v.slice(0, prefixLen)}…${v.slice(-4)}`,
  };
}

// ─── Snapshot builders ───────────────────────────────────────────────────────

const ALL_SECTIONS: SettingsSection[] = [
  "ai",
  "persona",
  "appearance",
  "permission",
];

function parseSections(raw: unknown): SettingsSection[] | { error: string } {
  if (raw == null) return [...ALL_SECTIONS];
  if (!Array.isArray(raw)) {
    return { error: "sections 须为数组（ai / persona / appearance / permission）" };
  }
  if (raw.length === 0) return [...ALL_SECTIONS];
  const out: SettingsSection[] = [];
  for (const item of raw) {
    if (
      item === "ai" ||
      item === "persona" ||
      item === "appearance" ||
      item === "permission"
    ) {
      if (!out.includes(item)) out.push(item);
    } else {
      return {
        error: `非法 section：${String(item)}。允许：ai / persona / appearance / permission`,
      };
    }
  }
  return out.length > 0 ? out : [...ALL_SECTIONS];
}

function resolveProviderKey(
  ai: AISettings,
  providerId: AIProviderId,
): string {
  const snap = ai.providerCredentials?.[providerId]?.apiKey?.trim() ?? "";
  if (snap) return snap;
  // 当前 active 供应商：回退共享协议槽
  if (ai.customProviderId === providerId) {
    return (
      ai.customOpenAIResponsesApiKey?.trim() ||
      ai.customOpenAIApiKey?.trim() ||
      ai.customClaudeApiKey?.trim() ||
      ""
    );
  }
  return "";
}

function resolveProviderBaseURL(
  ai: AISettings,
  providerId: AIProviderId,
): string {
  const snap = ai.providerCredentials?.[providerId]?.baseURL?.trim() ?? "";
  if (snap) return snap;
  if (ai.customProviderId === providerId) {
    if (ai.customProtocol === "claude") return ai.customClaudeBaseURL;
    if (ai.customProtocol === "openai") return ai.customOpenAIBaseURL;
    return ai.customOpenAIResponsesBaseURL;
  }
  return "";
}

function buildAiSnapshot(ai: AISettings) {
  const providerCredentials: Record<
    string,
    { baseURL: string; apiKey: MaskedSecret }
  > = {};
  for (const [pid, entry] of Object.entries(ai.providerCredentials ?? {})) {
    if (!entry) continue;
    providerCredentials[pid] = {
      baseURL: entry.baseURL ?? "",
      apiKey: maskSecret(entry.apiKey ?? ""),
    };
  }

  const oauth = ai.oauthSession?.accessToken?.trim()
    ? {
        hasSession: true as const,
        accountLabel: ai.oauthSession.accountLabel,
        providerId: ai.oauthSession.providerId,
        source: ai.oauthSession.source,
        expiresAt: ai.oauthSession.expiresAt,
      }
    : null;

  return {
    selectedModelId: ai.selectedModelId,
    workspaceSelectedModelId: ai.workspaceSelectedModelId,
    workspaceReasoningLevel: ai.workspaceReasoningLevel,
    customProviderId: ai.customProviderId,
    customProtocol: ai.customProtocol,
    preferredAuthMode: ai.preferredAuthMode,
    readGlobalPrompt: ai.readGlobalPrompt,
    readLocalSkills: ai.readLocalSkills,
    runtime: ai.runtime,
    customOpenAIResponsesBaseURL: ai.customOpenAIResponsesBaseURL,
    customOpenAIBaseURL: ai.customOpenAIBaseURL,
    customClaudeBaseURL: ai.customClaudeBaseURL,
    customOpenAIResponsesApiKey: maskSecret(ai.customOpenAIResponsesApiKey),
    customOpenAIApiKey: maskSecret(ai.customOpenAIApiKey),
    customClaudeApiKey: maskSecret(ai.customClaudeApiKey),
    providerCredentials,
    modelsByProvider: ai.modelsByProvider,
    customModelOptions: ai.customModelOptions,
    enabledProviders: ai.enabledProviders,
    oauth,
  };
}

function buildPersonaSnapshot(persona: PersonaSettings) {
  return {
    selectedPersonaId: persona.selectedPersonaId,
    customPersonas: persona.customPersonas,
    builtinPersonas: BUILTIN_PERSONAS.map((p) => ({
      id: p.id,
      name: p.name,
    })),
  };
}

function buildPermissionSnapshot(mode: PermissionMode) {
  return {
    mode,
    labels: { ...PERMISSION_MODE_LABELS },
  };
}

function buildSnapshot(sections: SettingsSection[]) {
  const result: Record<string, unknown> = { ok: true };
  if (sections.includes("ai")) {
    result.ai = buildAiSnapshot(accessors.getAI());
  }
  if (sections.includes("persona")) {
    result.persona = buildPersonaSnapshot(accessors.getPersona());
  }
  if (sections.includes("appearance")) {
    result.appearance = { ...accessors.getAppearance() };
  }
  if (sections.includes("permission")) {
    result.permission = buildPermissionSnapshot(accessors.getPermissionMode());
  }
  return result;
}

// ─── getAppSettings ──────────────────────────────────────────────────────────

export async function executeGetAppSettings(
  input: Record<string, unknown>,
  _ctx?: AgentToolContext,
): Promise<unknown> {
  const parsed = parseSections(input.sections);
  if ("error" in parsed) {
    return { ok: false, error: parsed.error };
  }
  return buildSnapshot(parsed);
}

// ─── updateAppSettings ───────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parseModelOptions(raw: unknown): AIModelOption[] | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    return { error: "saveProvider.modelOptions 须为数组" };
  }
  const out: AIModelOption[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label =
      typeof item.label === "string" ? item.label.trim() : id;
    if (!id) continue;
    const opt: AIModelOption = { id, label: label || id };
    if (typeof item.description === "string" && item.description.trim()) {
      opt.description = item.description.trim();
    }
    if (
      typeof item.contextWindow === "number" &&
      item.contextWindow > 0
    ) {
      opt.contextWindow = Math.floor(item.contextWindow);
    }
    if (typeof item.supportsVision === "boolean") {
      opt.supportsVision = item.supportsVision;
    }
    out.push(opt);
  }
  return out;
}

/**
 * 解析 saveProvider 时要使用的当前 key：
 * - 显式非空 apiKey → 使用
 * - 省略 / 空 → 从 state 取已有 key，避免误清空
 */
function resolveSaveApiKey(
  ai: AISettings,
  providerId: AIProviderId,
  apiKeyField: unknown,
): string {
  if (typeof apiKeyField === "string" && apiKeyField.trim()) {
    return apiKeyField.trim();
  }
  // 不改 key：优先 providerCredentials，再共享槽
  return resolveProviderKey(ai, providerId);
}

export async function executeUpdateAppSettings(
  input: Record<string, unknown>,
  _ctx?: AgentToolContext,
): Promise<unknown> {
  // 硬拒：任何试图写入 oauth token 的字段
  if (isObject(input.ai)) {
    const aiIn = input.ai;
    if (
      "oauthSession" in aiIn ||
      "accessToken" in aiIn ||
      "refreshToken" in aiIn ||
      (isObject(aiIn.oauth) &&
        ("accessToken" in aiIn.oauth || "refreshToken" in aiIn.oauth))
    ) {
      return {
        ok: false,
        error:
          "禁止通过工具写入 OAuth token；断开本机账号请使用 clearOAuth: true",
      };
    }
  }

  const applied: string[] = [];

  // ── permissionMode（顶层） ──
  if ("permissionMode" in input) {
    const mode = input.permissionMode;
    if (!isPermissionMode(mode)) {
      return {
        ok: false,
        error:
          "非法 permissionMode；允许：workspace-read / workspace-write / full-access",
      };
    }
    accessors.setPermissionMode(mode);
    applied.push("permissionMode");
  }

  // ── ai ──
  if (isObject(input.ai)) {
    const aiPatch = input.ai;

    if ("selectedModelId" in aiPatch) {
      const v = aiPatch.selectedModelId;
      if (v !== null && typeof v !== "string") {
        return { ok: false, error: "ai.selectedModelId 须为 string 或 null" };
      }
      accessors.setAISelectedModelId(
        typeof v === "string" && v.trim() ? v.trim() : null,
      );
      applied.push("ai.selectedModelId");
    }

    if ("workspaceSelectedModelId" in aiPatch) {
      const v = aiPatch.workspaceSelectedModelId;
      if (v !== null && typeof v !== "string") {
        return {
          ok: false,
          error: "ai.workspaceSelectedModelId 须为 string 或 null",
        };
      }
      accessors.setAIWorkspaceSelectedModelId(
        typeof v === "string" && v.trim() ? v.trim() : null,
      );
      applied.push("ai.workspaceSelectedModelId");
    }

    if ("workspaceReasoningLevel" in aiPatch) {
      const v = aiPatch.workspaceReasoningLevel;
      if (v !== "low" && v !== "medium" && v !== "high") {
        return {
          ok: false,
          error: "ai.workspaceReasoningLevel 须为 low / medium / high",
        };
      }
      accessors.setAIWorkspaceReasoningLevel(v);
      applied.push("ai.workspaceReasoningLevel");
    }

    if ("preferredAuthMode" in aiPatch) {
      const v = aiPatch.preferredAuthMode;
      if (v !== "api_key" && v !== "oauth") {
        return {
          ok: false,
          error: "ai.preferredAuthMode 须为 api_key 或 oauth",
        };
      }
      accessors.setPreferredAuthMode(v);
      applied.push("ai.preferredAuthMode");
    }

    if ("readGlobalPrompt" in aiPatch) {
      if (typeof aiPatch.readGlobalPrompt !== "boolean") {
        return { ok: false, error: "ai.readGlobalPrompt 须为 boolean" };
      }
      accessors.setAIReadGlobalPrompt(aiPatch.readGlobalPrompt);
      applied.push("ai.readGlobalPrompt");
    }

    if ("readLocalSkills" in aiPatch) {
      if (typeof aiPatch.readLocalSkills !== "boolean") {
        return { ok: false, error: "ai.readLocalSkills 须为 boolean" };
      }
      accessors.setAIReadLocalSkills(aiPatch.readLocalSkills);
      applied.push("ai.readLocalSkills");
    }

    if ("selectComposerModel" in aiPatch) {
      const ref = aiPatch.selectComposerModel;
      if (typeof ref !== "string" || !ref.trim()) {
        return {
          ok: false,
          error: "ai.selectComposerModel 须为非空字符串（provider/model）",
        };
      }
      accessors.selectComposerModel(ref.trim());
      applied.push("ai.selectComposerModel");
    }

    if ("saveProvider" in aiPatch) {
      if (!isObject(aiPatch.saveProvider)) {
        return { ok: false, error: "ai.saveProvider 须为对象" };
      }
      const sp = aiPatch.saveProvider;
      const providerIdRaw = sp.providerId;
      if (typeof providerIdRaw !== "string" || !isAIProviderId(providerIdRaw)) {
        return {
          ok: false,
          error:
            "ai.saveProvider.providerId 非法；允许 deepseek / xai / custom-openai-responses / custom-openai / custom-claude",
        };
      }
      const providerId = providerIdRaw as AIProviderId;

      let protocol: CustomAIProtocol | undefined;
      if ("protocol" in sp && sp.protocol != null) {
        if (
          sp.protocol !== "openai" &&
          sp.protocol !== "openai-responses" &&
          sp.protocol !== "claude"
        ) {
          return {
            ok: false,
            error:
              "ai.saveProvider.protocol 须为 openai / openai-responses / claude",
          };
        }
        protocol = sp.protocol;
      }

      const currentAi = accessors.getAI();
      const baseURL =
        typeof sp.baseURL === "string" && sp.baseURL.trim()
          ? sp.baseURL.trim()
          : resolveProviderBaseURL(currentAi, providerId);

      const modelOptionsRaw = parseModelOptions(sp.modelOptions);
      if ("error" in modelOptionsRaw) {
        return { ok: false, error: modelOptionsRaw.error };
      }
      // 若未提供 modelOptions，保留该供应商已有模型
      const modelOptions =
        modelOptionsRaw.length > 0
          ? modelOptionsRaw
          : (currentAi.modelsByProvider?.[providerId] ??
            (currentAi.customProviderId === providerId
              ? currentAi.customModelOptions
              : []));

      const apiKey = resolveSaveApiKey(currentAi, providerId, sp.apiKey);

      accessors.saveAICustomConfig({
        providerId,
        protocol,
        baseURL,
        apiKey,
        modelOptions,
      });
      applied.push("ai.saveProvider");
    }

    if ("setProviderEnabled" in aiPatch) {
      if (!isObject(aiPatch.setProviderEnabled)) {
        return { ok: false, error: "ai.setProviderEnabled 须为对象" };
      }
      const pe = aiPatch.setProviderEnabled;
      if (typeof pe.providerId !== "string" || !isAIProviderId(pe.providerId)) {
        return {
          ok: false,
          error: "ai.setProviderEnabled.providerId 非法",
        };
      }
      if (typeof pe.enabled !== "boolean") {
        return {
          ok: false,
          error: "ai.setProviderEnabled.enabled 须为 boolean",
        };
      }
      accessors.setProviderEnabled(pe.providerId, pe.enabled);
      applied.push("ai.setProviderEnabled");
    }

    if ("clearOAuth" in aiPatch) {
      if (aiPatch.clearOAuth === true) {
        accessors.clearOAuthSession();
        applied.push("ai.clearOAuth");
      } else if (aiPatch.clearOAuth !== false) {
        return {
          ok: false,
          error: "ai.clearOAuth 须为 boolean（true 断开本机账号）",
        };
      }
    }
  }

  // ── persona ──
  if (isObject(input.persona)) {
    const p = input.persona;

    if ("selectedPersonaId" in p) {
      if (typeof p.selectedPersonaId !== "string" || !p.selectedPersonaId.trim()) {
        return {
          ok: false,
          error: "persona.selectedPersonaId 须为非空字符串",
        };
      }
      accessors.setSelectedPersonaId(p.selectedPersonaId.trim());
      applied.push("persona.selectedPersonaId");
    }

    if ("addCustomPersona" in p) {
      if (!isObject(p.addCustomPersona)) {
        return { ok: false, error: "persona.addCustomPersona 须为对象" };
      }
      const ap = p.addCustomPersona;
      if (typeof ap.name !== "string" || !ap.name.trim()) {
        return {
          ok: false,
          error: "persona.addCustomPersona.name 须为非空字符串",
        };
      }
      if (typeof ap.systemSnippet !== "string") {
        return {
          ok: false,
          error: "persona.addCustomPersona.systemSnippet 须为字符串",
        };
      }
      accessors.addCustomPersona({
        name: ap.name,
        systemSnippet: ap.systemSnippet,
      });
      applied.push("persona.addCustomPersona");
    }

    if ("updateCustomPersona" in p) {
      if (!isObject(p.updateCustomPersona)) {
        return { ok: false, error: "persona.updateCustomPersona 须为对象" };
      }
      const up = p.updateCustomPersona;
      if (typeof up.id !== "string" || !up.id.trim()) {
        return {
          ok: false,
          error: "persona.updateCustomPersona.id 须为非空字符串",
        };
      }
      const patch: { name?: string; systemSnippet?: string } = {};
      if (typeof up.name === "string") patch.name = up.name;
      if (typeof up.systemSnippet === "string") {
        patch.systemSnippet = up.systemSnippet;
      }
      accessors.updateCustomPersona(up.id.trim(), patch);
      applied.push("persona.updateCustomPersona");
    }

    if ("removeCustomPersonaId" in p) {
      if (
        typeof p.removeCustomPersonaId !== "string" ||
        !p.removeCustomPersonaId.trim()
      ) {
        return {
          ok: false,
          error: "persona.removeCustomPersonaId 须为非空字符串",
        };
      }
      accessors.removeCustomPersona(p.removeCustomPersonaId.trim());
      applied.push("persona.removeCustomPersonaId");
    }
  }

  // ── appearance ──
  let appearanceTouched = false;
  let windowHeightTouched = false;
  let uiZoomTouched = false;
  if (isObject(input.appearance)) {
    const a = input.appearance;

    if ("uiFont" in a) {
      if (!isUiFontId(a.uiFont)) {
        return { ok: false, error: "appearance.uiFont 非法" };
      }
      accessors.setUiFont(a.uiFont);
      applied.push("appearance.uiFont");
      appearanceTouched = true;
    }

    if ("codeFont" in a) {
      if (!isCodeFontId(a.codeFont)) {
        return { ok: false, error: "appearance.codeFont 非法" };
      }
      accessors.setCodeFont(a.codeFont);
      applied.push("appearance.codeFont");
      appearanceTouched = true;
    }

    if ("customCodeFont" in a) {
      if (typeof a.customCodeFont !== "string") {
        return {
          ok: false,
          error: "appearance.customCodeFont 须为字符串",
        };
      }
      accessors.setCustomCodeFont(a.customCodeFont);
      applied.push("appearance.customCodeFont");
      appearanceTouched = true;
    }

    if ("fontSize" in a) {
      if (!isFontSizeId(a.fontSize)) {
        return {
          ok: false,
          error: "appearance.fontSize 须为 sm / md / lg",
        };
      }
      accessors.setFontSize(a.fontSize);
      applied.push("appearance.fontSize");
      appearanceTouched = true;
    }

    if ("windowHeight" in a) {
      if (
        typeof a.windowHeight !== "number" ||
        !Number.isFinite(a.windowHeight)
      ) {
        return {
          ok: false,
          error: "appearance.windowHeight 须为数字",
        };
      }
      accessors.setWindowHeight(a.windowHeight);
      applied.push("appearance.windowHeight");
      appearanceTouched = true;
      windowHeightTouched = true;
    }

    if ("uiZoom" in a) {
      if (typeof a.uiZoom !== "number" || !Number.isFinite(a.uiZoom)) {
        return {
          ok: false,
          error: "appearance.uiZoom 须为数字",
        };
      }
      accessors.setUiZoom(a.uiZoom);
      applied.push("appearance.uiZoom");
      appearanceTouched = true;
      uiZoomTouched = true;
    }
  }

  if (appearanceTouched) {
    const appearance = accessors.getAppearance();
    applyAppearanceFonts(appearance);
    if (windowHeightTouched) {
      applyWindowHeight(appearance.windowHeight);
    }
    if (uiZoomTouched) {
      applyUiZoom(appearance.uiZoom);
    }
  }

  if (applied.length === 0) {
    return {
      ok: false,
      error: "未提供任何可应用的 patch 字段",
    };
  }

  return {
    ok: true,
    applied,
    snapshot: buildSnapshot([...ALL_SECTIONS]),
  };
}
