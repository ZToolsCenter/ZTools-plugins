/**
 * PDF 字体注册（中文支持）。
 *
 * 用户需手动放置 NotoSansSC-Regular.ttf 到 /public/fonts/，
 * 否则会回退到 @react-pdf/renderer 内置 Helvetica（不支持中文）。
 */

let registered = false;

export async function registerPdfFonts(): Promise<void> {
  if (registered) return;
  registered = true;

  try {
    const { Font } = await import("@react-pdf/renderer");
    Font.register({
      family: "NotoSansSC",
      src: "/fonts/NotoSansSC-Regular.ttf",
    });
    // 关闭 react-pdf 默认的连字与中英文断字优化（中文不需要）
    Font.registerHyphenationCallback((word) => [word]);
  } catch (error) {
    console.warn(
      "[pdfExport] NotoSansSC 字体注册失败，中文可能无法正常渲染。请将 NotoSansSC-Regular.ttf 放入 /public/fonts/ 目录。",
      error,
    );
  }
}

export const PDF_FONT_FAMILY = "NotoSansSC";
