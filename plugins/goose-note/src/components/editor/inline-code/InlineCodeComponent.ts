import {
  createStyleSpecFromTipTapMark,
  defaultStyleSpecs,
} from "@blocknote/core";

/**
 * 编辑态在 `<code>` 内额外渲染两个零宽 boundary span。
 *
 * 浏览器会把「code 内首字符前」与「code 外左侧」当成同一个可视光标位置，
 * 只靠文本节点偏移无法把光标钉进圆角盒内。零宽 inline-block 是原子行内盒，
 * 它前后的 DOM 位置在布局上互不等价，光标插件据此可靠地区分盒内 / 盒外。
 * 内容 span 是 ProseMirror 的要求：内容洞必须是父节点的唯一子节点。
 */
const inlineCodeMark = defaultStyleSpecs.code.implementation.mark.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "code",
      { ...HTMLAttributes, "data-goose-inline-code": "" },
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

/** 外部 HTML 输出标准 `<code>`，不把编辑器专用的 boundary 节点复制出去。 */
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
