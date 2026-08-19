import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 相对适配比例的最大放大倍数 */
const MAX_ZOOM_FACTOR = 5;
const ZOOM_STEP = 1.2;

interface ArtifactPanZoomProps {
  children: ReactNode;
  /** 内容变化时重新适配视口（例如 SVG 重新渲染） */
  contentKey?: string;
  className?: string;
  minHeight?: number;
}

function roundTransform(value: number) {
  return Math.round(value * 1000) / 1000;
}

function parseSvgLength(value: string | null | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("%")) return 0;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 量 SVG 固有尺寸。scrollWidth 在旧 Chromium / flex 窄列里常被压成容器宽，
 * 导致 fit 比例=1、再居中 → 左右被 overflow 裁切（用户看到的「遮挡」）。
 */
function measureArtifactContentSize(content: HTMLElement): {
  width: number;
  height: number;
} {
  const svg = content.querySelector("svg");
  if (svg instanceof SVGSVGElement) {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        const w = Math.ceil(box.width + Math.max(0, box.x));
        const h = Math.ceil(box.height + Math.max(0, box.y));
        if (w > 10 && h > 10) {
          return { width: w, height: h };
        }
      }
    } catch {
      // 未插入布局时 getBBox 会抛错
    }

    const vb = svg.viewBox?.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      return { width: vb.width, height: vb.height };
    }

    const attrW = parseSvgLength(svg.getAttribute("width"));
    const attrH = parseSvgLength(svg.getAttribute("height"));
    if (attrW > 0 && attrH > 0) {
      return { width: attrW, height: attrH };
    }
  }

  // 临时去掉 transform 再量，避免已缩放时 scrollWidth 失真
  const prevTransform = content.style.transform;
  content.style.transform = "none";
  const width = Math.max(content.scrollWidth, content.offsetWidth, 1);
  const height = Math.max(content.scrollHeight, content.offsetHeight, 1);
  content.style.transform = prevTransform;
  return { width, height };
}

export function ArtifactPanZoom({
  children,
  contentKey,
  className,
  minHeight = 220,
}: ArtifactPanZoomProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const fitScaleRef = useRef(1);
  const contentSizeRef = useRef({ width: 1, height: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  const isZoomedIn = scale > fitScale + 0.001;

  const applyTransform = useCallback((next: { scale: number; x: number; y: number }) => {
    const minScale = fitScaleRef.current;
    const maxScale = minScale * MAX_ZOOM_FACTOR;
    const normalized = {
      scale: Math.min(maxScale, Math.max(minScale, next.scale)),
      x: roundTransform(next.x),
      y: roundTransform(next.y),
    };
    transformRef.current = normalized;
    setScale(normalized.scale);
    setOffset({ x: normalized.x, y: normalized.y });
  }, []);

  const centerAtScale = useCallback(
    (nextScale: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        applyTransform({ scale: nextScale, x: 0, y: 0 });
        return;
      }
      const { width: contentWidth, height: contentHeight } = contentSizeRef.current;
      const scaledW = contentWidth * nextScale;
      const scaledH = contentHeight * nextScale;

      const targetX =
        scaledW <= viewport.clientWidth
          ? (viewport.clientWidth - scaledW) / 2
          : 0;

      const targetY =
        scaledH <= viewport.clientHeight
          ? (viewport.clientHeight - scaledH) / 2
          : 0;

      applyTransform({
        scale: nextScale,
        x: targetX,
        y: targetY,
      });
    },
    [applyTransform],
  );

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return false;

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return false;

    const measured = measureArtifactContentSize(content);
    if (measured.width < 8 || measured.height < 8) return false;

    contentSizeRef.current = measured;

    // 把内容盒钉成固有尺寸，避免 flex 子项把 SVG 压窄后 scrollWidth 失真
    content.style.width = `${measured.width}px`;
    content.style.height = `${measured.height}px`;

    // 优先按宽度适应视口，保障横向完整展示与居中；
    // 当高度巨大时设置下限阈值（0.55），防止长图/复杂架构图被过度微缩成不可读的细线条
    const widthFit = (viewportWidth - 24) / measured.width;
    const heightFit = (viewportHeight - 24) / measured.height;
    let nextFit = Math.min(1, widthFit);
    if (heightFit < nextFit) {
      nextFit = Math.max(0.55, Math.min(nextFit, heightFit));
    }

    const safeFit = Number.isFinite(nextFit) && nextFit > 0 ? nextFit : 1;
    fitScaleRef.current = safeFit;
    setFitScale(safeFit);
    centerAtScale(safeFit);
    setReady(true);
    return true;
  }, [centerAtScale]);

  useEffect(() => {
    setReady(false);
    let frame = 0;
    let attempts = 0;
    let cancelled = false;

    const tryFit = () => {
      if (cancelled) return;
      attempts += 1;
      if (fitToViewport()) return;
      if (attempts < 30) {
        frame = window.requestAnimationFrame(tryFit);
        return;
      }
      // 最后一搏：用当前盒子尺寸，避免一直透明
      const content = contentRef.current;
      if (content) {
        contentSizeRef.current = {
          width: Math.max(content.scrollWidth, 1),
          height: Math.max(content.scrollHeight, 1),
        };
      }
      fitScaleRef.current = 1;
      setFitScale(1);
      applyTransform({ scale: 1, x: 0, y: 0 });
      setReady(true);
    };

    frame = window.requestAnimationFrame(tryFit);

    const viewport = viewportRef.current;
    const content = contentRef.current;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && viewport) {
      ro = new ResizeObserver(() => {
        // 视口变宽/变窄时重新适配；用户已放大时不强制拉回
        if (transformRef.current.scale <= fitScaleRef.current + 0.001) {
          fitToViewport();
        }
      });
      ro.observe(viewport);
      if (content) ro.observe(content);
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [applyTransform, contentKey, fitToViewport]);

  const zoomAtCenter = useCallback(
    (nextScale: number) => {
      const viewport = viewportRef.current;
      const prev = transformRef.current;
      const minScale = fitScaleRef.current;
      const maxScale = minScale * MAX_ZOOM_FACTOR;
      const clamped = Math.min(maxScale, Math.max(minScale, nextScale));
      if (Math.abs(clamped - prev.scale) < 0.0001) return;

      // 回到适配比例时重新居中，避免偏移残留
      if (clamped <= minScale + 0.0001) {
        centerAtScale(minScale);
        return;
      }

      if (!viewport) {
        applyTransform({ scale: clamped, x: prev.x, y: prev.y });
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const pivotX = rect.width / 2;
      const pivotY = rect.height / 2;
      const contentX = (pivotX - prev.x) / prev.scale;
      const contentY = (pivotY - prev.y) / prev.scale;

      applyTransform({
        scale: clamped,
        x: pivotX - contentX * clamped,
        y: pivotY - contentY * clamped,
      });
    },
    [applyTransform, centerAtScale],
  );

  const zoomByStep = useCallback(
    (direction: 1 | -1) => {
      const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAtCenter(transformRef.current.scale * factor);
    },
    [zoomAtCenter],
  );

  // 仅在已放大时拦截滚轮：平移查看细节，不缩放，也不抢走页面滚动
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !isZoomedIn) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const prev = transformRef.current;
      applyTransform({
        scale: prev.scale,
        x: prev.x - event.deltaX,
        y: prev.y - event.deltaY,
      });
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyTransform, isZoomedIn]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isZoomedIn) return;
    if (event.button !== 0) return;
    // 控件按钮不进入拖拽
    if ((event.target as HTMLElement | null)?.closest("button")) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
    };
    setDragging(true);
    viewport.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    applyTransform({
      scale: transformRef.current.scale,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const percent = Math.round((scale / Math.max(fitScale, 0.0001)) * 100);
  const atMinZoom = scale <= fitScale + 0.001;
  const atMaxZoom = scale >= fitScale * MAX_ZOOM_FACTOR - 0.001;

  return (
    <div
      ref={viewportRef}
      className={cn(
        "notebook-ai-artifact-panzoom relative overflow-hidden",
        isZoomedIn && "is-zoomed",
        dragging && "is-dragging",
        className,
      )}
      style={{ minHeight }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="img"
      aria-label={isZoomedIn ? "已放大的图形，可拖动或滚轮平移" : "图形预览"}
    >
      <div
        ref={contentRef}
        className="notebook-ai-artifact-panzoom-content"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          opacity: ready ? 1 : 0,
        }}
      >
        {children}
      </div>

      <TooltipProvider delayDuration={300}>
        <div className="notebook-ai-artifact-panzoom-controls pointer-events-none absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-[8px] bg-background/95 p-0.5 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 cursor-pointer rounded-[7px] text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                aria-label="缩小"
                disabled={atMinZoom}
                onClick={() => zoomByStep(-1)}
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>缩小</TooltipContent>
          </Tooltip>

          <span className="pointer-events-none min-w-[40px] select-none text-center text-[11px] tabular-nums text-muted-foreground">
            {percent}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 cursor-pointer rounded-[7px] text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                aria-label="放大"
                disabled={atMaxZoom}
                onClick={() => zoomByStep(1)}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>放大后可拖动/滚轮平移</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="pointer-events-auto h-7 w-7 cursor-pointer rounded-[7px] text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)]"
                aria-label="适配窗口"
                disabled={atMinZoom}
                onClick={() => fitToViewport()}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>适配窗口</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
