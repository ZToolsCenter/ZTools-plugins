import type { Page } from "@/types";
import {
  extractPlainText,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { toCanvas } from "html-to-image";
import type { CardThemeId } from "./themes";
import { getCardTheme } from "./themes";
import type { WatermarkConfig } from "./watermark";
import { normalizeWatermarkConfig } from "./watermark";
import { buildStyledHTML, renderBlocks } from "./domSerializer";
import { resolveImageUrls } from "./remoteImageResolver";
import { renderMermaidBlocksAsImages } from "./mermaid";
import { renderMathBlocksAsImages } from "./math";
import { toast } from "@/components/ui/sonner";
import { cloneExportBlocks } from "@/lib/export/prepareExportBlocks";

const MAX_CAPTURE_PIXEL_RATIO = 3;
const MIN_CAPTURE_PIXEL_RATIO = 0.1;
const MAX_CAPTURE_EDGE = 16_384;
const MAX_CAPTURE_PIXELS = 16_000_000;
const CAPTURE_TIMEOUT_MS = 60_000;
const SAVE_TIMEOUT_MS = 30_000;

let isCapturingImage = false;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

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
 * 按画布边长 / 总像素上限计算可用的 pixelRatio。
 * 理论比值经 floor 到 4 位后，两端 Math.ceil 仍可能略超上限，
 * 因此会继续下调直到落在安全范围内，而不是直接抛「尺寸超出」。
 */
export function calculateSafePixelRatio(width: number, height: number): number {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  const edgeRatio = Math.min(
    MAX_CAPTURE_EDGE / safeWidth,
    MAX_CAPTURE_EDGE / safeHeight,
  );
  const areaRatio = Math.sqrt(MAX_CAPTURE_PIXELS / (safeWidth * safeHeight));
  let ratio = Math.min(MAX_CAPTURE_PIXEL_RATIO, edgeRatio, areaRatio);

  // 向下保留四位，避免浮点取整后重新越过安全像素上限。
  ratio = Math.floor(ratio * 10_000) / 10_000;

  // floor 后两端 ceil 仍可能把总像素顶破上限，逐级下调 0.0001。
  while (
    ratio >= MIN_CAPTURE_PIXEL_RATIO &&
    !isCaptureRatioWithinLimits(safeWidth, safeHeight, ratio)
  ) {
    ratio = Math.floor((ratio - 0.0001) * 10_000) / 10_000;
  }

  if (!isCaptureRatioWithinLimits(safeWidth, safeHeight, ratio)) {
    throw new Error("内容过长，无法导出为单张图片，请缩小内容范围后重试");
  }
  return ratio;
}

/**
 * uTools 的 Chromium 运行时连续创建大画布时可能暂时无法分配足够内存。
 * 首次使用安全上限倍率；失败后逐级降到 2x、1x，避免一次偶发的画布失败
 * 直接中断整个导出流程。
 */
export function getCapturePixelRatios(width: number, height: number): number[] {
  const primaryRatio = calculateSafePixelRatio(width, height);
  const roundDown = (ratio: number) => Math.floor(ratio * 10_000) / 10_000;
  const candidates =
    primaryRatio > 2
      ? [primaryRatio, 2, 1]
      : primaryRatio > 1
        ? [primaryRatio, 1]
        : [
            primaryRatio,
            Math.max(MIN_CAPTURE_PIXEL_RATIO, roundDown(primaryRatio * 0.75)),
            Math.max(MIN_CAPTURE_PIXEL_RATIO, roundDown(primaryRatio * 0.5)),
          ];

  return candidates.filter(
    (ratio, index) =>
      ratio >= MIN_CAPTURE_PIXEL_RATIO &&
      candidates.findIndex((candidate) => candidate === ratio) === index,
  );
}

function getElementCapturePixelRatios(element: HTMLElement): number[] {
  const rect = element.getBoundingClientRect();
  const width = element.scrollWidth || rect.width;
  const height = element.scrollHeight || rect.height;
  return getCapturePixelRatios(width, height);
}

function normalizeTitleText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * 选区包含页面 H1 时，“显示标题”已经会在卡片头部渲染同一标题，
 * 因此跳过选区里的重复 H1；普通章节标题仍按原样保留。
 */
export function getSelectionBlocksToRender(
  selectionBlocks: BlockNoteContent,
  pageTitle: string,
  showTitle: boolean,
): BlockNoteContent {
  if (!showTitle || selectionBlocks.length === 0) return selectionBlocks;

  const firstBlock = selectionBlocks[0] as any;
  const headingLevel = Number(firstBlock?.props?.level) || 1;
  if (firstBlock?.type !== "heading" || headingLevel !== 1) {
    return selectionBlocks;
  }

  const selectedTitle = normalizeTitleText(extractPlainText([firstBlock]));
  const generatedTitle = normalizeTitleText(pageTitle);
  return selectedTitle && selectedTitle === generatedTitle
    ? selectionBlocks.slice(1)
    : selectionBlocks;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("图片编码失败"));
        }
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

async function yieldForCanvasCleanup(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function renderPngBlobWithFallback(element: HTMLElement): Promise<Blob> {
  const pixelRatios = getElementCapturePixelRatios(element);
  let lastError: unknown;

  for (let index = 0; index < pixelRatios.length; index += 1) {
    const pixelRatio = pixelRatios[index];
    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await withTimeout(
        toCanvas(element, {
          pixelRatio,
          cacheBust: false,
          skipFonts: true,
          imagePlaceholder:
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">' +
                '<rect width="200" height="80" rx="6" fill="#f3f4f6"/>' +
                '<text x="100" y="44" font-family="sans-serif" font-size="13" fill="#9ca3af" text-anchor="middle">图片加载失败</text>' +
                "</svg>",
            ),
        }),
        CAPTURE_TIMEOUT_MS,
        "生成图片超时",
      );

      return await withTimeout(
        canvasToPngBlob(canvas),
        CAPTURE_TIMEOUT_MS,
        "图片编码超时",
      );
    } catch (error) {
      lastError = error;
      releaseCanvas(canvas);
      canvas = null;
      const hasFallback = index < pixelRatios.length - 1;
      const timedOut =
        error instanceof Error && /timeout|超时/i.test(error.message);
      // html-to-image 没有取消接口；超时任务可能仍在后台运行，此时再起一次
      // 捕获只会进一步增加内存压力，因此仅对已经明确失败的尝试降级重试。
      if (!hasFallback || timedOut) break;
      console.warn(
        `[imageExport] ${pixelRatio}x capture failed, retrying at ${pixelRatios[index + 1]}x:`,
        error,
      );
      await yieldForCanvasCleanup();
    } finally {
      // PNG Blob 已经独立于画布；每次尝试结束就立即释放大画布，避免在
      // Base64 转换、写盘或下一次降级重试期间继续占用位图内存。
      releaseCanvas(canvas);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("生成图片失败");
}

function getExportErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "导出图片失败，请重试";
  if (/timeout|超时/i.test(message)) return `导出图片失败：${message}`;
  if (/内容过长|尺寸超出|图片编码|保存图片/.test(message)) {
    return message;
  }
  return "导出图片失败，请重试";
}

// ── Loading Overlay ────────────────────────────────────────────
function createLoadingOverlay(): HTMLElement {
  document
    .querySelectorAll("#goose-image-export-loading")
    .forEach((staleOverlay) => staleOverlay.remove());

  const overlay = document.createElement("div");
  overlay.id = "goose-image-export-loading";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:rgba(8,8,14,0.6);
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    animation:ge-in .5s cubic-bezier(.16,1,.3,1) both;
    overflow:hidden;
  `;

  const C = ["#58d7b8", "#4f9cf7", "#9b72f2", "#f472b6", "#ffb56a", "#22d3ee"];
  const particles = Array.from({ length: 14 }, (_, i) => {
    const c = C[i % C.length];
    const x = 34 + i * 2.4;
    const s = 2 + (i % 3);
    const d = (i * 0.32).toFixed(1);
    const dur = (3 + (i % 4) * 0.8).toFixed(1);
    return `<div style="position:absolute;left:${x}%;bottom:38%;width:${s}px;height:${s}px;border-radius:50%;background:${c};box-shadow:0 0 ${s * 3}px ${c};opacity:0;animation:ge-float ${dur}s ease-out ${d}s infinite;will-change:transform,opacity"></div>`;
  }).join("");

  overlay.innerHTML = `<style>
@keyframes ge-in{from{opacity:0}to{opacity:1}}
@keyframes ge-out{to{opacity:0;transform:scale(1.06)}}
@keyframes ge-blob1{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(40px,-28px) scale(1.1)}66%{transform:translate(-28px,32px) scale(.92)}}
@keyframes ge-blob2{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-36px,28px) scale(1.14)}66%{transform:translate(32px,-36px) scale(.86)}}
@keyframes ge-blob3{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(28px,36px) scale(.94)}66%{transform:translate(-36px,-16px) scale(1.1)}}
@keyframes ge-conic{to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes ge-glow{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.14);opacity:1}}
@keyframes ge-cw{to{transform:rotate(360deg)}}
@keyframes ge-ccw{to{transform:rotate(-360deg)}}
@keyframes ge-pulse{0%{transform:scale(.85);opacity:.5}50%{transform:scale(1.3);opacity:0}100%{transform:scale(.85);opacity:0}}
@keyframes ge-pulse2{0%{transform:scale(.85);opacity:.4}50%{transform:scale(1.4);opacity:0}100%{transform:scale(.85);opacity:0}}
@keyframes ge-float{0%{transform:translateY(0) scale(1);opacity:0}12%{opacity:.8}80%{opacity:.5}100%{transform:translateY(-150px) scale(.2);opacity:0}}
@keyframes ge-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes ge-enter{from{transform:scale(.55);opacity:0}to{transform:scale(1);opacity:1}}
@media(prefers-reduced-motion:reduce){#goose-image-export-loading,#goose-image-export-loading *{animation-duration:.01s!important;animation-iteration-count:1!important}}
</style>

<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">
  <div style="position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(88,215,184,.22),transparent 70%);top:calc(50% - 240px);left:calc(50% - 90px);filter:blur(72px);animation:ge-blob1 8s ease-in-out infinite;will-change:transform"></div>
  <div style="position:absolute;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(159,114,242,.22),transparent 70%);top:calc(50% - 60px);left:calc(50% + 40px);filter:blur(72px);animation:ge-blob2 10s ease-in-out infinite;will-change:transform"></div>
  <div style="position:absolute;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(255,181,106,.18),transparent 70%);top:calc(50% - 180px);left:calc(50% - 240px);filter:blur(72px);animation:ge-blob3 12s ease-in-out infinite;will-change:transform"></div>
</div>

<div style="position:relative;width:120px;height:120px;display:flex;align-items:center;justify-content:center;animation:ge-enter .65s cubic-bezier(.16,1,.3,1) .08s both">
  <div style="position:absolute;inset:-46px;border-radius:50%;border:.5px solid rgba(255,181,106,.1);animation:ge-cw 22s linear infinite;will-change:transform"></div>
  <div style="position:absolute;inset:-28px;border-radius:50%;border:1px solid rgba(159,114,242,.16);animation:ge-ccw 13s linear infinite;will-change:transform"></div>
  <div style="position:absolute;inset:-12px;border-radius:50%;border:1.5px dashed rgba(88,215,184,.28);animation:ge-cw 5.5s linear infinite;will-change:transform"></div>

  <div style="position:absolute;width:80px;height:80px;border-radius:50%;border:1.5px solid rgba(88,215,184,.25);animation:ge-pulse 2.8s ease-out infinite;will-change:transform,opacity"></div>
  <div style="position:absolute;width:80px;height:80px;border-radius:50%;border:1.5px solid rgba(159,114,242,.2);animation:ge-pulse2 2.8s ease-out 1.4s infinite;will-change:transform,opacity"></div>

  <div style="position:relative;width:56px;height:56px;border-radius:50%;overflow:hidden;animation:ge-glow 2.6s ease-in-out infinite;will-change:transform,opacity">
    <div style="position:absolute;inset:-30%;width:160%;height:160%;top:50%;left:50%;background:conic-gradient(from 0deg,#58d7b8,#4f9cf7,#9b72f2,#f472b6,#ffb56a,#22d3ee,#58d7b8);animation:ge-conic 3s linear infinite;will-change:transform"></div>
    <div style="position:absolute;inset:5px;border-radius:50%;background:rgba(10,10,18,.88);backdrop-filter:blur(4px)"></div>
  </div>

  <div style="position:absolute;inset:-8px;animation:ge-cw 3.2s linear infinite;will-change:transform"><div style="position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:6px;height:6px;border-radius:50%;background:#58d7b8;box-shadow:0 0 10px rgba(88,215,184,.8)"></div></div>
  <div style="position:absolute;inset:-22px;animation:ge-ccw 5s linear infinite;will-change:transform"><div style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#ffb56a;box-shadow:0 0 8px rgba(255,181,106,.8)"></div></div>
  <div style="position:absolute;inset:-38px;animation:ge-cw 7.5s linear infinite;will-change:transform"><div style="position:absolute;top:50%;right:-2px;transform:translateY(-50%);width:4px;height:4px;border-radius:50%;background:#9b72f2;box-shadow:0 0 8px rgba(159,114,242,.7)"></div></div>
  <div style="position:absolute;inset:-16px;animation:ge-cw 4s linear infinite;will-change:transform"><div style="position:absolute;left:-2px;top:50%;transform:translateY(-50%);width:3px;height:3px;border-radius:50%;background:#f472b6;box-shadow:0 0 6px rgba(244,114,182,.7)"></div></div>
</div>

<div style="margin-top:30px;font-size:15px;font-weight:600;letter-spacing:.05em;background:linear-gradient(90deg,#58d7b8,#4f9cf7,#9b72f2,#f472b6,#ffb56a,#58d7b8);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:ge-shimmer 2.5s linear infinite,ge-enter .65s cubic-bezier(.16,1,.3,1) .18s both">正在生成图片</div>

<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">${particles}</div>`;

  document.body.appendChild(overlay);
  return overlay;
}

function removeLoadingOverlay(overlay: HTMLElement): void {
  if (!overlay.isConnected) return;
  overlay.style.animation = "ge-out .4s cubic-bezier(.33,1,.68,1) forwards";
  setTimeout(() => overlay.remove(), 420);
}

// ── Core Capture ───────────────────────────────────────────────
async function waitForImages(container: HTMLElement): Promise<void> {
  const images = container.querySelectorAll("img");
  if (images.length === 0) return Promise.resolve();

  const promises = Array.from(images).map((img) => {
    return new Promise<void>((resolve) => {
      if (img.complete) {
        resolve();
        return;
      }
      img.onload = () => resolve();
      img.onerror = () => resolve();
      setTimeout(() => resolve(), 3000);
    });
  });

  return Promise.all(promises).then(() => {});
}

async function captureElementToPng(element: HTMLElement, filename: string) {
  if (isCapturingImage) {
    toast.info("图片正在生成，请稍候");
    return;
  }

  isCapturingImage = true;
  const overlay = createLoadingOverlay();

  try {
    await withTimeout(
      Promise.all([document.fonts.ready, waitForImages(element)]),
      10_000,
      "等待图片资源超时",
    );

    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );

    const blob = await renderPngBlobWithFallback(element);

    const { saveBlobAndReveal } = await import("../export");
    const saved = await withTimeout(
      saveBlobAndReveal(blob, filename),
      SAVE_TIMEOUT_MS,
      "保存图片超时",
    );
    if (saved) {
      toast.success("图片已保存到下载文件夹");
    } else {
      throw new Error("保存图片失败");
    }
  } catch (error) {
    toast.error(getExportErrorMessage(error));
    console.error("[imageExport] capture failed:", error);
  } finally {
    isCapturingImage = false;
    removeLoadingOverlay(overlay);
  }
}

// ── File Name Helpers ──────────────────────────────────────────
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "untitled";
}

function buildFileName(
  title: string,
  theme: ReturnType<typeof getCardTheme>,
  suffix?: string,
): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${milliseconds}`;
  const parts = [
    sanitizeFileName(title || "untitled"),
    sanitizeFileName(theme.nameEn),
    ts,
  ];
  if (suffix) parts.splice(1, 0, suffix);
  return `${parts.join("_")}.png`;
}

// ── Public API: Full Page Export ───────────────────────────────
export async function exportPageToImage(
  page: Page,
  themeId: CardThemeId = "github-light",
  watermarkConfig?: WatermarkConfig,
) {
  const theme = getCardTheme(themeId);
  const wm = normalizeWatermarkConfig(watermarkConfig);
  const title = getPageTitle(page) || extractTitleFromContent(page.content);
  const content = cloneExportBlocks(page.content, {
    ensureFirstTitle: !page.localFilePath,
  });
  await resolveImageUrls(content);
  await renderMermaidBlocksAsImages(content, theme);
  await renderMathBlocksAsImages(content, theme);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  document.body.appendChild(container);

  try {
    const firstBlock = content[0];
    const blocksToRender =
      wm.showTitle && firstBlock?.type === "heading"
        ? content.slice(1)
        : content;
    const blocksHtml = renderBlocks(blocksToRender, theme);
    const html = buildStyledHTML({
      title,
      blocksHtml,
      theme,
      watermarkConfig: wm,
    });
    container.innerHTML = html;

    const cardElement = container.querySelector(
      ".gooseshot-container",
    ) as HTMLElement;
    if (!cardElement) throw new Error("Failed to create preview element");

    await captureElementToPng(cardElement, buildFileName(title, theme));
  } finally {
    document.body.removeChild(container);
  }
}

// ── Public API: Selection Export ───────────────────────────────
export async function exportSelectionToImage(
  selectionBlocks: BlockNoteContent,
  pageTitle?: string,
  themeId: CardThemeId = "github-light",
  watermarkConfig?: WatermarkConfig,
) {
  if (!Array.isArray(selectionBlocks) || selectionBlocks.length === 0) return;

  const theme = getCardTheme(themeId);
  const wm = normalizeWatermarkConfig(watermarkConfig);
  const title = pageTitle || "选中内容";

  const clonedBlocks = structuredClone(selectionBlocks) as BlockNoteContent;
  await resolveImageUrls(clonedBlocks);
  await renderMermaidBlocksAsImages(clonedBlocks, theme);
  await renderMathBlocksAsImages(clonedBlocks, theme);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  document.body.appendChild(container);

  try {
    const blocksToRender = getSelectionBlocksToRender(
      clonedBlocks,
      title,
      wm.showTitle,
    );
    const blocksHtml = renderBlocks(blocksToRender, theme);

    const html = buildStyledHTML({
      title,
      blocksHtml,
      theme,
      watermarkConfig: wm,
    });
    container.innerHTML = html;

    const cardElement = container.querySelector(
      ".gooseshot-container",
    ) as HTMLElement;
    if (!cardElement) throw new Error("Failed to create preview element");

    await captureElementToPng(cardElement, buildFileName(title, theme, "选中"));
  } finally {
    document.body.removeChild(container);
  }
}

// ── Legacy alias ───────────────────────────────────────────────
export async function exportToImage(
  page: Page,
  themeId: CardThemeId = "github-light",
) {
  return exportPageToImage(page, themeId);
}
