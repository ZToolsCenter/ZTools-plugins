/**
 * PDF 导出入口。
 *
 * - dynamic import @blocknote/xl-pdf-exporter + @react-pdf/renderer，避免拖慢首屏
 * - 默认 A4 + 中文 NotoSansSC（缺失时回退 Helvetica + warn）
 * - 通过 saveBlobAndReveal 走 uTools 保存通道，浏览器端回退到 a[download]
 */

import { toast } from "@/components/ui/sonner";
import type { Page } from "@/types";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { saveBlobAndReveal } from "@/lib/export/fileSave";
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

  // 浏览器 fallback
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
  const title = extractTitleFromContent(page.content) || "untitled";
  const filename = `${sanitizeFileName(title)}.pdf`;

  const task = (async () => {
    // 1. 注册中文字体（幂等）
    await registerPdfFonts();

    // 2. dynamic import 核心依赖
    const [{ PDFExporter }, ReactPDF, { editorSchema }, { pdfDefaultSchemaMappings }] =
      await Promise.all([
        import("@blocknote/xl-pdf-exporter"),
        import("@react-pdf/renderer"),
        import("@/components/editor/core/EditorComposer"),
        import("@blocknote/xl-pdf-exporter"),
      ]);

    // 3. 合并 mappings：默认 inline + style，自定义 blockMapping
    const blockMapping = await createPdfBlockMappings();
    const mergedMappings = {
      blockMapping: blockMapping as unknown as typeof pdfDefaultSchemaMappings.blockMapping,
      inlineContentMapping: pdfDefaultSchemaMappings.inlineContentMapping,
      styleMapping: pdfDefaultSchemaMappings.styleMapping,
    };

    // 4. 构造 Exporter（默认 A4，配置中文字体）
    const exporter = new PDFExporter(editorSchema as any, mergedMappings as any, {
      // 中文优先字体
      // 若 NotoSansSC 注册失败，react-pdf 会自动回退到 Helvetica
    });
    // 覆盖 page 样式中的字体 family，让中文走 NotoSansSC
    (exporter.styles as any).page = {
      ...(exporter.styles as any).page,
      fontFamily: PDF_FONT_FAMILY,
    };

    // 5. 生成 react-pdf Document → Blob
    const blocks = (page.content as any[]) ?? [];
    const document = await exporter.toReactPDFDocument(blocks as any);
    const blob = await ReactPDF.pdf(document).toBlob();

    // 6. 写盘
    await downloadBlob(blob, filename);
  })();

  await toast.promise(task, {
    loading: "正在生成 PDF…",
    success: `已导出 ${filename}`,
    error: (err) => `导出失败：${err?.message ?? "未知错误"}`,
  });
}
