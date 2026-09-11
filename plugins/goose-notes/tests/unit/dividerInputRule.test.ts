import { expect, test } from "playwright/test";

import { moveCursorAfterDivider } from "../../src/components/editor/inputrules/dividerInputRule";

type TestBlock = { id: string; type: string };

function createEditor(nextBlock?: TestBlock) {
  const divider = { id: "divider-1", type: "divider" };
  const inserted = { id: "paragraph-new", type: "paragraph" };
  const calls = {
    inserted: [] as Array<{
      blocks: Array<{ type: string; content: never[] }>;
      reference: TestBlock;
      placement: string;
    }>,
    focused: [] as Array<{ block: TestBlock; placement: string }>,
  };

  return {
    divider,
    inserted,
    calls,
    editor: {
      schema: {
        blockSpecs: {
          paragraph: { config: { content: "inline" } },
          heading: { config: { content: "inline" } },
          divider: { config: { content: "none" } },
        },
      },
      getBlock: (id: string) => (id === divider.id ? divider : undefined),
      getNextBlock: () => nextBlock,
      insertBlocks: (
        blocks: Array<{ type: string; content: never[] }>,
        reference: TestBlock,
        placement: "after",
      ) => {
        calls.inserted.push({ blocks, reference, placement });
        return [inserted];
      },
      setTextCursorPosition: (block: TestBlock, placement: "start") => {
        calls.focused.push({ block, placement });
      },
    },
  };
}

test("分割线在文档末尾时插入空段落并移动光标", () => {
  const { editor, divider, inserted, calls } = createEditor();

  moveCursorAfterDivider(editor, divider.id);

  expect(calls.inserted).toEqual([
    {
      blocks: [{ type: "paragraph", content: [] }],
      reference: divider,
      placement: "after",
    },
  ]);
  expect(calls.focused).toEqual([{ block: inserted, placement: "start" }]);
});

test("分割线下方已有可编辑块时直接移动光标，不增加空行", () => {
  const next = { id: "paragraph-2", type: "paragraph" };
  const { editor, divider, calls } = createEditor(next);

  moveCursorAfterDivider(editor, divider.id);

  expect(calls.inserted).toEqual([]);
  expect(calls.focused).toEqual([{ block: next, placement: "start" }]);
});

test("分割线下方仍是无光标块时在两者之间补空段落", () => {
  const next = { id: "divider-2", type: "divider" };
  const { editor, divider, inserted, calls } = createEditor(next);

  moveCursorAfterDivider(editor, divider.id);

  expect(calls.inserted).toHaveLength(1);
  expect(calls.focused).toEqual([{ block: inserted, placement: "start" }]);
});
