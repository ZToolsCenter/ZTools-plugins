/**
 * 侧边 AI 模型选择器 — 默认跟随设置里配置的模型，
 * 切换后写入 workspaceSelectedModelId 作为工作区级覆盖，
 * 重新选回默认模型时清除覆盖。
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/stores/useSettings";

interface ModelSelectorPopoverProps {
  disabled?: boolean;
}

export function ModelSelectorPopover({ disabled }: ModelSelectorPopoverProps) {
  const [open, setOpen] = useState(false);
  const customModelOptions = useSettings((state) => state.ai.customModelOptions);
  const selectedModelId = useSettings((state) => state.ai.selectedModelId);
  const workspaceSelectedModelId = useSettings(
    (state) => state.ai.workspaceSelectedModelId,
  );
  const setAIWorkspaceSelectedModelId = useSettings(
    (state) => state.setAIWorkspaceSelectedModelId,
  );

  // 默认选中设置配置的模型；工作区覆盖失效（模型已不在列表中）时回退默认。
  const effectiveModelId = useMemo(() => {
    if (
      workspaceSelectedModelId &&
      customModelOptions.some((option) => option.id === workspaceSelectedModelId)
    ) {
      return workspaceSelectedModelId;
    }
    return selectedModelId ?? customModelOptions[0]?.id ?? null;
  }, [customModelOptions, selectedModelId, workspaceSelectedModelId]);

  if (customModelOptions.length === 0 || !effectiveModelId) return null;

  const effectiveModel =
    customModelOptions.find((option) => option.id === effectiveModelId) ?? null;

  const selectModel = (modelId: string) => {
    setAIWorkspaceSelectedModelId(
      modelId === selectedModelId ? null : modelId,
    );
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-[7px] px-1.5 text-xs text-muted-foreground transition-colors hover:bg-[var(--goose-interactive-hover)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="切换模型"
          title={`当前模型：${effectiveModel?.id ?? effectiveModelId}`}
        >
          <span className="min-w-0 truncate">
            {effectiveModel?.label ?? effectiveModelId}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      {/*
        触发器在 composer 左侧：用 align="start" 让菜单从按钮左缘向右展开，
        避免 align="end" 把宽菜单甩到按钮左侧（视觉上像「跑偏」）。
      */}
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-56 p-1.5"
      >
        <div className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
          选择模型
        </div>
        <div className="space-y-0.5">
          {customModelOptions.map((option) => {
            const isActive = option.id === effectiveModelId;
            const isDefault = option.id === selectedModelId;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => selectModel(option.id)}
                className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--goose-interactive-hover)]"
                aria-current={isActive ? "true" : undefined}
                title={option.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {option.label}
                </span>
                {isDefault ? (
                  <span className="shrink-0 rounded-[4px] bg-[var(--goose-interactive-selected)] px-1 py-px text-[10px] text-[var(--goose-interactive-selected-fg)]">
                    默认
                  </span>
                ) : null}
                {isActive ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-foreground"
                    strokeWidth={2}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
