import { createExtension } from "@blocknote/core";

type EditorBlock = {
  id: string;
  type: string;
};

type DividerCursorEditor = {
  schema: {
    blockSpecs?: Record<string, { config?: { content?: string } }>;
  };
  getBlock: (id: string) => EditorBlock | undefined;
  getNextBlock: (block: EditorBlock) => EditorBlock | undefined;
  insertBlocks: (
    blocks: Array<{ type: string; content: never[] }>,
    reference: EditorBlock,
    placement: "after",
  ) => EditorBlock[];
  setTextCursorPosition: (block: EditorBlock, placement: "start") => void;
};

/**
 * `---` 变成分割线后，把光标送到下一行。
 *
 * 若分割线下方已有可编辑块，直接聚焦它；若下方为空或仍是无光标块，
 * 就紧跟分割线插入一个空段落。这样不会为了移动光标改写已有正文。
 */
export function moveCursorAfterDivider(
  editor: DividerCursorEditor,
  dividerId: string,
): void {
  const divider = editor.getBlock(dividerId);
  if (!divider || divider.type !== "divider") return;

  const nextBlock = editor.getNextBlock(divider);
  const nextContentType = nextBlock
    ? editor.schema.blockSpecs?.[nextBlock.type]?.config?.content
    : undefined;

  if (nextBlock && nextContentType !== "none") {
    editor.setTextCursorPosition(nextBlock, "start");
    return;
  }

  const [paragraph] = editor.insertBlocks(
    [{ type: "paragraph", content: [] }],
    divider,
    "after",
  );
  if (paragraph) editor.setTextCursorPosition(paragraph, "start");
}

/**
 * 替代 BlockNote 原生 divider input rule。原规则会把选择留在 void block 上；
 * 等它的事务落地后，再通过公开 BlockNote API 建立下一行并移动光标。
 */
export const gooseDividerInputRuleExtension = createExtension(({ editor }) => ({
  key: "goose-divider-input-rule",
  inputRules: [
    {
      find: /^---$/,
      replace() {
        let blockId: string;
        try {
          blockId = editor.getTextCursorPosition().block.id;
        } catch {
          return undefined;
        }

        queueMicrotask(() =>
          moveCursorAfterDivider(
            editor as unknown as DividerCursorEditor,
            blockId,
          ),
        );
        return { type: "divider", props: {}, content: [] } as any;
      },
    },
  ],
}));
