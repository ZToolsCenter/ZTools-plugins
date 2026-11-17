import { useEffect } from "react";
import { getSelectionBlockInfo } from "../utils/selectionUtils";
import { transformRelativeImageUrlsToAbsolute } from "../utils/pathUtils";
import { MarkdownBlock } from "../types/typora";

export function useMarkdownCopyTransform(options: {
  docPath: string | null;
  blocks: MarkdownBlock[];
  yamlRootUrl?: string;
  copyImagesAsAbsolute: boolean;
}): void {
  const { docPath, blocks, yamlRootUrl, copyImagesAsAbsolute } = options;
  useEffect(() => {
    const handleDocumentCopy = (e: ClipboardEvent) => {
      if (copyImagesAsAbsolute === false || !docPath) {
        return;
      }

      let selectedText = "";
      const activeEl = document.activeElement;
      const isInput = activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement;
      if (
        activeEl &&
        (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement)
      ) {
        const start = activeEl.selectionStart ?? 0;
        const end = activeEl.selectionEnd ?? 0;
        if (start < end) {
          selectedText = activeEl.value.slice(start, end);
        }
      }

      // If copying inside CodeMirror 6, CodeMirror already handles copy via view.state.sliceDoc
      if (document.activeElement?.closest(".cm-editor")) {
        return;
      }

      const selection = window.getSelection();
      if (!isInput && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const info = getSelectionBlockInfo(selection, blocks);
        if (info && e.clipboardData) {
          e.preventDefault();
          const rawMarkdown =
            info.coveredBlocks.length > 1
              ? info.coveredBlocks.map((b) => b.raw).join("\n\n")
              : (info.startBlock.raw || selection.toString());
          e.clipboardData.setData("text/plain", rawMarkdown);
          e.clipboardData.setData("text/markdown", rawMarkdown);
          return;
        }
      }

      if (!selectedText && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        selectedText = selection.toString();
      }

      if (!selectedText) return;

      // Check if selected content contains relative markdown or HTML image references
      if (
        /!\[[^\]]*\]\((?!https?:|data:|blob:|file:|\/|[a-zA-Z]:)[^\s")]+(?:\s+["'][^"']*["'])?\)/.test(
          selectedText
        ) ||
        /<img\s+[^>]*?src=["'](?!https?:|data:|blob:|file:|\/|[a-zA-Z]:)[^"']+["']/i.test(
          selectedText
        )
      ) {
        const transformed = transformRelativeImageUrlsToAbsolute(
          selectedText,
          docPath,
          yamlRootUrl
        );
        if (transformed !== selectedText && e.clipboardData) {
          e.preventDefault();
          e.clipboardData.setData("text/plain", transformed);
        }
      }
    };

    document.addEventListener("copy", handleDocumentCopy);
    return () => {
      document.removeEventListener("copy", handleDocumentCopy);
    };
  }, [docPath, blocks, yamlRootUrl, copyImagesAsAbsolute]);

}
