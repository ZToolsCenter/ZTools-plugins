import type { PartialBlock } from "@blocknote/core";
import type { RefObject } from "react";
import type { EditorRef } from "@/components/editor/core/Editor";
import { svgToDataUrl } from "@/lib/notebook-ai/svgSanitizer";
import {
  appendPageContentSafely,
  guardPageForAiWrite,
} from "@/lib/notebook-ai/pageWriteGuard";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import type { JSONContent } from "@/types";

type ArtifactEditorRef = RefObject<EditorRef | null>;
type ArtifactEditor = NonNullable<EditorRef["editor"]>;
type EditorBlockLike = { id?: string; content?: unknown };

function headingBlock(title: string): PartialBlock {
  return {
    type: "heading",
    props: { level: 3 },
    content: title,
  };
}

export function createMermaidArtifactBlocks(
  title: string | undefined,
  source: string,
): PartialBlock[] {
  const blocks: PartialBlock[] = [];
  const trimmedTitle = title?.trim();
  if (trimmedTitle) blocks.push(headingBlock(trimmedTitle));
  blocks.push({
    type: "codeBlock",
    props: { language: "mermaid" },
    content: source.trim(),
  });
  return blocks;
}

export function createSvgArtifactBlocks(
  title: string | undefined,
  sanitizedSvg: string,
): PartialBlock[] {
  if (!sanitizedSvg.trim()) return [];

  const blocks: PartialBlock[] = [];
  const trimmedTitle = title?.trim();
  if (trimmedTitle) blocks.push(headingBlock(trimmedTitle));
  blocks.push({
    type: "image",
    props: {
      url: svgToDataUrl(sanitizedSvg),
      caption: trimmedTitle || "SVG",
      textAlignment: "center",
    },
  });
  return blocks;
}

function isEmptyInlineBlock(block: unknown): boolean {
  const content = (block as EditorBlockLike | null | undefined)?.content;
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return false;
  return content.every((item) => {
    if (typeof item === "string") return item.trim().length === 0;
    if (!item || typeof item !== "object") return true;
    if (typeof item.text === "string") return item.text.trim().length === 0;
    return false;
  });
}

function focusInsertedBlock(editor: ArtifactEditor, block: unknown) {
  const blockId = (block as EditorBlockLike | null | undefined)?.id;

  window.setTimeout(() => {
    try {
      editor.setTextCursorPosition(
        block as Parameters<ArtifactEditor["setTextCursorPosition"]>[0],
        "end",
      );
    } catch {
      // Image and other non-text blocks cannot receive a text cursor.
    }
    editor.focus();
  }, 0);

  requestAnimationFrame(() => {
    if (!blockId) return;
    const element = document.querySelector(
      `[data-id="${blockId}"]`,
    ) as HTMLElement | null;
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function insertBlocksAtEditorCursor(
  editor: EditorRef["editor"],
  blocks: PartialBlock[],
): boolean {
  if (!editor || blocks.length === 0) return false;

  let anchorBlock: unknown | undefined;
  try {
    anchorBlock = editor.getTextCursorPosition().block;
  } catch {
    anchorBlock = undefined;
  }

  anchorBlock ??= editor.document.at(-1);
  if (!anchorBlock) return false;

  let inserted: unknown[];
  try {
    if (isEmptyInlineBlock(anchorBlock)) {
      editor.updateBlock(
        anchorBlock as Parameters<ArtifactEditor["updateBlock"]>[0],
        blocks[0] as Parameters<ArtifactEditor["updateBlock"]>[1],
      );
      inserted = [anchorBlock];
      if (blocks.length > 1) {
        inserted.push(
          ...editor.insertBlocks(
            blocks.slice(1) as Parameters<ArtifactEditor["insertBlocks"]>[0],
            anchorBlock as Parameters<ArtifactEditor["insertBlocks"]>[1],
            "after",
          ),
        );
      }
    } else {
      inserted = editor.insertBlocks(
        blocks as Parameters<ArtifactEditor["insertBlocks"]>[0],
        anchorBlock as Parameters<ArtifactEditor["insertBlocks"]>[1],
        "after",
      );
    }
  } catch {
    return false;
  }

  const target = inserted[inserted.length - 1] ?? anchorBlock;
  if (target) focusInsertedBlock(editor, target);
  return true;
}

export type ArtifactInsertResult =
  | { ok: true; pageId: string }
  | { ok: false; error: string };

function guardActiveArtifactPage() {
  const pageId = usePages.getState().activePageId;
  const expectedNotebookId = useNotebooks.getState().activeNotebookId;
  const guard = guardPageForAiWrite(pageId ?? "", { expectedNotebookId });
  return { pageId, expectedNotebookId, guard };
}

async function appendBlocksToActivePage(
  blocks: PartialBlock[],
): Promise<ArtifactInsertResult> {
  const { pageId, expectedNotebookId, guard } = guardActiveArtifactPage();
  if (!pageId || !guard.ok) {
    return { ok: false, error: guard.ok ? "当前没有打开页面" : guard.error };
  }
  const result = await appendPageContentSafely(pageId, blocks as JSONContent, {
    expectedNotebookId,
  });
  return result.ok ? { ok: true, pageId } : { ok: false, error: result.error };
}

export async function insertArtifactBlocks(
  editorRef: ArtifactEditorRef | undefined,
  blocks: PartialBlock[],
): Promise<ArtifactInsertResult> {
  if (blocks.length === 0) return { ok: false, error: "没有可插入的内容" };

  const { pageId, guard } = guardActiveArtifactPage();
  if (!pageId || !guard.ok) {
    return { ok: false, error: guard.ok ? "当前没有打开页面" : guard.error };
  }
  if (insertBlocksAtEditorCursor(editorRef?.current?.editor ?? null, blocks)) {
    return { ok: true, pageId };
  }
  return appendBlocksToActivePage(blocks);
}
