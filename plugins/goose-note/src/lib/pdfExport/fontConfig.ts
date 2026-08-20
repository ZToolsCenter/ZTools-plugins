/**
 * PDF 字体注册（中文支持）。
 *
 * @react-pdf 的 Font.register({ src }) 若给普通 URL，渲染阶段会 fetch。
 * uTools / ZTools 以 file:// 打开 index.html，根路径 `/fonts/xxx`
 * 会变成 file:///fonts/xxx（磁盘根目录）→ ERR_FILE_NOT_FOUND → Failed to fetch。
 *
 * 正确做法：
 * 1. 按页面地址解析相对路径 fonts/NotoSansSC-Regular.{ttf,otf}
 * 2. 先读成 data: URL 再注册，避免 pdf().toBlob() 再 fetch
 */

export const PDF_FONT_FAMILY = "NotoSansSC";

export const PDF_FONT_RELATIVE_PATHS = [
  "fonts/NotoSansSC-Regular.ttf",
  "fonts/NotoSansSC-Regular.otf",
] as const;

let registered = false;

export function resolvePdfFontUrl(relativePath: string, baseHref: string): string {
  return new URL(relativePath, baseHref).href;
}

export function fileUrlToLocalPath(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  try {
    const decoded = decodeURIComponent(new URL(url).pathname);
    if (/^\/[A-Za-z]:\//.test(decoded)) return decoded.slice(1);
    return decoded;
  } catch {
    return null;
  }
}

export function toPdfFontDataUrl(base64: string): string {
  return `data:font/ttf;base64,${base64}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function readFontBase64FromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return null;
    return uint8ToBase64(new Uint8Array(buf));
  } catch {
    return null;
  }
}

async function readFontBase64FromGooseFs(filePath: string): Promise<string | null> {
  try {
    const gfs = typeof window !== "undefined" ? window.gooseFs : undefined;
    if (!gfs) return null;
    const asyncReader = (gfs as GooseFs & {
      readFileBase64Async?: (path: string) => Promise<string | null>;
    }).readFileBase64Async;
    if (typeof asyncReader === "function") {
      const base64 = await asyncReader(filePath);
      if (base64) return base64;
    }
    if (typeof gfs.readFileBase64 === "function") {
      return gfs.readFileBase64(filePath) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadPdfFontDataUrl(
  baseHref: string = typeof window !== "undefined" ? window.location.href : "http://localhost/",
): Promise<string | null> {
  for (const rel of PDF_FONT_RELATIVE_PATHS) {
    const url = resolvePdfFontUrl(rel, baseHref);
    const fromFetch = await readFontBase64FromUrl(url);
    if (fromFetch) return toPdfFontDataUrl(fromFetch);
    const localPath = fileUrlToLocalPath(url);
    if (localPath) {
      const fromFs = await readFontBase64FromGooseFs(localPath);
      if (fromFs) return toPdfFontDataUrl(fromFs);
    }
  }
  return null;
}

export async function registerPdfFonts(
  baseHref?: string,
): Promise<boolean> {
  if (registered) return true;

  try {
    const { Font } = await import("@react-pdf/renderer");
    const dataUrl = await loadPdfFontDataUrl(
      baseHref ?? (typeof window !== "undefined" ? window.location.href : "http://localhost/"),
    );
    if (!dataUrl) {
      console.warn(
        "[pdfExport] 未找到 NotoSansSC。请将 NotoSansSC-Regular.ttf 或 .otf 放到 public/fonts/（构建后为 dist/fonts/）。",
      );
      return false;
    }
    Font.register({
      family: PDF_FONT_FAMILY,
      src: dataUrl,
    });
    Font.register({
      family: PDF_FONT_FAMILY,
      src: dataUrl,
      fontWeight: "bold",
    });
    Font.registerHyphenationCallback((word) => [word]);
    registered = true;
    return true;
  } catch (error) {
    console.warn("[pdfExport] NotoSansSC 字体注册失败，中文可能无法正常渲染。", error);
    return false;
  }
}
