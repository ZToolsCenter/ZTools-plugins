import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { extractTitleFromContent } from "@/components/editor/utils/content-text-extractor";
import { getPageTitle } from "@/components/editor/utils/page-title";
import {
  normalizePageContent,
  createEmptyBlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import {
  blocksToMarkdown,
  blocksToHTML,
  EXPORT_HTML_HEAD_ASSETS,
  EXPORT_HTML_BODY_SCRIPTS,
} from "./blocknoteSerializer";
import { buildExportMarkdown, buildExportHtmlBody } from "./pageMarkdown";
import { inlineExportMediaAsBase64 } from "./inlineImagesBase64";
import { importFromMarkdown, type ImportResult } from "./markdown/parse";
import { saveBlobAndReveal, triggerBrowserDownload } from "./fileSave";

export { jsonContentToMarkdown } from "./markdown/serialize";
export { blocksToMarkdown, blocksToHTML } from "./blocknoteSerializer";
export {
  importFromMarkdown,
  importMarkdownFragment,
  type ImportResult,
} from "./markdown/parse";
export {
  exportNotebooks,
  generateExportZip,
  inspectNotebookImportZip,
  importNotebooksFromZip,
  type ExportOptions,
} from "./zipBundle";
export { saveBlobAndReveal, saveBlobWithPrompt } from "./fileSave";
export { exportToPDF } from "@/lib/pdfExport";

function cloneExportBlocks(content: BlockNoteContent): BlockNoteContent {
  return structuredClone(content ?? []) as BlockNoteContent;
}

async function downloadBlob(blob: Blob, filename: string) {
  try {
    const saved = await saveBlobAndReveal(blob, filename);
    if (saved) return;
  } catch (error) {
    console.error("[export] saveBlobAndReveal 失败，尝试浏览器下载:", error);
  }

  if (triggerBrowserDownload(blob, filename)) return;

  throw new Error("导出失败：无法保存文件");
}

async function downloadFile(
  content: string,
  filename: string,
  contentType: string,
) {
  try {
    const blob = new Blob([content], { type: contentType });
    await downloadBlob(blob, filename);
  } catch (error) {
    console.error("下载失败:", error);
    throw error;
  }
}

export async function exportToJSON(page: Page) {
  const data = JSON.stringify(page, null, 2);
  const title = getPageTitle(page);
  await downloadFile(data, `${title || "untitled"}.json`, "application/json");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function exportToMarkdown(page: Page) {
  const blocks = cloneExportBlocks(
    Array.isArray(page.content)
      ? (page.content as BlockNoteContent)
      : normalizePageContent(page.content),
  );
  await inlineExportMediaAsBase64(blocks, page.localFilePath);
  const fullMarkdown = await buildExportMarkdown(page, blocks);
  const title = getPageTitle(page);
  await downloadFile(
    fullMarkdown,
    `${title || "untitled"}.md`,
    "text/markdown",
  );
}

export async function exportToHTML(page: Page) {
  const blocks = cloneExportBlocks(
    Array.isArray(page.content)
      ? (page.content as BlockNoteContent)
      : normalizePageContent(page.content),
  );
  await inlineExportMediaAsBase64(blocks, page.localFilePath);
  const bodyHtml = await buildExportHtmlBody(page, blocks);
  const title = getPageTitle(page);
  const fullHtml = renderExportHtml(title, bodyHtml, !page.localFilePath);
  await downloadFile(fullHtml, `${title || "untitled"}.html`, "text/html");
}

export function renderExportHtml(
  title: string,
  bodyHtml: string,
  includeBodyH1 = true,
): string {
  const bodyHeading = includeBodyH1
    ? `<h1>${escapeHtmlText(title)}</h1>\n`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(title)}</title>
${EXPORT_HTML_HEAD_ASSETS}
<style>
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 820px; margin: 0 auto; padding: 2rem; line-height: 1.65; color: #1f2329; }
img { max-width: 100%; height: auto; }
video { display: block; max-width: 100%; height: auto; margin: 1rem 0; border-radius: 6px; background: #1f2329; }
blockquote { border-left: 3px solid #d0d7de; padding: 0 1rem; color: #57606a; margin: 1rem 0; }
code { background: #f2f3f5; color: #1f2329; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.88em; }
pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; }
pre code { background: transparent; padding: 0; }
pre.mermaid { background: transparent; padding: 0; text-align: center; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
table th, table td { border: 1px solid #d0d7de; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
table th { background: #f6f8fa; font-weight: 600; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5rem 0; }
ul, ol { padding-left: 1.5rem; }
a { color: #0969da; }
h1, h2, h3, h4 { line-height: 1.3; margin-top: 1.5em; scroll-margin-top: 1.5rem; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
input[type="checkbox"] { margin-right: 0.4em; }
.export-toc { position: fixed; z-index: 1; top: 1rem; left: 1rem; width: min(17rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; box-sizing: border-box; padding: 0.45rem; border: 1px solid #d8dee4; border-radius: 8px; background: #ffffff; box-shadow: 0 8px 24px rgba(31, 35, 40, 0.12); font-size: 0.875rem; }
.export-toc__header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.export-toc__title { margin: 0; color: #1f2329; font-size: 0.875rem; font-weight: 600; }
.export-toc__toggle { appearance: none; border: 0; border-radius: 5px; padding: 0.25rem 0.45rem; background: #f2f3f5; color: #1f2329; cursor: pointer; font: inherit; line-height: 1.25; }
.export-toc__toggle:hover { background: #e8eaed; }
.export-toc__list { margin: 0.4rem 0 0; padding: 0; list-style: none; }
.export-toc__item + .export-toc__item { margin-top: 0.15rem; }
.export-toc__link { display: block; overflow: hidden; padding: 0.18rem 0.35rem; border-radius: 4px; color: #57606a; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.export-toc__link:hover { background: #f2f3f5; color: #1f2329; }
.export-toc__item--h2 { padding-left: 0.75rem; }
.export-toc__item--h3 { padding-left: 1.5rem; }
.export-toc__item--h4 { padding-left: 2.25rem; }
.export-toc.is-collapsed { width: auto; overflow: visible; }
.export-toc.is-collapsed .export-toc__title, .export-toc.is-collapsed .export-toc__list { display: none; }
@media (max-width: 1100px) { .export-toc { position: static; width: 100%; max-height: none; margin: 0 0 1.5rem; } .export-toc.is-collapsed { width: fit-content; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
</head>
<body>
<nav class="export-toc" aria-label="文档目录">
  <div class="export-toc__header">
    <p class="export-toc__title">目录</p>
    <button class="export-toc__toggle" type="button" aria-expanded="true">收起</button>
  </div>
  <ol class="export-toc__list"></ol>
</nav>
<main id="export-content">
${bodyHeading}${bodyHtml}
</main>
<script>
(() => {
  const toc = document.querySelector('.export-toc');
  const list = toc?.querySelector('.export-toc__list');
  const toggle = toc?.querySelector('.export-toc__toggle');
  const headings = document.querySelectorAll('#export-content h1, #export-content h2, #export-content h3, #export-content h4');
  const usedIds = new Set();
  const makeId = (text) => {
    const base = text.trim().toLowerCase().replace(/[^\\w\\u4e00-\\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
    let id = base;
    let suffix = 2;
    while (usedIds.has(id) || document.getElementById(id)) id = base + '-' + suffix++;
    return id;
  };
  headings.forEach((heading) => {
    const text = heading.textContent?.trim();
    if (!text || !list) return;
    const existingId = heading.id;
    const id = existingId && !usedIds.has(existingId) ? existingId : makeId(text);
    heading.id = id;
    usedIds.add(id);
    const item = document.createElement('li');
    item.className = 'export-toc__item export-toc__item--' + heading.tagName.toLowerCase();
    const link = document.createElement('a');
    link.className = 'export-toc__link';
    link.href = '#' + encodeURIComponent(id);
    link.textContent = text;
    item.append(link);
    list.append(item);
  });
  if (!list?.children.length) toc?.remove();
  toggle?.addEventListener('click', () => {
    const collapsed = toc?.classList.toggle('is-collapsed') ?? false;
    toggle.textContent = collapsed ? '目录' : '收起';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
})();
</script>
${EXPORT_HTML_BODY_SCRIPTS}
</body>
</html>`;
}

export function importFromJSON(
  jsonString: string,
  filename?: string,
): ImportResult {
  try {
    const data: unknown = JSON.parse(jsonString);
    if (!data || typeof data !== "object" || !("content" in data)) {
      return {
        title: "",
        content: createEmptyBlockNoteContent(),
        success: false,
        error: "无效的 JSON 格式：缺少 content 字段",
      };
    }
    const record = data as Record<string, unknown>;
    if (!record.content || typeof record.content !== "object") {
      return {
        title: "",
        content: createEmptyBlockNoteContent(),
        success: false,
        error: "无效的 JSON 格式：缺少 content 字段",
      };
    }

    let title = filename || "导入的页面";
    if (typeof record.title === "string" && record.title) {
      title = record.title;
    } else {
      title =
        extractTitleFromContent(record.content as BlockNoteContent) ||
        filename ||
        "导入的页面";
    }

    return {
      title,
      content: normalizePageContent(record.content),
      success: true,
    };
  } catch {
    return {
      title: "",
      content: createEmptyBlockNoteContent(),
      success: false,
      error: "解析 JSON 失败",
    };
  }
}

export function importFile(): Promise<ImportResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.md,.markdown,.txt";

    let settled = false;
    const finish = (result: ImportResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const cancelled = () =>
      finish({
        title: "",
        content: createEmptyBlockNoteContent(),
        success: false,
        error: "未选择文件",
      });

    input.addEventListener("cancel", cancelled, { once: true });
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        cancelled();
        return;
      }

      try {
        const text = await file.text();
        const ext = file.name.split(".").pop()?.toLowerCase();
        const filename = file.name.replace(/\.[^/.]+$/, "");

        if (ext === "json") {
          finish(importFromJSON(text, filename));
        } else if (ext === "md" || ext === "markdown" || ext === "txt") {
          finish(importFromMarkdown(text, filename));
        } else {
          finish({
            title: "",
            content: createEmptyBlockNoteContent(),
            success: false,
            error: "不支持的文件格式",
          });
        }
      } catch (error) {
        finish({
          title: "",
          content: createEmptyBlockNoteContent(),
          success: false,
          error:
            error instanceof Error && error.message
              ? `读取文件失败：${error.message}`
              : "读取文件失败",
        });
      }
    };

    input.click();
  });
}
