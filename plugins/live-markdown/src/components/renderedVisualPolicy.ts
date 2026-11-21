/** Passive drawing vocabulary. Unknown HTML and active SVG are never copied. */
const HTML_TAGS = new Set("span div p br b i strong em sub sup small label".split(" "));
const SVG_TAGS = new Set("svg g defs path rect circle ellipse line polyline polygon text tspan textPath marker clipPath mask pattern linearGradient radialGradient stop symbol use foreignObject title desc".toLowerCase().split(" "));
export function passiveVisualTag(tag: string, svg: boolean): boolean {
  const name = tag.toLowerCase();
  return svg ? SVG_TAGS.has(name) : HTML_TAGS.has(name) || /^mjx-(?!assistive|merror)[a-z0-9-]+$/.test(name);
}

/** Only references inside this one snapshot may survive. */
export function localVisualReference(value: string, ids: ReadonlyMap<string, string>): string | null {
  if (!/url\s*\(/i.test(value)) return value;
  let valid = true;
  const rewritten = value.replace(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi, (_match, ref: string) => {
    const id = ref.startsWith("#") ? ids.get(ref.slice(1)) : undefined;
    if (!id) { valid = false; return "none"; }
    return `url(#${id})`;
  });
  return valid && !/url\s*\((?!#[^)]+\))/i.test(rewritten) ? rewritten : null;
}

export type VisualKind = "image" | "math" | "diagram";

/** Limits scaled CSS pixels, independently of an SVG's coordinate system. */
export function visualScaleBounds(width: number, height: number, bounds: { width: number; height: number }, kind: VisualKind) {
  if (!width || !height) return { fit: 1, min: 0.1, max: 8 };
  const safeMax = Math.min(32768 / width, 32768 / height, Math.sqrt(120_000_000 / (width * height)));
  const stageFit = Math.min(bounds.width / width, bounds.height / height);
  const fit = Math.min(kind === "diagram" ? safeMax : kind === "math" ? Math.min(2.5, safeMax) : 1, stageFit);
  const max = kind === "image" ? 8 : Math.min(safeMax, kind === "diagram" ? Math.max(8, fit * 8) : 8);
  return { fit, min: Math.min(0.1, fit), max };
}

export function boundedVisualSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= 120_000_000;
}
