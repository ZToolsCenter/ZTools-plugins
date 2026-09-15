/**
 * 本机 CLI 鉴权材料探测与（可选）导入。
 * detect：仅返回 **可行动** 凭证（importAllowed && hasAuthMaterial），
 *   即能驱动 OAuth/对话的 Grok auth.json / OpenCodex xAI 会话。
 * import：仅 grok_cli / opencodex（xai 账号）允许读入 oauthSession。
 * 模型列表：读 ~/.grok/models_cache.json（Grok CLI 会话缓存）。
 *
 * 禁止：Claude 订阅桥、ChatGPT access_token 当 sk-、静默写 secret 到 Key 槽。
 * 不展示：仅 presence 的 Claude/Pi/OpenCode/Codex/无材料目录。
 */
import { exists, getHomedir, readFile } from "@/lib/fs";
import type { AIOAuthSession } from "./auth";
import {
  cacheGrokCliClientVersion,
  parseGrokCliVersionJson,
} from "./cliProxyHeaders";
import {
  XAI_CLI_SESSION_BASE_URL,
  type AIProviderId,
  type AIProviderPreset,
} from "./presets";
import type { AIModelOption, CustomAIProtocol } from "./types";

export type LocalAuthSource =
  | "grok_cli"
  | "opencodex"
  | "codex_cli"
  | "claude_cli"
  | "pi_cli"
  | "opencode"
  | string;

export type LocalAuthHint = {
  /** 可导入时对应的供应商；detect-only 可为 null */
  providerId: AIProviderId | null;
  source: LocalAuthSource;
  /** 家目录相对展示用，如 ~/.grok */
  displayPath: string;
  /** 是否发现可用 auth 材料（存在性或轻解析；未把 secret 写入 ga:） */
  hasAuthMaterial: boolean;
  /** 是否允许本产品导入为 oauthSession */
  importAllowed: boolean;
  /** 仅导入解析后可选 */
  accountHint?: string;
  /** UI 短状态说明 */
  statusNote?: string;
};

/** 拼接家目录下相对路径（POSIX 风格 / 即可，preload 会规范化） */
function joinHome(home: string, ...parts: string[]): string {
  const base = home.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return [base, ...parts].join(sep);
}

/** preset 是否要求本机 CLI 目录存在才出现在供应商列表 */
export function isLocalPresenceProvider(
  providerId: AIProviderId | string | null | undefined,
  presets: AIProviderPreset[],
): boolean {
  if (!providerId) return false;
  const preset = presets.find((p) => p.id === providerId);
  return Boolean(preset?.requiresLocalPresence);
}

/**
 * 过滤供应商下拉可见项：
 * - 无 requiresLocalPresence → 始终可见
 * - 有 requiresLocalPresence → 仅当 hints 中存在同 providerId
 */
export function filterVisibleProviderPresets(
  presets: AIProviderPreset[],
  hints: LocalAuthHint[],
): AIProviderPreset[] {
  return presets.filter((preset) => {
    if (!preset.requiresLocalPresence) return true;
    return hints.some((h) => h.providerId === preset.id);
  });
}

/**
 * 解析 Grok CLI `~/.grok/auth.json`。
 * 顶层为 auth entry id → { key, refresh_token?, expires_at?, email?, ... }。
 * 取第一个非空 key 的条目。
 */
export function parseGrokAuthJson(raw: string): AIOAuthSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!key) continue;

    const session: AIOAuthSession = {
      accessToken: key,
      providerId: "xai",
    };

    if (typeof entry.refresh_token === "string" && entry.refresh_token.trim()) {
      session.refreshToken = entry.refresh_token.trim();
    }

    if (typeof entry.expires_at === "string" && entry.expires_at.trim()) {
      const ms = Date.parse(entry.expires_at);
      if (Number.isFinite(ms)) {
        session.expiresAt = ms;
      }
    }

    if (typeof entry.email === "string" && entry.email.trim()) {
      session.accountLabel = entry.email.trim();
    } else {
      session.accountLabel = "Grok 账号";
    }

    return session;
  }

  return null;
}

/**
 * 从 credential 对象提取 access / refresh / email（OpenCodex 等）。
 */
function sessionFromCredentialObject(
  cred: Record<string, unknown>,
  accountLabelFallback: string,
): AIOAuthSession | null {
  const access =
    (typeof cred.access === "string" && cred.access.trim()) ||
    (typeof cred.access_token === "string" && cred.access_token.trim()) ||
    (typeof cred.accessToken === "string" && cred.accessToken.trim()) ||
    (typeof cred.key === "string" && cred.key.trim()) ||
    "";
  if (!access) return null;

  const session: AIOAuthSession = {
    accessToken: access,
    providerId: "xai",
  };

  const refresh =
    (typeof cred.refresh === "string" && cred.refresh.trim()) ||
    (typeof cred.refresh_token === "string" && cred.refresh_token.trim()) ||
    (typeof cred.refreshToken === "string" && cred.refreshToken.trim()) ||
    "";
  if (refresh) session.refreshToken = refresh;

  const email =
    (typeof cred.email === "string" && cred.email.trim()) ||
    (typeof cred.account === "string" && cred.account.trim()) ||
    "";
  session.accountLabel = email || accountLabelFallback;

  if (typeof cred.expires_at === "string" && cred.expires_at.trim()) {
    const ms = Date.parse(cred.expires_at);
    if (Number.isFinite(ms)) session.expiresAt = ms;
  } else if (
    typeof cred.expiresAt === "number" &&
    Number.isFinite(cred.expiresAt)
  ) {
    session.expiresAt = cred.expiresAt;
  }

  return session;
}

/**
 * 判断 account key / provider 字段是否为 xAI 账号。
 */
function isXaiAccountKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  return (
    k === "xai" ||
    k === "x.ai" ||
    k === "grok" ||
    k.includes("xai") ||
    k.includes("grok")
  );
}

/**
 * 解析 OpenCodex `~/.opencodex/auth.json`。
 * 取 active / 第一个 xai 账号的 credential.access（+refresh,email）。
 *
 * 兼容形状示例：
 * - { accounts: { xai: { credential: { access, refresh, email } } }, activeAccount?: "xai" }
 * - { accounts: [{ provider: "xai", credential: {...} }] }
 * - { xai: { access, ... } } 顶层直挂
 */
export function parseOpenCodexAuthJson(raw: string): AIOAuthSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const root = parsed as Record<string, unknown>;

  const tryAccountEntry = (
    entry: unknown,
    labelFallback: string,
  ): AIOAuthSession | null => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const obj = entry as Record<string, unknown>;
    const credRaw =
      obj.credential &&
      typeof obj.credential === "object" &&
      !Array.isArray(obj.credential)
        ? (obj.credential as Record<string, unknown>)
        : obj;
    return sessionFromCredentialObject(credRaw, labelFallback);
  };

  // 1) accounts map
  const accounts = root.accounts;
  if (accounts && typeof accounts === "object" && !Array.isArray(accounts)) {
    const map = accounts as Record<string, unknown>;
    const active =
      typeof root.activeAccount === "string"
        ? root.activeAccount.trim()
        : typeof root.active === "string"
          ? root.active.trim()
          : "";

    if (active && isXaiAccountKey(active) && map[active] != null) {
      const session = tryAccountEntry(map[active], "OpenCodex xAI");
      if (session) return session;
    }

    for (const [key, value] of Object.entries(map)) {
      if (!isXaiAccountKey(key)) continue;
      const session = tryAccountEntry(value, "OpenCodex xAI");
      if (session) return session;
    }
  }

  // 2) accounts array
  if (Array.isArray(accounts)) {
    for (const item of accounts) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const provider =
        (typeof row.provider === "string" && row.provider) ||
        (typeof row.providerId === "string" && row.providerId) ||
        (typeof row.id === "string" && row.id) ||
        "";
      if (!isXaiAccountKey(provider)) continue;
      const session = tryAccountEntry(row, "OpenCodex xAI");
      if (session) return session;
    }
  }

  // 3) 顶层 xai / grok 键
  for (const key of Object.keys(root)) {
    if (!isXaiAccountKey(key)) continue;
    const session = tryAccountEntry(root[key], "OpenCodex xAI");
    if (session) return session;
  }

  return null;
}

/**
 * 轻解析 Codex CLI auth.json：是否含 OPENAI_API_KEY / chatgpt tokens。
 * **不**返回 secret；仅用于 statusNote。
 */
export function inspectCodexAuthJson(raw: string): {
  hasOpenAiApiKey: boolean;
  hasChatGptTokens: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { hasOpenAiApiKey: false, hasChatGptTokens: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { hasOpenAiApiKey: false, hasChatGptTokens: false };
  }
  const root = parsed as Record<string, unknown>;

  const keyCandidates = [
    root.OPENAI_API_KEY,
    root.openai_api_key,
    root.api_key,
    root.apiKey,
  ];
  const hasOpenAiApiKey = keyCandidates.some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );

  const tokens = root.tokens;
  let hasChatGptTokens = false;
  if (tokens && typeof tokens === "object" && !Array.isArray(tokens)) {
    const t = tokens as Record<string, unknown>;
    hasChatGptTokens = [
      t.access_token,
      t.accessToken,
      t.id_token,
      t.refresh_token,
    ].some((v) => typeof v === "string" && v.trim().length > 0);
  }
  // 顶层 access_token（部分 codex 形状）
  if (
    !hasChatGptTokens &&
    typeof root.access_token === "string" &&
    root.access_token.trim()
  ) {
    hasChatGptTokens = true;
  }

  return { hasOpenAiApiKey, hasChatGptTokens };
}

/** 可行动凭证：允许导入且有鉴权材料（能驱动 OAuth/对话） */
export function isActionableLocalAuthHint(hint: LocalAuthHint): boolean {
  return Boolean(hint.importAllowed && hint.hasAuthMaterial);
}

/** 过滤出可行动本机账号提示（设置列表只展示这些） */
export function filterActionableLocalAuthHints(
  hints: LocalAuthHint[],
): LocalAuthHint[] {
  return hints.filter(isActionableLocalAuthHint);
}

/**
 * 探测本机 CLI 鉴权目录。
 * 仅返回可行动 hint（importAllowed && hasAuthMaterial）：
 * Grok 可解析 auth.json、OpenCodex 可解析 xAI 会话。
 * 无 homedir 时返回 []。
 */
export async function detectLocalAuthHints(): Promise<LocalAuthHint[]> {
  const home = getHomedir();
  if (!home) return [];

  const hints: LocalAuthHint[] = [];

  // --- Grok CLI：仅 auth.json 可解析时入列（与 import 一致）---
  const grokAuth = joinHome(home, ".grok", "auth.json");
  if (await exists(grokAuth)) {
    const raw = await readFile(grokAuth);
    if (raw?.trim()) {
      const session = parseGrokAuthJson(raw);
      if (session) {
        hints.push({
          providerId: "xai",
          source: "grok_cli",
          displayPath: "~/.grok",
          hasAuthMaterial: true,
          importAllowed: true,
          accountHint: session.accountLabel,
          statusNote: "可导入",
        });
      }
    }
  }

  // --- OpenCodex：仅可解析 xAI 账号时入列 ---
  const opencodexAuth = joinHome(home, ".opencodex", "auth.json");
  if (await exists(opencodexAuth)) {
    const raw = await readFile(opencodexAuth);
    if (raw?.trim()) {
      const session = parseOpenCodexAuthJson(raw);
      if (session) {
        hints.push({
          providerId: "xai",
          source: "opencodex",
          displayPath: "~/.opencodex",
          hasAuthMaterial: true,
          importAllowed: true,
          accountHint: session.accountLabel,
          statusNote: "可导入 xAI 账号",
        });
      }
    }
  }

  // Codex / Claude / Pi / OpenCode：仅 presence 或订阅凭证，不入可行动列表
  // （不桥接 Claude/ChatGPT 订阅 token）

  // 双保险：只返回可行动 hint
  return filterActionableLocalAuthHints(hints);
}

export type ImportLocalOAuthTarget = LocalAuthSource | AIProviderId | string;

/**
 * 从本机 CLI 导入 OAuth 会话。
 * 允许：grok_cli / xai → ~/.grok；opencodex → ~/.opencodex xai。
 * Claude / Codex chatgpt / 其它一律拒绝。
 */
export async function importLocalOAuthSession(
  sourceOrProvider: ImportLocalOAuthTarget,
): Promise<
  | { ok: true; session: AIOAuthSession; source: LocalAuthSource }
  | { ok: false; error: string }
> {
  const target = String(sourceOrProvider || "").trim().toLowerCase();

  const home = getHomedir();
  if (!home) {
    return { ok: false, error: "无法访问本机目录" };
  }

  // Grok CLI
  if (target === "xai" || target === "grok_cli" || target === "grok") {
    const authPath = joinHome(home, ".grok", "auth.json");
    if (!(await exists(authPath))) {
      return {
        ok: false,
        error: "未找到 Grok CLI 登录文件（~/.grok/auth.json）",
      };
    }
    const raw = await readFile(authPath);
    if (raw == null || !raw.trim()) {
      return { ok: false, error: "无法读取 Grok CLI 登录文件" };
    }
    const session = parseGrokAuthJson(raw);
    if (!session) {
      return { ok: false, error: "Grok CLI 登录文件格式无效或无可导入条目" };
    }
    session.source = "grok_cli";
    // 导入时同步缓存 CLI 客户端版本（cli-chat-proxy 身份头）
    try {
      const versionPath = joinHome(home, ".grok", "version.json");
      if (await exists(versionPath)) {
        const versionRaw = await readFile(versionPath);
        if (versionRaw) {
          const ver = parseGrokCliVersionJson(versionRaw);
          if (ver) cacheGrokCliClientVersion(ver);
        }
      }
    } catch {
      // ignore version cache failures
    }
    return { ok: true, session, source: "grok_cli" };
  }

  // OpenCodex xAI
  if (target === "opencodex") {
    const authPath = joinHome(home, ".opencodex", "auth.json");
    if (!(await exists(authPath))) {
      return {
        ok: false,
        error: "未找到 OpenCodex 登录文件（~/.opencodex/auth.json）",
      };
    }
    const raw = await readFile(authPath);
    if (raw == null || !raw.trim()) {
      return { ok: false, error: "无法读取 OpenCodex 登录文件" };
    }
    const session = parseOpenCodexAuthJson(raw);
    if (!session) {
      return {
        ok: false,
        error: "OpenCodex 中未找到可导入的 xAI 账号凭证",
      };
    }
    session.source = "opencodex";
    return { ok: true, session, source: "opencodex" };
  }

  if (
    target === "claude_cli" ||
    target === "claude" ||
    target === "custom-claude"
  ) {
    return {
      ok: false,
      error: "Claude Code 订阅凭证不导入，请使用 API 密钥页",
    };
  }

  if (target === "codex_cli" || target === "codex") {
    return {
      ok: false,
      error: "Codex 订阅凭证不接入对话，请使用 API 密钥页",
    };
  }

  return {
    ok: false,
    error: "该来源不支持从本机 CLI 导入账号",
  };
}

const DEFAULT_GROK_CLI_BASE_URL = XAI_CLI_SESSION_BASE_URL;

/**
 * 从 origin（如 https://cli-chat-proxy.grok.com/v1/models）推导 base URL。
 * 去掉末尾 /models（可带尾斜杠）。
 */
function baseURLFromOrigin(origin: string): string | null {
  const trimmed = origin.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const stripped = trimmed.replace(/\/models$/i, "");
  return stripped || null;
}

/**
 * 解析 Grok CLI `~/.grok/models_cache.json`。
 * 跳过 hidden；id/label/contextWindow 来自 info；baseURL / protocol 从条目或 origin 推导。
 */
export function parseGrokModelsCache(raw: string): {
  models: AIModelOption[];
  baseURL: string | null;
  protocol: CustomAIProtocol | null;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const modelsRaw = root.models;
  if (!modelsRaw || typeof modelsRaw !== "object" || Array.isArray(modelsRaw)) {
    return null;
  }

  const models: AIModelOption[] = [];
  let firstBaseURL: string | null = null;
  let sawResponses = false;
  let sawChat = false;

  for (const [mapKey, value] of Object.entries(
    modelsRaw as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const infoRaw = entry.info;
    const info =
      infoRaw && typeof infoRaw === "object" && !Array.isArray(infoRaw)
        ? (infoRaw as Record<string, unknown>)
        : entry;

    if (info.hidden === true) continue;

    const idCandidate =
      (typeof info.id === "string" && info.id.trim()) ||
      (typeof info.model === "string" && info.model.trim()) ||
      mapKey.trim();
    if (!idCandidate) continue;

    const label =
      typeof info.name === "string" && info.name.trim()
        ? info.name.trim()
        : idCandidate;

    const rawContext =
      typeof info.context_window === "number"
        ? info.context_window
        : typeof info.contextWindow === "number"
          ? info.contextWindow
          : undefined;
    const contextWindow =
      typeof rawContext === "number" && rawContext > 0
        ? Math.floor(rawContext)
        : undefined;

    models.push({
      id: idCandidate,
      label,
      ...(contextWindow != null ? { contextWindow } : {}),
    });

    if (!firstBaseURL && typeof info.base_url === "string") {
      const bu = info.base_url.trim().replace(/\/+$/, "");
      if (bu) firstBaseURL = bu;
    }

    const backend =
      typeof info.api_backend === "string"
        ? info.api_backend.trim().toLowerCase()
        : "";
    if (backend === "responses") {
      sawResponses = true;
    } else if (
      backend === "chat" ||
      backend === "chat_completions" ||
      backend === "openai" ||
      backend === "completions"
    ) {
      sawChat = true;
    }
  }

  if (models.length === 0) {
    return null;
  }

  let baseURL = firstBaseURL;
  if (!baseURL && typeof root.origin === "string") {
    baseURL = baseURLFromOrigin(root.origin);
  }
  if (!baseURL) {
    baseURL = DEFAULT_GROK_CLI_BASE_URL;
  }

  let protocol: CustomAIProtocol;
  if (sawResponses) {
    protocol = "openai-responses";
  } else if (sawChat) {
    protocol = "openai";
  } else {
    // 会话路径默认 Responses
    protocol = "openai-responses";
  }

  return { models, baseURL, protocol };
}

/**
 * 读取本机 Grok CLI 模型缓存（~/.grok/models_cache.json）。
 * 缺失 / 无效 / 无模型 → null。
 */
export async function loadGrokCliModelsFromCache(): Promise<{
  models: AIModelOption[];
  baseURL: string;
  protocol: CustomAIProtocol;
} | null> {
  const home = getHomedir();
  if (!home) return null;

  const cachePath = joinHome(home, ".grok", "models_cache.json");
  if (!(await exists(cachePath))) return null;

  const raw = await readFile(cachePath);
  if (raw == null || !raw.trim()) return null;

  const parsed = parseGrokModelsCache(raw);
  if (!parsed || parsed.models.length === 0) return null;

  return {
    models: parsed.models,
    baseURL: parsed.baseURL ?? DEFAULT_GROK_CLI_BASE_URL,
    protocol: parsed.protocol ?? "openai-responses",
  };
}
