import { FilePlus2, FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TreeEmptyStateProps {
  isLocalNotebook: boolean;
  width: number;
  /** 侧栏树可视区高度；有值时用它做垂直居中，避免 flex 高度链断裂 */
  height?: number;
  onCreatePage: () => void;
}

export function TreeEmptyState({
  isLocalNotebook,
  width,
  height = 0,
  onCreatePage,
}: TreeEmptyStateProps) {
  const EmptyIcon = isLocalNotebook ? FilePlus2 : FileText;
  const isCompactEmptyState = width <= 172;
  const hasMeasuredHeight = height > 0;

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center",
        !hasMeasuredHeight && "h-full min-h-0 flex-1",
        isCompactEmptyState ? "px-2.5" : "px-4",
      )}
      style={hasMeasuredHeight ? { height, minHeight: height } : undefined}
    >
      <div
        className={cn(
          "flex w-full flex-col items-center text-center",
          isCompactEmptyState
            ? "max-w-[9.75rem] gap-3.5"
            : "max-w-[12rem] gap-4",
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center rounded-[16px] bg-[hsl(var(--goose-selected-bg))] text-foreground/40 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.45)]",
            isCompactEmptyState ? "size-14" : "size-16",
          )}
          aria-hidden
        >
          <EmptyIcon
            className={cn(isCompactEmptyState ? "size-7" : "size-8")}
            strokeWidth={1.35}
          />
        </div>

        <p
          className={cn(
            "font-semibold tracking-[-0.02em] text-foreground/80 text-balance",
            isCompactEmptyState
              ? "text-[17px] leading-snug"
              : "text-[20px] leading-tight",
          )}
        >
          {isLocalNotebook ? "暂无文件可选" : "暂无页面可选"}
        </p>

        <Button
          type="button"
          size="sm"
          onClick={onCreatePage}
          className={cn(
            "h-9 gap-1.5 px-3.5 font-medium",
            isCompactEmptyState
              ? "w-full text-[13px]"
              : "min-w-[7.5rem] text-[14px]",
          )}
        >
          <Plus className="!size-3.5 shrink-0 opacity-80" strokeWidth={2.25} />
          {isLocalNotebook ? "新建文件" : "新建页面"}
        </Button>
      </div>
    </div>
  );
}
