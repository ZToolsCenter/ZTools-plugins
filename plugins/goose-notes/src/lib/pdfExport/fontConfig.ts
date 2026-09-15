/**
 * PDF 字体注册（中文支持）。
 *
 * @react-pdf 的 Font.register({ src }) 若给普通 URL，渲染阶段会 fetch。
 * uTools / ZTools 以 file:// 打开 index.html，根路径 `/fonts/xxx`
 * 会变成 file:///fonts/xxx（磁盘根目录）→ ERR_FILE_NOT_FOUND → Failed to fetch。
 * 因此不能把 src 设成站点根 `/fonts/...`，必须先读成 data: URL 再注册。
 *
 * 按当前笔记 fontFamily + 设置里的 customFonts 选远程单文件（woff2/otf），
 * 同会话按 URL 缓存 data URL。失败 warn 后回退 Noto / Helvetica，不打进产物。
 */

import { REMOTE_FONT_SOURCES } from "@/lib/fontLoader";

export const PDF_FONT_FAMILY = "NotoSansSC";
export const PDF_HARMONY_FAMILY = "HarmonyOS Sans SC";
export const PDF_CANGER_FAMILY = "仓耳今楷";
export const PDF_DM_MONO_FAMILY = "DM Mono";

export type PdfPageFontFamily = "default" | "serif" | "mono";

export type PdfCustomFonts = {
  default: { font: string | null };
  serif: { font: string | null };
  mono: { font: string | null };
};

export type PdfEmbedKind = "harmony" | "canger" | "dm-mono" | "noto";

export type PdfFontPlan = {
  category: PdfPageFontFamily;
  embed: PdfEmbedKind;
  bodyFamily: string;
  pageFontFamily: string | string[];
  bodyUrls: readonly string[];
  bodyFallbackUrls: readonly string[];
  monoUrls: readonly string[];
};

/** 仅作 file:// 相对解析的文档/测例，不再作为加载来源。 */
export const PDF_FONT_RELATIVE_PATHS = [
  "fonts/NotoSansSC-Regular.ttf",
  "fonts/NotoSansSC-Regular.otf",
] as const;

export const PDF_CJK_FONT_URLS = [
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
  "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf",
] as const;

/** UI 走分包 CSS；PDF 必须单文件。fontLoader 已不再保留这条，沿用同一 Resources commit。 */
export const PDF_HARMONYOS_WOFF2_URLS = [
  `https://cdn.jsdelivr.net/gh/eachann1024/Resources@d6dc229cd882dc0983dc5ce7cf28fb85047a4a76/${encodeURI("鸿蒙黑体-HarmonyOS Sans SC.woff2")}`,
] as const;

export const PDF_CANGER_WOFF2_URLS = [
  REMOTE_FONT_SOURCES["仓耳今楷"],
] as const;

export const PDF_DM_MONO_WOFF2_URLS = [
  "https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5.1.0/files/dm-mono-latin-400-normal.woff2",
] as const;

const MIN_CJK_FONT_BYTES = 100_000;
const MIN_LATIN_FONT_BYTES = 4_000;

const dataUrlByUrl = new Map<string, string | null>();
const inflightByUrl = new Map<string, Promise<string | null>>();
let registeredKey: string | null = null;
let lastRegisterResult: { ready: boolean; pageFontFamily: string | string[] } | null =
  null;
let hyphenationRegistered = false;

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

export function toPdfFontDataUrl(base64: string, mime = "font/otf"): string {
  return `data:${mime};base64,${base64}`;
}

export function resetPdfFontLoadCache(): void {
  dataUrlByUrl.clear();
  inflightByUrl.clear();
  registeredKey = null;
  lastRegisterResult = null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function guessFontMime(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".ttf")) return "font/ttf";
  return "font/otf";
}

function firstFamilyName(font: string | null | undefined): string {
  if (!font) return "";
  return font
    .split(",")[0]
    .trim()
    .replace(/^["']+|["']+$/g, "");
}

function classifyCustomName(name: string): PdfEmbedKind | "empty" {
  if (!name) return "empty";
  if (/harmonyos|ui-sans-serif/i.test(name)) return "harmony";
  if (name.includes("仓耳")) return "canger";
  if (/dm\s*mono/i.test(name)) return "dm-mono";
  return "noto";
}

export function resolvePdfFontPlan(
  fontFamily?: PdfPageFontFamily | null,
  customFonts?: PdfCustomFonts | null,
): PdfFontPlan {
  const category: PdfPageFontFamily = fontFamily ?? "default";
  const customName = firstFamilyName(customFonts?.[category]?.font);
  const named = classifyCustomName(customName);

  let embed: PdfEmbedKind;
  if (named === "harmony" || (named === "empty" && category === "default")) {
    embed = "harmony";
  } else if (named === "canger" || (named === "empty" && category === "serif")) {
    embed = "canger";
  } else if (named === "dm-mono" || (named === "empty" && category === "mono")) {
    embed = "dm-mono";
  } else {
    embed = "noto";
  }

  if (embed === "harmony") {
    return {
      category,
      embed,
      bodyFamily: PDF_HARMONY_FAMILY,
      pageFontFamily: PDF_HARMONY_FAMILY,
      bodyUrls: PDF_HARMONYOS_WOFF2_URLS,
      bodyFallbackUrls: PDF_CJK_FONT_URLS,
      monoUrls: PDF_DM_MONO_WOFF2_URLS,
    };
  }

  if (embed === "canger") {
    return {
      category,
      embed,
      bodyFamily: PDF_CANGER_FAMILY,
      pageFontFamily: PDF_CANGER_FAMILY,
      bodyUrls: PDF_CANGER_WOFF2_URLS,
      bodyFallbackUrls: PDF_CJK_FONT_URLS,
      monoUrls: PDF_DM_MONO_WOFF2_URLS,
    };
  }

  if (embed === "dm-mono") {
    return {
      category,
      embed,
      bodyFamily: PDF_HARMONY_FAMILY,
      pageFontFamily: [PDF_DM_MONO_FAMILY, PDF_HARMONY_FAMILY],
      bodyUrls: PDF_HARMONYOS_WOFF2_URLS,
      bodyFallbackUrls: PDF_CJK_FONT_URLS,
      monoUrls: PDF_DM_MONO_WOFF2_URLS,
    };
  }

  return {
    category,
    embed: "noto",
    bodyFamily: PDF_FONT_FAMILY,
    pageFontFamily: PDF_FONT_FAMILY,
    bodyUrls: PDF_CJK_FONT_URLS,
    bodyFallbackUrls: [],
    monoUrls: PDF_DM_MONO_WOFF2_URLS,
  };
}

async function loadCachedFontDataUrl(
  url: string,
  minBytes: number,
): Promise<string | null> {
  if (dataUrlByUrl.has(url)) return dataUrlByUrl.get(url) ?? null;
  const existing = inflightByUrl.get(url);
  if (existing) return existing;

  const job = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        dataUrlByUrl.set(url, null);
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < minBytes) {
        dataUrlByUrl.set(url, null);
        return null;
      }
      const dataUrl = toPdfFontDataUrl(uint8ToBase64(new Uint8Array(buf)), guessFontMime(url));
      dataUrlByUrl.set(url, dataUrl);
      return dataUrl;
    } catch {
      dataUrlByUrl.set(url, null);
      return null;
    }
  })();

  inflightByUrl.set(url, job);
  try {
    return await job;
  } finally {
    inflightByUrl.delete(url);
  }
}

export async function loadFirstPdfFontDataUrl(
  urls: readonly string[],
  minBytes = MIN_CJK_FONT_BYTES,
): Promise<string | null> {
  for (const url of urls) {
    const src = await loadCachedFontDataUrl(url, minBytes);
    if (src) return src;
  }
  return null;
}

/** Noto CJK（测例与 fallback）。 */
export async function loadPdfFontDataUrl(): Promise<string | null> {
  return loadFirstPdfFontDataUrl(PDF_CJK_FONT_URLS);
}

function registerFamilyVariants(Font: typeof import("@react-pdf/renderer").Font, family: string, src: string) {
  Font.register({ family, src });
  Font.register({ family, src, fontWeight: "bold" });
  Font.register({ family, src, fontStyle: "italic" });
  Font.register({ family, src, fontWeight: "bold", fontStyle: "italic" });
}

export async function registerPdfFonts(options?: {
  fontFamily?: PdfPageFontFamily | null;
  customFonts?: PdfCustomFonts | null;
}): Promise<{ ready: boolean; pageFontFamily: string | string[] }> {
  const plan = resolvePdfFontPlan(options?.fontFamily, options?.customFonts);
  const planKey = `${plan.embed}:${plan.category}:${firstFamilyName(options?.customFonts?.[plan.category]?.font)}`;
  if (registeredKey === planKey && lastRegisterResult) {
    return lastRegisterResult;
  }

  try {
    const { Font } = await import("@react-pdf/renderer");
    const primarySrc = await loadFirstPdfFontDataUrl(plan.bodyUrls);
    const bodySrc =
      primarySrc ?? (await loadFirstPdfFontDataUrl(plan.bodyFallbackUrls));
    if (!primarySrc && bodySrc && plan.embed !== "noto") {
      console.warn(
        `[pdfExport] 未能加载 ${plan.bodyFamily}，回退 NotoSansSC。`,
      );
    }

    const monoSrc = await loadFirstPdfFontDataUrl(
      plan.monoUrls,
      MIN_LATIN_FONT_BYTES,
    );
    if (!monoSrc) {
      console.warn("[pdfExport] 未能加载 DM Mono，代码块回退已注册的正文/CJK 字体。");
    }

    if (!bodySrc && !monoSrc) {
      console.warn(
        "[pdfExport] 未能远程加载可用字体，将使用 Helvetica，中文可能无法正常渲染（方块）。",
      );
      return { ready: false, pageFontFamily: "Helvetica" };
    }

    const bodyFamily =
      bodySrc && (primarySrc || plan.embed === "noto")
        ? plan.bodyFamily
        : PDF_FONT_FAMILY;

    if (bodySrc) {
      const aliases = new Set([bodyFamily, PDF_FONT_FAMILY, "Inter"]);
      for (const family of aliases) {
        registerFamilyVariants(Font, family, bodySrc);
      }
    }

    if (monoSrc) {
      registerFamilyVariants(Font, PDF_DM_MONO_FAMILY, monoSrc);
      registerFamilyVariants(Font, "GeistMono", monoSrc);
    } else if (bodySrc) {
      registerFamilyVariants(Font, PDF_DM_MONO_FAMILY, bodySrc);
      registerFamilyVariants(Font, "GeistMono", bodySrc);
    }

    if (!hyphenationRegistered) {
      Font.registerHyphenationCallback((word) => [word]);
      hyphenationRegistered = true;
    }

    let pageFontFamily: string | string[];
    if (plan.embed === "dm-mono") {
      const stack: string[] = [];
      if (monoSrc) stack.push(PDF_DM_MONO_FAMILY);
      if (bodySrc) stack.push(bodyFamily);
      pageFontFamily = stack.length === 1 ? stack[0] : stack;
    } else {
      pageFontFamily = bodySrc ? bodyFamily : "Helvetica";
    }

    lastRegisterResult = { ready: Boolean(bodySrc || monoSrc), pageFontFamily };
    registeredKey = planKey;
    return lastRegisterResult;
  } catch (error) {
    console.warn("[pdfExport] 字体注册失败，将使用 Helvetica，中文可能无法正常渲染。", error);
    return { ready: false, pageFontFamily: "Helvetica" };
  }
}
