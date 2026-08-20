/**
 * PDF 导出入口。
 *
 * - dynamic import @blocknote/xl-pdf-exporter + @react-pdf/renderer，避免拖慢首屏
 * - 默认 A4 + 中文 NotoSansSC（缺失时回退 Helvetica + warn）
 * - 通过 saveBlobAndReveal 走 uTools 保存通道，浏览器端回退到 a[download]
 * - 导出前统一整理 content（含本地文件夹 doc 对象 / 空 inline）
 */

import type { Page } from "@/types";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { saveBlobAndReveal } from "@/lib/export/fileSave";
import { prepareExportBlocks } from "@/lib/export/prepareExportBlocks";
import { registerPdfFonts, PDF_FONT_FAMILY } from "./fontConfig";
import { createPdfBlockMappings } from "./blockMappings";

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

export async function exportToPDF(page: Page): Promise<void> {
  const title = getPageTitle(page) || "untitled";
  const filename = `${sanitizeFileName(title)}.pdf`;

  await registerPdfFonts();

  const [{ PDFExporter }, ReactPDF, { editorSchema }, { pdfDefaultSchemaMappings }] =
    await Promise.all([
      import("@blocknote/xl-pdf-exporter"),
      import("@react-pdf/renderer"),
      import("@/components/editor/core/EditorComposer"),
      import("@blocknote/xl-pdf-exporter"),
    ]);

  const blockMapping = await createPdfBlockMappings();
  const mergedMappings = {
    blockMapping: blockMapping as unknown as typeof pdfDefaultSchemaMappings.blockMapping,
    inlineContentMapping: pdfDefaultSchemaMappings.inlineContentMapping,
    styleMapping: pdfDefaultSchemaMappings.styleMapping,
  };

  const exporter = new PDFExporter(editorSchema as any, mergedMappings as any, {});
  (exporter.styles as any).page = {
    ...(exporter.styles as any).page,
    fontFamily: PDF_FONT_FAMILY,
  };

  const blocks = await prepareExportBlocks(page);
  const document = await exporter.toReactPDFDocument(blocks as any);
  const blob = await ReactPDF.pdf(document).toBlob();
  await downloadBlob(blob, filename);
}
