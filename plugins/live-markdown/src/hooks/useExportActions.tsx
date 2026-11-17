import { useCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LivePreviewEditor } from "../components/LivePreviewEditor";
import { parseMarkdownDocument } from "../core/markdownParser";
import { getThemeCss, sanitizeExportHtmlBody } from "../core/themeStyles";
import { LoadedDocument, TyporaBridgeApi, TyporaPreferences, WorkspaceScanResult } from "../types/typora";
import { transformRelativeImageUrlsToAbsolute } from "../utils/pathUtils";

export interface ExportActionsOptions {
  doc: LoadedDocument;
  parsed: ReturnType<typeof parseMarkdownDocument>;
  preferences: TyporaPreferences;
  bridge: TyporaBridgeApi | null;
  workspace: WorkspaceScanResult | null;
  showToast: (message: string) => void;
}

export function useExportActions(options: ExportActionsOptions) {
  const { doc, parsed, preferences, bridge, workspace, showToast } = options;
  const buildCleanExportHtmlBody = useCallback(() => {
    try {
      const staticHtml = renderToStaticMarkup(
        <LivePreviewEditor
          markdown={doc.content}
          blocks={parsed.blocks}
          outline={parsed.outline}
          yamlMeta={parsed.yamlMeta}
          refLinks={parsed.refLinks}
          footnotes={parsed.footnotes}
          focusedBlockId={null}
          sourceMode={false}
          typewriterMode={false}
          searchHighlight=""
          docPath={doc.path}
          preferences={preferences}
          onFocusBlock={() => {}}
          onUpdateBlock={() => {}}
          onReplaceBlockWithRaw={() => {}}
          onInsertBlockAfter={() => {}}
          onDeleteBlock={() => {}}
          onChangeFullMarkdown={() => {}}
          onOpenLink={() => {}}
          onJumpToHeading={() => {}}
          onContextMenuRequest={() => {}}
        />
      );
      if (staticHtml) {
        return sanitizeExportHtmlBody(staticHtml);
      }
    } catch {
      // Fall back to live #write DOM below
    }
    const writeContainer = document.getElementById("write");
    const rawHtml =
      writeContainer?.innerHTML ||
      `<pre>${doc.content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`;
    return sanitizeExportHtmlBody(rawHtml);
  }, [doc.content, doc.path, parsed, preferences]);

  const handleExportHtml = useCallback(
    (includeStyles: boolean) => {
      const htmlBody = buildCleanExportHtmlBody();
      const themeCss = getThemeCss(preferences.theme);
      const docTitle = doc.name.replace(/\.(md|markdown|txt)$/i, "");

      if (bridge?.selectSaveFile && bridge?.exportHtmlFile) {
        const defaultHtmlName = `${docTitle}.html`;
        const savePath = bridge.selectSaveFile({
          title: "导出 HTML",
          defaultPath: `${workspace?.rootDir || doc.dir}/${defaultHtmlName}`,
          filters: [{ name: "HTML Document", extensions: ["html"] }]
        });
        if (savePath) {
          try {
            bridge.exportHtmlFile(savePath, {
              title: docTitle,
              htmlBody,
              themeName: preferences.theme,
              themeCss,
              includeStyles
            });
            showToast(`已导出 HTML 至 ${savePath}`);
            return;
          } catch (err) {
            showToast(
              `导出失败: ${err instanceof Error ? err.message : String(err)}`
            );
            return;
          }
        }
      }

      // Browser download fallback
      const safeTitle = docTitle
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const standalone = bridge?.buildStandaloneHtml
        ? bridge.buildStandaloneHtml({
            title: docTitle,
            htmlBody,
            themeName: preferences.theme,
            themeCss,
            includeStyles
          })
        : `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  ${includeStyles ? `<style>\n${themeCss}\n</style>` : ""}
</head>
<body class="typora-export" data-theme="${preferences.theme}">
  <div class="typora-export-content">
    <div id="write" class="is-node">
${htmlBody}
    </div>
  </div>
</body>
</html>`;

      const blob = new Blob([standalone], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${docTitle}.html`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("已导出 HTML 文件");
    },
    [
      bridge,
      buildCleanExportHtmlBody,
      doc.dir,
      doc.name,
      preferences.theme,
      showToast,
      workspace
    ]
  );

  const handlePrintPdf = useCallback(() => {
    window.print();
  }, []);

  const handleCopyAs = useCallback(
    (mode: "markdown" | "html" | "text") => {
      let textToCopy = doc.content;
      if (mode === "markdown") {
        if (preferences.copyImagesAsAbsolute !== false) {
          textToCopy = transformRelativeImageUrlsToAbsolute(
            doc.content,
            doc.path,
            parsed.yamlMeta["typora-root-url"]
          );
        }
      } else if (mode === "html") {
        textToCopy = buildCleanExportHtmlBody() || doc.content;
      } else if (mode === "text") {
        const writeEl = document.getElementById("write");
        textToCopy = writeEl?.innerText || doc.content;
      }
      if (bridge?.copyTextToClipboard) {
        bridge.copyTextToClipboard(textToCopy);
      } else {
        navigator.clipboard?.writeText(textToCopy);
      }
      showToast(
        mode === "markdown"
          ? "已复制 Markdown 源码 (图片已转换为绝对路径)"
          : mode === "html"
          ? "已复制 HTML 代码"
          : "已复制纯文本"
      );
    },
    [
      bridge,
      buildCleanExportHtmlBody,
      doc.content,
      doc.path,
      parsed.yamlMeta,
      preferences.copyImagesAsAbsolute,
      showToast
    ]
  );


  return { buildCleanExportHtmlBody, handleExportHtml, handlePrintPdf, handleCopyAs };
}
