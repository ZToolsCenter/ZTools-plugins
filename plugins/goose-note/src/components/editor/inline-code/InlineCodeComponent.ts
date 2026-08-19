import {
  createStyleSpecFromTipTapMark,
  defaultStyleSpecs,
} from "@blocknote/core";

const inlineCodeMark = defaultStyleSpecs.code.implementation.mark.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "code",
      {
        ...HTMLAttributes,
        "data-goose-inline-code": "",
      },
      [
        "span",
        {
          "aria-hidden": "true",
          contenteditable: "false",
          "data-goose-inline-code-boundary": "start",
        },
      ],
      ["span", { "data-goose-inline-code-content": "" }, 0],
      [
        "span",
        {
          "aria-hidden": "true",
          contenteditable: "false",
          "data-goose-inline-code-boundary": "end",
        },
      ],
    ];
  },
});

const internalStyleSpec = createStyleSpecFromTipTapMark(
  inlineCodeMark,
  "boolean",
);

/**
 * 编辑态使用自有 DOM 组件，明确区分左右边界与真实内容。
 * 外部 HTML 仍输出标准 `<code>`，不会把编辑器边界节点复制出去。
 */
export const gooseInlineCodeStyleSpec: typeof internalStyleSpec = {
  ...internalStyleSpec,
  implementation: {
    ...internalStyleSpec.implementation,
    toExternalHTML() {
      const code = document.createElement("code");
      return { dom: code, contentDOM: code };
    },
  },
};

export const gooseEditorStyleSpecs = {
  ...defaultStyleSpecs,
  code: gooseInlineCodeStyleSpec,
};
