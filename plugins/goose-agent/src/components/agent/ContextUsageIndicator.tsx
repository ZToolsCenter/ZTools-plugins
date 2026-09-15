/**
 * Composer 底栏上下文用量空心环（Codex 风格）。
 * Hybrid：优先 provider usage；估算时 used 前缀 ≈。
 * 默认只显示环；Hover 短摘要 · Click 详情 Popover（含 % 与 tok/s）。
 * 支持 usageOverride 注入（子代理等场景，不读 store）。
 */
import { useMemo, useState } from "react";
import {
  formatTokenCount,
  modelIdsMatch,
  resolveActiveProtocol,
  resolveContextWindowTokens,
  resolveEffectiveModelId,
} from "@/lib/ai-provider";
import {
  estimateTokensFromImageBase64,
  estimateTokensFromText,
  type UsageSource,
} from "@/lib/agent/usage";
import { Popover, ProgressCircle, Tooltip } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import {
  useAgentChats,
  type AgentConversationUsage,
  type AgentMessage,
} from "@/stores/useAgentChats";
import { useSettings } from "@/stores/settings";

export interface ContextUsageIndicatorProps {
  /** 主会话 id；与 usageOverride 二选一（override 优先） */
  conversationId?: string;
  /** 注入：子代理等场景，不读 store */
  usageOverride?: AgentConversationUsage | null;
  /** 覆盖模型 id（上下文窗口 + 标签） */
  modelIdOverride?: string | null;
  /** 估算用文本消息（无 usage 时） */
  estimateMessages?: AgentMessage[];
  className?: string;
  disabled?: boolean;
  /** compact size for card header */
  size?: "sm" | "md";
}

/** zustand selector 空数组必须稳定引用，避免 getSnapshot 无限循环 */
const EMPTY_MESSAGES: AgentMessage[] = [];

type FillTone = "normal" | "warning" | "danger";

function hasPositive(...values: Array<number | undefined | null>): boolean {
  return values.some(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  );
}

function resolveFillTone(percent: number): FillTone {
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return "normal";
}

function toneLabel(tone: FillTone): string {
  if (tone === "danger") return "将满";
  if (tone === "warning") return "较满";
  return "正常";
}

function progressColor(
  tone: FillTone,
): "accent" | "warning" | "danger" | "default" {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  return "accent";
}

function shortModelName(
  modelId: string | null | undefined,
  label?: string | null,
): string {
  const raw = (label ?? modelId ?? "").trim();
  if (!raw) return "模型";
  const parts = raw.split(/[/:]/);
  const last = parts[parts.length - 1] || raw;
  return last.length > 18 ? `${last.slice(0, 16)}…` : last;
}

function barBlocks(percent: number, width = 10): string {
  const filled = Math.round(
    (Math.min(100, Math.max(0, percent)) / 100) * width,
  );
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      // AgentToolPart.type 为 string，无法靠 type 字面量收窄；用字段判断
      if (part.type === "text" && "text" in part && typeof part.text === "string") {
        total += estimateTokensFromText(part.text);
      } else if (
        part.type === "image" &&
        "dataBase64" in part &&
        typeof part.dataBase64 === "string" &&
        part.dataBase64.length > 0
      ) {
        total += estimateTokensFromImageBase64(part.dataBase64);
      }
    }
  }
  return total;
}

export function ContextUsageIndicator({
  conversationId,
  usageOverride,
  modelIdOverride,
  estimateMessages,
  className,
  disabled,
  size = "md",
}: ContextUsageIndicatorProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  const hasOverride = usageOverride !== undefined;
  const storeConversationId = hasOverride ? "" : (conversationId ?? "");

  const storeUsage = useAgentChats(
    (s) =>
      storeConversationId
        ? (s.conversations[storeConversationId]?.usage ?? null)
        : null,
  );

  const storeMessages = useAgentChats(
    (s) =>
      storeConversationId
        ? (s.conversations[storeConversationId]?.messages ?? EMPTY_MESSAGES)
        : EMPTY_MESSAGES,
  );

  const usage = hasOverride ? (usageOverride ?? null) : storeUsage;
  const messages = estimateMessages ?? storeMessages;

  const customModelOptions = useSettings((s) => s.ai.customModelOptions);
  const selectedModelId = useSettings((s) => s.ai.selectedModelId);
  const workspaceSelectedModelId = useSettings(
    (s) => s.ai.workspaceSelectedModelId,
  );
  const ai = useSettings((s) => s.ai);

  const effectiveModelId = useMemo(() => {
    if (modelIdOverride != null && modelIdOverride.trim()) {
      return modelIdOverride.trim();
    }
    return resolveEffectiveModelId({
      workspaceSelectedModelId,
      selectedModelId,
      customModelOptions,
      customProviderId: ai.customProviderId,
    });
  }, [
    modelIdOverride,
    customModelOptions,
    selectedModelId,
    workspaceSelectedModelId,
    ai.customProviderId,
  ]);

  const effectiveModel = useMemo(
    () =>
      customModelOptions.find((o) =>
        modelIdsMatch(o.id, effectiveModelId, ai.customProviderId),
      ) ?? null,
    [customModelOptions, effectiveModelId, ai.customProviderId],
  );

  const protocol = useMemo(
    () =>
      resolveActiveProtocol(ai, {
        selectedModelId: effectiveModelId,
      }),
    [ai, effectiveModelId],
  );

  const contextLimit = useMemo(
    () =>
      resolveContextWindowTokens({
        modelId: effectiveModelId,
        modelOptions: customModelOptions,
        protocol,
        providerId: ai.customProviderId,
      }),
    [effectiveModelId, customModelOptions, protocol, ai.customProviderId],
  );

  const metrics = useMemo(() => {
    // conversationId 缺失且无 override 时不展示
    if (!hasOverride && !conversationId) return null;

    const lastTurn = usage?.lastTurn;
    const session = usage?.session;
    const estimatedFromMessages = estimateMessagesTokens(messages);
    const systemPromptTokens = lastTurn?.systemPromptTokens;

    // 环填充：上下文占用（最近一次请求），非会话累计
    let used: number | null = null;
    let source: UsageSource | "none" = "none";

    if (lastTurn) {
      const isProvider =
        lastTurn.source === "provider" || lastTurn.source === "hybrid";
      if (isProvider && hasPositive(lastTurn.promptTokens)) {
        used = lastTurn.promptTokens;
        source = lastTurn.source;
      } else if (hasPositive(lastTurn.totalTokens)) {
        used = lastTurn.totalTokens;
        source = lastTurn.source;
      } else if (hasPositive(lastTurn.promptTokens)) {
        used = lastTurn.promptTokens;
        source = lastTurn.source;
      }
    }

    if (used == null) {
      const est =
        (typeof systemPromptTokens === "number" && systemPromptTokens > 0
          ? systemPromptTokens
          : 0) + estimatedFromMessages;
      if (est > 0) {
        used = est;
        source = "estimate";
      }
    }

    if (used == null || used <= 0 || contextLimit <= 0) {
      return null;
    }

    const percent = Math.min(
      100,
      Math.max(0, Math.round((used / contextLimit) * 100)),
    );
    const free = Math.max(0, contextLimit - used);
    const isEstimate = source === "estimate";
    const tone = resolveFillTone(percent);

    const cacheRead =
      lastTurn?.cacheReadTokens ?? session?.cacheReadTokens ?? 0;
    const cacheWrite =
      lastTurn?.cacheWriteTokens ?? session?.cacheWriteTokens ?? 0;
    const showCache =
      (typeof lastTurn?.cacheReadTokens === "number" ||
        typeof lastTurn?.cacheWriteTokens === "number" ||
        (session != null &&
          (session.cacheReadTokens > 0 || session.cacheWriteTokens > 0))) &&
      (cacheRead > 0 || cacheWrite > 0);

    const promptForRate = lastTurn?.promptTokens ?? 0;
    const cacheHitRate =
      showCache && promptForRate > 0
        ? Math.min(100, Math.round((cacheRead / promptForRate) * 100))
        : null;

    return {
      used,
      free,
      limit: contextLimit,
      percent,
      tone,
      source,
      isEstimate,
      lastTurn,
      session,
      systemPromptTokens:
        typeof systemPromptTokens === "number" && systemPromptTokens > 0
          ? systemPromptTokens
          : null,
      tokensPerSecond:
        typeof lastTurn?.tokensPerSecond === "number" &&
        lastTurn.tokensPerSecond > 0
          ? lastTurn.tokensPerSecond
          : null,
      showCache,
      cacheRead,
      cacheWrite,
      cacheHitRate,
      modelLabel: shortModelName(effectiveModelId, effectiveModel?.label),
    };
  }, [
    hasOverride,
    conversationId,
    usage,
    messages,
    contextLimit,
    effectiveModelId,
    effectiveModel?.label,
  ]);

  if (!metrics) return null;

  const isCompact = size === "sm";

  const usedDisplay = `${metrics.isEstimate ? "≈" : ""}${formatTokenCount(metrics.used)}`;
  const limitDisplay = formatTokenCount(metrics.limit);
  const freeDisplay = formatTokenCount(metrics.free);
  const ariaLabel = `上下文已用 ${metrics.percent}%，约 ${formatTokenCount(metrics.used)} / ${limitDisplay} tokens`;

  const hoverBody = (
    <div className="flex flex-col gap-0.5 text-[11px] leading-snug">
      <div className="tabular-nums text-fg">
        上下文{"  "}
        {usedDisplay} / {limitDisplay}
      </div>
      <div className="tabular-nums text-fg-muted">
        Context · {metrics.percent}%
      </div>
      <div className="text-fg-faint">
        {metrics.modelLabel} · {toneLabel(metrics.tone)}
      </div>
    </div>
  );

  const detailBody = (
    <div className="flex flex-col gap-2.5 p-2.5 text-[11.5px] text-fg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium">上下文用量</span>
        {metrics.isEstimate || metrics.source === "hybrid" ? (
          <span className="text-[10px] text-fg-faint">
            {metrics.source === "estimate" ? "估算" : "混合"}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-fg-muted">
          <span className="tracking-tight">{barBlocks(metrics.percent)}</span>
          <span
            className={cn(
              "font-medium",
              metrics.tone === "danger" && "text-timer-low",
              metrics.tone === "warning" && "text-[#d97706]",
            )}
          >
            {metrics.percent}%
          </span>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-fg-muted">
          {usedDisplay} used · {freeDisplay} free · {limitDisplay} limit
        </div>
      </div>

      {metrics.lastTurn ? (
        <div className="flex flex-col gap-1 border-t border-border-soft pt-2">
          <div className="text-[10.5px] text-fg-faint">本轮</div>
          <MetricRow
            label="提示词 (Prompt)"
            value={formatTokenCount(metrics.lastTurn.promptTokens)}
            approx={metrics.isEstimate}
          />
          <MetricRow
            label="完成 (Completion)"
            value={formatTokenCount(metrics.lastTurn.completionTokens)}
            approx={metrics.isEstimate}
          />
          {metrics.systemPromptTokens != null ? (
            <MetricRow
              label="系统提示"
              value={formatTokenCount(metrics.systemPromptTokens)}
              approx={metrics.isEstimate}
            />
          ) : null}
        </div>
      ) : null}

      {metrics.session && hasPositive(metrics.session.totalTokens) ? (
        <div className="flex flex-col gap-1 border-t border-border-soft pt-2">
          <div className="text-[10.5px] text-fg-faint">会话累计</div>
          <MetricRow
            label="总消耗"
            value={formatTokenCount(metrics.session.totalTokens)}
          />
        </div>
      ) : null}

      {metrics.showCache ? (
        <div className="flex flex-col gap-1 border-t border-border-soft pt-2">
          <div className="text-[10.5px] text-fg-faint">缓存</div>
          {metrics.cacheRead > 0 ? (
            <MetricRow
              label="已缓存"
              value={formatTokenCount(metrics.cacheRead)}
            />
          ) : null}
          {metrics.cacheWrite > 0 ? (
            <MetricRow
              label="写入"
              value={formatTokenCount(metrics.cacheWrite)}
            />
          ) : null}
          {metrics.cacheHitRate != null ? (
            <MetricRow label="命中率" value={`${metrics.cacheHitRate}%`} />
          ) : null}
        </div>
      ) : null}

      {metrics.tokensPerSecond != null ? (
        <div className="flex flex-col gap-1 border-t border-border-soft pt-2">
          <div className="text-[10.5px] text-fg-faint">速度</div>
          <MetricRow
            label="tok/s"
            value={`${Math.round(metrics.tokensPerSecond)}`}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={cn("shrink-0", className)}>
      <Tooltip delay={400} isDisabled={detailOpen || Boolean(disabled)}>
        <Tooltip.Trigger>
          <span className="inline-flex">
            <Popover
              isOpen={detailOpen}
              onOpenChange={(next) => {
                if (disabled) return;
                setDetailOpen(next);
              }}
            >
              <Popover.Trigger>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={ariaLabel}
                  className={cn(
                    "inline-flex items-center justify-center rounded-md",
                    isCompact ? "size-6" : "size-7",
                    "text-fg-muted hover:bg-surface-hover hover:text-fg",
                    "transition-colors duration-150",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-strong)]",
                    metrics.tone === "danger" && "text-timer-low",
                    metrics.tone === "warning" && "text-[#d97706]",
                  )}
                >
                  <ProgressCircle
                    aria-label={ariaLabel}
                    value={metrics.percent}
                    minValue={0}
                    maxValue={100}
                    size="sm"
                    color={progressColor(metrics.tone)}
                    className={isCompact ? "size-4" : "size-5"}
                  >
                    <ProgressCircle.Track>
                      <ProgressCircle.TrackCircle />
                      <ProgressCircle.FillCircle />
                    </ProgressCircle.Track>
                  </ProgressCircle>
                </button>
              </Popover.Trigger>
              <Popover.Content placement="top end" className="w-[240px] p-0">
                <Popover.Dialog className="outline-none">
                  {detailBody}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content placement="top" className="max-w-[200px] px-2 py-1.5">
          {hoverBody}
        </Tooltip.Content>
      </Tooltip>
    </div>
  );
}

function MetricRow({
  label,
  value,
  approx,
}: {
  label: string;
  value: string;
  approx?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-fg-muted">{label}</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg">
        {approx ? `≈${value}` : value}
      </span>
    </div>
  );
}
