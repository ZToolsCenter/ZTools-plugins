import type { PartialBlock } from "@blocknote/core";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { getFixedAppShortcuts } from "@/lib/fixed-app-shortcuts";
import { formatShortcut } from "@/lib/utils";

const WELCOME_IMAGE =
  "https://goose-notion-1257312034.cos.ap-guangzhou.myqcloud.com/welcome-cover.png";

const fixedShortcuts = getFixedAppShortcuts();
const shortcutLabel = (shortcut: string) => formatShortcut(shortcut);
const shortcutLabels = (...shortcuts: string[]) =>
  shortcuts.map(shortcutLabel).join(" / ");

type ShortcutItem = {
  shortcut: string;
  action: string;
  note?: string;
};

type ShortcutSection = {
  title: string;
  description: string;
  items: ShortcutItem[];
};

const paragraph = (value?: string): PartialBlock => ({
  type: "paragraph",
  content: value || "",
});

const heading = (level: number, value: string): PartialBlock => ({
  type: "heading",
  props: { level },
  content: value,
});

const bulletList = (items: string[]): PartialBlock[] =>
  items.map((item) => ({ type: "bulletListItem", content: item }));

const orderedList = (items: string[]): PartialBlock[] =>
  items.map((item) => ({ type: "numberedListItem", content: item }));

const taskList = (
  items: Array<{ checked: boolean; text: string }>,
): PartialBlock[] =>
  items.map((item) => ({
    type: "checkListItem",
    props: { checked: item.checked },
    content: item.text,
  }));

const quote = (value: string): PartialBlock => ({
  type: "quote",
  content: value,
});

const callout = (icon: string, value: string): PartialBlock =>
  ({
    type: "callout",
    props: { icon },
    content: value,
  } as unknown as PartialBlock);

const codeBlock = (value: string, language?: string): PartialBlock => ({
  type: "codeBlock",
  props: { language: language || "" },
  content: value,
});

const table = (headers: string[], rows: string[][]): PartialBlock => ({
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      { cells: headers },
      ...rows.map((row) => ({ cells: row })),
    ],
  },
});

const divider = (): PartialBlock => ({
  type: "divider",
});

const image = (src: string): PartialBlock => ({
  type: "image",
  props: { url: src, caption: "" },
});

const shortcutSections: ShortcutSection[] = [
  {
    title: "全局与工作区",
    description: "切页面之前先记住这组，都是全局入口。",
    items: [
      {
        shortcut: shortcutLabel("Mod+N"),
        action: "新建页面",
        note: "在当前记事本里新建并自动打开。",
      },
      {
        shortcut: shortcutLabel(fixedShortcuts.openSettings),
        action: "打开设置",
        note: "调整快捷键、搜索行为和外观。",
      },
      {
        shortcut: shortcutLabels("Mod+Plus", "Mod+-", "Mod+0"),
        action: "放大、缩小、重置编辑器字号",
        note: "影响阅读与编辑时的文本大小。",
      },
    ],
  },
  {
    title: "搜索与查找",
    description: "一个管全局搜索，一个管当前页面查找，别混了。",
    items: [
      {
        shortcut: shortcutLabel("Mod+Shift+K"),
        action: "打开全局搜索",
        note: "搜索页面标题与内容。",
      },
      {
        shortcut: "Tab",
        action: "切换搜索范围",
        note: "在当前记事本与全部记事本之间切换。",
      },
      {
        shortcut: "自定义关闭键",
        action: "关闭搜索面板",
        note: "默认未设置，可在设置中自定义。",
      },
      {
        shortcut: shortcutLabel("Mod+F"),
        action: "打开当前页查找",
        note: "只在当前页面内查找文本。",
      },
      {
        shortcut: shortcutLabels("Enter", "Shift+Enter"),
        action: "跳到下一个 / 上一个匹配",
        note: "查找框聚焦时可直接使用。",
      },
      {
        shortcut: shortcutLabels("Mod+G", "Mod+Shift+G"),
        action: "跳到下一个 / 上一个匹配",
        note: "不离开键盘继续浏览结果。",
      },
      {
        shortcut: shortcutLabels("F3", "Shift+F3"),
        action: "跳到下一个 / 上一个匹配",
        note: "另一组常见查找导航键。",
      },
      {
        shortcut: shortcutLabel("Esc"),
        action: "关闭当前页查找",
        note: "关闭后会回到编辑器。",
      },
    ],
  },
  {
    title: "极简工作区",
    description: "默认只保留当前笔记，用搜索或侧边栏直接切换。",
    items: [
      {
        shortcut: shortcutLabel("Mod+N"),
        action: "新建笔记",
        note: "创建后直接输入顶栏标题，按回车进入正文。",
      },
      {
        shortcut: shortcutLabel("Mod+Shift+K"),
        action: "搜索并切换笔记",
        note: "打开结果会替换当前笔记，不会新增标签。",
      },
    ],
  },
  {
    title: "编辑器格式化",
    description: "这组主要来自选中文本后的浮动工具栏。",
    items: [
      {
        shortcut: shortcutLabel("Mod+B"),
        action: "粗体",
      },
      {
        shortcut: shortcutLabel("Mod+I"),
        action: "斜体",
      },
      {
        shortcut: shortcutLabel("Mod+U"),
        action: "下划线",
      },
      {
        shortcut: shortcutLabel("Mod+Shift+S"),
        action: "删除线",
      },
      {
        shortcut: shortcutLabel("Mod+E"),
        action: "行内代码",
      },
      {
        shortcut: shortcutLabels(
          "Mod+Shift+L",
          "Mod+Shift+E",
          "Mod+Shift+R",
          "Mod+Shift+J",
        ),
        action: "左对齐 / 居中 / 右对齐 / 两端对齐",
      },
      {
        shortcut: shortcutLabel("Mod+Z"),
        action: "撤销",
      },
      {
        shortcut: `${shortcutLabel("Mod+Shift+Z")} 或 ${shortcutLabel("Mod+Y")}`,
        action: "重做",
      },
      {
        shortcut: shortcutLabels("Tab", "Shift+Tab"),
        action: "表格中切换到下一个 / 上一个单元格",
        note: "只在表格内生效。",
      },
    ],
  },
  {
    title: "输入指令与块触发",
    description: "这组不是传统快捷键，更像快速输入语法。",
    items: [
      {
        shortcut: "/ 或 、",
        action: "打开斜杠菜单",
        note: "在空白段落里输入即可唤起。",
      },
      {
        shortcut: "# / ## / ###",
        action: "一级 / 二级 / 三级标题",
      },
      {
        shortcut: "[]",
        action: "待办列表",
      },
      {
        shortcut: "- / 1.",
        action: "无序列表 / 有序列表",
      },
      {
        shortcut: ">",
        action: "引用",
      },
      {
        shortcut: "``` / $$ / tb / co / ---",
        action: "代码块 / 数学公式 / 表格 / 标注 / 分隔线",
      },
    ],
  },
];

function buildShortcutSection(section: ShortcutSection): PartialBlock[] {
  return [
    heading(2, section.title),
    paragraph(section.description),
    table(
      ["快捷方式", "作用", "备注"],
      section.items.map((item) => [
        item.shortcut,
        item.action,
        item.note ?? " ",
      ]),
    ),
  ];
}

export const onboardingPageContent: BlockNoteContent = [
  heading(1, "鹅的笔记 · 新手指南"),
  paragraph("欢迎使用鹅的笔记。这份文档不是功能堆砌，而是带你快速建立第一套使用习惯。"),
  paragraph("先用 3 分钟扫完，再边试边改，你会比死记快捷键更快上手。"),
  callout(
    "🪶",
    "推荐顺序：先学页面结构，再学搜索与查找，最后记住最常用的几组编辑快捷键。",
  ),
  image(WELCOME_IMAGE),
  heading(2, "第一次使用，建议先做这 4 步"),
  ...orderedList([
    `按 ${shortcutLabel("Mod+N")} 新建一页，先随便记两行内容。`,
    "在空白行输入 /，看一遍能插入哪些块。",
    `按 ${shortcutLabel("Mod+Shift+K")} 试一次全局搜索，再按 ${shortcutLabel("Mod+F")} 试一次页内查找。`,
    "选中一段文字，试试粗体、斜体、行内代码和对齐按钮。",
  ]),
  heading(2, "页面与侧边栏"),
  ...bulletList([
    "页面支持父子层级，适合按项目、主题、时间分层整理。",
    "侧边栏里的页面可以拖拽排序，也可以拖成子页面。",
    "常用页面可以收藏，重要页面可以置顶，方便长期保留在显眼位置。",
    "删除的页面会进入垃圾箱，不是立刻消失，误删还有回退空间。",
    "本地文件夹模式下，页面会和你的磁盘文件联动，适合管理现有 Markdown 文件。",
  ]),
  heading(2, "极简工作区"),
  table(
    ["能力", "怎么用", "结果"],
    [
      ["切换笔记", "从侧边栏、搜索或最近访问打开", "当前笔记被直接替换"],
      [
        "新建笔记",
        `按 ${shortcutLabel("Mod+N")} 或点击侧边栏加号`,
        "先输入顶栏标题，再进入正文",
      ],
      [
        "需要多标签时",
        "在设置中关闭“极简工作区”",
        "恢复标签栏及其管理快捷键",
      ],
    ],
  ),
  heading(2, "搜索与查找"),
  ...bulletList([
    "全局搜索用于跨页面找内容；页内查找用于在当前页面定位某个词。",
    "搜索面板里按 Tab 可以切换“当前记事本”与“全部记事本”。",
    `查找框支持 ${shortcutLabel("Enter")}、${shortcutLabel("Mod+G")} 和 F3 继续跳转结果。`,
    `${shortcutLabel("Esc")} 会关闭页内查找并把焦点还给编辑器。`,
  ]),
  heading(2, "编辑器基础操作"),
  ...bulletList([
    "内容会自动保存，普通笔记不用养成手动保存的习惯。",
    `撤销与重做分别是 ${shortcutLabel("Mod+Z")}、${shortcutLabel("Mod+Shift+Z")} 或 ${shortcutLabel("Mod+Y")}。`,
    `表格里按 ${shortcutLabels("Tab", "Shift+Tab")} 可以继续在单元格间移动。`,
    "如果只是想快速输入结构，用 / 或 、 打开指令菜单通常比找按钮更快。",
  ]),
  heading(2, "常用块与输入方式"),
  table(
    ["块类型", "触发方式", "适合记录什么"],
    [
      ["标题", "# / ## / ###", "搭页面结构、做章节层级"],
      ["列表与待办", "-、1.、1。、[]、【】", "任务清单、会议纪要、步骤说明"],
      ["引用与标注", ">、co", "摘录原话、强调重点提醒"],
      ["代码 / 数学 / Mermaid", "```、$$、斜杠菜单", "技术笔记、公式推导、流程图"],
      ["表格与分隔线", "tb、---", "信息对比、把内容切成清晰区块"],
      ["图片与文件", "直接粘贴、拖入或通过菜单插入", "资料归档、截图说明、附件记录"],
    ],
  ),
  heading(2, "自动保存说明"),
  callout(
    "💾",
    `普通页面会自动保存，不需要把 ${shortcutLabel("Mod+S")} 当成日常必按键。`,
  ),
  ...bulletList([
    "普通页面：边写边自动保存，离开页面前也会主动提交最新内容。",
    `本地文件页面：除了自动保存外，还支持用 ${shortcutLabel("Mod+S")} 立即刷新落盘，适合你想马上确认文件写入磁盘时使用。`,
    "如果你看到“内容已保存”提示，多半是在本地文件或立即保存流程里触发的，不代表平时必须手动保存。",
  ]),
  heading(2, "常见上手建议"),
  ...taskList([
    { checked: true, text: "先建立 2 到 3 层页面结构，不要一上来把所有内容塞进一页。" },
    { checked: false, text: "给常用页面加收藏或置顶，减少每天来回翻找。" },
    { checked: false, text: "把搜索面板退出键改成顺手的组合。" },
    { checked: false, text: "经常写技术笔记的话，顺手试试代码块、Mermaid 和数学公式。" },
  ]),
  heading(2, "示例区块"),
  paragraph("下面这些示例块可以直接改，边改边熟悉编辑体验。"),
  quote("灵感先记下来，结构可以稍后再整理。"),
  codeBlock('print("Hello, Goose Note")\nlog("记录想法，比回忆更可靠")'),
  paragraph("行内公式示例：E=mc^2，适合穿插在普通句子里。"),
  codeBlock("f(x)=\\int_0^1 x^2 \, dx", "math"),
  codeBlock(
    "flowchart LR\nA[想法] --> B{要不要展开}\nB -->|是| C[继续写]\nB -->|否| D[先收藏待会儿回来看]",
    "mermaid",
  ),
  callout("✨", "拖动块左侧手柄可以调整顺序，很多整理动作都比剪切粘贴更快。"),
  divider(),
  table(
    ["你可能会用到", "在哪里更顺手"],
    [
      ["收藏 / 置顶", "页面头部操作区"],
      ["垃圾箱", "侧边栏底部"],
      ["导入 / 导出 / 锁定页面", "页面右上角更多操作"],
    ],
  ),
];

export const onboardingChildPageContent: BlockNoteContent = [
  heading(1, "功能速览"),
  paragraph("这页适合第一次打开时快速扫读，知道每个模块大概是干什么的。"),
  heading(2, "你会最先接触到的模块"),
  ...bulletList([
    "页面树：组织父子层级、拖拽调整顺序、收藏常用页。",
    "极简工作区：始终只保留当前笔记，减少页面切换噪音。",
    "搜索：全局找页面内容，或在当前页内精准定位关键词。",
    "编辑器：支持文本格式、表格、代码块、公式、Mermaid、图片与附件。",
    "页面操作：导入、导出、锁定页面与查看页面历史。",
    "垃圾箱：删除后先暂存，避免误删直接丢失。",
  ]),
  heading(2, "最值得立刻记住的习惯"),
  ...orderedList([
    "输入 / 打开指令菜单，比到处找按钮快很多。",
    "需要切换页面时优先用搜索；只有确实需要并排处理时再关闭极简工作区。",
    `需要找一句话时先用 ${shortcutLabel("Mod+F")}，别把全局搜索当页内查找用。`,
    "内容平时会自动保存，把注意力放在整理结构上，不要被“要不要保存”打断。",
  ]),
  heading(2, "本地文件模式和普通页面的区别"),
  table(
    ["场景", "普通页面", "本地文件页面"],
    [
      ["保存方式", "自动保存", "自动保存 + 可手动立即落盘"],
      ["适合用途", "日常记录、知识整理", "管理已有 Markdown 文件"],
      ["常见反馈", "通常无感保存", "更容易看到“已保存”反馈"],
    ],
  ),
];

export const onboardingSecondChildContent: BlockNoteContent = [
  heading(1, "快捷键指南"),
  paragraph("把快捷键分组记，比从头背到尾更轻松。先记你每天会按到的 5 个。"),
  callout(
    "⌨️",
    "如果某组你几乎不用，就先别背。会搜索、会查找、会撤销，效率已经能上来一大截。",
  ),
  ...shortcutSections.flatMap((section) => [
    ...buildShortcutSection(section),
    paragraph(),
  ]),
  heading(2, "关于保存这件事"),
  ...bulletList([
    `普通页面默认自动保存，所以这里不把 ${shortcutLabel("Mod+S")} 当成必学快捷键。`,
    `如果你正在编辑本地文件页面，${shortcutLabel("Mod+S")} 更像“现在就立即落盘”。`,
    "真正值得优先记住的，是搜索、查找、标签切换和格式化这几组高频操作。",
  ]),
];
