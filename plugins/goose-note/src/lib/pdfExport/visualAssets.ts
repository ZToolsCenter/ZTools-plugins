/**
 * PDF 导出用的可视资源：把 mermaid/math 渲成 PNG data URL，
 * 把本地 / 插件 / 远程图片收成 react-pdf 能吃的栅格 data URL。
 *
 * 不把 SVG（尤其含 foreignObject 的 Mermaid）直接丢给 @react-pdf/image。
 * 不把 file://、相对路径、http(s) 原样交给 react-pdf 去 fetch。
 */

import { blobToBase64 } from "@/lib/imageStorage/utils";
import {
  isLocalFilePath,
  readLocalFileAsBlobAsync,
  resolveToAbsolute,
} from "@/lib/imageStorage/strategies/file-system";
import { fileUrlToLocalPath } from "./fontConfig";

export const PDF_RASTER_DATA_URL_RE =
  /^data:image\/(png|jpe?g|gif|webp|bmp)(;|$)/i;

const PDF_LIGHT_MATH = {
  color: "#111827",
  background: "#ffffff",
} as const;

export function getCodeBlockText(block: { content?: unknown } | null | undefined): string {
  const content = block?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const rec = item as { type?: string; text?: string };
        if (rec.type === "hardBreak") return "\n";
        return typeof rec.text === "string" ? rec.text : "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

export function isRasterPdfImageSrc(url: string): boolean {
  return PDF_RASTER_DATA_URL_RE.test(url);
}

export function isSvgDataUrl(url: string): boolean {
  return /^data:image\/svg\+xml/i.test(url);
}

export function isVisualCodeLanguage(language: string): boolean {
  const lang = language.trim().toLowerCase();
  return lang === "mermaid" || lang === "math" || lang === "latex" || lang === "tex";
}

function resolveLocalMediaPath(
  src: string,
  pageLocalFilePath?: string | null,
): string | null {
  if (src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src)) return src;
  if (!pageLocalFilePath) return null;
  const dir = pageLocalFilePath.replace(/[\\/][^\\/]+$/, "");
  return dir ? resolveToAbsolute(dir, src) : null;
}

function decodeSvgDataUrl(url: string): string {
  const match = url.match(/^data:image\/svg\+xml([^,]*),(.*)$/is);
  if (!match) throw new Error("不是 SVG data URL");
  const meta = match[1] ?? "";
  const payload = match[2] ?? "";
  if (/;base64/i.test(meta)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
}

async function rasterizeSvgMarkup(svg: string): Promise<string> {
  const { svgMarkupToPngBlob } = await import("@/lib/imageExport/svgToPng");
  const blob = await svgMarkupToPngBlob(svg, { targetLongEdge: 2048, padding: 12 });
  const dataUrl = await blobToBase64(blob);
  if (!isRasterPdfImageSrc(dataUrl)) {
    throw new Error("SVG 栅格化结果不是 PNG data URL");
  }
  return dataUrl;
}

async function rasterizeIfNeeded(dataUrl: string): Promise<string | null> {
  if (isRasterPdfImageSrc(dataUrl)) return dataUrl;
  if (isSvgDataUrl(dataUrl)) {
    return rasterizeSvgMarkup(decodeSvgDataUrl(dataUrl));
  }
  return dataUrl.startsWith("data:image/") ? dataUrl : null;
}

async function blobToPdfImageDataUrl(blob: Blob): Promise<string | null> {
  if (!blob || blob.size === 0) return null;
  if (blob.type.includes("svg") || blob.type === "image/svg+xml") {
    const svg = await blob.text();
    return rasterizeSvgMarkup(svg);
  }
  const dataUrl = await blobToBase64(blob);
  return rasterizeIfNeeded(dataUrl);
}

function guessImageMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

async function readGooseFsBase64(fullPath: string): Promise<string | null> {
  const gfs =
    typeof window !== "undefined"
      ? (window as Window & {
          gooseFs?: {
            readFileBase64Async?: (path: string) => Promise<string | null>;
            readFileBase64?: (path: string) => string | null;
          };
        }).gooseFs
      : undefined;
  if (!gfs) return null;
  if (typeof gfs.readFileBase64Async === "function") {
    const base64 = await gfs.readFileBase64Async(fullPath);
    if (base64) return base64;
  }
  if (typeof gfs.readFileBase64 === "function") {
    return gfs.readFileBase64(fullPath) ?? null;
  }
  return null;
}

async function readLocalPathAsDataUrl(fullPath: string): Promise<string | null> {
  try {
    const base64 = await readGooseFsBase64(fullPath);
    if (base64) {
      const dataUrl = `data:${guessImageMime(fullPath)};base64,${base64}`;
      return await rasterizeIfNeeded(dataUrl);
    }
    const blob = await readLocalFileAsBlobAsync(fullPath);
    if (blob) return blobToPdfImageDataUrl(blob);
  } catch (error) {
    console.error("[pdfExport] 读取本地图片失败:", fullPath, error);
  }
  return null;
}

export async function renderMermaidPngDataUrl(source: string): Promise<string | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;
  const { renderMermaidSvgForExport } = await import("@/lib/imageExport/mermaid");
  const svg = await renderMermaidSvgForExport(trimmed, "light");
  if (!svg?.trim()) return null;
  return rasterizeSvgMarkup(svg);
}

export async function renderMathPngDataUrl(source: string): Promise<string | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持导出公式图片");
  }
  const { default: katex } = await import("katex");
  const { captureElementAsPngBlob } = await import("@/lib/imageExport/svgToPng");
  const html = katex.renderToString(trimmed, {
    displayMode: true,
    throwOnError: false,
    output: "html",
  });

  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    "z-index:-1",
    "padding:16px 24px",
    `color:${PDF_LIGHT_MATH.color}`,
    `background:${PDF_LIGHT_MATH.background}`,
    "font-size:18px",
    "line-height:1.4",
    "display:inline-block",
  ].join(";");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  try {
    await document.fonts.ready.catch(() => undefined);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const blob = await captureElementAsPngBlob(wrapper, { targetLongEdge: 1600 });
    const dataUrl = await blobToBase64(blob);
    if (!isRasterPdfImageSrc(dataUrl)) {
      throw new Error("公式截图结果不是 PNG data URL");
    }
    return dataUrl;
  } finally {
    document.body.removeChild(wrapper);
  }
}

export type CodeBlockVisual =
  | { kind: "png"; src: string; language: "mermaid" | "math" }
  | { kind: "source-fallback"; text: string; language: "mermaid" | "math" }
  | { kind: "empty"; language: "mermaid" | "math" }
  | { kind: "code" };

export type CodeBlockVisualHooks = {
  renderMermaidPng?: (source: string) => Promise<string | null>;
  renderMathPng?: (source: string) => Promise<string | null>;
};

export async function resolveCodeBlockVisual(
  block: { props?: { language?: string }; content?: unknown },
  hooks?: CodeBlockVisualHooks,
): Promise<CodeBlockVisual> {
  const language = String(block?.props?.language || "").trim().toLowerCase();
  const text = getCodeBlockText(block);
  const source = text.trim();

  if (language === "mermaid") {
    if (!source) return { kind: "empty", language: "mermaid" };
    try {
      const render = hooks?.renderMermaidPng ?? renderMermaidPngDataUrl;
      const png = await render(source);
      if (png && isRasterPdfImageSrc(png)) {
        return { kind: "png", src: png, language: "mermaid" };
      }
      console.error("[pdfExport] mermaid render returned no PNG");
    } catch (error) {
      console.error("[pdfExport] mermaid render failed:", error);
    }
    return { kind: "source-fallback", text, language: "mermaid" };
  }

  if (language === "math" || language === "latex" || language === "tex") {
    if (!source) return { kind: "empty", language: "math" };
    try {
      const render = hooks?.renderMathPng ?? renderMathPngDataUrl;
      const png = await render(source);
      if (png && isRasterPdfImageSrc(png)) {
        return { kind: "png", src: png, language: "math" };
      }
      console.error("[pdfExport] math render returned no PNG");
    } catch (error) {
      console.error("[pdfExport] math render failed:", error);
    }
    return { kind: "source-fallback", text, language: "math" };
  }

  return { kind: "code" };
}

async function blobUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "blob";
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
          resolve(xhr.response as Blob);
          return;
        }
        reject(new Error(`blob 读取失败（${xhr.status}）`));
      };
      xhr.onerror = () => reject(new Error("blob 读取失败"));
      xhr.send();
    });
    return blobToPdfImageDataUrl(blob);
  } catch (error) {
    console.error("[pdfExport] blob 图片读取失败:", error);
    return null;
  }
}

export async function resolvePdfImageDataUrl(
  url: string,
  pageLocalFilePath?: string | null,
): Promise<string | null> {
  const src = String(url || "").trim();
  if (!src) return null;

  try {
    if (src.startsWith("data:")) {
      return await rasterizeIfNeeded(src);
    }

    if (src.startsWith("blob:")) {
      return await blobUrlToDataUrl(src);
    }

    if (src.startsWith("file:")) {
      const localPath = fileUrlToLocalPath(src);
      if (!localPath) return null;
      return await readLocalPathAsDataUrl(localPath);
    }

    if (isLocalFilePath(src)) {
      const abs = resolveLocalMediaPath(src, pageLocalFilePath);
      if (abs) {
        const fromDisk = await readLocalPathAsDataUrl(abs);
        if (fromDisk) return fromDisk;
      }
    }

    if (
      src.startsWith("att:") ||
      src.startsWith("uuid:") ||
      /^https?:\/\//i.test(src)
    ) {
      const { resolveRemoteImageToDataUrl } = await import(
        "@/lib/imageExport/remoteImageResolver"
      );
      const remote = await resolveRemoteImageToDataUrl(src);
      if (remote) return await rasterizeIfNeeded(remote);
      return null;
    }

    if (typeof window !== "undefined" && !src.includes("://")) {
      try {
        const absUrl = new URL(src, window.location.href).href;
        if (absUrl && absUrl !== src) {
          return await resolvePdfImageDataUrl(absUrl, pageLocalFilePath);
        }
      } catch {
        // ignore invalid relative URL
      }
    }
  } catch (error) {
    console.error("[pdfExport] 图片解析失败:", src, error);
  }

  return null;
}
