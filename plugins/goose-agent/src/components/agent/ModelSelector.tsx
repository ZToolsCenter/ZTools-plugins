/**
 * Composer 内模型选择器 — 单列展示凭证有效且已启用的供应商 provider/model。
 * 选中后切换 customProviderId + preferredAuthMode + workspace 模型。
 */
import { useMemo } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Selection } from "react-aria-components";
import { Dropdown } from "@/lib/heroui";
import { modelSupportsVision } from "@/lib/ai-provider";
import {
  getAggregatedComposerModels,
  resolveComposerSelectedRef,
} from "@/lib/ai-provider/providerModels";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  disabled?: boolean;
  /** 贴入分组 pill 时去掉独立边框 / 外层圆角 */
  compact?: boolean;
}

export function ModelSelector({
  disabled,
  compact,
}: ModelSelectorProps) {
  const ai = useSettings((s) => s.ai);
  const selectComposerModel = useSettings((s) => s.selectComposerModel);

  const aggregated = useMemo(
    () => getAggregatedComposerModels(ai),
    [
      ai.modelsByProvider,
      ai.customModelOptions,
      ai.customProviderId,
      ai.customOpenAIResponsesApiKey,
      ai.customOpenAIApiKey,
      ai.customClaudeApiKey,
      ai.oauthSession,
      ai.preferredAuthMode,
      ai.enabledProviders,
    ],
  );

  const effectiveRef = useMemo(
    () => resolveComposerSelectedRef(ai, aggregated),
    [
      aggregated,
      ai.workspaceSelectedModelId,
      ai.selectedModelId,
      ai.customProviderId,
    ],
  );

  if (aggregated.length === 0 || !effectiveRef) {
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center text-[11.5px] text-fg-faint",
          compact ? "px-1.5" : "rounded-md border border-border-soft px-2",
        )}
        title="请先在设置中配置模型"
      >
        未配置模型
      </span>
    );
  }

  const effectiveModel =
    aggregated.find((o) => o.ref === effectiveRef) ?? null;

  const handleSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];
    if (typeof next !== "string") return;
    if (next === effectiveRef) return;
    selectComposerModel(next);
  };

  const triggerLabel = effectiveModel?.primaryLabel ?? effectiveRef ?? "";

  return (
    <div className="shrink-0" title={`当前模型：${triggerLabel}`}>
      <Dropdown>
        <Dropdown.Trigger
          isDisabled={disabled}
          aria-label="切换模型"
          className={cn(
            "flex h-7 max-w-[180px] items-center gap-0.5 text-[11.5px] text-fg-muted",
            "hover:bg-surface-hover hover:text-fg",
            "transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-40",
            compact
              ? // 分组 pill 左侧：与父级 rounded-md 一致，避免 hover 直角
                "rounded-l-md px-1.5"
              : "rounded-md border border-border-soft px-2",
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown
            className="size-2.5 shrink-0 opacity-60"
            strokeWidth={2}
          />
        </Dropdown.Trigger>
        <Dropdown.Popover
          placement="top start"
          className="w-64 max-w-[min(16rem,92vw)] overflow-hidden p-1.5"
        >
          <div className="shrink-0 px-2 pb-1.5 pt-1 text-[11px] text-fg-faint">
            选择模型
          </div>
          <Dropdown.Menu
            aria-label="选择模型"
            selectionMode="single"
            selectedKeys={new Set([effectiveRef])}
            onSelectionChange={handleSelectionChange}
            disallowEmptySelection
            className="max-h-[min(14rem,var(--available-height,14rem))] overflow-y-auto overscroll-contain"
          >
            {aggregated.map((option) => {
              const isActive = option.ref === effectiveRef;
              const supportsVision = modelSupportsVision(
                option.id,
                aggregated.map((m) => ({
                  id: m.id,
                  label: m.label,
                  supportsVision: m.supportsVision,
                })),
                option.providerId,
              );
              return (
                <Dropdown.Item
                  key={option.ref}
                  id={option.ref}
                  textValue={option.primaryLabel}
                  className="cursor-pointer gap-2 rounded-md px-2 py-1.5"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[12.5px] text-fg"
                    title={option.primaryLabel}
                  >
                    {option.primaryLabel}
                  </span>
                  {supportsVision ? (
                    <span className="shrink-0 text-[10px] text-fg-faint">
                      视觉
                    </span>
                  ) : null}
                  {isActive ? (
                    <Check
                      className="size-3.5 shrink-0 text-fg"
                      strokeWidth={2}
                    />
                  ) : null}
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
