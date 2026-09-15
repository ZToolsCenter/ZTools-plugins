import type { MouseEvent as ReactMouseEvent } from "react";
import { blobToBase64, getExtensionFromMimeType } from "@/lib/imageStorage/utils";
import { fs } from "@/lib/utools/fs";
import { shell } from "@/lib/utools/shell";

/** 所有「打开来看」预览按钮的统一文案 */
export const PREVIEW_ACTION_TOOLTIP = "预览（左键全屏 / 右键系统）";

/** 预览缩放按百分比步进，不用 1.2 倍这种非整比例 */
export const PREVIEW_ZOOM_STEP_PERCENT = 25;
export const PREVIEW_ZOOM_MIN_PERCENT = 25;
export const PREVIEW_ZOOM_MAX_PERCENT = 400;

export function clampPreviewZoomPercent(value: number): number {
  const snapped =
    Math.round(value / PREVIEW_ZOOM_STEP_PERCENT) * PREVIEW_ZOOM_STEP_PERCENT;
  return Math.min(
    PREVIEW_ZOOM_MAX_PERCENT,
    Math.max(PREVIEW_ZOOM_MIN_PERCENT, snapped),
  );
}

export type PreviewContent =
  | { kind: "image"; data: string | Blob; fileName?: string }
  | { kind: "svg"; markup: string; fileName?: string; background?: string }
  | { kind: "html"; html: string; fileName?: string }
  | { kind: "math"; source: string; fileName?: string };

export function previewPointerHandlers(handlers: {
  onInternal: () => void | Promise<void>;
  onSystem: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return {
    "aria-label": PREVIEW_ACTION_TOOLTIP,
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      if (handlers.disabled) return;
      event.preventDefault();
      void handlers.onInternal();
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (handlers.disabled) return;
      void handlers.onSystem();
    },
  };
}

export async function toImageDataUrl(payload: string | Blob): Promise<string> {
  if (typeof payload === "string") {
    if (!payload.startsWith("data:")) {
      throw new Error("预览数据无效");
    }
    return payload;
  }
  return blobToBase64(payload);
}

export function buildPreviewTempFile(
  dataUrl: string,
  fileName: string,
  token: string,
): { relativePath: string; base64: string } {
  const mime = dataUrl.match(/^data:([^;]+);base64,/)?.[1] ?? "image/png";
  const base64 = dataUrl.replace(/^data:.*?;base64,/, "");
  if (!base64) throw new Error("预览数据无效");

  const fallbackExt = getExtensionFromMimeType(mime);
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(fileName);
  const safeName = hasExt ? fileName : `${fileName}.${fallbackExt || "png"}`;
  return {
    relativePath: `goose-note/previews/${token}/${safeName}`,
    base64,
  };
}

export function svgNeedsHtmlShell(markup: string): boolean {
  return /<foreignObject[\s>]/i.test(markup);
}

/**
 * 预览按固有尺寸展示，缩放交给外层 transform。
 * 这里只补齐缺失的一侧：没有 viewBox 就按像素宽高推，没有像素宽高就按 viewBox 推。
 */
export function normalizeSvgIntrinsicSize(markup: string): string {
  return markup.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
    const width = attrs.match(/\swidth="([\d.]+)"/i)?.[1];
    const height = attrs.match(/\sheight="([\d.]+)"/i)?.[1];
    if (width && height) {
      return /\sviewBox="/i.test(attrs)
        ? full
        : `<svg${attrs} viewBox="0 0 ${width} ${height}">`;
    }
    const viewBox = attrs.match(/\sviewBox="([^"]+)"/i)?.[1];
    if (!viewBox) return full;
    const [, , viewWidth, viewHeight] = viewBox.trim().split(/[\s,]+/);
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/gi, "");
    return `<svg${cleaned} width="${viewWidth}" height="${viewHeight}">`;
  });
}

export function wrapSvgAsHtml(
  markup: string,
  options?: { title?: string; background?: string; color?: string },
): string {
  const background = options?.background ?? "#ffffff";
  const color = options?.color ?? "#111111";
  const title = escapeHtml(options?.title ?? "预览");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  html, body { margin: 0; min-height: 100%; background: ${background}; color: ${color}; }
  body { padding: 24px; box-sizing: border-box; overflow: auto; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
</style>
</head>
<body>${markup}</body>
</html>`;
}

export function wrapHtmlDocument(
  body: string,
  options?: {
    title?: string;
    background?: string;
    color?: string;
    extraHead?: string;
  },
): string {
  if (/^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body)) {
    return body;
  }
  const background = options?.background ?? "#ffffff";
  const color = options?.color ?? "#111111";
  const title = escapeHtml(options?.title ?? "预览");
  const extraHead = options?.extraHead ?? "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
${extraHead}
<style>
  html, body { margin: 0; min-height: 100%; background: ${background}; color: ${color}; }
  body { padding: 24px; box-sizing: border-box; font-family: Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d0d0; padding: 8px 12px; text-align: left; }
  th { background: rgba(127,127,127,0.12); }
</style>
</head>
<body>${body}</body>
</html>`;
}

export async function openImagePayloadInSystem(
  payload: string | Blob,
  fileName = "preview.png",
): Promise<void> {
  const dataUrl = await toImageDataUrl(payload);
  await writeAndOpenTempFile(
    buildPreviewTempFile(dataUrl, fileName, previewToken()),
  );
}

export async function openPreviewInSystem(
  content: PreviewContent,
): Promise<void> {
  if (content.kind === "image") {
    await openImagePayloadInSystem(
      content.data,
      content.fileName ?? "preview.png",
    );
    return;
  }

  if (content.kind === "svg") {
    const useHtml = svgNeedsHtmlShell(content.markup);
    const text = useHtml
      ? wrapSvgAsHtml(content.markup, { background: content.background })
      : content.markup;
    const fileName = useHtml
      ? withExtension(content.fileName ?? "preview.html", "html")
      : withExtension(content.fileName ?? "preview.svg", "svg");
    await openTextFileInSystem(text, fileName);
    return;
  }

  if (content.kind === "html") {
    await openTextFileInSystem(
      wrapHtmlDocument(content.html),
      withExtension(content.fileName ?? "preview.html", "html"),
    );
    return;
  }

  const { default: katex } = await import("katex");
  const mathHtml = katex.renderToString(content.source, {
    displayMode: true,
    throwOnError: false,
    output: "html",
  });
  await openTextFileInSystem(
    wrapHtmlDocument(`<div class="katex-preview">${mathHtml}</div>`, {
      title: "公式预览",
      extraHead:
        '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">',
    }),
    withExtension(content.fileName ?? "formula.html", "html"),
  );
}

async function openTextFileInSystem(
  text: string,
  fileName: string,
): Promise<void> {
  await writeAndOpenTempFile({
    relativePath: `goose-note/previews/${previewToken()}/${fileName}`,
    base64: textToBase64(text),
  });
}

async function writeAndOpenTempFile(file: {
  relativePath: string;
  base64: string;
}): Promise<void> {
  const targetPath = await fs.writeTempFile(file.relativePath, file.base64);
  if (!targetPath) {
    throw new Error("当前环境不支持系统预览");
  }
  const opened = await shell.openPath(targetPath);
  if (!opened) {
    throw new Error("系统预览打开失败");
  }
}

function previewToken(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}`;
}

function withExtension(fileName: string, ext: string): string {
  if (new RegExp(`\\.${ext}$`, "i").test(fileName)) return fileName;
  return `${fileName.replace(/\.[a-z0-9]{1,8}$/i, "")}.${ext}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
