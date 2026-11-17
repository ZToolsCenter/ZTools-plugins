import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import {
  applyInlineFormatToText, convertBlockType, createEmptyTableBlock, serializeBlocksToMarkdown
} from "../core/markdownParser";
import { AlertKind, InlineFormatAction, LoadedDocument, MarkdownBlock, TyporaBridgeApi, TyporaPreferences } from "../types/typora";

type UpdateContent = (content: string, recordUndo?: boolean) => void;

export interface MarkdownEditorActionsOptions {
  doc: LoadedDocument;
  parsedBlocks: MarkdownBlock[];
  bridge: TyporaBridgeApi | null;
  preferences: Pick<TyporaPreferences, "imageRootPathMode">;
  focusedBlockId: string | null;
  selectedBlockIds: string[];
  lastActiveBlockIdRef: MutableRefObject<string | null>;
  setFocusedBlockId: Dispatch<SetStateAction<string | null>>;
  setSelectedBlockIds: Dispatch<SetStateAction<string[]>>;
  setTableModalOpen: Dispatch<SetStateAction<boolean>>;
  updateMarkdownContent: UpdateContent;
  showToast: (message: string) => void;
}

export function useMarkdownEditorActions(options: MarkdownEditorActionsOptions) {
  const {
    doc, parsedBlocks, bridge, preferences, focusedBlockId, selectedBlockIds,
    lastActiveBlockIdRef, setFocusedBlockId, setSelectedBlockIds, setTableModalOpen,
    updateMarkdownContent, showToast
  } = options;
  const parsed = { blocks: parsedBlocks };
  // Block-level mutations in Live Preview Editor
  const handleUpdateBlock = useCallback(
    (blockId: string, updatedBlock: MarkdownBlock) => {
      const nextBlocks = parsed.blocks.map((b) =>
        b.id === blockId ? updatedBlock : b
      );
      updateMarkdownContent(serializeBlocksToMarkdown(nextBlocks));
    },
    [parsed.blocks, updateMarkdownContent]
  );

  const handleReplaceBlockWithRaw = useCallback(
    (blockId: string, newRawMarkdown: string) => {
      const nextDoc = parsed.blocks
        .map((b) => (b.id === blockId ? newRawMarkdown : b.raw))
        .join("\n\n");
      updateMarkdownContent(nextDoc);
    },
    [parsed.blocks, updateMarkdownContent]
  );

  const handleInsertBlockAfter = useCallback(
    (afterBlockId: string, rawMarkdown = "", focusNewBlock = true) => {
      const idx = parsed.blocks.findIndex((b) => b.id === afterBlockId);
      const insertRaw = rawMarkdown !== undefined ? rawMarkdown : "";
      if (idx === -1) {
        updateMarkdownContent(
          doc.content.trim()
            ? `${doc.content.trimEnd()}\n\n${insertRaw}\n`
            : `${insertRaw}\n`
        );
        if (focusNewBlock) {
          setFocusedBlockId(`block-${parsed.blocks.length + 1}`);
        } else {
          setFocusedBlockId(null);
        }
        return;
      }
      const rawChunks = parsed.blocks.map((b) => b.raw);
      rawChunks.splice(idx + 1, 0, insertRaw);
      updateMarkdownContent(rawChunks.join("\n\n"));
      if (focusNewBlock) {
        setFocusedBlockId(`block-${idx + 2}`);
      } else {
        setFocusedBlockId(null);
      }
    },
    [doc.content, parsed.blocks, updateMarkdownContent]
  );

  const handleExitListAndInsertBlockAfter = useCallback(
    (blockId: string, trimmedListRaw: string) => {
      const idx = parsed.blocks.findIndex((b) => b.id === blockId);
      if (idx === -1) {
        updateMarkdownContent(trimmedListRaw);
        return;
      }
      const nextDoc = parsed.blocks
        .map((b) => (b.id === blockId ? trimmedListRaw : b.raw))
        .filter((raw) => raw.trim().length > 0)
        .join("\n\n");
      updateMarkdownContent(nextDoc);
      setFocusedBlockId(null);
    },
    [parsed.blocks, updateMarkdownContent]
  );

  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      if (parsed.blocks.length <= 1) {
        updateMarkdownContent("");
        setFocusedBlockId(null);
        setSelectedBlockIds([]);
        return;
      }
      const idx = parsed.blocks.findIndex((b) => b.id === blockId);
      const remaining = parsed.blocks
        .filter((b) => b.id !== blockId)
        .map((b) => b.raw);
      updateMarkdownContent(remaining.join("\n\n"));
      setSelectedBlockIds([]);
      const nextFocusIdx = Math.max(0, idx - 1);
      setFocusedBlockId(`block-${nextFocusIdx + 1}`);
    },
    [parsed.blocks, updateMarkdownContent]
  );

  const handleDeleteSelectedBlocks = useCallback(
    (targetIds?: string[]) => {
      const toDelete = new Set(targetIds || selectedBlockIds);
      if (toDelete.size === 0) return;
      const count = toDelete.size;
      const remaining = parsed.blocks
        .filter((b) => !toDelete.has(b.id))
        .map((b) => b.raw);
      updateMarkdownContent(remaining.join("\n\n"));
      setSelectedBlockIds([]);
      setFocusedBlockId(null);
      showToast(`已删除 ${count} 个模块`);
    },
    [parsed.blocks, selectedBlockIds, showToast, updateMarkdownContent]
  );

  // Convert active or last block to another block type (Paragraph menu / shortcuts)
  const handleConvertBlock = useCallback(
    (
      target:
        | "paragraph"
        | "heading"
        | "blockquote"
        | "alert"
        | "ul"
        | "ol"
        | "task"
        | "code"
        | "math",
      options?: { headingLevel?: 1 | 2 | 3 | 4 | 5 | 6; alertKind?: AlertKind }
    ) => {
      const targetBlock =
        parsed.blocks.find((b) => b.id === focusedBlockId) ||
        (lastActiveBlockIdRef.current
          ? parsed.blocks.find((b) => b.id === lastActiveBlockIdRef.current)
          : null) ||
        parsed.blocks[parsed.blocks.length - 1];
      if (!targetBlock) {
        const fallbackRaw =
          target === "heading"
            ? `${"#".repeat(options?.headingLevel || 2)} 新标题`
            : target === "code"
            ? "```typescript\n\n```"
            : target === "math"
            ? "$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$"
            : "新段落";
        updateMarkdownContent(fallbackRaw);
        return;
      }
      const convertedBlock = convertBlockType(targetBlock, target, options);
      handleReplaceBlockWithRaw(targetBlock.id, convertedBlock.raw);
    },
    [focusedBlockId, handleReplaceBlockWithRaw, parsed.blocks, updateMarkdownContent]
  );

  // Insert rich block (table, code, math, mermaid, toc, hr, frontmatter, footnote)
  const handleInsertBlock = useCallback(
    (
      kind:
        | "table"
        | "code"
        | "math"
        | "mermaid"
        | "toc"
        | "hr"
        | "frontmatter"
        | "footnote"
    ) => {
      if (kind === "table") {
        setTableModalOpen(true);
        return;
      }
      if (kind === "frontmatter") {
        if (parsed.blocks[0]?.type === "frontmatter") {
          setFocusedBlockId(parsed.blocks[0].id);
          return;
        }
        const fm = `---\ntitle: ${doc.name.replace(/\.md$/i, "")}\ndate: ${new Date()
          .toISOString()
          .slice(0, 10)}\n---`;
        updateMarkdownContent(`${fm}\n\n${doc.content}`);
        return;
      }

      const snippetMap: Record<string, string> = {
        code: "```typescript\nfunction helloMarkdown() {\n  console.log('Seamless Live Preview!');\n}\n```",
        math: "$$\n\\mathcal{L}(\\theta) = \\frac{1}{N}\\sum_{i=1}^{N} \\left(y_i - f_\\theta(x_i)\\right)^2\n$$",
        mermaid:
          "```mermaid\ngraph LR\n  A[Markdown AST] --> B[Live Preview]\n  B --> C[Export HTML/PDF]\n```",
        toc: "[TOC]",
        hr: "---",
        footnote: "[^note]: 这里填写脚注说明内容。"
      };

      const snippet = snippetMap[kind] || "";
      const afterId =
        focusedBlockId ||
        lastActiveBlockIdRef.current ||
        parsed.blocks[parsed.blocks.length - 1]?.id ||
        "";
      if (afterId) {
        handleInsertBlockAfter(afterId, snippet);
      } else {
        updateMarkdownContent(snippet);
      }
    },
    [
      doc.content,
      doc.name,
      focusedBlockId,
      handleInsertBlockAfter,
      parsed.blocks,
      updateMarkdownContent
    ]
  );

  // Insert table from TableInsertModal
  const handleConfirmInsertTable = useCallback(
    (cols: number, rows: number) => {
      const tableMd = createEmptyTableBlock(cols, rows);
      const afterId =
        focusedBlockId ||
        lastActiveBlockIdRef.current ||
        parsed.blocks[parsed.blocks.length - 1]?.id ||
        "";
      if (afterId) {
        handleInsertBlockAfter(afterId, tableMd);
      } else {
        updateMarkdownContent(tableMd);
      }
      showToast(`已插入 ${cols} 列 × ${rows} 行表格`);
    },
    [focusedBlockId, handleInsertBlockAfter, parsed.blocks, showToast, updateMarkdownContent]
  );

  // Apply inline format to active textarea selection or focused block
  const handleApplyInlineFormat = useCallback(
    (action: InlineFormatAction) => {
      const activeEl = document.activeElement;
      if (activeEl && activeEl instanceof HTMLTextAreaElement) {
        const start = activeEl.selectionStart ?? 0;
        const end = activeEl.selectionEnd ?? 0;
        const result = applyInlineFormatToText(
          activeEl.value,
          start,
          end,
          action
        );
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        nativeInputValueSetter?.call(activeEl, result.text);
        activeEl.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => {
          activeEl.focus();
          activeEl.setSelectionRange(result.nextStart, result.nextEnd);
        }, 10);
        return;
      }

      // If no textarea is focused, apply to the currently focused block or last paragraph
      const targetBlock =
        parsed.blocks.find((b) => b.id === focusedBlockId) ||
        (lastActiveBlockIdRef.current
          ? parsed.blocks.find((b) => b.id === lastActiveBlockIdRef.current)
          : null) ||
        parsed.blocks[parsed.blocks.length - 1];
      if (!targetBlock) return;
      const baseText = targetBlock.text || targetBlock.raw;
      const formatted = applyInlineFormatToText(
        baseText,
        0,
        baseText.length,
        action
      );
      if (targetBlock.type === "heading") {
        handleReplaceBlockWithRaw(
          targetBlock.id,
          `${"#".repeat(targetBlock.headingLevel || 1)} ${formatted.text}`
        );
      } else {
        handleReplaceBlockWithRaw(targetBlock.id, formatted.text);
      }
    },
    [focusedBlockId, handleReplaceBlockWithRaw, parsed.blocks]
  );

  // Insert local image and copy to ./assets
  const handleInsertLocalImage = useCallback(() => {
    if (!bridge?.selectImageFile) {
      handleApplyInlineFormat("image");
      return;
    }
    const chosenImg = bridge.selectImageFile();
    if (!chosenImg) return;

    if (doc.path && bridge.copyImageToAssets) {
      try {
        const copied = bridge.copyImageToAssets(doc.path, chosenImg, {
          usePerDocAssets: preferences.imageRootPathMode === "per-doc-assets"
        });
        const imgMd = `![image](${copied.relativeMarkdownPath})`;
        const afterId =
          focusedBlockId ||
          lastActiveBlockIdRef.current ||
          parsed.blocks[parsed.blocks.length - 1]?.id ||
          "";
        if (afterId) {
          handleInsertBlockAfter(afterId, imgMd);
        } else {
          updateMarkdownContent(`${doc.content}\n\n${imgMd}`);
        }
        showToast(`图片已复制到 ${copied.relativeMarkdownPath}`);
        return;
      } catch {
        // fallback to direct path
      }
    }
    const imgMd = `![image](${chosenImg})`;
    const afterId =
      focusedBlockId ||
      lastActiveBlockIdRef.current ||
      parsed.blocks[parsed.blocks.length - 1]?.id ||
      "";
    if (afterId) {
      handleInsertBlockAfter(afterId, imgMd);
    } else {
      updateMarkdownContent(`${doc.content}\n\n${imgMd}`);
    }
  }, [
    bridge,
    doc.content,
    doc.path,
    focusedBlockId,
    handleApplyInlineFormat,
    handleInsertBlockAfter,
    parsed.blocks,
    preferences.imageRootPathMode,
    showToast,
    updateMarkdownContent
  ]);

  // Handle pasted image data URL
  const handlePasteImageDataUrl = useCallback(
    (dataUrl: string): string | null => {
      if (doc.path && bridge?.copyImageToAssets) {
        try {
          const saved = bridge.copyImageToAssets(doc.path, dataUrl, {
            usePerDocAssets: preferences.imageRootPathMode === "per-doc-assets"
          });
          showToast(`已保存剪贴板图片至 ${saved.relativeMarkdownPath}`);
          return saved.relativeMarkdownPath;
        } catch {
          return dataUrl;
        }
      }
      return dataUrl;
    },
    [bridge, doc.path, preferences.imageRootPathMode, showToast]
  );


  return {
    handleUpdateBlock,
    handleReplaceBlockWithRaw,
    handleInsertBlockAfter,
    handleExitListAndInsertBlockAfter,
    handleDeleteBlock,
    handleDeleteSelectedBlocks,
    handleConvertBlock,
    handleInsertBlock,
    handleConfirmInsertTable,
    handleApplyInlineFormat,
    handleInsertLocalImage,
    handlePasteImageDataUrl
  };
}
