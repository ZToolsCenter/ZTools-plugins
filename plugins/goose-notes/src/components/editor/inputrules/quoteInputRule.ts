import { createExtension } from "@blocknote/core";

/**
 * 引用触发：在块行首输入「竖线 + 空格」时转 quote，支持半角 `| `(U+007C)与全角 `｜ `(U+FF5C)。
 *
 * 为什么不用内置的 `> `：`>` 已让给折叠功能（行首 `> ` → 折叠标题/折叠列表），
 * 内置 `> ` → quote 规则由 disableExtensions(['quote-block-shortcuts']) 禁用（见 Editor.tsx）。
 * 竖线 `|`/`｜` 形似引用左边线，且不与折叠 / 箭头 / markdown 其它规则冲突。
 */
export const gooseQuoteInputRuleExtension = createExtension({
  key: "goose-quote-input-rules",
  inputRules: [
    {
      find: /^[|｜]\s$/u,
      replace: () => ({
        type: "quote",
        props: {},
      }),
    },
  ],
});
