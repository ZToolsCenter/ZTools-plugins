import React, { useEffect, useMemo, useRef } from "react";
import {
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Type,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  AlertTriangle,
  Minus,
  ListTree,
  Table,
  Code,
  Sigma,
  GitFork,
  Link,
  Image,
  Bookmark,
  X,
  Sparkles
} from "lucide-react";

export interface SlashCommandItem {
  id: string;
  group: string;
  label: string;
  description: string;
  badge: string;
  keywords: string[];
  template: string;
  cursorOffset?: number;
  icon: React.ReactNode;
  action?: string;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
  // 0. AI 创作助手
  {
    id: "ai_copilot",
    group: "AI 创作助手",
    label: "AI 创作助手 (Copilot)",
    description: "呼出 AI 助手，支持智能续写、润色、校对、架构图生成与 MCP 扩展",
    badge: "/ai",
    keywords: ["ai", "copilot", "chat", "assistant", "zhushou", "助手", "提问", "续写", "润色"],
    template: "",
    cursorOffset: 0,
    action: "ai_chat",
    icon: <Sparkles size={16} />
  },
  // 1. 基础文本与标题
  {
    id: "text",
    group: "基础文本",
    label: "正文文本",
    description: "普通正文段落，支持丰富行内样式",
    badge: "Text",
    keywords: ["text", "p", "paragraph", "zhengwen", "putong", "段落", "正文"],
    template: "",
    cursorOffset: 0,
    icon: <Type size={16} />
  },
  {
    id: "h1",
    group: "基础文本",
    label: "一级标题",
    description: "超大字号，用于整篇文章的主标题",
    badge: "#",
    keywords: ["h1", "heading1", "title", "1", "yiji", "biaoti", "一级", "标题"],
    template: "# ",
    cursorOffset: 2,
    icon: <Heading1 size={16} />
  },
  {
    id: "h2",
    group: "基础文本",
    label: "二级标题",
    description: "大字号，用于划分核心大章节",
    badge: "##",
    keywords: ["h2", "heading2", "section", "2", "erji", "二级", "章节"],
    template: "## ",
    cursorOffset: 3,
    icon: <Heading2 size={16} />
  },
  {
    id: "h3",
    group: "基础文本",
    label: "三级标题",
    description: "中字号，用于小节与细分段落",
    badge: "###",
    keywords: ["h3", "heading3", "subsection", "3", "sanji", "三级", "小节"],
    template: "### ",
    cursorOffset: 4,
    icon: <Heading3 size={16} />
  },
  {
    id: "h4",
    group: "基础文本",
    label: "四级标题",
    description: "四级小节标题",
    badge: "####",
    keywords: ["h4", "heading4", "4", "siji", "四级"],
    template: "#### ",
    cursorOffset: 5,
    icon: <Heading4 size={16} />
  },
  {
    id: "h5",
    group: "基础文本",
    label: "五级标题",
    description: "五级辅助标题",
    badge: "#####",
    keywords: ["h5", "heading5", "5", "wuji", "五级"],
    template: "##### ",
    cursorOffset: 6,
    icon: <Heading5 size={16} />
  },
  {
    id: "h6",
    group: "基础文本",
    label: "六级标题",
    description: "六级细致标题",
    badge: "######",
    keywords: ["h6", "heading6", "6", "liuji", "六级"],
    template: "###### ",
    cursorOffset: 7,
    icon: <Heading6 size={16} />
  },

  // 2. 列表与待办
  {
    id: "bullet_list",
    group: "列表与待办",
    label: "无序列表",
    description: "项目符号清单，组织平行要点",
    badge: "-",
    keywords: ["ul", "list", "bullet", "wuxu", "liebiao", "列表", "圆点"],
    template: "- ",
    cursorOffset: 2,
    icon: <List size={16} />
  },
  {
    id: "ordered_list",
    group: "列表与待办",
    label: "有序列表",
    description: "按序号递增的列表，组织步骤指引",
    badge: "1.",
    keywords: ["ol", "ordered", "number", "youxu", "序号", "步骤", "顺序"],
    template: "1. ",
    cursorOffset: 3,
    icon: <ListOrdered size={16} />
  },
  {
    id: "task_list",
    group: "列表与待办",
    label: "任务列表",
    description: "交互式可勾选的任务清单与待办事项",
    badge: "[ ]",
    keywords: ["todo", "task", "check", "daiban", "renwu", "待办", "勾选"],
    template: "- [ ] ",
    cursorOffset: 6,
    icon: <CheckSquare size={16} />
  },

  // 3. 结构与排版
  {
    id: "quote",
    group: "结构与排版",
    label: "引用",
    description: "突出重点引述文字或权威出处",
    badge: ">",
    keywords: ["quote", "blockquote", "yinyong", "引用", "名言"],
    template: "> ",
    cursorOffset: 2,
    icon: <Quote size={16} />
  },
  {
    id: "callout_note",
    group: "结构与排版",
    label: "高亮提示框 (Callout)",
    description: "飞书/GFM 风格高亮提示卡片，醒目传达信息",
    badge: "[!NOTE]",
    keywords: ["alert", "callout", "note", "tip", "tishi", "提示", "警告", "卡片"],
    template: "> [!NOTE]\n> 在此输入重要提示信息…",
    cursorOffset: 12,
    icon: <AlertTriangle size={16} />
  },
  {
    id: "divider",
    group: "结构与排版",
    label: "分割线",
    description: "横向分割线，划分视觉模块",
    badge: "---",
    keywords: ["hr", "divider", "line", "fengexian", "分割线", "横线"],
    template: "---\n",
    cursorOffset: 4,
    icon: <Minus size={16} />
  },
  {
    id: "toc",
    group: "结构与排版",
    label: "文章目录 (TOC)",
    description: "根据全文标题自动生成可跳转大纲目录",
    badge: "[toc]",
    keywords: ["toc", "tableofcontents", "mulu", "dagang", "目录", "大纲"],
    template: "[toc]\n",
    cursorOffset: 6,
    icon: <ListTree size={16} />
  },

  // 4. 多媒体与高级内容
  {
    id: "table",
    group: "高级内容",
    label: "表格",
    description: "插入标准 3x3 交互式所见即所得表格",
    badge: "| 表格",
    keywords: ["table", "grid", "biaoge", "表格", "数据", "单元格"],
    template: "| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 单元格 | 单元格 | 单元格 |\n| 单元格 | 单元格 | 单元格 |",
    cursorOffset: 2,
    icon: <Table size={16} />
  },
  {
    id: "code_block",
    group: "高级内容",
    label: "代码块",
    description: "支持语法高亮与行号的代码围栏",
    badge: "```",
    keywords: ["code", "fence", "program", "daima", "代码", "程序"],
    template: "```typescript\n// 在此编写代码\n```",
    cursorOffset: 14,
    icon: <Code size={16} />
  },
  {
    id: "math_block",
    group: "高级内容",
    label: "数学公式块",
    description: "LaTeX / MathJax 独立公式，数学科学排版",
    badge: "$$",
    keywords: ["math", "latex", "tex", "formula", "gongshi", "数学", "公式"],
    template: "$$\n\\sum_{i=1}^{n} x_i = X\n$$",
    cursorOffset: 3,
    icon: <Sigma size={16} />
  },
  {
    id: "mermaid_diagram",
    group: "高级内容",
    label: "Mermaid 图表",
    description: "文本即流程图、时序图、甘特图与思维导图",
    badge: "Mermaid",
    keywords: ["mermaid", "diagram", "chart", "flow", "tubiao", "图表", "流程图"],
    template: "```mermaid\ngraph TD\n  A[开始] --> B(处理步骤)\n  B --> C[完成目标]\n```",
    cursorOffset: 11,
    icon: <GitFork size={16} />
  },
  {
    id: "link",
    group: "高级内容",
    label: "超链接",
    description: "行内网页地址或文档内部锚点链接",
    badge: "[]()",
    keywords: ["link", "url", "href", "chaolianjie", "链接", "网址"],
    template: "[链接文本](https://)",
    cursorOffset: 1,
    icon: <Link size={16} />
  },
  {
    id: "image",
    group: "高级内容",
    label: "图片",
    description: "插入网络图片或本地图片路径",
    badge: "![]()",
    keywords: ["image", "img", "photo", "pic", "tupian", "图片", "截图"],
    template: "![图片说明](https://)",
    cursorOffset: 2,
    icon: <Image size={16} />
  },
  {
    id: "footnote",
    group: "高级内容",
    label: "脚注",
    description: "添加附注解释，自动在文档末尾形成索引",
    badge: "[^]",
    keywords: ["footnote", "note", "jiaozhu", "脚注", "附注"],
    template: "[^1]: 脚注详细内容说明",
    cursorOffset: 5,
    icon: <Bookmark size={16} />
  }
];

export function filterAndRankSlashCommands(
  commands: SlashCommandItem[],
  filterText: string
): SlashCommandItem[] {
  const q = filterText.trim().toLowerCase();
  if (!q) return commands;

  interface ScoredItem {
    item: SlashCommandItem;
    score: number;
    originalIndex: number;
  }

  const scored: ScoredItem[] = [];

  for (let idx = 0; idx < commands.length; idx += 1) {
    const cmd = commands[idx];
    let score = -1;

    // 1. Exact match on ID, badge or keywords (Highest priority: 100)
    if (
      cmd.id.toLowerCase() === q ||
      cmd.badge.toLowerCase() === q ||
      cmd.keywords.some((kw) => kw.toLowerCase() === q)
    ) {
      score = 100;
    }
    // 2. Prefix match on ID, badge or keywords (High priority: 80)
    else if (
      cmd.id.toLowerCase().startsWith(q) ||
      cmd.badge.toLowerCase().startsWith(q) ||
      cmd.keywords.some((kw) => kw.toLowerCase().startsWith(q))
    ) {
      score = 80;
    }
    // 3. Exact match on Chinese label (Score: 70)
    else if (cmd.label.toLowerCase() === q) {
      score = 70;
    }
    // 4. Prefix match or contains match on Chinese label (Score: 60)
    else if (cmd.label.toLowerCase().includes(q)) {
      score = cmd.label.toLowerCase().startsWith(q) ? 65 : 60;
    }
    // 5. Contains match on keywords or description (Score: 40)
    else if (
      cmd.keywords.some((kw) => kw.toLowerCase().includes(q)) ||
      cmd.description.toLowerCase().includes(q)
    ) {
      score = 40;
    }

    if (score >= 0) {
      scored.push({ item: cmd, score, originalIndex: idx });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((s) => s.item);
}

export interface GroupedCommandsResult {
  groups: { groupName: string; items: { item: SlashCommandItem; globalIdx: number }[] }[];
  orderedItems: SlashCommandItem[];
}

export function getGroupedSlashCommands(filterText: string): GroupedCommandsResult {
  const ranked = filterAndRankSlashCommands(SLASH_COMMANDS, filterText);
  const q = filterText.trim();

  const groups: { groupName: string; items: { item: SlashCommandItem; globalIdx: number }[] }[] = [];
  const orderedItems: SlashCommandItem[] = [];

  if (q) {
    // When searching with a query, show results ranked by match score
    const items = ranked.map((item, idx) => ({ item, globalIdx: idx }));
    groups.push({
      groupName: `匹配指令 (${ranked.length})`,
      items
    });
    return { groups, orderedItems: ranked };
  }

  // When no query is typed (bare "/"), group in canonical top-to-bottom category order
  const categoryOrder = ["AI 创作助手", "基础文本", "列表与待办", "结构与排版", "高级内容"];
  let globalIdx = 0;

  for (const cat of categoryOrder) {
    const catItems = ranked.filter((cmd) => cmd.group === cat);
    if (catItems.length > 0) {
      const groupItems: { item: SlashCommandItem; globalIdx: number }[] = [];
      for (const item of catItems) {
        groupItems.push({ item, globalIdx });
        orderedItems.push(item);
        globalIdx += 1;
      }
      groups.push({ groupName: cat, items: groupItems });
    }
  }

  const otherItems = ranked.filter((cmd) => !categoryOrder.includes(cmd.group));
  if (otherItems.length > 0) {
    const groupItems: { item: SlashCommandItem; globalIdx: number }[] = [];
    for (const item of otherItems) {
      groupItems.push({ item, globalIdx });
      orderedItems.push(item);
      globalIdx += 1;
    }
    groups.push({ groupName: "其他", items: groupItems });
  }

  return { groups, orderedItems };
}

export interface SlashCommandMenuProps {
  filterText: string;
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onClose: () => void;
  onHoverIndex: (index: number) => void;
  menuRef?: React.RefObject<HTMLDivElement | null>;
}

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  filterText,
  selectedIndex,
  onSelect,
  onClose,
  onHoverIndex,
  menuRef
}) => {
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Group commands dynamically and obtain strictly ordered flattened list
  const { groups: groupedCommands, orderedItems: filteredCommands } = useMemo(() => {
    return getGroupedSlashCommands(filterText);
  }, [filterText]);

  // Keep selected item visible in scroll view
  useEffect(() => {
    if (!listContainerRef.current) return;
    const activeEl = listContainerRef.current.querySelector<HTMLElement>(
      `.ty-slash-item[data-index="${selectedIndex}"]`
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  return (
    <div
      ref={menuRef}
      className="ty-slash-menu-popup"
      tabIndex={-1}
      onMouseDown={(e) => {
        // Prevent blur on the active textarea when clicking inside popup
        e.preventDefault();
      }}
    >
      <div className="ty-slash-menu-header">
        <span className="ty-slash-menu-title">快捷命令 (Slash Commands)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="ty-slash-menu-hint">↑↓ 切换 • 回车确认 • Esc 退出</span>
          <button
            type="button"
            className="ty-slash-close-btn"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="ty-slash-menu-body" ref={listContainerRef}>
        {filteredCommands.length === 0 ? (
          <div className="ty-slash-empty-state">
            <span>未找到与 &quot;{filterText}&quot; 匹配的 Markdown 语法</span>
          </div>
        ) : (
          groupedCommands.map((grp) => (
            <div key={grp.groupName} className="ty-slash-group">
              <div className="ty-slash-group-label">{grp.groupName}</div>
              {grp.items.map(({ item, globalIdx }) => {
                const isSelected = globalIdx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    data-index={globalIdx}
                    className={`ty-slash-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => onSelect(item)}
                    onMouseMove={(e) => {
                      if (e.movementX !== 0 || e.movementY !== 0) {
                        onHoverIndex(globalIdx);
                      }
                    }}
                  >
                    <div className="ty-slash-item-icon-box">{item.icon}</div>
                    <div className="ty-slash-item-content">
                      <div className="ty-slash-item-title">{item.label}</div>
                      <div className="ty-slash-item-desc">{item.description}</div>
                    </div>
                    <div className="ty-slash-item-badge">{item.badge}</div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
