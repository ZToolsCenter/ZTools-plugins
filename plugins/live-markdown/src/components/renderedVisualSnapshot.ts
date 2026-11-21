import { boundedVisualSize, localVisualReference, passiveVisualTag } from "./renderedVisualPolicy";

export type RenderedVisual = { kind: "math" | "diagram"; node: Element; width: number; height: number; background: string };
export type ReadingVisual = { src: string; alt: string; trigger: HTMLElement | SVGElement; rendered?: RenderedVisual; focusFallback?: () => void };
export const RENDERED_VISUAL_SELECTOR = ".ty-math-block-render, .ty-math-inline-render, mjx-container, .ty-diagram-block svg, .ty-mermaid-block svg, .mermaid svg";
const SVG_NS = "http://www.w3.org/2000/svg";
const SKIP = "mjx-assistive-mml, mjx-merror, [data-mjx-error], .MathJax_Menu, .MathJax_Error, .error-icon, .error-text";
const ERROR = "mjx-merror, [data-mjx-error], .MathJax_Error, .error-icon, .error-text";
const STYLE_PROPERTIES = (`color background-color display visibility opacity box-sizing position vertical-align
  font-family font-size font-style font-weight font-variant font-feature-settings line-height letter-spacing white-space
  text-align text-decoration text-transform text-indent word-spacing direction writing-mode
  width height min-width min-height max-width max-height top left right bottom
  margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
  border-top border-right border-bottom border-left border-radius
  align-items align-self justify-content flex-direction flex-wrap flex-grow flex-shrink gap row-gap column-gap
  transform transform-origin fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap
  stroke-linejoin stroke-miterlimit paint-order text-anchor dominant-baseline alignment-baseline
  marker-start marker-mid marker-end clip-path mask overflow`).split(/\s+/);
const ATTRIBUTES = new Set((`id class viewBox preserveAspectRatio d x y x1 y1 x2 y2 dx dy width height rx ry r cx cy
  points transform fill fill-rule fill-opacity stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin
  marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient
  clip-path clipPathUnits mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform
  gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod pathLength
  text-anchor dominant-baseline alignment-baseline lengthAdjust textLength font-size font-family font-style font-weight
  opacity visibility color role aria-label aria-hidden`).toLowerCase().split(/\s+/));
let snapshotSequence = 0;

export function renderedVisualKind(element: Element): "math" | "diagram" | null {
  if (element.matches("mjx-container, .ty-math-block-render, .ty-math-inline-render")) return "math";
  return element.matches("svg") && !!element.closest(".ty-diagram-block, .ty-mermaid-block, .mermaid") ? "diagram" : null;
}

export function isRenderedVisual(element: Element): boolean {
  if (!renderedVisualKind(element) || element.matches(SKIP) || element.querySelector(ERROR)) return false;
  if (element.closest("mjx-assistive-mml")) return false;
  if (element.matches("mjx-container") && !element.querySelector("svg path, svg use, mjx-math mjx-c, mjx-math mjx-utext")) return false;
  const pending: [Node, number][] = [[element, 0]];
  let count = 0, textLength = 0;
  while (pending.length) {
    const [node, depth] = pending.pop()!;
    if (depth > 80 || ++count > 6000) return false;
    if (node.nodeType === Node.TEXT_NODE) textLength += node.textContent?.length || 0;
    if (textLength > 2_000_000) return false;
    for (const child of node.childNodes) pending.push([child, depth + 1]);
  }
  const rect = element.getBoundingClientRect();
  return boundedVisualSize(rect.width, rect.height) && (!!element.textContent?.trim() || !!element.querySelector("path, use, rect, line, circle"));
}

function copyStyle(source: Element, target: Element, ids: Map<string, string>, pseudo?: string) {
  const styles = source.ownerDocument.defaultView!.getComputedStyle(source, pseudo);
  const targetStyle = (target as HTMLElement | SVGElement).style;
  for (const property of STYLE_PROPERTIES) {
    const value = localVisualReference(styles.getPropertyValue(property), ids);
    if (value && !/expression\s*\(|javascript:/i.test(value)) targetStyle.setProperty(property, value);
  }
  targetStyle.setProperty("background-image", "none");
  targetStyle.setProperty("animation", "none");
  targetStyle.setProperty("transition", "none");
  return styles;
}

/** Reconstructs passive nodes, rather than executing copied HTML or SVG strings. */
export function snapshotRenderedVisual(source: Element): RenderedVisual | null {
  if (!isRenderedVisual(source)) return null;
  if (source.querySelectorAll("*").length > 6000 || (source.textContent?.length || 0) > 2_000_000) return null;
  const document = source.ownerDocument;
  const kind = renderedVisualKind(source)!;
  const prefix = `reading-visual-${++snapshotSequence}-`;
  const ids = new Map<string, string>();
  const dependencies: Element[] = [];
  let visited = 0;
  const visitReferences = (element: Element, depth = 0) => {
    if (depth > 80) throw new Error("Rendered visual reference depth exceeds preview limits");
    for (const item of [element, ...element.querySelectorAll("*")]) {
      if (++visited > 12000) throw new Error("Rendered visual references exceed preview limits");
      if (item.id && !ids.has(item.id)) ids.set(item.id, `${prefix}${ids.size}`);
      for (const attr of item.attributes) {
        const references = attr.value.matchAll(/(?:url\(["']?|^)(#[\w:.-]+)/g);
        for (const [, reference] of references) {
          const id = reference.slice(1);
          if (ids.has(id)) continue;
          const dependency = document.getElementById(id);
          if (dependency?.namespaceURI !== SVG_NS || !passiveVisualTag(dependency.localName, true)) continue;
          ids.set(id, `${prefix}${ids.size}`);
          if (!source.contains(dependency) && !dependencies.includes(dependency)) {
            dependencies.push(dependency);
            visitReferences(dependency, depth + 1);
          }
        }
      }
    }
  };
  try { visitReferences(source); } catch { return null; }
  let copied = 0;
  const clone = (element: Element, depth = 0, referenceDefinition = false): Element | null => {
    if (++copied > 6000 || depth > 80) throw new Error("Rendered visual exceeds preview limits");
    const svg = element.namespaceURI === SVG_NS;
    const anchor = element.localName === "a";
    if ((!anchor && !passiveVisualTag(element.localName, svg)) || element.matches(SKIP)) return null;
    const tag = anchor ? (svg ? "g" : "span") : element.localName === "mjx-c" ? "span" : element.localName;
    const copy = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "id") { copy.id = ids.get(attribute.value)!; continue; }
      // The computed snapshot owns presentation; arbitrary source classes must not
      // reintroduce background URLs, animations or pseudo content in the preview.
      if (name === "class") {
        const classes = attribute.value.split(/\s+/).filter((value) => /^ty-(?:math|mermaid)[\w-]*$/.test(value));
        if (classes.length) copy.setAttribute("class", classes.join(" "));
        continue;
      }
      if (name === "href" || name === "xlink:href") {
        const id = attribute.value.startsWith("#") ? ids.get(attribute.value.slice(1)) : undefined;
        if (element.localName === "use" && id) copy.setAttribute("href", `#${id}`);
        continue;
      }
      if (!ATTRIBUTES.has(name)) continue;
      const value = localVisualReference(attribute.value, ids);
      if (value !== null) copy.setAttribute(attribute.name, value);
    }
    copyStyle(element, copy, ids);
    if (referenceDefinition) {
      // A globally cached MathJax glyph inherits color/stroke from <use> at its
      // actual location, not from the invisible cache's DOM ancestors.
      for (const property of ["color", "fill", "stroke", "stroke-width"]) {
        const specified = (element as SVGElement).style.getPropertyValue(property) || element.getAttribute(property);
        const value = specified ? localVisualReference(specified, ids) : null;
        if (value !== null) (copy as SVGElement).style.setProperty(property, value);
        else (copy as SVGElement).style.removeProperty(property);
      }
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) copy.append(document.createTextNode(child.textContent || ""));
      else if (child instanceof Element) { const next = clone(child, depth + 1, referenceDefinition); if (next) copy.append(next); }
    }
    // MathJax CHTML puts its font glyphs in ::before; preserve those as passive text.
    if (!svg && element.localName === "mjx-c") {
      const pseudo = document.defaultView!.getComputedStyle(element, "::before");
      if (pseudo.content && !["none", "normal", '""'].includes(pseudo.content)) {
        const glyph = document.createElement("span");
        try { glyph.textContent = JSON.parse(pseudo.content); } catch { glyph.textContent = pseudo.content.replace(/^["']|["']$/g, ""); }
        copyStyle(element, glyph, ids, "::before");
        copy.prepend(glyph);
        copy.classList.remove(...copy.classList);
      }
    }
    copy.removeAttribute("tabindex");
    copy.removeAttribute("role");
    return copy;
  };
  let node: Element | null;
  try { node = clone(source); } catch { return null; }
  if (!node) return null;
  const svg = node.matches("svg") ? node : node.querySelector("svg");
  if (svg && dependencies.length) {
    const defs = document.createElementNS(SVG_NS, "defs");
    try { for (const dependency of dependencies) { const copy = clone(dependency, 0, true); if (copy) defs.append(copy); } } catch { return null; }
    svg.prepend(defs);
  }
  const rect = source.getBoundingClientRect();
  // viewBox defines vector coordinates, which may use arbitrary units/origins.
  // Zoom percentages and layout budgets always refer to actual displayed CSS pixels.
  const { width, height } = rect;
  if (!boundedVisualSize(width, height)) return null;
  Object.assign((node as HTMLElement | SVGElement).style, { width: `${width}px`, height: `${height}px`, minWidth: "0", maxWidth: "none", maxHeight: "none", margin: "0", overflow: "visible" });
  let background = "transparent";
  for (let parent: Element | null = source; parent; parent = parent.parentElement) {
    const color = document.defaultView!.getComputedStyle(parent).backgroundColor;
    if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") { background = color; break; }
  }
  return { kind, node, width, height, background };
}
