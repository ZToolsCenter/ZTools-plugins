import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

import { jsonContentToMarkdown } from "./markdown/serialize";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";

/**
 * 把 <pre><code class="language-mermaid">...</code></pre> 转成
 * <pre class="mermaid">...</pre>，便于浏览器侧 mermaid.js 自动渲染。
 */
function rehypeMermaid() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node) return;
      if (
        node.type === "element" &&
        node.tagName === "pre" &&
        Array.isArray(node.children)
      ) {
        const code = node.children.find(
          (c: any) => c && c.type === "element" && c.tagName === "code",
        );
        const cls = code?.properties?.className;
        const isMermaid =
          Array.isArray(cls) && cls.some((c: any) => c === "language-mermaid");
        if (isMermaid) {
          const text = (code.children || [])
            .map((c: any) => (typeof c?.value === "string" ? c.value : ""))
            .join("");
          node.tagName = "pre";
          node.properties = { className: ["mermaid"] };
          node.children = [{ type: "text", value: text }];
          return;
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}

const htmlPipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeKatex)
  .use(rehypeHighlight, { detect: true, ignoreMissing: true })
  .use(rehypeMermaid)
  .use(rehypeStringify, { allowDangerousHtml: true });

export async function blocksToMarkdown(
  blocks: BlockNoteContent,
): Promise<string> {
  return jsonContentToMarkdown(blocks);
}

export async function blocksToHTML(
  blocks: BlockNoteContent,
): Promise<string> {
  const md = jsonContentToMarkdown(blocks);
  const file = await htmlPipeline.process(md);
  return String(file);
}

/**
 * CDN 资源 — 注入到导出 HTML 的 <head> / <body> 末尾。
 * KaTeX：渲染 $$...$$ 数学公式
 * highlight.js：代码高亮（rehype-highlight 输出的是 hljs-* class）
 * mermaid：浏览器侧 auto-init，把 <pre class="mermaid"> 渲染成图
 */
export const EXPORT_HTML_HEAD_ASSETS = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css">
`.trim();

export const EXPORT_HTML_BODY_SCRIPTS = `
<script type="module">
  try {
    const mermaid = (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
    mermaid.initialize({ startOnLoad: true, theme: "default", securityLevel: "loose" });
  } catch (e) { console.warn("[export] mermaid 加载失败:", e); }
</script>
`.trim();
