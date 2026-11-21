import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReadingImage, ReadingImageViewer } from "./ReadingImageViewer";
import { renderedVisualKind, snapshotRenderedVisual } from "./renderedVisualSnapshot";
import { focusReadingVisualFallback, readingVisualTriggerFor, readingVisualTriggers, VisualTrigger } from "./readingVisualTriggers";

type Props = { active: boolean; documentId: string; content: string; children: React.ReactNode };

/** Delegates passive document visuals after rendering; never enters an editing surface. */
export function ReadingImageBoundary({ active, documentId, content, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Set<VisualTrigger>());
  const [image, setImage] = useState<ReadingImage | null>(null);
  const [failure, setFailure] = useState(false);
  useLayoutEffect(() => { setImage(null); setFailure(false); }, [active, documentId, content]);
  useEffect(() => {
    if (!active || !root.current) return;
    const originals = new Map<HTMLElement | SVGElement, (string | null)[]>();
    const attributes = ["tabindex", "role", "aria-label", "aria-haspopup", "data-reading-visual"];
    const restore = (element: HTMLElement | SVGElement, values: (string | null)[]) => attributes.forEach((name, index) => {
      if (values[index] === null) element.removeAttribute(name);
      else element.setAttribute(name, values[index]!);
    });
    const decorate = () => {
      const write = root.current?.querySelector("#write");
      const next = new Set(write ? readingVisualTriggers(write) : []);
      triggers.current = next;
      originals.forEach((values, element) => {
        if (!next.has(element)) {
          restore(element, values); originals.delete(element);
        }
      });
      next.forEach((element) => {
        if (originals.has(element)) return;
        // A renderer can clone/replace a decorated root. Its copied affordances
        // belong to this boundary, not to the new renderer's original markup.
        const copiedDecoration = element.getAttribute("data-reading-visual") === "true";
        originals.set(element, attributes.map((name) => copiedDecoration ? null : element.getAttribute(name)));
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        const label = element instanceof HTMLImageElement ? element.alt || "图片" : renderedVisualKind(element) === "math" ? "数学公式" : "Mermaid 图表";
        element.setAttribute("aria-label", `查看大图：${label}`);
        element.setAttribute("aria-haspopup", "dialog");
        element.setAttribute("data-reading-visual", "true");
      });
    };
    decorate();
    const observer = new MutationObserver((records) => {
      decorate();
      setImage((current) => {
        if (!current) return current;
        if (!triggers.current.has(current.trigger)) return null;
        // Renderer output may change without changing Markdown/document identity.
        // Viewer layout mutations live outside the source trigger and are ignored.
        return records.some((record) => record.target === current.trigger || current.trigger.contains(record.target)) ? null : current;
      });
    });
    observer.observe(root.current, { childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ["class", "style", "data-processed", "data-mjx-error", "width", "height", "viewBox", "src", "href", "d"] });
    return () => {
      observer.disconnect();
      triggers.current.clear();
      originals.forEach((values, element) => restore(element, values));
    };
  }, [active, documentId]);
  const open = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!active || !(event.target instanceof Element)) return;
    const trigger = readingVisualTriggerFor(event.target, triggers.current);
    if (!trigger || !root.current?.querySelector("#write")?.contains(trigger)) return;
    if (event.target.closest("mjx-assistive-mml, .MathJax_Menu")) return;
    event.preventDefault();
    event.stopPropagation();
    setFailure(false);
    const focusFallback = () => focusReadingVisualFallback(root.current?.querySelector<HTMLElement>("#write") || null, triggers.current);
    // Reuse the already resolved source as an img URL, never as markup or navigation.
    if (trigger instanceof HTMLImageElement) {
      if (trigger.currentSrc || trigger.src) setImage({ src: trigger.currentSrc || trigger.src, alt: trigger.alt, trigger, focusFallback });
    } else {
      let rendered = null;
      try { rendered = snapshotRenderedVisual(trigger); } catch { /* A failed snapshot must never trap the user in a modal. */ }
      if (rendered) setImage({ src: "", alt: rendered.kind === "math" ? "数学公式" : "Mermaid 图表", trigger, rendered, focusFallback });
      else setFailure(true);
    }
  };
  return <div ref={root} className={active ? "ty-reading-images" : undefined} style={{ display: "contents" }}
    onClickCapture={open}
    onKeyDownCapture={(event) => { if (event.key === "Enter" || event.key === " ") open(event); }}>
    {children}
    {active && failure && <p role="status" className="ty-reading-visual-feedback">此图形暂时无法打开，请等待重新渲染后重试。</p>}
    {active && image && <ReadingImageViewer key={image.src} image={image} onClose={() => setImage(null)} />}
  </div>;
}
