import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";

const PLUGIN_KEY = new PluginKey("goose-code-block-link-strip");

// 兜底：代码块内容必须是无 mark 的纯文本（语法高亮走 decoration，不依赖 mark）。
// 两类来源会往里塞 mark：
// 1. autolink 插件不区分 codeBlock node，块里写带协议的 URL 会被自动加 link mark；
// 2. 粘贴 Markdown/HTML 时围栏内容经 <pre><code> 解析，内层 <code> 被默认
//    行内 code 样式再解析一遍，代码块内每段文字都带上 inline code mark
//    （视觉上是一粒粒圆角小块）。
// 这里在每次 doc 变更后扫描所有代码块，把内部所有 mark 清掉。
export const gooseCodeBlockLinkStripExtension = createExtension({
  key: "goose-code-block-link-strip",
  prosemirrorPlugins: [
    new Plugin({
      key: PLUGIN_KEY,
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((t) => t.docChanged)) return null;

        const ranges: Array<{ from: number; to: number }> = [];
        newState.doc.descendants((node, pos) => {
          if (node.type.name !== "codeBlock") return true;
          node.descendants((child, offset) => {
            if (!child.isText) return true;
            if (child.marks.length === 0) return true;
            const from = pos + 1 + offset;
            ranges.push({ from, to: from + child.nodeSize });
            return false;
          });
          return false;
        });

        if (ranges.length === 0) return null;
        const tr = newState.tr;
        for (const r of ranges) tr.removeMark(r.from, r.to);
        return tr;
      },
    }),
  ],
});
