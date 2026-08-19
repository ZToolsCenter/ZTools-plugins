import type { BlockNoteEditor } from "@blocknote/core";
import { FilePanelExtension } from "@blocknote/core/extensions";
import { AIExtension } from "@blocknote/xl-ai";
import * as LucideIcons from "lucide-react";
import { isInsideToggle } from "@/components/editor/utils/toggleNesting";

export interface SlashMenuItem {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  aliases?: string[];
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
  children?: SlashMenuItem[];
  onItemClick: () => void;
}

export interface SlashMenuFeaturePolicy {
  transcodeVideoUploads: boolean;
  openAttachmentsExternally: boolean;
}

export function isSlashMenuDivider(item: SlashMenuItem): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    (item as { type?: string }).type === "divider"
  );
}

export function getBlockNoteSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  aiEnabled: boolean,
  features: SlashMenuFeaturePolicy = {
    transcodeVideoUploads: true,
    openAttachmentsExternally: true,
  },
): SlashMenuItem[] {
  // 插入完成后：把光标移到新块、把视图滚动到新块、把焦点交回编辑器
  const focusAndScrollTo = (block: { id: string }) => {
    try {
      editor.setTextCursorPosition(block, "end");
    } catch {
      /* block 可能已被 BlockNote 内部刷新；忽略 */
    }
    editor.focus();
    // React 自定义块（如 codeBlock）的 contentDOM 挂载是异步的：上面同步设的
    // PM 光标位置在 DOM 里找不到落点，会被回退到块容器外——表现为创建代码块后
    // 立刻粘贴贴到块外。等本轮事件处理结束、React 挂载完成后补设一次，把 DOM
    // 光标真正送进块内。用 setTimeout 而非 rAF：后台标签页 rAF 不触发。
    window.setTimeout(() => {
      try {
        editor.setTextCursorPosition(block, "end");
      } catch {
        /* block 可能已被 BlockNote 内部刷新；忽略 */
      }
      editor.focus();
    }, 0);
    // 等 DOM 更新一帧后再滚动，确保新块已渲染
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-id="${block.id}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const insertOrUpdate = (block: any): any => {
    // 必须在点击执行时实时读取当前块：BlockNote 在调用 onItemClick 之前已先跑过
    // closeMenu() → clearQuery()（删掉触发字符 / 或 、）。若沿用菜单构建时捕获的旧
    // 快照，content 仍带着 /，会误判 hasTrigger 并对陈旧 block 引用做二次清空，
    // 导致转换落到相邻块、整篇下移一行（用户反馈：第一行按 / 第二行却变成了标题）。
    const currentBlock = editor.getTextCursorPosition().block;
    const content = currentBlock.content as any;

    // 剥掉行首触发字符（/ 或 、），返回剩余 inline 内容。
    // 不能用「先 updateBlock 清空 content 再取光标块」的两步法：清空一个带 children 的块
    // （如折叠列表 toggleListItem）的标题后，光标会跳进它的第一个子块，第二步
    // getTextCursorPosition() 取到的是子块而非原块，导致转换落到子块、原块标题与缩进
    // 子内容（含图片）全部错乱丢失。改为对 currentBlock（稳定引用）一次性 updateBlock。
    const stripLeadingTrigger = (
      c: any,
    ): { hasTrigger: boolean; content: any } => {
      if (!Array.isArray(c) || c.length === 0 || c[0]?.type !== "text") {
        return { hasTrigger: false, content: c };
      }
      const text = c[0].text || "";
      const trigger = text.startsWith("/")
        ? "/"
        : text.startsWith("、")
          ? "、"
          : null;
      if (!trigger) return { hasTrigger: false, content: c };
      const nextText = text.slice(trigger.length);
      return {
        hasTrigger: true,
        content: nextText
          ? [{ ...c[0], text: nextText }, ...c.slice(1)]
          : c.slice(1),
      };
    };

    const stripped = stripLeadingTrigger(content);
    const hasTrigger = stripped.hasTrigger;

    let target: any;
    if (hasTrigger) {
      // 目标块若是 inline 内容块（段落/标题/各类列表项），保留剥掉触发符后的 content；
      // 若是结构化块（image/divider 等，content: "none"），不能塞 content。
      const targetKind = (editor.schema as any).blockSchema?.[block.type]
        ?.content;
      target = editor.updateBlock(
        currentBlock,
        targetKind === "inline"
          ? { ...block, content: stripped.content }
          : block,
      );
    } else {
      const isEmpty =
        !content ||
        (Array.isArray(content) && content.length === 0) ||
        (typeof content === "string" && content.trim() === "");
      if (isEmpty) {
        editor.updateBlock(currentBlock, block);
        target = currentBlock;
      } else {
        const [inserted] = editor.insertBlocks([block], currentBlock, "after");
        target = inserted;
      }
    }
    if (target?.id) focusAndScrollTo(target);
    return target;
  };

  const items: SlashMenuItem[] = [];

  // 未启用 AI 的构建不添加「生成」斜杠项。
  if (aiEnabled && (__GOOSE_EDITOR_AI__ || __HOST_TARGET__ === "native-editor")) {
    items.push({
      title: "生成",
      description: "接着写点什么...",
      icon: <LucideIcons.Sparkles size={18} />,
      aliases: ["ai", "generate", "shengcheng", "xiezuo", "sparkle"],
      onItemClick: () => {
        // 删除触发字符 / 或 、
        const pos = editor.getTextCursorPosition();
        const block = pos.block;
        const content = block.content as any[];
        if (
          Array.isArray(content) &&
          content.length === 1 &&
          content[0]?.type === "text" &&
          (content[0].text === "/" || content[0].text === "、")
        ) {
          editor.updateBlock(block, { content: [] });
        } else if (
          Array.isArray(content) &&
          content.length >= 1 &&
          content[0]?.type === "text" &&
          (content[0].text.startsWith("/") || content[0].text.startsWith("、"))
        ) {
          const newText = content[0].text.slice(1);
          editor.updateBlock(block, {
            content: newText ? [{ ...content[0], text: newText }] : [],
          });
        }

        if (__HOST_TARGET__ === "native-editor") {
          window.dispatchEvent(new CustomEvent("goose-note:native-ai-entry", {
            detail: { source: "slash" },
          }));
          return;
        }
        const ai = editor.getExtension(AIExtension);
        const blockId = editor.getTextCursorPosition().block.id;
        if (ai && blockId) {
          ai.openAIMenuAtBlock(blockId);
        }
      },
    });
  }

  items.push(
    {
      title: "一级标题",
      description: "大标题",
      icon: <LucideIcons.Heading1 size={18} />,
      aliases: ["h1", "heading1", "title", "biaoti"],
      badge: "#",
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 1 },
        }),
    },
    {
      title: "二级标题",
      description: "中标题",
      icon: <LucideIcons.Heading2 size={18} />,
      aliases: ["h2", "heading2", "subtitle", "biaoti"],
      badge: "##",
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 2 },
        }),
    },
    {
      title: "三级标题",
      description: "小标题",
      icon: <LucideIcons.Heading3 size={18} />,
      aliases: ["h3", "heading3", "biaoti"],
      badge: "###",
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 3 },
        }),
    },
    {
      title: "折叠一级标题",
      description: "可展开/收起下方内容的一级标题",
      icon: <LucideIcons.ChevronRightSquare size={18} />,
      aliases: [
        "toggleheading",
        "toggleh1",
        "toggle",
        "collapseheading",
        "fold",
        "zhediebiaoti",
        "zhedie",
        "shouqibiaoti",
      ],
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 1, isToggleable: true },
        }),
    },
    {
      title: "折叠二级标题",
      description: "可展开/收起下方内容的二级标题",
      icon: <LucideIcons.ChevronRightSquare size={18} />,
      aliases: [
        "toggleheading2",
        "toggleh2",
        "toggle",
        "fold",
        "zhedie",
        "zhedieerji",
      ],
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 2, isToggleable: true },
        }),
    },
    {
      title: "折叠三级标题",
      description: "可展开/收起下方内容的三级标题",
      icon: <LucideIcons.ChevronRightSquare size={18} />,
      aliases: [
        "toggleheading3",
        "toggleh3",
        "toggle",
        "fold",
        "zhedie",
        "zhediesanji",
      ],
      onItemClick: () =>
        insertOrUpdate({
          type: "heading",
          props: { level: 3, isToggleable: true },
        }),
    },
    { type: "divider" } as any,
    {
      title: "待办事项",
      description: "带有复选框的任务列表",
      icon: <LucideIcons.CheckSquare size={18} />,
      aliases: [
        "todo",
        "task",
        "daiban",
        "renwu",
        "提醒",
        "提醒事项",
        "tixing",
      ],
      badge: "[]",
      onItemClick: () => insertOrUpdate({ type: "checkListItem" }),
    },
    {
      title: "无序列表",
      description: "创建普通的项目符号列表",
      icon: <LucideIcons.List size={18} />,
      aliases: ["list", "bullet", "liebiao"],
      badge: "-",
      onItemClick: () => insertOrUpdate({ type: "bulletListItem" }),
    },
    {
      title: "有序列表",
      description: "创建带有数字的列表",
      icon: <LucideIcons.ListOrdered size={18} />,
      aliases: ["ordered", "list", "liebiao"],
      badge: "1.",
      onItemClick: () => insertOrUpdate({ type: "numberedListItem" }),
    },
    {
      title: "折叠列表",
      description: "可展开/收起内容的折叠列表",
      icon: <LucideIcons.ChevronRight size={18} />,
      aliases: ["toggle", "collapse", "fold", "zhedie", "shouqi"],
      badge: "> ",
      onItemClick: () => insertOrUpdate({ type: "toggleListItem" }),
    },
    {
      title: "引用",
      description: "插入一段引用文字",
      icon: <LucideIcons.Quote size={18} />,
      aliases: ["quote", "blockquote", "yinyong"],
      badge: "| ",
      onItemClick: () => insertOrUpdate({ type: "quote" }),
    },
    {
      title: "标注",
      description: "插入带图标的重点标注块",
      icon: <LucideIcons.Info size={18} />,
      aliases: ["callout", "annotation", "info", "biaozhu", "tishi"],
      onItemClick: () => insertOrUpdate({ type: "callout" }),
    },
    {
      title: "分隔线",
      description: "插入一条水平分割线",
      icon: <LucideIcons.Minus size={18} />,
      aliases: ["divider", "separator", "hr", "fengexian"],
      badge: "---",
      onItemClick: () => insertOrUpdate({ type: "divider" }),
    },
    { type: "divider" } as any,
    {
      title: "表格",
      description: "插入一个简单的表格",
      icon: <LucideIcons.Table size={18} />,
      aliases: ["table", "biaoge"],
      onItemClick: () => {
        insertOrUpdate({
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: ["", "", ""] }, { cells: ["", "", ""] }],
          },
        } as any);
      },
    },
    {
      title: "代码块",
      description: "插入带语法高亮的代码块",
      icon: <LucideIcons.Code size={18} />,
      aliases: ["code", "block", "daima"],
      badge: "```",
      onItemClick: () =>
        insertOrUpdate({ type: "codeBlock", props: { language: "markdown" } }),
    },
    {
      title: "数学公式",
      description: "插入数学公式块 (KaTeX)",
      icon: <LucideIcons.Sigma size={18} />,
      aliases: ["math", "formula", "gongshi", "katex"],
      onItemClick: () =>
        insertOrUpdate({ type: "codeBlock", props: { language: "math" } }),
    },
    {
      title: "Mermaid 图表",
      description: "插入流程图、时序图等 (Mermaid)",
      icon: <LucideIcons.GitGraph size={18} />,
      aliases: ["mermaid", "chart", "diagram", "tubiao"],
      onItemClick: () =>
        insertOrUpdate({ type: "codeBlock", props: { language: "mermaid" } }),
    },
    {
      title: "图片",
      description: "插入图片选择器模块",
      icon: <LucideIcons.Image size={18} />,
      aliases: ["image", "photo", "tupian", "img"],
      onItemClick: () => {
        const inserted = insertOrUpdate({ type: "image" });
        editor.getExtension(FilePanelExtension)?.showMenu(inserted.id);
      },
    },
    {
      title: "视频",
      description: features.transcodeVideoUploads
        ? "上传视频并自动压缩为可播放的 MP4"
        : "上传视频并保存为 Markdown 相对资源",
      icon: <LucideIcons.Video size={18} />,
      aliases: ["video", "movie", "shipin", "luping"],
      onItemClick: () => {
        const inserted = insertOrUpdate({ type: "video" });
        // 视频为 void 块，末尾补空行便于继续书写
        try {
          const last = editor.document.at(-1);
          if (last?.id === inserted?.id) {
            editor.insertBlocks(
              [{ type: "paragraph", content: "" }],
              inserted,
              "after",
            );
          }
        } catch {
          // ignore
        }
        editor.getExtension(FilePanelExtension)?.showMenu(inserted.id);
      },
    },
    {
      title: "文件",
      description: features.openAttachmentsExternally
        ? "上传附件并直接调用系统默认应用打开"
        : "上传附件并保存为 Markdown 相对资源",
      icon: <LucideIcons.FileUp size={18} />,
      aliases: ["file", "attachment", "pdf", "wenjian", "fujian"],
      onItemClick: () => {
        const inserted = insertOrUpdate({ type: "file" });
        editor.getExtension(FilePanelExtension)?.showMenu(inserted.id);
      },
    },
  );

  let menuItems = items;

  // 紧凑模式精简斜杠菜单，保留常用输入块。
  if (__GOOSE_EDITOR_COMPACT__) {
    const compactSlashTitles = new Set([
      "一级标题",
      "二级标题",
      "待办事项",
      "无序列表",
      "有序列表",
      "引用",
      "标注",
      "分隔线",
      "代码块",
      "图片",
    ]);
    menuItems = menuItems.filter(
      (it) => !isSlashMenuDivider(it) && compactSlashTitles.has(it.title),
    );
  }

  // 折叠块内部隐藏「折叠标题/折叠列表」项,避免无限折叠嵌套(任意后代)。
  // 统一 markdown 触发器也做了同样拦截。光标此时已在目标块。
  const currentBlock = editor.getTextCursorPosition().block;
  if (isInsideToggle(editor, currentBlock)) {
    const TOGGLE_TITLES = new Set([
      "折叠一级标题",
      "折叠二级标题",
      "折叠三级标题",
      "折叠列表",
    ]);
    return menuItems.filter((it) => !TOGGLE_TITLES.has(it.title));
  }

  return menuItems;
}

export function filterSlashMenuItems(
  items: SlashMenuItem[],
  query: string,
): SlashMenuItem[] {
  const q = query.trim().toLowerCase();

  // No query: return all items (dividers included for grouping)
  if (!q.length) return items;

  // With query: only return matching non-divider items
  const matched = items.filter((item) => {
    if ((item as any).type === "divider") return false;
    const haystacks = [
      item.title,
      item.description ?? "",
      ...(item.aliases ?? []),
    ].map((v) => v.toLowerCase());
    return haystacks.some((v) => v.includes(q));
  });

  return matched;
}
