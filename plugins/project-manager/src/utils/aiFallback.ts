import {
  MAX_AI_FALLBACK_SLOTS,
  type AiAttempt,
  type AiFallbackMode,
  type AiServiceConfig,
  type Settings,
} from '../types';
import { requestAiText, type AiChatMessage, type RequestAiTextOptions } from './ai.ts';

/***********************AI 多渠道回退*********************/

function isConfiguredService(service?: Partial<AiServiceConfig> | null): boolean {
  return Boolean(service?.baseUrl?.trim() && service?.apiKey?.trim());
}

/** 从 baseUrl 里取一个短标签（域名），用于告诉用户实际走的是哪个渠道 */
function describeChannel(baseUrl: string, index: number): string {
  const trimmed = baseUrl.trim();
  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed || `#${index + 1}`;
  }
}

/**
 * 把两种回退模式展开成有序的尝试列表。
 *
 * - 单渠道多模型：同一套 baseUrl/apiKey，依次换模型
 * - 多渠道多模型：依次换整套 baseUrl/apiKey/model
 *
 * 都截断到 MAX_AI_FALLBACK_SLOTS。配置不全（缺 baseUrl / apiKey / model）的槽位
 * 直接跳过，所以返回空数组就意味着「压根没配可用的 AI 服务」。
 */
export function buildAiAttempts(settings: Settings): AiAttempt[] {
  const mode: AiFallbackMode = settings.gitAiFallbackMode ?? 'single_channel';

  if (mode === 'multi_channel') {
    return (settings.gitAiChannels ?? [])
      .filter(channel => channel.enabled !== false)
      .filter(channel => isConfiguredService(channel) && channel.model?.trim())
      .slice(0, MAX_AI_FALLBACK_SLOTS)
      .map((channel, index) => ({
        apiType: channel.apiType,
        baseUrl: channel.baseUrl.trim(),
        apiKey: channel.apiKey.trim(),
        model: channel.model.trim(),
        label: `${describeChannel(channel.baseUrl, index)} · ${channel.model.trim()}`,
      }));
  }

  const single = settings.gitAiSingleChannel;
  if (!single || !isConfiguredService(single.service)) return [];

  const host = describeChannel(single.service.baseUrl, 0);
  return (single.models ?? [])
    .map(model => model.trim())
    .filter(Boolean)
    .slice(0, MAX_AI_FALLBACK_SLOTS)
    .map(model => ({
      apiType: single.service.apiType,
      baseUrl: single.service.baseUrl.trim(),
      apiKey: single.service.apiKey.trim(),
      model,
      label: `${host} · ${model}`,
    }));
}

/** 从错误里尽量抠出 HTTP 状态码——utils/ai.ts 把它拼进了错误文本 */
function extractStatusCode(message: string): number | null {
  const match = message.match(/\b(\d{3})\b/);
  if (!match) return null;
  const code = Number(match[1]);
  return code >= 100 && code <= 599 ? code : null;
}

/**
 * 这个错误换个槽位重试有意义吗。
 *
 * 可回退：网络错误、超时、429 限流、5xx 服务端错误、返回空内容。
 * 不可回退：明确的客户端配置错误（400 / 401 / 403），换模型也是同一把 key，
 * 白等一轮。注意 404 视为可回退——它通常是「这个模型不存在」，
 * 换下一个模型正是要做的事。
 */
export function isRetriableAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatusCode(message);

  if (status !== null) {
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status === 404) return true;
    // 400 / 401 / 403 等：配置或权限问题
    if (status >= 400) return false;
  }

  // 没有状态码：网络层失败、超时、解析失败、返回空内容——都值得换个槽位再试
  return true;
}

/**
 * 同一把 apiKey 的后续模型是否还有必要试。
 *
 * 单渠道模式下 401/403 意味着这把 key 不可用，剩下的模型必然同样失败，
 * 应当直接中止而不是把用户的等待时间乘以 3。
 */
function isChannelFatal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatusCode(message);
  return status === 401 || status === 403;
}

export interface AiFallbackResult {
  text: string;
  /** 实际生效的那次尝试 */
  usedAttempt: AiAttempt;
  /** 是否发生了回退（首选失败） */
  didFallback: boolean;
}

export interface RequestAiTextWithFallbackOptions {
  messages: AiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 按顺序尝试各个槽位，第一个成功即返回。
 *
 * 全部失败时抛出一条聚合了每次「渠道 · 模型 → 错误」的错误，
 * 否则用户只能看到最后一次失败，无法判断是哪一环配错了。
 */
export async function requestAiTextWithFallback(
  attempts: AiAttempt[],
  options: RequestAiTextWithFallbackOptions,
): Promise<AiFallbackResult> {
  if (attempts.length === 0) {
    throw new Error('No configured AI service is available.');
  }

  const failures: string[] = [];

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const request: RequestAiTextOptions = {
      apiType: attempt.apiType,
      baseUrl: attempt.baseUrl,
      apiKey: attempt.apiKey,
      model: attempt.model,
      messages: options.messages,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      stream: options.stream,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    };

    try {
      const text = await requestAiText(request);
      if (!text.trim()) throw new Error('AI API returned empty content.');
      return { text, usedAttempt: attempt, didFallback: index > 0 };
    } catch (error) {
      // 用户主动取消不算失败，也不该继续回退
      if (options.signal?.aborted) throw error;

      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${attempt.label}: ${message}`);

      if (!isRetriableAiError(error)) break;
      // 同一把 key 已被判定不可用时，后面的模型不必再试
      if (isChannelFatal(error) && sharesApiKeyWithRest(attempts, index)) break;
    }
  }

  throw new Error(failures.join('\n'));
}

/** 后续尝试是否和当前这次共用同一把 key（单渠道多模型就是这种情况） */
function sharesApiKeyWithRest(attempts: AiAttempt[], index: number): boolean {
  const current = attempts[index];
  return attempts.slice(index + 1).every(next =>
    next.apiKey === current.apiKey && next.baseUrl === current.baseUrl
  );
}
