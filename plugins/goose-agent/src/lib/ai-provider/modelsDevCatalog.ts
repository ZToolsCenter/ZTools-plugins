/**
 * models.dev hybrid catalog（仅 vision 布尔）。
 * 内存 + localStorage 24h TTL；失败回退仓内 last-known-good snapshot。
 */

import { MODELS_DEV_VISION_SNAPSHOT } from "./data/modelsDevVisionSnapshot";

export type ModelsDevVisionCatalog = {
  version: number;
  source: string;
  /** providerId → modelId → supports image input */
  providers: Record<string, Record<string, boolean>>;
  /** epoch ms when fetched / loaded */
  fetchedAt?: number;
};

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_VISION_TTL_MS = 24 * 60 * 60 * 1000;
export const MODELS_DEV_VISION_STORAGE_KEY = "ga:models-dev-vision-catalog";

let memoryCatalog: ModelsDevVisionCatalog | null = null;
let inflight: Promise<ModelsDevVisionCatalog> | null = null;

/** 将本仓 providerId 映射到 models.dev provider 键 */
export function mapProviderIdToModelsDev(
  providerId: string | null | undefined,
): string[] {
  const id = (providerId ?? "").trim().toLowerCase();
  if (!id) return [];
  if (id === "xai") return ["xai"];
  if (id === "openai") return ["openai"];
  if (id === "anthropic") return ["anthropic"];
  if (id === "deepseek") return ["deepseek"];
  if (id === "custom-claude") return ["anthropic"];
  if (id === "custom-openai" || id === "custom-openai-responses") {
    return ["openai", "openrouter", "azure", "groq", "together", "fireworks-ai"];
  }
  // 透传未知 id（如 google / zhipuai）
  return [id];
}

function isCatalogShape(value: unknown): value is ModelsDevVisionCatalog {
  if (!value || typeof value !== "object") return false;
  const v = value as ModelsDevVisionCatalog;
  return (
    typeof v.version === "number" &&
    typeof v.providers === "object" &&
    v.providers !== null
  );
}

function readStorage(): ModelsDevVisionCatalog | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(MODELS_DEV_VISION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCatalogShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(catalog: ModelsDevVisionCatalog): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      MODELS_DEV_VISION_STORAGE_KEY,
      JSON.stringify(catalog),
    );
  } catch {
    // quota / private mode
  }
}

function isFresh(catalog: ModelsDevVisionCatalog, now = Date.now()): boolean {
  const at = catalog.fetchedAt;
  if (typeof at !== "number" || !Number.isFinite(at)) return false;
  return now - at < MODELS_DEV_VISION_TTL_MS;
}

/**
 * 从 models.dev api.json 抽出 vision 布尔表。
 * 公开供单测。
 */
export function parseModelsDevApiJson(payload: unknown): ModelsDevVisionCatalog {
  if (!payload || typeof payload !== "object") {
    throw new Error("models.dev 响应无效");
  }
  const root = payload as Record<string, unknown>;
  const providers: Record<string, Record<string, boolean>> = {};

  for (const [providerId, providerVal] of Object.entries(root)) {
    if (!providerVal || typeof providerVal !== "object") continue;
    const modelsRaw = (providerVal as { models?: unknown }).models;
    if (!modelsRaw || typeof modelsRaw !== "object") continue;
    const entry: Record<string, boolean> = {};
    for (const [modelId, modelVal] of Object.entries(
      modelsRaw as Record<string, unknown>,
    )) {
      if (!modelVal || typeof modelVal !== "object") continue;
      const modalities = (modelVal as { modalities?: unknown }).modalities;
      if (!modalities || typeof modalities !== "object") continue;
      const input = (modalities as { input?: unknown }).input;
      if (!Array.isArray(input)) continue;
      entry[modelId] = input.some(
        (m) => typeof m === "string" && m.toLowerCase() === "image",
      );
    }
    if (Object.keys(entry).length > 0) {
      providers[providerId] = entry;
    }
  }

  if (Object.keys(providers).length === 0) {
    throw new Error("models.dev 未解析到模型");
  }

  return {
    version: 1,
    source: "models.dev",
    providers,
    fetchedAt: Date.now(),
  };
}

/** 同步可读：内存 → localStorage（未过期）→ snapshot */
export function getModelsDevVisionCatalogSync(): ModelsDevVisionCatalog {
  if (memoryCatalog) return memoryCatalog;

  const stored = readStorage();
  if (stored && isFresh(stored)) {
    memoryCatalog = stored;
    return stored;
  }

  // 过期 stored 仍可作基线，但优先 snapshot 的键覆盖缺失
  const snap: ModelsDevVisionCatalog = {
    ...MODELS_DEV_VISION_SNAPSHOT,
    fetchedAt: MODELS_DEV_VISION_SNAPSHOT.fetchedAt ?? 0,
  };
  if (stored?.providers) {
    memoryCatalog = {
      version: Math.max(stored.version, snap.version),
      source: stored.source || snap.source,
      providers: { ...snap.providers, ...stored.providers },
      fetchedAt: stored.fetchedAt,
    };
    return memoryCatalog;
  }

  memoryCatalog = snap;
  return snap;
}

/**
 * 在 catalog 中查找 vision。
 * @returns true/false 命中；undefined 未收录
 */
export function lookupModelsDevVision(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  catalog: ModelsDevVisionCatalog = getModelsDevVisionCatalogSync(),
): boolean | undefined {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) return undefined;

  const lower = id.toLowerCase();
  const providerKeys = mapProviderIdToModelsDev(providerId);

  const tryInProvider = (pKey: string): boolean | undefined => {
    const models = catalog.providers[pKey];
    if (!models) return undefined;
    if (typeof models[id] === "boolean") return models[id];
    // case-insensitive
    for (const [mid, vis] of Object.entries(models)) {
      if (mid.toLowerCase() === lower) return vis;
    }
    return undefined;
  };

  for (const pKey of providerKeys) {
    const hit = tryInProvider(pKey);
    if (hit !== undefined) return hit;
  }

  // 自定义源：全表按 model id 扫一遍（同 id 多源时 true 优先）
  if (
    !providerId ||
    providerId.startsWith("custom-") ||
    providerKeys.length === 0
  ) {
    let sawFalse = false;
    for (const models of Object.values(catalog.providers)) {
      for (const [mid, vis] of Object.entries(models)) {
        if (mid === id || mid.toLowerCase() === lower) {
          if (vis) return true;
          sawFalse = true;
        }
      }
    }
    if (sawFalse) return false;
  }

  return undefined;
}

/** 测试/重置用 */
export function __resetModelsDevVisionCatalogForTests(): void {
  memoryCatalog = null;
  inflight = null;
}

export function __setModelsDevVisionCatalogForTests(
  catalog: ModelsDevVisionCatalog | null,
): void {
  memoryCatalog = catalog;
}

/**
 * 确保 catalog 可用；过期则后台拉 models.dev。
 * 失败保留 snapshot / 旧缓存。
 */
export async function ensureModelsDevVisionCatalog(options?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ModelsDevVisionCatalog> {
  const force = options?.force === true;
  const current = getModelsDevVisionCatalogSync();
  if (!force && isFresh(current)) {
    return current;
  }

  if (inflight && !force) return inflight;

  const doFetch = options?.fetchImpl ?? fetch;
  inflight = (async () => {
    try {
      const res = await doFetch(MODELS_DEV_API_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`models.dev HTTP ${res.status}`);
      }
      const payload: unknown = await res.json();
      const next = parseModelsDevApiJson(payload);
      memoryCatalog = next;
      writeStorage(next);
      return next;
    } catch {
      // 保留现有
      return getModelsDevVisionCatalogSync();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
