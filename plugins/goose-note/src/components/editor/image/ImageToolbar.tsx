import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Download,
  Maximize2,
} from "lucide-react";
import { useEffect, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react";
import { cn } from "@/components/editor/utils/cn";
import type { ImageAlignment } from "@/components/editor/image/imageUtils";
import { EDITOR_UI_SCALE_CHANGE_EVENT } from "@/lib/appearance";
import {
  EDITOR_CONTEXT_UI_GAP,
  getScaledEditorUiPx,
} from "@/components/editor/utils/editorContextUi";
import { useEditorUiScale } from "@/components/editor/hooks/useEditorUiScale";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";

export interface SelectedImageState {
  blockId: string | null;
  src: string;
  alt?: string;
  index: number;
  rect: DOMRect;
  alignment: ImageAlignment;
}

interface ImageToolbarProps {
  selectedImage: SelectedImageState;
  applyImageAlignment: (alignment: ImageAlignment) => void;
  handleSelectedImageZoom: () => void;
  handleSelectedImageCopy: () => void;
  handleSelectedImageDownload: () => void;
  openImageLabel: string;
  floatingBoundary?: HTMLElement | null;
  getReferenceRect?: () => DOMRect | null;
}

const imageToolButtonClass = "goose-block-toolbar-control";

function ImageToolButton({
  label,
  className,
  pressed,
  onClick,
  tooltipSideOffset,
  children,
}: {
  label: string;
  className?: string;
  pressed?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  tooltipSideOffset: number;
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
          className={cn(imageToolButtonClass, className)}
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

export function ImageToolbar({
  selectedImage,
  applyImageAlignment,
  handleSelectedImageZoom,
  handleSelectedImageCopy,
  handleSelectedImageDownload,
  openImageLabel,
  floatingBoundary,
  getReferenceRect,
}: ImageToolbarProps) {
  const editorUiScale = useEditorUiScale();
  const usesFloatingPosition = Boolean(getReferenceRect);
  const overflowOptions = {
    boundary: floatingBoundary ?? undefined,
    padding: getScaledEditorUiPx(8, editorUiScale),
  };
  const { refs, floatingStyles, update } = useFloating({
    open: usesFloatingPosition,
    strategy: "fixed",
    placement: "top",
    middleware: [
      offset(() => getScaledEditorUiPx(EDITOR_CONTEXT_UI_GAP)),
      flip({ ...overflowOptions, fallbackPlacements: ["bottom"] }),
      shift(overflowOptions),
      size({
        ...overflowOptions,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
          elements.floating.style.overflowX = "auto";
        },
      }),
    ],
    whileElementsMounted(reference, floating, update) {
      return autoUpdate(reference, floating, update, {
        animationFrame: true,
      });
    },
  });

  useEffect(() => {
    if (!getReferenceRect) return;
    refs.setPositionReference({
      getBoundingClientRect: () => getReferenceRect() ?? selectedImage.rect,
      contextElement: floatingBoundary ?? undefined,
    });
  }, [floatingBoundary, getReferenceRect, refs, selectedImage.rect]);

  useEffect(() => {
    if (!usesFloatingPosition) return;
    window.addEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, update);
    return () =>
      window.removeEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, update);
  }, [update, usesFloatingPosition]);

  const toolbar = (
    <TooltipProvider delayDuration={400} skipDelayDuration={100}>
      <div
        ref={usesFloatingPosition ? refs.setFloating : undefined}
        data-goose-image-toolbar
        className="fixed z-[20000]"
        style={
          usesFloatingPosition
            ? floatingStyles
            : {
                top: Math.max(
                  8,
                  selectedImage.rect.top - getScaledEditorUiPx(40),
                ),
                left: selectedImage.rect.left + selectedImage.rect.width / 2,
                transform: "translateX(-50%)",
              }
        }
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        role="toolbar"
        aria-label="图片操作"
      >
        <div className="goose-editor-context-ui goose-block-toolbar-surface animate-in fade-in-0 zoom-in-95 duration-150">
          {(
            [
              ["left", "左对齐", AlignLeft],
              ["center", "居中对齐", AlignCenter],
              ["right", "右对齐", AlignRight],
            ] as const
          ).map(([alignment, label, Icon]) => (
            <ImageToolButton
              key={alignment}
              label={label}
              pressed={selectedImage.alignment === alignment}
              tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
              onClick={() => applyImageAlignment(alignment)}
            >
              <Icon className="h-[15px] w-[15px]" />
            </ImageToolButton>
          ))}

          <div className="goose-block-toolbar-separator" />

          <ImageToolButton
            label={openImageLabel}
            tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
            onClick={handleSelectedImageZoom}
          >
            <Maximize2 className="h-[15px] w-[15px]" />
          </ImageToolButton>
          <ImageToolButton
            label="复制图片"
            tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
            onClick={handleSelectedImageCopy}
          >
            <Copy className="h-[15px] w-[15px]" />
          </ImageToolButton>
          <ImageToolButton
            label="下载图片"
            tooltipSideOffset={getScaledEditorUiPx(8, editorUiScale)}
            onClick={handleSelectedImageDownload}
          >
            <Download className="h-[15px] w-[15px]" />
          </ImageToolButton>
        </div>
      </div>
    </TooltipProvider>
  );

  return usesFloatingPosition && typeof document !== "undefined"
    ? createPortal(toolbar, document.body)
    : toolbar;
}
