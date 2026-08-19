import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Download,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { flip, offset, shift, size, useFloating } from "@floating-ui/react";
import { cn } from "@/components/editor/utils/cn";
import type { ImageAlignment } from "@/components/editor/image/imageUtils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";
import {
  EDITOR_CONTEXT_UI_GAP,
  getScaledEditorUiPx,
} from "@/components/editor/utils/editorContextUi";
import { useEditorUiScale } from "@/components/editor/hooks/useEditorUiScale";

type VideoToolbarProps = {
  rect: DOMRect;
  alignment: ImageAlignment;
  editable: boolean;
  onAlign: (alignment: ImageAlignment) => void;
  onReplace: () => void;
  onDownload: () => void;
  onDelete: () => void;
};

const toolButtonClass = "goose-block-toolbar-control";

function VideoToolButton({
  label,
  className,
  pressed,
  tooltipSideOffset,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  pressed?: boolean;
  tooltipSideOffset: number;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn(toolButtonClass, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={tooltipSideOffset}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function VideoToolbar({
  rect,
  alignment,
  editable,
  onAlign,
  onReplace,
  onDownload,
  onDelete,
}: VideoToolbarProps) {
  const editorUiScale = useEditorUiScale();
  const overflowPadding = getScaledEditorUiPx(8, editorUiScale);
  const { refs, floatingStyles, update } = useFloating({
    strategy: "fixed",
    placement: "top",
    middleware: [
      offset(getScaledEditorUiPx(EDITOR_CONTEXT_UI_GAP, editorUiScale)),
      flip({ padding: overflowPadding, fallbackPlacements: ["bottom"] }),
      shift({ padding: overflowPadding }),
      size({
        padding: overflowPadding,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
          elements.floating.style.overflowX = "auto";
        },
      }),
    ],
  });
  const setFloating = useCallback(
    (node: HTMLElement | null) => refs.setFloating(node),
    [refs],
  );

  useEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => rect,
    });
    void update();
  }, [rect, refs, update, editorUiScale]);

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={100}>
      <div
        data-goose-video-toolbar
        ref={setFloating}
        className="fixed z-[20000]"
        style={floatingStyles}
        onMouseDown={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        role="toolbar"
        aria-label="视频操作"
      >
        <div className="goose-editor-context-ui goose-block-toolbar-surface animate-in fade-in-0 zoom-in-95 duration-150">
          {editable &&
            (
              [
                ["left", "左对齐", AlignLeft],
                ["center", "居中对齐", AlignCenter],
                ["right", "右对齐", AlignRight],
              ] as const
            ).map(([value, label, Icon]) => (
              <VideoToolButton
                key={value}
                label={label}
                pressed={alignment === value}
                tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
                onClick={() => onAlign(value)}
              >
                <Icon className="h-[15px] w-[15px]" />
              </VideoToolButton>
            ))}

          {editable && <div className="goose-block-toolbar-separator" />}

          {editable && (
            <VideoToolButton
              label="更换视频"
              tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
              onClick={onReplace}
            >
              <RefreshCw className="h-[15px] w-[15px]" />
            </VideoToolButton>
          )}
          <VideoToolButton
            label="下载视频"
            tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
            onClick={onDownload}
          >
            <Download className="h-[15px] w-[15px]" />
          </VideoToolButton>
          {editable && (
            <VideoToolButton
              label="删除视频"
              tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
              onClick={onDelete}
              className="hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
            >
              <Trash2 className="h-[15px] w-[15px]" />
            </VideoToolButton>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
