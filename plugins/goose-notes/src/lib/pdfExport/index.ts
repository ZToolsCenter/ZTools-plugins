/**
 * PDF 导出入口。
 *
 * - dynamic import @blocknote/xl-pdf-exporter + @react-pdf/renderer，避免拖慢首屏
 * - 默认 A4；按笔记 fontFamily + customFonts 远程拉单文件字体，读成 data URL 再注册；失败降级 Noto/Helvetica，不打进包
 * - 通过 saveBlobAndReveal 走 uTools 保存通道，浏览器端回退到 a[download]
 * - 导出前统一整理 content（含本地文件夹 doc 对象 / 空 inline）
 */

import type { Page } from "@/types";
import type { CustomFonts } from "@/stores/useSettings";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { saveBlobAndReveal } from "@/lib/export/fileSave";
import { prepareExportBlocks } from "@/lib/export/prepareExportBlocks";
import { registerPdfFonts } from "./fontConfig";
import { createPdfBlockMappings } from "./blockMappings";

/** 薄 getter：避免 fontConfig 静态绑 zustand。 */
async function readExportCustomFonts(): Promise<CustomFonts> {
  const { useSettings } = await import("@/stores/useSettings");
  return useSettings.getState().customFonts;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "untitled";
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  try {
    const saved = await saveBlobAndReveal(blob, filename);
    if (saved) return;
  } catch (error) {
    console.error("[pdfExport] saveBlobAndReveal 失败，尝试浏览器下载:", error);
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  } catch (error) {
    throw new Error("PDF 保存失败：无法写入文件", { cause: error });
  }
}

export async function exportToPDF(
  page: Page,
  customFonts?: CustomFonts,
): Promise<void> {
  const title = getPageTitle(page) || "untitled";
  const filename = `${sanitizeFileName(title)}.pdf`;

  const fonts = customFonts ?? (await readExportCustomFonts());
  const registered = await registerPdfFonts({
    fontFamily: page.fontFamily ?? "default",
    customFonts: fonts,
  });

  const [{ PDFExporter }, ReactPDF, { editorSchema }, { pdfDefaultSchemaMappings }] =
    await Promise.all([
      import("@blocknote/xl-pdf-exporter"),
      import("@react-pdf/renderer"),
      import("@/components/editor/core/EditorComposer"),
      import("@blocknote/xl-pdf-exporter"),
    ]);

  const blockMapping = await createPdfBlockMappings({
    pageLocalFilePath: page.localFilePath ?? null,
  });
  const mergedMappings = {
    blockMapping: blockMapping as unknown as typeof pdfDefaultSchemaMappings.blockMapping,
    inlineContentMapping: pdfDefaultSchemaMappings.inlineContentMapping,
    styleMapping: pdfDefaultSchemaMappings.styleMapping,
  };

  // emojiSource:false —— 不要去拉 twemoji CDN（插件离线 / file:// 会 Failed to fetch）
  // resolveFileUrl: 已是 data:/http(s) 的资源原样返回，禁止走 BlockNote CORS 代理
  const exporter = new PDFExporter(editorSchema as any, mergedMappings as any, {
    emojiSource: false,
    resolveFileUrl: async (url: string) => url,
  });
  // 跳过默认 registerFonts：运行时不要再 import 那 4 套 Inter/Geist 字体。
  // 构建期靠 vite alias 把 Inter_18pt / GeistMono 指到 pdf-font-empty，避免打进 dist。
  // 拉丁/CJK 由 registerPdfFonts 按笔记字体覆盖；失败则 Helvetica，中文可能方块。
  (exporter as unknown as { fontsRegistered: boolean }).fontsRegistered = true;
  if (registered.ready) {
    (exporter.styles as any).page = {
      ...(exporter.styles as any).page,
      fontFamily: registered.pageFontFamily,
    };
  }

  const blocks = await prepareExportBlocks(page);
  const document = await exporter.toReactPDFDocument(blocks as any);
  const blob = await ReactPDF.pdf(document).toBlob();
  await downloadBlob(blob, filename);
}
