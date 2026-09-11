/**
 * Composer 多供应商模型引用：canonical id = `{providerId}/{modelId}`。
 * 请求 API 时剥离为裸 modelId；遗留裸 id 用当前 provider 补前缀。
 *
 * 网关模型 id 常自带 `xai/…`、`LiteLLM/…` 等段，不能把任意与 AIProviderId
 * 撞名的首段都当成我们的路由前缀剥掉。
 */
import {
  getAIProviderPreset,
  isAIProviderId,
  type AIProviderId,
} from "./presets";
import type { AIModelOption } from "./types";

export type ModelRef = {
  providerId: AIProviderId;
  modelId: string;
  /** canonical：providerId/modelId */
  ref: string;
};

const PROVIDER_SEP = "/";

/**
 * 仅当首段是我们的存储/路由 providerId 时才拆。
 * `onlyProvider` 有值时必须等于该 provider（getApiModelId 用，避免 custom 下
 * 的 `xai/grok-…` 被误剥成 xai 路由）。
 */
function tryParseOurProviderPrefix(
  value: string,
  onlyProvider?: AIProviderId | null,
): { providerId: AIProviderId; rest: string } | null {
  const idx = value.indexOf(PROVIDER_SEP);
  if (idx <= 0) return null;
  const head = value.slice(0, idx);
  const rest = value.slice(idx + 1);
  if (!rest || !isAIProviderId(head)) return null;
  if (onlyProvider != null && head !== onlyProvider) return null;
  return { providerId: head, rest };
}

export function formatModelRef(
  providerId: AIProviderId | string,
  modelId: string,
): string {
  const pid = String(providerId).trim();
  const mid = modelId.trim();
  if (!pid || !mid) return mid || pid;
  // 已是该 provider 前缀则不重复
  if (mid.startsWith(`${pid}/`)) return mid;
  return `${pid}/${mid}`;
}

/**
 * 列表/Chip 用供应商展示前缀：内置短 id，自定义用预设名称（非内部 id）。
 * 例：custom-openai-responses →「OpenAI Responses」
 */
export function getProviderDisplayPrefix(
  providerId: AIProviderId | string,
): string {
  if (!isAIProviderId(providerId)) return String(providerId);
  if (providerId === "deepseek" || providerId === "xai") {
    return providerId;
  }
  return getAIProviderPreset(providerId).label;
}

/**
 * 解析 canonical 或裸 model id。
 * - 有 fallback：只剥该存储供应商前缀；网关 id 整段保留
 * - 无 fallback：首段为合法路由 id 时视为 canonical
 */
export function parseModelRef(
  value: string | null | undefined,
  fallbackProviderId?: AIProviderId | string | null,
): {
  providerId: AIProviderId | null;
  modelId: string | null;
  ref: string | null;
} {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return { providerId: null, modelId: null, ref: null };
  }

  const fb =
    typeof fallbackProviderId === "string" && isAIProviderId(fallbackProviderId)
      ? fallbackProviderId
      : null;

  if (fb) {
    const our = tryParseOurProviderPrefix(raw, fb);
    if (our) {
      return {
        providerId: fb,
        modelId: our.rest,
        ref: formatModelRef(fb, our.rest),
      };
    }
    return {
      providerId: fb,
      modelId: raw,
      ref: formatModelRef(fb, raw),
    };
  }

  const prefixed = tryParseOurProviderPrefix(raw, null);
  if (prefixed) {
    return {
      providerId: prefixed.providerId,
      modelId: prefixed.rest,
      ref: formatModelRef(prefixed.providerId, prefixed.rest),
    };
  }

  return { providerId: null, modelId: raw, ref: raw };
}

/** 遗留裸 id → 补当前 provider 前缀；已是 canonical 则规范化。 */
export function normalizeModelRef(
  value: string | null | undefined,
  currentProviderId: AIProviderId | string | null | undefined,
): string | null {
  const parsed = parseModelRef(value, currentProviderId ?? null);
  return parsed.ref;
}

/** API 请求用裸 model id（去掉 provider 前缀）。 */
export function getApiModelId(
  value: string | null | undefined,
  fallbackProviderId?: AIProviderId | string | null,
): string | null {
  const parsed = parseModelRef(value, fallbackProviderId);
  return parsed.modelId;
}

/**
 * 比较两个 model id 是否指向同一模型（canonical `provider/model` 与裸 id 互通）。
 * 例：`deepseek/deepseek-chat` ↔ `deepseek-chat`。
 */
export function modelIdsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
  fallbackProviderId?: AIProviderId | string | null,
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const bareA = getApiModelId(a, fallbackProviderId) ?? a;
  const bareB = getApiModelId(b, fallbackProviderId) ?? b;
  return bareA === bareB && bareA.length > 0;
}

/**
 * 从 settings 解析当前有效模型 id（优先 workspace，再 selected，再列表首项）。
 * 匹配时接受 canonical 与裸 id。
 */
export function resolveEffectiveModelId(ai: {
  workspaceSelectedModelId?: string | null;
  selectedModelId?: string | null;
  customModelOptions?: { id: string }[];
  customProviderId?: string | null;
}): string | null {
  const options = ai.customModelOptions ?? [];
  const providerId = ai.customProviderId ?? null;
  const matches = (id: string | null | undefined) => {
    if (!id) return false;
    if (options.length === 0) return true;
    return options.some((o) => modelIdsMatch(o.id, id, providerId));
  };
  if (matches(ai.workspaceSelectedModelId)) {
    return ai.workspaceSelectedModelId ?? null;
  }
  if (matches(ai.selectedModelId)) {
    return ai.selectedModelId ?? null;
  }
  return ai.selectedModelId ?? options[0]?.id ?? null;
}

export type AggregatedModelOption = AIModelOption & {
  providerId: AIProviderId;
  /** canonical provider/model */
  ref: string;
  /** 下拉主标签：provider/model 或 label */
  primaryLabel: string;
};

export type ModelsByProvider = Partial<
  Record<AIProviderId, AIModelOption[]>
>;

/** 内置供应商列表前缀用短 id；自定义不拼任何前缀（模型 id 常已含网关名） */
function shouldPrefixPrimaryLabel(providerId: AIProviderId): boolean {
  return providerId === "deepseek" || providerId === "xai";
}

/**
 * 将各供应商模型展平为单列。
 * - deepseek / xai：`{id}/{模型名}`
 * - 自定义：只显示模型 label/id，不加「OpenAI Responses/」等前缀
 * 仅包含传入列表中的项（调用方先按凭证过滤）。
 */
export function aggregateModelsByProvider(
  modelsByProvider: ModelsByProvider | null | undefined,
  options?: {
    /** 供应商展示前缀（可选）；仅对内置 deepseek/xai 生效 */
    providerLabels?: Partial<Record<AIProviderId, string>>;
    /** 排序：供应商顺序 */
    providerOrder?: AIProviderId[];
  },
): AggregatedModelOption[] {
  if (!modelsByProvider) return [];

  const order = options?.providerOrder;
  const keys = (
    order
      ? order.filter((id) => modelsByProvider[id]?.length)
      : (Object.keys(modelsByProvider) as AIProviderId[])
  ).filter((id) => isAIProviderId(id));

  // 未在 order 中的供应商追加在后
  if (order) {
    for (const id of Object.keys(modelsByProvider) as AIProviderId[]) {
      if (isAIProviderId(id) && !keys.includes(id) && modelsByProvider[id]?.length) {
        keys.push(id);
      }
    }
  }

  const out: AggregatedModelOption[] = [];
  for (const providerId of keys) {
    const list = modelsByProvider[providerId];
    if (!list?.length) continue;
    const displayPrefix =
      options?.providerLabels?.[providerId] ??
      getProviderDisplayPrefix(providerId);
    for (const model of list) {
      const modelId = model.id.trim();
      if (!modelId) continue;
      // 只剥我们自己的路由前缀；网关 id（xai/…、LiteLLM/…）整段保留
      const bare =
        getApiModelId(modelId, providerId) ?? modelId;
      const ref = formatModelRef(providerId, bare);
      // 展示优先 API/缓存 label；否则用裸 model id（可含网关前缀）
      const modelDisplay =
        model.label?.trim() && model.label.trim() !== displayPrefix
          ? model.label.trim()
          : bare;
      const primaryLabel = shouldPrefixPrimaryLabel(providerId)
        ? `${displayPrefix}/${modelDisplay}`
        : modelDisplay;
      out.push({
        ...model,
        id: bare,
        providerId,
        ref,
        primaryLabel,
        label: model.label?.trim() ? model.label : bare,
      });
    }
  }
  return out;
}

/** 规范化 modelsByProvider 存储结构 */
export function normalizeModelsByProvider(
  value: unknown,
): ModelsByProvider {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: ModelsByProvider = {};
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (!isAIProviderId(key)) continue;
    if (!Array.isArray(list)) continue;
    const models: AIModelOption[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!id) continue;
      // 存裸 model id
      const bare = getApiModelId(id, key) ?? id;
      const label =
        typeof raw.label === "string" && raw.label.trim()
          ? raw.label.trim()
          : bare;
      const opt: AIModelOption = { id: bare, label };
      if (typeof raw.description === "string" && raw.description.trim()) {
        opt.description = raw.description.trim();
      }
      if (typeof raw.contextWindow === "number" && raw.contextWindow > 0) {
        opt.contextWindow = Math.floor(raw.contextWindow);
      }
      if (typeof raw.supportsVision === "boolean") {
        opt.supportsVision = raw.supportsVision;
      }
      models.push(opt);
    }
    if (models.length > 0) {
      out[key] = models;
    }
  }
  return out;
}
