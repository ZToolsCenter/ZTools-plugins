/**
 * Composer 内思考长度：低 | 中 | 高。
 * 位于模型选择器右侧；默认中，无「默认」字眼，选中即可。
 * 默认紧凑 chip；`compact` 时去掉独立边框，便于父级分组 pill。
 */
import { Check, ChevronDown } from "lucide-react";
import type { Selection } from "react-aria-components";
import { Dropdown } from "@/lib/heroui";
import type { AIReasoningLevel } from "@/lib/ai-provider";
import { useSettings } from "@/stores/settings";
import { cn } from "@/lib/utils";

/** UI 仅暴露三档；存储侧可能仍有历史 default，读入时归一为 medium。 */
export type ThinkingLengthLevel = "low" | "medium" | "high";

const THINKING_LENGTH_OPTIONS: Array<{
  id: ThinkingLengthLevel;
  label: string;
  description: string;
}> = [
  { id: "low", label: "低", description: "更快，适合简单问答" },
  { id: "medium", label: "中", description: "平衡速度与深度" },
  { id: "high", label: "高", description: "更长思考，适合复杂任务" },
];

function toThinkingLength(level: AIReasoningLevel): ThinkingLengthLevel {
  if (level === "low" || level === "high" || level === "medium") return level;
  return "medium";
}

interface ReasoningLevelControlProps {
  disabled?: boolean;
  /** 贴入分组 pill 时去掉独立边框 / 外层圆角 */
  compact?: boolean;
}

export function ReasoningLevelControl({
  disabled,
  compact,
}: ReasoningLevelControlProps) {
  const level = useSettings((s) => s.ai.workspaceReasoningLevel);
  const setLevel = useSettings((s) => s.setAIWorkspaceReasoningLevel);
  const currentId = toThinkingLength(level);
  const current =
    THINKING_LENGTH_OPTIONS.find((o) => o.id === currentId) ??
    THINKING_LENGTH_OPTIONS[1]!;

  const handleSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];
    if (
      typeof next === "string" &&
      THINKING_LENGTH_OPTIONS.some((o) => o.id === next)
    ) {
      setLevel(next as ThinkingLengthLevel);
    }
  };

  return (
    <div className="shrink-0" title={`思考长度：${current.label}`}>
      <Dropdown>
        <Dropdown.Trigger
          isDisabled={disabled}
          aria-label="思考长度"
          className={cn(
            "flex h-7 min-w-0 items-center gap-0.5 text-[11.5px] text-fg-muted",
            "hover:bg-surface-hover hover:text-fg",
            "transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-40",
            compact
              ? // 分组 pill 右侧：与父级 rounded-md 一致，避免 hover 直角
                "rounded-r-md px-1.5"
              : "rounded-md border border-border-soft px-2",
          )}
        >
          <span className="tabular-nums">{current.label}</span>
          <ChevronDown
            className="size-2.5 shrink-0 opacity-60"
            strokeWidth={2}
          />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top start" className="w-52 p-1.5">
          <div className="px-2 pb-1.5 pt-1 text-[11px] text-fg-faint">
            思考长度
          </div>
          <Dropdown.Menu
            aria-label="思考长度"
            selectionMode="single"
            selectedKeys={new Set([currentId])}
            onSelectionChange={handleSelectionChange}
            disallowEmptySelection
          >
            {THINKING_LENGTH_OPTIONS.map((option) => {
              const isActive = option.id === currentId;
              return (
                <Dropdown.Item
                  key={option.id}
                  id={option.id}
                  textValue={option.label}
                  className={cn(
                    "cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5",
                    isActive && "bg-accent-subtle",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-[12.5px] font-medium text-fg">
                      {option.label}
                    </span>
                    {isActive ? (
                      <Check
                        className="ml-auto size-3.5 shrink-0 text-fg"
                        strokeWidth={2}
                      />
                    ) : null}
                  </span>
                  <span className="text-[11px] leading-snug text-fg-faint">
                    {option.description}
                  </span>
                </Dropdown.Item>
              );
            })}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
