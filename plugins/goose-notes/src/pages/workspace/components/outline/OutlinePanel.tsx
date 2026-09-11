import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import type { HeadingItem } from "./useHeadings";

interface OutlinePanelProps {
  headings: HeadingItem[];
  activeId: string | null;
  onHeadingClick: (blockId: string) => void;
}

export function OutlinePanel({ headings, activeId, onHeadingClick }: OutlinePanelProps) {
  if (headings.length === 0) {
    return (
      <div className="w-full h-full flex flex-col bg-[hsl(var(--goose-shell-bg))]">
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/20 mb-2" />
          <p className="text-xs text-muted-foreground/50">暂无标题</p>
          <p className="text-[11px] text-muted-foreground/30 mt-0.5">使用 # 到 #### 添加</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-[hsl(var(--goose-shell-bg))]">
      <div className="flex-1 overflow-y-auto py-2 px-2">
        <nav className="space-y-0.5">
          {headings.map((heading) => (
            <OutlineTreeNode
              key={heading.id}
              heading={heading}
              depth={0}
              activeId={activeId}
              onHeadingClick={onHeadingClick}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

function OutlineTreeNode({
  heading,
  depth,
  activeId,
  onHeadingClick,
}: {
  heading: HeadingItem;
  depth: number;
  activeId: string | null;
  onHeadingClick: (blockId: string) => void;
}) {
  const isActive = activeId === heading.id;

  return (
    <div>
      <button
        onClick={() => onHeadingClick(heading.id)}
        className={cn(
          "w-full text-left text-xs leading-5 rounded-md px-2 py-1 transition-colors duration-150",
          "hover:bg-[var(--goose-interactive-hover)]",
          isActive
            ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)] font-medium"
            : "text-muted-foreground/80",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <span className="block truncate">{heading.text}</span>
      </button>
      {heading.children.length > 0 ? (
        <div>
          {heading.children.map((child) => (
            <OutlineTreeNode
              key={child.id}
              heading={child}
              depth={depth + 1}
              activeId={activeId}
              onHeadingClick={onHeadingClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
