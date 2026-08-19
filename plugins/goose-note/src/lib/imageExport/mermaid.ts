import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { CardTheme } from "./themes";

export const MERMAID_EXPORT_FONT =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif';

type MermaidExportMode = "light" | "dark";

function getCodeBlockText(block: any): string {
  const content = block?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

function expandViewBox(svg: string, padding = 12): string {
  const match = svg.match(/\sviewBox="([^"]+)"/);
  if (!match) return svg;

  const values = match[1].split(/\s+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return svg;
  }

  const [x, y, width, height] = values;
  const nextX = x - padding;
  const nextY = y - padding;
  const nextWidth = width + padding * 2;
  const nextHeight = height + padding * 2;
  const nextViewBox = `${nextX} ${nextY} ${nextWidth} ${nextHeight}`;
  const nextWidthAttr = String(Math.ceil(nextWidth));
  const nextHeightAttr = String(Math.ceil(nextHeight));

  let nextSvg = svg.replace(match[0], ` viewBox="${nextViewBox}"`);
  nextSvg = /\swidth="[^"]*"/.test(nextSvg)
    ? nextSvg.replace(/\swidth="[^"]*"/, ` width="${nextWidthAttr}"`)
    : nextSvg.replace("<svg ", `<svg width="${nextWidthAttr}" `);
  nextSvg = /\sheight="[^"]*"/.test(nextSvg)
    ? nextSvg.replace(/\sheight="[^"]*"/, ` height="${nextHeightAttr}"`)
    : nextSvg.replace("<svg ", `<svg height="${nextHeightAttr}" `);

  return nextSvg;
}

function hardenMermaidSvg(svg: string): string {
  const exportStyle = `<style>
svg { overflow: visible; }
foreignObject { overflow: visible; }
.label, .nodeLabel, .edgeLabel, .edgeLabel p, .label p {
  font-family: ${MERMAID_EXPORT_FONT};
  line-height: 1.35;
}
.label p, .nodeLabel p, .edgeLabel p {
  margin: 0;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: break-word;
  text-align: center;
  max-width: 280px;
}
</style>`;

  const withFixedSizing = expandViewBox(svg)
    .replace(/\sstyle="[^"]*max-width:[^"]*"/, "")
    .replace("<svg ", '<svg style="overflow:visible;background:transparent" ');

  return withFixedSizing.replace(/(<svg\b[^>]*>)/, `$1${exportStyle}`);
}

export async function renderMermaidSvgForExport(
  source: string,
  mode: MermaidExportMode,
): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: mode === "dark" ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: MERMAID_EXPORT_FONT,
    themeVariables: {
      fontFamily: MERMAID_EXPORT_FONT,
    },
    flowchart: {
      // 导出/预览都按内容固有尺寸，避免 useMaxWidth 把大图压扁后栅格发糊
      useMaxWidth: false,
      htmlLabels: true,
      padding: 16,
    },
    suppressErrorRendering: true,
  });

  const id = `mermaid-export-${Math.random().toString(36).slice(2, 11)}`;
  const { svg } = await mermaid.render(id, source);
  return hardenMermaidSvg(svg);
}

export function mermaidSvgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function renderMermaidBlockAsImage(block: any, theme: CardTheme): Promise<void> {
  if (block?.type !== "codeBlock" || block.props?.language !== "mermaid") return;

  const source = getCodeBlockText(block).trim();
  if (!source) return;

  try {
    const svg = await renderMermaidSvgForExport(source, theme.mode);
    block.type = "image";
    block.content = undefined;
    block.children = [];
    block.props = {
      url: mermaidSvgToDataUrl(svg),
      caption: "Mermaid",
      textAlignment: "center",
    };
  } catch (error) {
    console.error("[imageExport] mermaid render failed:", error);
  }
}

async function walkBlocks(blocks: any[], theme: CardTheme): Promise<void> {
  for (const block of blocks) {
    await renderMermaidBlockAsImage(block, theme);
    if (Array.isArray(block?.children) && block.children.length > 0) {
      await walkBlocks(block.children, theme);
    }
  }
}

export async function renderMermaidBlocksAsImages(
  blocks: BlockNoteContent,
  theme: CardTheme,
): Promise<void> {
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  await walkBlocks(blocks as any[], theme);
}
