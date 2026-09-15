import * as LucideIcons from "lucide-react";
import type { Page } from "@/types";
import { cn } from "@/lib/utils";
import { IconSelector } from "@/pages/workspace/components/shared/IconSelector";

interface PageIconButtonProps {
  page: Page;
  /** 紧凑入口：放在顶栏标题旁，不占编辑区垂直空间 */
  className?: string;
}

/**
 * 页面图标入口（顶栏紧凑版）。
 * 原先 Notion 式大图标在正文上方会永久占一行空白；单标签把标题提到顶栏后更浪费。
 * 本地文件夹页不支持 page.icon 元数据，调用方应自行不渲染。
 */
export function PageIconButton({ page, className }: PageIconButtonProps) {
  const updatePage = usePages((s) => s.updatePage);
  const disabled = Boolean(page.trashedAt || page.isLocked);
  const iconName = page.icon;
  const LucideIcon =
    iconName && (LucideIcons as any)[iconName]
      ? ((LucideIcons as any)[iconName] as typeof LucideIcons.Smile)
      : null;

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={iconName ? "更换页面图标" : "添加页面图标"}
      title={iconName ? "更换图标" : "添加图标"}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "text-muted-foreground/75 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)] hover:text-foreground",
        iconName && "text-foreground/85",
        className,
      )}
    >
      {LucideIcon ? (
        <LucideIcon className="h-4 w-4" strokeWidth={1.75} />
      ) : iconName ? (
        <span className="text-[15px] leading-none">{iconName}</span>
      ) : (
        <LucideIcons.Smile className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );

  if (disabled) {
    return trigger;
  }

  return (
    <IconSelector
      value={iconName}
      onChange={(icon) => updatePage(page.id, { icon })}
    >
      {trigger}
    </IconSelector>
  );
}
