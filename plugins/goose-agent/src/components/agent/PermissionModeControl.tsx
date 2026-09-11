/**
 * Composer 权限三档：只读工作区 | 工作区读写 | 完整权限。
 * Codex 式紧凑触发器（输入卡左下角 / 底栏均可）；完整权限立即 setState，无 Dialog/confirm。
 */
import { ChevronDown, Shield, ShieldAlert } from "lucide-react";
import type { Selection } from "react-aria-components";
import { Dropdown } from "@/lib/heroui";
import {
  PERMISSION_MODE_OPTIONS,
  usePermissionMode,
  type PermissionMode,
} from "@/stores/usePermissionMode";
import { cn } from "@/lib/utils";

interface PermissionModeControlProps {
  disabled?: boolean;
  /** 紧凑样式（默认 true）：h-7 / 11.5px，适合输入卡左侧 */
  compact?: boolean;
}

export function PermissionModeControl({
  disabled,
  compact = true,
}: PermissionModeControlProps) {
  const mode = usePermissionMode((s) => s.mode);
  const setMode = usePermissionMode((s) => s.setMode);

  const current =
    PERMISSION_MODE_OPTIONS.find((o) => o.id === mode) ??
    PERMISSION_MODE_OPTIONS[1]!;
  const isFullAccess = mode === "full-access";
  const Icon = isFullAccess ? ShieldAlert : Shield;

  const handleSelectionChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];
    if (
      typeof next === "string" &&
      PERMISSION_MODE_OPTIONS.some((o) => o.id === next)
    ) {
      // 完整权限：立即 setState，无确认
      setMode(next as PermissionMode);
    }
  };

  return (
    <div className="shrink-0" title={current.description}>
      <Dropdown>
        <Dropdown.Trigger
          isDisabled={disabled}
          aria-label={`权限模式：${current.label}`}
          className={cn(
            "flex items-center gap-0.5 rounded-md transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-40",
            compact
              ? "h-7 max-w-[132px] px-1.5 text-[11.5px] leading-none"
              : "h-8 max-w-[148px] px-2 text-[12px]",
            isFullAccess
              ? "font-medium text-timer-low hover:bg-danger-faint"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <Icon
            className={cn("shrink-0", compact ? "size-3" : "size-3.5")}
            strokeWidth={isFullAccess ? 2 : 1.75}
            aria-hidden
          />
          <span className="min-w-0 truncate">{current.label}</span>
          <ChevronDown
            className={cn(
              "shrink-0 opacity-70",
              compact ? "size-2.5" : "size-3",
            )}
            strokeWidth={1.75}
            aria-hidden
          />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top start" className="w-56 p-1.5">
          <div className="px-2 pb-1.5 pt-1 text-[11px] text-fg-faint">
            权限模式
          </div>
          <Dropdown.Menu
            aria-label="权限模式"
            selectionMode="single"
            selectedKeys={new Set([mode])}
            onSelectionChange={handleSelectionChange}
            disallowEmptySelection
          >
            {PERMISSION_MODE_OPTIONS.map((option) => {
              const isActive = option.id === mode;
              const optionFull = option.id === "full-access";
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
                  <span
                    className={cn(
                      "text-[12.5px] font-medium",
                      optionFull ? "text-timer-low" : "text-fg",
                    )}
                  >
                    {option.label}
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
