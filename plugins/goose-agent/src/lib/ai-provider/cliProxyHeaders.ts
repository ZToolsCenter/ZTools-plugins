/**
 * Grok CLI chat-proxy 请求头。
 * cli-chat-proxy 要求 x-grok-client-version 等身份头；缺省会 426 并报 version (none)。
 * 版本从 ~/.grok/version.json 解析，缓存 last-good；禁止发送字面量 "none"。
 */
import { exists, getHomedir, readFile } from "@/lib/fs";
import { XAI_CLI_SESSION_BASE_URL } from "./presets";

export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_TOKEN_AUTH = "xai-grok-cli";
export const GROK_CLI_USER_AGENT = "xai-grok-cli";
export const GROK_CLI_CLIENT_MODE = "headless";

/** 解析失败且无缓存时的兜底（真实 semver 形，避免 "none"） */
export const GROK_CLI_VERSION_FALLBACK = "1.0.0";

const VERSION_HEADER = "x-grok-client-version";
const IDENTIFIER_HEADER = "x-grok-client-identifier";
const TOKEN_AUTH_HEADER = "X-XAI-Token-Auth";
const MODE_HEADER = "x-grok-client-mode";

/** 内存 last-good；import/session 路径可显式 cacheGrokCliClientVersion */
let cachedClientVersion: string | null = null;

function joinHome(home: string, ...parts: string[]): string {
  const base = home.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return [base, ...parts].join(sep);
}

/**
 * 解析本机 home：优先 gooseFs bridge，再尝试 process.env（Node/Electron）。
 * 浏览器纯预览无 home 时返回 null，调用方走 fallback 版本。
 */
function resolveHomeDir(): string | null {
  const fromFs = getHomedir();
  if (fromFs) return fromFs;
  try {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    const home = env?.HOME?.trim() || env?.USERPROFILE?.trim();
    return home || null;
  } catch {
    return null;
  }
}

/**
 * 从 version.json 文本解析客户端版本。
 * 优先 `version`，其次 `stable_version`；拒绝 "none"/空。
 */
export function parseGrokCliVersionJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of ["version", "stable_version"] as const) {
    const v = obj[key];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed && !/^none$/i.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return null;
}

/** 规范化版本串：trim，拒绝 none/空。 */
export function normalizeGrokCliClientVersion(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return null;
  return trimmed;
}

export function cacheGrokCliClientVersion(version: string): void {
  const normalized = normalizeGrokCliClientVersion(version);
  if (normalized) {
    cachedClientVersion = normalized;
  }
}

export function getCachedGrokCliClientVersion(): string | null {
  return cachedClientVersion;
}

/** 测试 / 会话重置用 */
export function clearGrokCliClientVersionCache(): void {
  cachedClientVersion = null;
}

/**
 * 同步解析可用版本：优先 cache → 传入 hint → fallback。
 * 异步读盘见 resolveGrokCliClientVersion。
 */
export function resolveGrokCliClientVersionSync(
  hint?: string | null,
): string {
  return (
    normalizeGrokCliClientVersion(cachedClientVersion) ??
    normalizeGrokCliClientVersion(hint) ??
    GROK_CLI_VERSION_FALLBACK
  );
}

/** 读 ~/.grok/version.json 并更新 cache；失败则用 last-good / fallback。 */
export async function resolveGrokCliClientVersion(): Promise<string> {
  // 已有 cache 时仍尝试刷新（版本可能随 grok update 变化），但 IO 失败不丢 cache
  const home = resolveHomeDir();
  if (home) {
    const path = joinHome(home, ".grok", "version.json");
    try {
      if (await exists(path)) {
        const raw = await readFile(path);
        if (raw) {
          const parsed = parseGrokCliVersionJson(raw);
          if (parsed) {
            cacheGrokCliClientVersion(parsed);
            return parsed;
          }
        }
      }
    } catch {
      // ignore IO errors; fall through
    }
  }
  return resolveGrokCliClientVersionSync();
}

/** URL 是否指向 Grok CLI chat-proxy。 */
export function isCliChatProxyUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("cli-chat-proxy.grok.com") ||
    lower.startsWith(XAI_CLI_SESSION_BASE_URL.toLowerCase())
  );
}

export type CliProxyHeaderOptions = {
  /** 已解析版本；缺省用 sync resolve（cache / fallback） */
  clientVersion?: string | null;
  /** 是否附加 User-Agent / mode（默认 true） */
  includeOptional?: boolean;
};

/**
 * 构造 cli-chat-proxy 必需身份头。
 * 永不输出 version=none。
 */
export function buildCliProxyHeaders(
  options: CliProxyHeaderOptions = {},
): Record<string, string> {
  const version = resolveGrokCliClientVersionSync(options.clientVersion);
  const headers: Record<string, string> = {
    [VERSION_HEADER]: version,
    [IDENTIFIER_HEADER]: GROK_CLI_CLIENT_IDENTIFIER,
    [TOKEN_AUTH_HEADER]: GROK_CLI_TOKEN_AUTH,
  };
  if (options.includeOptional !== false) {
    headers["User-Agent"] = GROK_CLI_USER_AGENT;
    headers[MODE_HEADER] = GROK_CLI_CLIENT_MODE;
  }
  return headers;
}

/**
 * 合并请求头：仅当 url 指向 cli-chat-proxy 时注入身份头。
 * 调用方可先 await resolveGrokCliClientVersion() 预热 cache。
 */
export function withCliProxyHeaders(
  url: string,
  baseHeaders: Record<string, string>,
  options: CliProxyHeaderOptions = {},
): Record<string, string> {
  if (!isCliChatProxyUrl(url)) {
    return { ...baseHeaders };
  }
  return {
    ...baseHeaders,
    ...buildCliProxyHeaders(options),
  };
}

/** HTTP 状态或错误文案是否像 CLI 版本 / 426 升级要求。 */
export function isGrokCliVersionError(
  statusOrMessage: number | string | null | undefined,
  bodyText?: string | null,
): boolean {
  if (statusOrMessage === 426) return true;
  const text = [
    typeof statusOrMessage === "string" ? statusOrMessage : "",
    bodyText ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return false;
  return (
    text.includes("426") ||
    text.includes("upgrade required") ||
    text.includes("grok cli version") ||
    text.includes("client version") ||
    (text.includes("version") && text.includes("none")) ||
    text.includes("x-grok-client-version")
  );
}

/**
 * 426 / CLI 版本类错误 → 简体中文可操作提示。
 * 引导更新 Grok CLI 或重新导入本机账号，不写死单一过时版本号。
 */
export function formatGrokCliVersionErrorMessage(
  detail?: string | null,
): string {
  const extra =
    typeof detail === "string" && detail.trim() && !isGrokCliVersionError(detail)
      ? `（${detail.trim()}）`
      : "";
  return (
    "Grok CLI 代理要求有效的客户端版本信息。" +
    "请更新本机 Grok CLI 后，在「设置 → AI → 本机账号」重新导入。" +
    extra
  );
}

/**
 * 将 fetch 失败映射为用户可见错误；426/版本类走专用 CTA。
 * 非版本类返回 null，由调用方保留原逻辑。
 */
export function mapFetchErrorIfGrokCliVersion(
  status: number,
  errorMessage: string | null | undefined,
): string | null {
  if (isGrokCliVersionError(status, errorMessage)) {
    return formatGrokCliVersionErrorMessage(
      status === 426 ? null : errorMessage,
    );
  }
  if (errorMessage && isGrokCliVersionError(errorMessage)) {
    return formatGrokCliVersionErrorMessage(errorMessage);
  }
  return null;
}
