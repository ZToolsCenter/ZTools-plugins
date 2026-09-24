/**
 * 模型是否支持视觉（用户附图）。
 * 优先级：用户手动 supportsVision → live/拉模显式 boolean → models.dev catalog → 极简启发式 → 未知 false。
 */

import {
  getModelsDevVisionCatalogSync,
  lookupModelsDevVision,
  type ModelsDevVisionCatalog,
} from "./modelsDevCatalog";
import { getApiModelId } from "./modelRef";

export type VisionCustomOption = {
  id: string;
  supportsVision?: boolean;
};

export type VisionResolutionSource =
  | "user"
  | "live"
  | "catalog"
  | "heuristic"
  | "unknown";

export type VisionResolution = {
  /** 是否按支持视觉处理（unknown 时为 false，fail-closed） */
  supported: boolean;
  source: VisionResolutionSource;
};

/**
 * 极简启发式 id 片段（小写匹配）；仅作 catalog 未命中时的兜底。
 * 导出供测试与文档。
 */
export const VISION_MODEL_ID_HINTS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-4-turbo",
  "gpt-4-vision",
  "gpt-5",
  "o1",
  "o3",
  "o4",
  "claude-3",
  "claude-4",
  "claude-sonnet",
  "claude-opus",
  "claude-haiku",
  "gemini",
  "vision",
  "vl-",
  "-vl",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "glm-4v",
  "glm-4.1v",
  "llava",
  "pixtral",
  "minicpm-v",
  "internvl",
  "llama-4",
  "llama4",
  // Grok 4.x 系列（catalog 优先；此处兜底防止 snapshot 过旧）
  "grok-4",
  "grok-2-vision",
] as const;

/** 明确不支持视觉（优先于 VISION_MODEL_ID_HINTS 中的宽泛匹配） */
const NON_VISION_HINTS = [
  "deepseek-chat",
  "deepseek-coder",
  "deepseek-reasoner",
  "deepseek-v3",
  "deepseek-v4",
  "deepseek-r1",
  "gpt-3.5",
  "text-embedding",
  "tts-",
  "whisper",
  "moderation",
  "dall-e",
  "imagen",
];

function heuristicVision(modelId: string): boolean | undefined {
  const lower = modelId.toLowerCase();
  for (const hint of NON_VISION_HINTS) {
    if (lower.includes(hint)) return false;
  }
  for (const hint of VISION_MODEL_ID_HINTS) {
    if (lower.includes(hint)) return true;
  }
  return undefined;
}

function findOption(
  modelId: string,
  customOptions?: VisionCustomOption[] | null,
  providerId?: string | null,
): VisionCustomOption | undefined {
  if (!Array.isArray(customOptions)) return undefined;
  const bare = getApiModelId(modelId, providerId) ?? modelId;
  return customOptions.find((o) => {
    if (o.id === modelId) return true;
    const optBare = getApiModelId(o.id, providerId) ?? o.id;
    return optBare === bare;
  });
}

/**
 * 统一解析视觉能力。
 * @param providerId 供应商 id（用于 catalog 路由）
 * @param modelId 模型 id（canonical 或裸 id）
 * @param option 单条模型选项；也可传 customOptions 数组由内部查找
 * @param catalog models.dev 表；省略则读 sync cache/snapshot
 */
export function resolveModelVision(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  option?: VisionCustomOption | VisionCustomOption[] | null,
  catalog?: ModelsDevVisionCatalog | null,
): VisionResolution {
  const raw = typeof modelId === "string" ? modelId.trim() : "";
  if (!raw) {
    return { supported: false, source: "unknown" };
  }
  // 查找 option / 启发式 / catalog 统一用裸 id，兼容 `provider/model`
  const id = getApiModelId(raw, providerId) ?? raw;

  let opt: VisionCustomOption | undefined;
  if (Array.isArray(option)) {
    opt = findOption(raw, option, providerId);
  } else if (option && typeof option === "object") {
    // 单条 option：id 缺省或与 modelId（canonical/裸）一致时采用
    if (
      !option.id ||
      option.id === raw ||
      option.id === id ||
      (getApiModelId(option.id, providerId) ?? option.id) === id
    ) {
      opt = option;
    }
  }

  // 1) 用户手动 / live 拉模写在 option.supportsVision 的显式 boolean
  //    （设置页手动开关与 API 显式字段共用此槽；用户覆盖在 merge 层保留）
  if (opt && typeof opt.supportsVision === "boolean") {
    return {
      supported: opt.supportsVision,
      // 无法区分手写与 live 时标 user（手动优先语义）
      source: "user",
    };
  }

  // 2) catalog（models.dev）
  const cat = catalog ?? getModelsDevVisionCatalogSync();
  const fromCatalog = lookupModelsDevVision(providerId, id, cat);
  if (typeof fromCatalog === "boolean") {
    return { supported: fromCatalog, source: "catalog" };
  }

  // 3) 极简启发式
  const fromHint = heuristicVision(id);
  if (typeof fromHint === "boolean") {
    return { supported: fromHint, source: "heuristic" };
  }

  // 4) 未知 → fail-closed
  return { supported: false, source: "unknown" };
}

/**
 * 兼容旧调用：仅 modelId + customOptions。
 * 可选传入 providerId / catalog 以启用 hybrid。
 */
export function modelSupportsVision(
  modelId: string | null | undefined,
  customOptions?: VisionCustomOption[] | null,
  providerId?: string | null,
  catalog?: ModelsDevVisionCatalog | null,
): boolean {
  return resolveModelVision(providerId, modelId, customOptions, catalog)
    .supported;
}
