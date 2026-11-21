import { useLayoutEffect, useRef, useState } from "react";
import { Expand, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import "../styles/reading-images.css";
import { ReadingVisual } from "./renderedVisualSnapshot";
import { RenderedVisualCanvas } from "./RenderedVisualCanvas";
import { visualScaleBounds } from "./renderedVisualPolicy";

export type ReadingImage = ReadingVisual;

type Props = { image: ReadingImage; onClose: () => void };

/** Uses the browser modal primitive for focus containment and background inertness. */
export function ReadingImageViewer({ image, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: image.rendered?.width || 0, height: image.rendered?.height || 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);
  const limits = visualScaleBounds(size.width, size.height, bounds, image.rendered?.kind ?? "image");
  const scale = zoom ?? limits.fit;

  useLayoutEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    const initialBounds = stage.current!.getBoundingClientRect();
    setBounds({ width: Math.max(1, initialBounds.width - 32), height: Math.max(1, initialBounds.height - 32) });
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: Math.max(1, entry.contentRect.width - 32), height: Math.max(1, entry.contentRect.height - 32) });
    });
    observer.observe(stage.current!);
    return () => {
      observer.disconnect();
      element.close();
      document.body.style.overflow = overflow;
      document.documentElement.style.overflow = rootOverflow;
      if (image.trigger.isConnected && image.trigger.getAttribute("data-reading-visual") === "true") image.trigger.focus({ preventScroll: true });
      else if (image.focusFallback) image.focusFallback();
      else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [image]);

  const changeZoom = (factor: number) => setZoom(Math.min(limits.max, Math.max(limits.min, scale * factor)));
  return (
    <dialog ref={dialog} className="ty-image-viewer" aria-label="图片查看器"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ty-image-viewer-panel">
        <div className="ty-image-viewer-toolbar" role="toolbar" aria-label="图片缩放">
          <span className="ty-image-viewer-name" title={image.alt}>{image.alt || "图片"}</span>
          <output aria-live="polite">{Math.round(scale * 100)}%</output>
          <button type="button" aria-label="缩小图片" title="缩小" disabled={failed || scale <= limits.min} onClick={() => changeZoom(1 / 1.25)}><ZoomOut size={18} /></button>
          <button type="button" aria-label="放大图片" title="放大" disabled={failed || scale >= limits.max} onClick={() => changeZoom(1.25)}><ZoomIn size={18} /></button>
          <button type="button" aria-label="图片原始大小" title="原始大小" disabled={failed} onClick={() => setZoom(1)}><Expand size={18} /></button>
          <button type="button" aria-label="图片适应窗口" title="适应窗口" disabled={failed} onClick={() => setZoom(null)}><RotateCcw size={18} /></button>
          <button type="button" autoFocus aria-label="关闭图片查看器" title="关闭 (Esc)" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="ty-image-viewer-stage" ref={stage} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          {failed ? <p role="alert">图片加载失败，请关闭后重试。</p> : <div className="ty-image-viewer-canvas">
            {image.rendered ? <RenderedVisualCanvas visual={image.rendered} scale={scale} /> : <img src={image.src} alt={image.alt} draggable={false}
              onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
              style={size.width ? { width: size.width * scale, height: size.height * scale } : undefined} />}
          </div>}
        </div>
      </div>
    </dialog>
  );
}
