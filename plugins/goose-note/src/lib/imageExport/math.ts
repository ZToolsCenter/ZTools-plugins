import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { CardTheme } from "./themes";

function getCodeBlockText(block: any): string {
  const content = block?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (item.type === "hardBreak") return "\n";
        return typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

/**
 * 将 KaTeX HTML 栅格化为 PNG data URL。
 * 不用 SVG foreignObject 作 img src（浏览器兼容差）；
 * 离屏 DOM + html-to-image 截图更稳。
 */
async function mathHtmlToPngDataUrl(html: string, theme: CardTheme): Promise<string> {
  const { captureElementAsPngBlob } = await import("./svgToPng");

  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    "z-index:-1",
    "padding:16px 24px",
    `color:${theme.textColor}`,
    "background:transparent",
    "font-size:18px",
    "line-height:1.4",
    "display:inline-block",
  ].join(";");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  try {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const blob = await captureElementAsPngBlob(wrapper);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("公式图片编码失败"));
      reader.readAsDataURL(blob);
    });
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function renderMathBlockAsImage(block: any, theme: CardTheme): Promise<void> {
  if (block?.type !== "codeBlock" || block.props?.language !== "math") return;

  const source = getCodeBlockText(block).trim();
  if (!source) return;

  try {
    const { default: katex } = await import("katex");
    // 确保 katex CSS 已注入（MathView 运行时会带；导出时可能未加载）
    if (typeof document !== "undefined" && !document.getElementById("goose-katex-css")) {
      try {
        // 动态 import 副作用 CSS 可能不可用；忽略失败，依赖内联样式
        const link = document.createElement("link");
        link.id = "goose-katex-css";
        link.rel = "stylesheet";
        link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
        document.head.appendChild(link);
        await new Promise<void>((resolve) => {
          link.onload = () => resolve();
          link.onerror = () => resolve();
          setTimeout(() => resolve(), 1500);
        });
      } catch {
        // ignore
      }
    }

    const html = katex.renderToString(source, {
      displayMode: true,
      throwOnError: false,
      output: "html",
    });

    const dataUrl = await mathHtmlToPngDataUrl(html, theme);
    block.type = "image";
    block.content = undefined;
    block.children = [];
    block.props = {
      url: dataUrl,
      caption: "公式",
      textAlignment: "center",
    };
  } catch (error) {
    console.error("[imageExport] math render failed:", error);
  }
}

async function walkBlocks(blocks: any[], theme: CardTheme): Promise<void> {
  for (const block of blocks) {
    await renderMathBlockAsImage(block, theme);
    if (Array.isArray(block?.children) && block.children.length > 0) {
      await walkBlocks(block.children, theme);
    }
  }
}

export async function renderMathBlocksAsImages(
  blocks: BlockNoteContent,
  theme: CardTheme,
): Promise<void> {
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  await walkBlocks(blocks as any[], theme);
}
