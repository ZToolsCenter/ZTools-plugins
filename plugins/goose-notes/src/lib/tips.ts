import { formatShortcut } from "./utils";
import { useSettings } from "@/stores/useSettings";

export const TIPS = [
  "输入 / 可唤起命令菜单",
  () => `按 ${formatShortcut("Shift")} + 粘贴 可粘贴纯文本，绕过 Markdown 解析`,
  "粘贴 Markdown 格式文本会自动转换为富文本",
  "拖拽左侧手柄可调整段落顺序",
  "选中文字后出现格式工具栏",
  "内容会自动保存，不需要手动点击保存",
  () => {
    const shortcut = useSettings.getState().appShortcuts.openSearch;
    return shortcut
      ? `${formatShortcut(shortcut)} 可快速搜索页面（uTools 输入会自动同步）`
      : "可在设置 → 快捷键中配置全局搜索";
  },
  () =>
    `${formatShortcut("Mod+Plus")} / ${formatShortcut("Mod+-")} 可缩放编辑器文字`,
  () => {
    const shortcut = useSettings.getState().appShortcuts.newNote;
    return shortcut
      ? `${formatShortcut(shortcut)} 快速新建空白笔记`
      : "可在设置 → 快捷键中配置快速新建笔记";
  },
  "双击图片可调整大小和对齐方式",
  "支持代码块语法高亮，输入 /code 插入",
  "设置 → 数据管理 可重置所有数据",
];

export function getRandomTip(): string {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  return typeof tip === "function" ? tip() : tip;
}
