/**
 * 将 SVG 标记或预览 DOM 安全栅格化为 PNG。
 *
 * 不走「SVG → <img> → canvas.drawImage」：Mermaid 等含 foreignObject 的 SVG
 * 会污染 canvas（tainted canvas），toBlob 直接失败。
 * 统一用离屏 DOM + html-to-image 截图。
 *
 * 分辨率策略：按内容固有尺寸导出，长边目标 4K（3840）冗余，
 * 小图至少 2×，并受画布边长 / 总像素上限约束。
 */

/** 导出长边目标像素（4K 冗余） */
export const EXPORT_TARGET_LONG_EDGE = 3840;
/** 内容清晰度下限倍率（视网膜） */
export const EXPORT_MIN_PIXEL_RATIO = 2;
/** SVG/矢量栅格允许的更高倍率（页面长截图仍走 renderer 的 3×） */
export const EXPORT_MAX_PIXEL_RATIO = 8;

const MAX_CAPTURE_EDGE = 16_384;
const MAX_CAPTURE_PIXELS = 16_000_000;
const MIN_CAPTURE_PIXEL_RATIO = 0.1;

export type ContentAwarePixelRatioOptions = {
  /** 长边目标像素，默认 3840（4K） */
  targetLongEdge?: number;
  /** 最低倍率，默认 2 */
  minRatio?: number;
  /** 最高倍率，默认 8 */
  maxRatio?: number;
};

function isCaptureRatioWithinLimits(
  width: number,
  height: number,
  ratio: number,
): boolean {
  if (ratio < MIN_CAPTURE_PIXEL_RATIO) return false;
  const outputWidth = Math.ceil(width * ratio);
  const outputHeight = Math.ceil(height * ratio);
  return (
    outputWidth <= MAX_CAPTURE_EDGE &&
    outputHeight <= MAX_CAPTURE_EDGE &&
    outputWidth * outputHeight <= MAX_CAPTURE_PIXELS
  );
}

/**
 * 按内容宽高计算导出 pixelRatio：
 * - 优先把长边推到 4K（3840）冗余
 * - 小内容至少 2×，避免糊
 * - 大内容受画布边长 / 16M 像素上限约束
 */
export function calculateContentAwarePixelRatio(
  width: number,
  height: number,
  options?: ContentAwarePixelRatioOptions,
): number {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  const longEdge = Math.max(safeWidth, safeHeight);
  const targetLongEdge = options?.targetLongEdge ?? EXPORT_TARGET_LONG_EDGE;
  const minRatio = options?.minRatio ?? EXPORT_MIN_PIXEL_RATIO;
  const maxRatio = options?.maxRatio ?? EXPORT_MAX_PIXEL_RATIO;

  const edgeRatio = Math.min(
    MAX_CAPTURE_EDGE / safeWidth,
    MAX_CAPTURE_EDGE / safeHeight,
  );
  const areaRatio = Math.sqrt(MAX_CAPTURE_PIXELS / (safeWidth * safeHeight));
  // 内容越大倍率可降，但仍尽量贴 4K 长边
  const contentRatio = targetLongEdge / longEdge;
  let ratio = Math.min(maxRatio, edgeRatio, areaRatio, Math.max(minRatio, contentRatio));

  // 若内容本身已超过 4K，仍尽量保留 minRatio（在安全范围内）
  if (longEdge >= targetLongEdge) {
    ratio = Math.min(maxRatio, edgeRatio, areaRatio, Math.max(1, minRatio));
  }

  ratio = Math.floor(ratio * 10_000) / 10_000;

  while (
    ratio >= MIN_CAPTURE_PIXEL_RATIO &&
    !isCaptureRatioWithinLimits(safeWidth, safeHeight, ratio)
  ) {
    ratio = Math.floor((ratio - 0.0001) * 10_000) / 10_000;
  }

  if (!isCaptureRatioWithinLimits(safeWidth, safeHeight, ratio)) {
    throw new Error("内容过大，无法导出为单张图片，请缩小范围后重试");
  }
  return ratio;
}

/** 失败时按更低倍率降级重试（内存/画布偶发失败） */
export function getContentAwarePixelRatios(
  width: number,
  height: number,
  options?: ContentAwarePixelRatioOptions,
): number[] {
  const primary = calculateContentAwarePixelRatio(width, height, options);
  const roundDown = (ratio: number) => Math.floor(ratio * 10_000) / 10_000;
  const candidates =
    primary > 4
      ? [primary, 4, 2, 1]
      : primary > 2
        ? [primary, 2, 1]
        : primary > 1
          ? [primary, 1]
          : [
              primary,
              Math.max(MIN_CAPTURE_PIXEL_RATIO, roundDown(primary * 0.75)),
              Math.max(MIN_CAPTURE_PIXEL_RATIO, roundDown(primary * 0.5)),
            ];

  return candidates.filter(
    (ratio, index) =>
      ratio >= MIN_CAPTURE_PIXEL_RATIO &&
      isCaptureRatioWithinLimits(width, height, ratio) &&
      candidates.findIndex((candidate) => candidate === ratio) === index,
  );
}

function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  const match = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(?:px|pt|pc|in|cm|mm|em|rem|ex|ch)?$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * 读取 SVG 内容固有尺寸（属性 → viewBox → bbox → 布局），并写回明确宽高，
 * 避免去掉 width/height 后回落到浏览器默认 300×150 导致糊图。
 */
export function ensureSvgContentSize(svgEl: SVGSVGElement): {
  width: number;
  height: number;
} {
  let width = parseSvgLength(svgEl.getAttribute("width"));
  let height = parseSvgLength(svgEl.getAttribute("height"));

  const viewBox = svgEl.viewBox?.baseVal;
  if (
    (width == null || height == null) &&
    viewBox &&
    viewBox.width > 0 &&
    viewBox.height > 0
  ) {
    width = width ?? viewBox.width;
    height = height ?? viewBox.height;
  }

  if (width == null || height == null) {
    try {
      const bbox = svgEl.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        width = width ?? bbox.width;
        height = height ?? bbox.height;
      }
    } catch {
      // 未挂载或空 SVG 时 getBBox 会抛
    }
  }

  if (width == null || height == null) {
    const rect = svgEl.getBoundingClientRect();
    width = width ?? (rect.width > 0 ? rect.width : 300);
    height = height ?? (rect.height > 0 ? rect.height : 150);
  }

  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));

  svgEl.setAttribute("width", String(safeWidth));
  svgEl.setAttribute("height", String(safeHeight));
  svgEl.style.width = `${safeWidth}px`;
  svgEl.style.height = `${safeHeight}px`;
  svgEl.style.maxWidth = "none";
  svgEl.style.maxHeight = "none";
  svgEl.style.overflow = "visible";

  return { width: safeWidth, height: safeHeight };
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then(async (response) => {
    if (!response.ok) throw new Error("图片数据读取失败");
    const blob = await response.blob();
    if (!blob.size) throw new Error("图片为空");
    return blob;
  });
}

async function toPngWithRatioFallback(
  element: HTMLElement,
  width: number,
  height: number,
  options?: {
    pixelRatio?: number;
    backgroundColor?: string;
    ratios?: number[];
  },
): Promise<string> {
  const { toPng } = await import("html-to-image");
  const ratios =
    options?.ratios ??
    (options?.pixelRatio != null
      ? [options.pixelRatio]
      : getContentAwarePixelRatios(width, height));

  let lastError: unknown;
  for (let index = 0; index < ratios.length; index += 1) {
    const pixelRatio = ratios[index];
    try {
      return await toPng(element, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: options?.backgroundColor ?? "transparent",
        skipFonts: true,
        width,
        height,
      });
    } catch (error) {
      lastError = error;
      if (index >= ratios.length - 1) break;
      console.warn(
        `[imageExport] ${pixelRatio}x capture failed, retrying at ${ratios[index + 1]}x:`,
        error,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("生成图片失败");
}

/** 将 SVG 字符串离屏挂载后截为 PNG Blob */
export async function svgMarkupToPngBlob(
  svg: string,
  options?: {
    pixelRatio?: number;
    padding?: number;
    targetLongEdge?: number;
  },
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持导出图片");
  }
  const markup = svg.trim();
  if (!markup) throw new Error("SVG 为空");

  const padding = options?.padding ?? 12;

  const host = document.createElement("div");
  host.setAttribute("data-goose-svg-export", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    "z-index:-1",
    "display:inline-block",
    `padding:${padding}px`,
    "background:transparent",
    "line-height:0",
    "pointer-events:none",
  ].join(";");
  host.innerHTML = markup;

  const svgEl = host.querySelector("svg");
  let contentWidth = 300;
  let contentHeight = 150;
  if (svgEl instanceof SVGSVGElement) {
    const size = ensureSvgContentSize(svgEl);
    contentWidth = size.width;
    contentHeight = size.height;
  }

  const exportWidth = contentWidth + padding * 2;
  const exportHeight = contentHeight + padding * 2;
  host.style.width = `${exportWidth}px`;
  host.style.height = `${exportHeight}px`;
  host.style.boxSizing = "border-box";

  document.body.appendChild(host);
  try {
    await document.fonts.ready.catch(() => undefined);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    const dataUrl = await toPngWithRatioFallback(
      host,
      exportWidth,
      exportHeight,
      {
        pixelRatio: options?.pixelRatio,
        backgroundColor: "transparent",
        ratios:
          options?.pixelRatio != null
            ? undefined
            : getContentAwarePixelRatios(exportWidth, exportHeight, {
                targetLongEdge: options?.targetLongEdge,
              }),
      },
    );
    return dataUrlToBlob(dataUrl);
  } finally {
    document.body.removeChild(host);
  }
}

/** 截取页面上已有预览节点为 PNG（Math 等） */
export async function captureElementAsPngBlob(
  element: HTMLElement,
  options?: {
    pixelRatio?: number;
    backgroundColor?: string;
    targetLongEdge?: number;
  },
): Promise<Blob> {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(element.scrollWidth || rect.width || 1));
  const height = Math.max(
    1,
    Math.ceil(element.scrollHeight || rect.height || 1),
  );

  const dataUrl = await toPngWithRatioFallback(element, width, height, {
    pixelRatio: options?.pixelRatio,
    backgroundColor: options?.backgroundColor ?? "transparent",
    ratios:
      options?.pixelRatio != null
        ? undefined
        : getContentAwarePixelRatios(width, height, {
            targetLongEdge: options?.targetLongEdge,
          }),
  });
  return dataUrlToBlob(dataUrl);
}

/** data URL / blob URL / 任意可 fetch 的图片地址 → PNG Blob */
export async function imageUrlToPngBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("图片为空");
  if (blob.type === "image/png" || blob.type === "") {
    // getDataURL 可能不带 type，按内容处理
    if (blob.type === "image/png") return blob;
  }
  // 非 PNG 时尽量原样返回（ECharts 已是 PNG）；需要统一 PNG 的调用方再转
  return blob;
}
