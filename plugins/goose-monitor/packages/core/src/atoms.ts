/* UI 原子：AppIcon / Meter / Kbd —— 内联 style 像素级复刻设计稿 shared.jsx。 */
import type { AppRow } from "./types";
import { fuzzyMatchRanges } from "./shared";
import { icon } from "./icons";

export type AppIconKind = "real" | "system" | "application";

/** 真实图标优先；缺失时将系统来源与普通应用明确区分。 */
export function appIconKind(app: AppRow): AppIconKind {
  if (app.iconUrl) return "real";
  return app.systemOwned || app.sys ? "system" : "application";
}

/** 应用图标：优先真实图标，否则使用统一的系统/通用应用 SVG。 */
export function appIcon(app: AppRow, size = 28, radius?: number): HTMLElement {
  const r = radius != null ? radius : Math.round(size * 0.26);
  const el = document.createElement("span");
  el.className = "pk-app-icon";
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${r}px`,
    flex: "none",
    display: "grid",
    placeItems: "center",
    userSelect: "none",
    overflow: "hidden",
  } as Partial<CSSStyleDeclaration>);

  const kind = appIconKind(app);
  el.setAttribute("data-icon-kind", kind);
  if (kind === "real") {
    const img = document.createElement("img");
    img.src = app.iconUrl!;
    img.alt = app.name;
    Object.assign(img.style, {
      width: "100%", height: "100%", objectFit: "cover", display: "block",
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(img);
    return el;
  }

  const isSystem = kind === "system";
  Object.assign(el.style, {
    background: "var(--app-icon-bg)",
    border: "1px solid var(--app-icon-border)",
    color: "var(--app-icon-fg)",
  } as Partial<CSSStyleDeclaration>);
  el.title = isSystem ? "系统应用或进程" : "应用或进程";
  el.setAttribute("aria-hidden", "true");
  el.appendChild(icon(isSystem ? "settings" : "app-window", Math.max(12, Math.round(size * 0.62))));
  return el;
}

/** 水平 meter 条。 */
export function meter(
  value: number,
  max = 100,
  color = "var(--accent)",
  height = 4,
  width: string | number = "100%",
): HTMLElement {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  const track = document.createElement("span");
  Object.assign(track.style, {
    display: "block",
    width: typeof width === "number" ? `${width}px` : width,
    height: `${height}px`,
    borderRadius: "999px",
    background: "var(--bg-track)",
    overflow: "hidden",
  } as Partial<CSSStyleDeclaration>);
  const fill = document.createElement("span");
  fill.className = "meter-fill";
  Object.assign(fill.style, {
    display: "block",
    width: pct + "%",
    height: "100%",
    borderRadius: "999px",
    background: color,
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(fill);
  return track;
}

/** 匹配词高亮：把 text 里命中 query 的子串用品牌色高亮，返回可直接 append 的节点片段。
   复刻设计稿 v7 的 <Hl>：命中段 accent 色 + 700 字重 + bg-row-sel 底 + 3px 圆角。
   query 为空或不命中时，返回纯文本节点。大小写不敏感；支持非连续模糊高亮。 */
export function highlight(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const q = (query || "").trim();
  if (!q) { frag.appendChild(document.createTextNode(text)); return frag; }
  const ranges = fuzzyMatchRanges(text, q);
  if (ranges.length === 0) { frag.appendChild(document.createTextNode(text)); return frag; }
  let from = 0;
  for (const [start, end] of ranges) {
    if (start > from) frag.appendChild(document.createTextNode(text.slice(from, start)));
    const mark = document.createElement("span");
    Object.assign(mark.style, {
      color: "var(--accent)", fontWeight: "700",
      background: "var(--bg-row-sel)", borderRadius: "3px", padding: "0 1px",
    } as Partial<CSSStyleDeclaration>);
    mark.textContent = text.slice(start, end);
    frag.appendChild(mark);
    from = end;
  }
  if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
  return frag;
}

/** 键帽。 */
export function kbd(text: string, wide = false, className?: string): HTMLElement {
  const el = document.createElement("span");
  if (className) el.className = className;
  Object.assign(el.style, {
    display: "inline-grid",
    placeItems: "center",
    minWidth: wide ? "30px" : "18px",
    height: "18px",
    padding: "0 5px",
    borderRadius: "5px",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-2)",
    boxShadow: "0 1px 0 var(--border-strong)",
    font: "var(--t-mono-sm)",
    color: "var(--fg-2)",
  } as Partial<CSSStyleDeclaration>);
  el.textContent = text;
  return el;
}
/** 回车键帽（Lucide corner-down-left），替代 ⏎ 字符。 */
export function enterKey(wide = false, className?: string): HTMLElement {
  const el = document.createElement("span");
  if (className) el.className = className;
  Object.assign(el.style, {
    display: "inline-grid",
    placeItems: "center",
    minWidth: wide ? "30px" : "18px",
    height: "18px",
    padding: "0 4px",
    borderRadius: "5px",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-2)",
    boxShadow: "0 1px 0 var(--border-strong)",
    color: "var(--fg-2)",
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(icon("corner-down-left", 12));
  return el;
}
/** 修饰键 + 回车图标（如 ⌘↵）。 */
export function enterKeyMod(modLabel: string): HTMLElement {
  const el = document.createElement("span");
  Object.assign(el.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    minWidth: "30px",
    height: "18px",
    padding: "0 5px",
    borderRadius: "5px",
    background: "var(--bg-elev)",
    border: "1px solid var(--border-2)",
    boxShadow: "0 1px 0 var(--border-strong)",
    font: "var(--t-mono-sm)",
    color: "var(--fg-2)",
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(document.createTextNode(modLabel));
  el.appendChild(icon("corner-down-left", 11));
  return el;
}

/** 小工具：设置多个内联样式。 */
export function css(el: HTMLElement, s: Partial<CSSStyleDeclaration>): HTMLElement {
  Object.assign(el.style, s);
  return el;
}

/** 创建元素 + class + style 的便捷函数。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: {
    className?: string;
    style?: Partial<CSSStyleDeclaration>;
    text?: string;
    children?: (HTMLElement | Node | null)[];
    on?: Partial<Record<keyof HTMLElementEventMap, (e: any) => void>>;
    attrs?: Record<string, string>;
  } = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.style) Object.assign(el.style, opts.style);
  if (opts.text != null) el.textContent = opts.text;
  if (opts.attrs) for (const k in opts.attrs) el.setAttribute(k, opts.attrs[k]);
  if (opts.on)
    for (const k in opts.on) el.addEventListener(k, (opts.on as any)[k]);
  if (opts.children)
    for (const c of opts.children) if (c) el.appendChild(c);
  return el;
}
