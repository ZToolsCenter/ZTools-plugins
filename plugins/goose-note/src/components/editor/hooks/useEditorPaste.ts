import { useCallback, type MutableRefObject } from "react";
import { Fragment, Slice } from "@tiptap/pm/model";
import { useCreateBlockNote } from "@blocknote/react";
import {
  isValidUrl,
  looksLikeBlockStructure,
  looksLikeMermaidDiagram,
  looksLikeMarkdownFragment,
  normalizeMarkdownPasteText,
  parseMarkdownLink,
} from "../utils/clipboard";
import { clipboardHasPasteableImage } from "../utils/pasteClipboardImage";
import { selectionIsInsideFirstTitleBlock } from "../toolbars/formatting/helpers";

type Editor = ReturnType<typeof useCreateBlockNote>;

type UseEditorPasteOptions = {
  editor: Editor;
  editable: boolean;
  shiftPressedRef: MutableRefObject<boolean>;
};

/**
 * 是否走「标题一隔离粘贴」：仅当选区完全落在物理首块 H1 内时。
 *
 * 旧逻辑用 `cursorBlock.id === document[0].id`，会把小窗 raw 首段、多 block 选区
 * （选区锚点落在首块）都误判成标题，于是 insertBlocks 在下方追加而不替换选区。
 * 跨块选区 / 非 H1 首块必须返回 false，让默认粘贴替换当前选区。
 */
export function shouldIsolateTitleStructurePaste(editor: {
  prosemirrorState: Editor["prosemirrorState"];
}): boolean {
  return selectionIsInsideFirstTitleBlock(editor as Editor);
}

export function useEditorPaste({
  editor,
  editable,
  shiftPressedRef,
}: UseEditorPasteOptions) {
  const handleEditorPasteCapture = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!editable) return;
      if (clipboardHasPasteableImage(event.clipboardData)) return;
      if (event.defaultPrevented) return;
      if (shiftPressedRef.current) return;
      if ((event.target as HTMLElement | null)?.closest(".goose-code-block-node")) return;

      const clipboard = event.clipboardData;
      const plainText = normalizeMarkdownPasteText(
        clipboard.getData("text/plain"),
      );
      const htmlText = clipboard.getData("text/html");

      if (looksLikeMermaidDiagram(plainText)) {
        event.preventDefault();
        event.stopPropagation();
        editor.pasteMarkdown(`\`\`\`mermaid\n${plainText.trim()}\n\`\`\``);
        return;
      }

      // ===== 标题一隔离：仅当选区完全落在「物理首块 H1」内时 =====
      // 标题一必须保持独立(恒为物理首块 H1、不被注入图片/列表/代码等结构)。
      // 默认粘贴会把图片等结构块塞成标题一的 children(实测 depth=1)，破坏其独立性。
      // 处理：标题内粘贴「非纯文本的块结构」时，拦截默认，把内容解析成块插到标题下方。
      // 注意：小窗 raw 首块不是 H1；跨块选区也不走此路径（见 shouldIsolateTitleStructurePaste）。
      // 纯文本(单行)不拦截 → 照常注入标题文字。
      //
      // 多 block 选区（含小窗全选后粘贴）必须交给默认粘贴，用剪贴板内容替换选区，
      // 绝不能 insertBlocks 追加，否则会出现「选中内容还在、下面又贴了一份」。
      {
        if (
          shouldIsolateTitleStructurePaste(editor) &&
          looksLikeBlockStructure(plainText, htmlText)
        ) {
          event.preventDefault();
          event.stopPropagation();
          void (async () => {
            let blocks: any[] = [];
            try {
              if (htmlText && htmlText.trim()) {
                blocks = await editor.tryParseHTMLToBlocks(htmlText);
              } else if (plainText) {
                blocks = await editor.tryParseMarkdownToBlocks(plainText);
              }
            } catch {
              blocks = [];
            }
            if (!blocks || blocks.length === 0) return;
            const titleBlock = editor.document[0];
            if (!titleBlock) return;
            // 直接插到标题之后；原有正文顺移，不覆盖标题。
            const inserted = editor.insertBlocks(blocks, titleBlock, "after");
            const last = inserted[inserted.length - 1];
            if (last) editor.setTextCursorPosition(last, "end");
          })();
          return;
        }
      }

      if (!plainText) return;

      const trimmedText = plainText.trim();

      // 0. 选区在 callout / quote 内，且粘贴含多行 → 以 hardBreak 软换行注入，
      //    避免默认 Markdown 解析把多行拆成多个独立 paragraph 块溢出容器
      // 同样地：在「空列表项」中粘贴时，默认 paste 会把外部 <p> 当成新段落块
      // 替换掉空的列表块，导致刚打出的 `- ` bullet 被挤掉。这里走同一条软换行路径，
      // 把粘贴内容作为内联文本注入，保留列表块本身。
      const pmState = editor.prosemirrorState;
      const $from = pmState.selection.$from;
      let inSoftWrapContainer = false;
      let inEmptyListItem = false;
      for (let d = $from.depth; d >= 1; d--) {
        const node = $from.node(d);
        if (node.type.name === "blockContainer") {
          const contentNode = d + 1 <= $from.depth ? $from.node(d + 1) : null;
          const name = contentNode?.type.name;
          if (name === "callout" || name === "quote") {
            inSoftWrapContainer = true;
          } else if (
            contentNode &&
            (name === "bulletListItem" ||
              name === "numberedListItem" ||
              name === "checkListItem" ||
              name === "toggleListItem") &&
            contentNode.content.size === 0
          ) {
            inEmptyListItem = true;
          }
          break;
        }
      }
      if (
        (inSoftWrapContainer && plainText.includes("\n")) ||
        inEmptyListItem
      ) {
        event.preventDefault();
        event.stopPropagation();
        const schema = pmState.schema;
        const hardBreakType = schema.nodes.hardBreak;
        const lines = plainText.split("\n");
        const nodes: any[] = [];
        lines.forEach((line, idx) => {
          if (idx > 0 && hardBreakType) nodes.push(hardBreakType.create());
          if (line.length > 0) nodes.push(schema.text(line));
        });
        const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
        editor.prosemirrorView.dispatch(
          pmState.tr.replaceSelection(slice).scrollIntoView(),
        );
        return;
      }

      // 1. 粘贴 Markdown 链接 [text](url) → 直接转为链接
      const mdLink = parseMarkdownLink(trimmedText);
      if (mdLink) {
        event.preventDefault();
        event.stopPropagation();
        editor.createLink(mdLink.url, mdLink.text);
        return;
      }

      // 2. 粘贴纯 URL → 根据是否有选中文本决定行为
      //    仅当整段「只是」一个 URL(内部无空白)时才建链;若是「URL + 空格 + 其它文字」
      //    (如 `http://x.com/p 登录地址必须用这个`),isValidUrl 的非 anchored 正则仍会
      //    命中开头的 URL → 整段被 createLink 吞成一个链接,后面的文字也被并进去。
      //    这类整段交给后续普通粘贴/autolink,只把真正的 URL 片段识别成链接。
      if (!/\s/.test(trimmedText) && isValidUrl(trimmedText)) {
        // 裸域名(baidu.com)/www. 开头没有协议，href 不补全的话 openUrl 打不开，
        // 这里统一补 https://，显示文本仍保留原文。
        const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedText)
          ? trimmedText
          : `https://${trimmedText}`;
        // 先尝试 BlockNote 的选中文本 API，fallback 到原生选区
        let selectedText = editor.getSelectedText();
        if (!selectedText?.trim()) {
          try {
            const sel = document.getSelection();
            selectedText = sel?.toString() || "";
          } catch { /* ignore */ }
        }

        if (selectedText?.trim()) {
          // 选中文本 + 粘贴 URL → 将选中文本转为链接
          event.preventDefault();
          event.stopPropagation();
          editor.createLink(href, selectedText);
          return;
        }

        // 无选中文本 + 粘贴纯 URL → 将 URL 作为链接文本插入
        event.preventDefault();
        event.stopPropagation();
        editor.createLink(href, trimmedText);
        return;
      }

      // 2.5 纯文本含 Markdown 代码围栏(```lang ... ```) → 强制走 pasteMarkdown。
      // 即便剪贴板同时带 text/html(从网页/IDE 复制常见),也优先用纯文本解析:
      // 默认 HTML 粘贴对自定义 codeBlock 易降级成段落,而 pasteMarkdown 能正确还原代码块。
      const hasMarkdownCodeFence = /(^|\n)\s*```/.test(plainText);
      if (hasMarkdownCodeFence) {
        event.preventDefault();
        event.stopPropagation();
        editor.pasteMarkdown(plainText);
        return;
      }

      // 3. 其他 Markdown 内容
      if (!looksLikeMarkdownFragment(plainText)) return;

      if (htmlText && htmlText.trim()) return;

      event.preventDefault();
      event.stopPropagation();
      editor.pasteMarkdown(plainText);
    },
    [editable, editor],
  );

  return { handleEditorPasteCapture };
}
