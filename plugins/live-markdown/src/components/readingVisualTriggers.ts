import { isRenderedVisual, RENDERED_VISUAL_SELECTOR } from "./renderedVisualSnapshot";

export type VisualTrigger = HTMLElement | SVGElement;

/** One interaction entry for each top-level drawing, regardless of label contents. */
export function readingVisualTriggers(write: Element): VisualTrigger[] {
  const rendered = [...write.querySelectorAll<VisualTrigger>(RENDERED_VISUAL_SELECTOR)].filter(isRenderedVisual);
  const roots = rendered.filter((element) => !rendered.some((other) => other !== element && other.contains(element)));
  const images = [...write.querySelectorAll<HTMLImageElement>("img")].filter((image) =>
    !image.closest("mjx-assistive-mml") && !roots.some((element) => element.contains(image)));
  return [...roots, ...images];
}

export function readingVisualTriggerFor(target: Element, triggers: ReadonlySet<VisualTrigger>): VisualTrigger | null {
  for (let current: Element | null = target; current; current = current.parentElement) {
    if (triggers.has(current as VisualTrigger)) return current as VisualTrigger;
  }
  return null;
}

export function focusReadingVisualFallback(write: HTMLElement | null, triggers: ReadonlySet<VisualTrigger>) {
  const connected = [...triggers].find((element) => element.isConnected && write?.contains(element));
  if (connected) { connected.focus({ preventScroll: true }); return; }
  if (!write?.isConnected) return;
  const original = write.getAttribute("tabindex");
  write.tabIndex = -1;
  write.focus({ preventScroll: true });
  if (original === null) write.removeAttribute("tabindex");
  else write.setAttribute("tabindex", original);
}
