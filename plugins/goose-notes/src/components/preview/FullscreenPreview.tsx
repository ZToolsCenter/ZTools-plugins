import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { MathView } from "@/components/editor/blocks/math/MathView";
import {
  clampPreviewZoomPercent,
  normalizeSvgIntrinsicSize,
  PREVIEW_ZOOM_STEP_PERCENT,
  toImageDataUrl,
  wrapHtmlDocument,
  type PreviewContent,
} from "@/lib/preview/previewAction";

const PREVIEW_ICON_CLASS =
  "cursor-pointer hover:bg-[var(--goose-control-hover-bg)] dark:hover:bg-[var(--goose-control-hover-bg)]";

function isZoomInKey(event: KeyboardEvent) {
  return (
    event.key === "=" ||
    event.key === "+" ||
    event.code === "Equal" ||
    event.code === "NumpadAdd"
  );
}

function isZoomOutKey(event: KeyboardEvent) {
  return event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract";
}

function isZoomResetKey(event: KeyboardEvent) {
  return event.key === "0" || event.code === "Digit0" || event.code === "Numpad0";
}

/**
 * 量固有尺寸而非渲染尺寸：SVG 走 viewBox，旧 Chromium 下 offsetWidth 会被容器压失真。
 * 公式没有 viewBox，只能退回布局盒。
 */
function measureVectorSize(node: HTMLElement): { width: number; height: number } {
  const svg = node.querySelector(".goose-preview-svg > svg");
  const viewBox = (svg as SVGSVGElement | null)?.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  return { width: node.offsetWidth, height: node.offsetHeight };
}

export function FullscreenPreview({
  open,
  content,
  title = "预览",
  onClose,
}: {
  open: boolean;
  content: PreviewContent | null;
  title?: string;
  onClose: () => void;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [vectorFit, setVectorFit] = useState<{
    width: number;
    height: number;
    scale: number;
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const vectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setZoomPercent(100);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isZoomInKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        setZoomPercent((current) =>
          clampPreviewZoomPercent(current + PREVIEW_ZOOM_STEP_PERCENT),
        );
        return;
      }
      if (isZoomOutKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        setZoomPercent((current) =>
          clampPreviewZoomPercent(current - PREVIEW_ZOOM_STEP_PERCENT),
        );
        return;
      }
      if (isZoomResetKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        setZoomPercent(100);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || content?.kind !== "image") {
      setImageSrc(null);
      return;
    }
    let cancelled = false;
    void toImageDataUrl(content.data).then((src) => {
      if (!cancelled) setImageSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [content, open]);

  const isVector = content?.kind === "svg" || content?.kind === "math";
  const vectorKey =
    content?.kind === "svg"
      ? content.markup
      : content?.kind === "math"
        ? content.source
        : "";

  useLayoutEffect(() => {
    if (!open || !isVector) {
      setVectorFit(null);
      return;
    }
    let frame = 0;
    let attempts = 0;
    const measure = () => {
      const body = bodyRef.current;
      const node = vectorRef.current;
      if (!body || !node) return;
      const size = measureVectorSize(node);
      const style = getComputedStyle(body);
      const availableWidth =
        body.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const availableHeight =
        body.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom);
      // 公式要等 katex 异步渲染完才有尺寸
      if (size.width < 8 || size.height < 8) {
        if (attempts++ < 20) frame = window.requestAnimationFrame(measure);
        return;
      }
      setVectorFit({
        width: size.width,
        height: size.height,
        // 只缩不放：小图保持固有尺寸，放大只会更糊
        scale: Math.min(
          1,
          availableWidth / size.width,
          availableHeight / size.height,
        ),
      });
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [open, isVector, vectorKey]);

  const bodyClass = useMemo(() => {
    if (!content) return "";
    if (content.kind === "image") return "is-media";
    if (content.kind === "html") return "is-html";
    if (content.kind === "math") return "is-vector is-math";
    return "is-vector";
  }, [content]);

  if (!open || !content || typeof document === "undefined") return null;

  const atMinZoom = zoomPercent <= 25;
  const atMaxZoom = zoomPercent >= 400;
  const vectorScale = (vectorFit?.scale ?? 1) * (zoomPercent / 100);

  return createPortal(
    <div
      className="goose-code-preview-lightbox"
      contentEditable={false}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="goose-code-preview-lightbox-panel">
        <div className="goose-code-preview-lightbox-header">
          <div className="goose-code-preview-lightbox-title">{title}</div>
          <div className="goose-code-preview-lightbox-zoom">
            <IconButton
              type="button"
              tone="muted"
              size="sm"
              aria-label="缩小"
              disabled={atMinZoom}
              className={PREVIEW_ICON_CLASS}
              onClick={() =>
                setZoomPercent((current) =>
                  clampPreviewZoomPercent(current - PREVIEW_ZOOM_STEP_PERCENT),
                )
              }
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
            <span className="goose-code-preview-lightbox-zoom-label">
              {zoomPercent}%
            </span>
            <IconButton
              type="button"
              tone="muted"
              size="sm"
              aria-label="放大"
              disabled={atMaxZoom}
              className={PREVIEW_ICON_CLASS}
              onClick={() =>
                setZoomPercent((current) =>
                  clampPreviewZoomPercent(current + PREVIEW_ZOOM_STEP_PERCENT),
                )
              }
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
            <IconButton
              type="button"
              tone="muted"
              size="sm"
              aria-label="重置为 100%"
              disabled={zoomPercent === 100}
              className={PREVIEW_ICON_CLASS}
              onClick={() => setZoomPercent(100)}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </IconButton>
          </div>
          <IconButton
            type="button"
            tone="muted"
            size="sm"
            aria-label="关闭预览"
            className={`goose-code-preview-lightbox-close ${PREVIEW_ICON_CLASS}`}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div
          ref={bodyRef}
          className={`goose-code-preview-lightbox-body ${bodyClass}`}
        >
          {isVector ? (
            <div
              className="goose-preview-vector-sizer"
              style={
                vectorFit
                  ? {
                      width: `${vectorFit.width * vectorScale}px`,
                      height: `${vectorFit.height * vectorScale}px`,
                    }
                  : undefined
              }
            >
              <div
                ref={vectorRef}
                className="goose-preview-vector"
                style={
                  vectorFit ? { transform: `scale(${vectorScale})` } : undefined
                }
              >
                {content.kind === "svg" ? (
                  <div
                    className="goose-preview-svg notebook-ai-artifact-svg"
                    style={
                      content.background
                        ? { background: content.background }
                        : undefined
                    }
                    // SVG comes from local mermaid/export sanitizers, not raw model HTML.
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: normalizeSvgIntrinsicSize(content.markup),
                    }}
                  />
                ) : null}
                {content.kind === "math" ? (
                  <MathView value={content.source} displayMode={true} />
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className="goose-preview-zoom-surface"
              style={{ zoom: zoomPercent / 100 }}
            >
              {content.kind === "image" ? (
                imageSrc ? <img src={imageSrc} alt={title} /> : null
              ) : null}
              {content.kind === "html" ? (
                <iframe
                  className="goose-preview-html"
                  title={title}
                  sandbox="allow-scripts"
                  srcDoc={wrapHtmlDocument(content.html)}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function FullscreenImagePreview({
  open,
  src,
  title,
  onClose,
}: {
  open: boolean;
  src: string | null;
  title?: string;
  onClose: () => void;
}) {
  return (
    <FullscreenPreview
      open={open}
      content={src ? { kind: "image", data: src } : null}
      title={title}
      onClose={onClose}
    />
  );
}
