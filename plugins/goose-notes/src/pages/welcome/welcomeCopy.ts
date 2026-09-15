/**
 * Static copy / text constants for the Welcome page.
 * Centralised here so the UI layer stays declarative and i18n-ready.
 */

// ── Header ──────────────────────────────────────────────────────────
export const APP_TITLE = "欢迎使用 Goose Note";
export const APP_DESCRIPTION =
  "这是一个功能强大的笔记应用，让我们通过以下控件展示来了解它的功能";
export const BTN_GO_SUBPAGE = "前往子页面";
export const BTN_LIKE = "点个赞";

// ── Button showcase ─────────────────────────────────────────────────
export const BUTTON_CARD_TITLE = "按钮组件";
export const BUTTON_CARD_DESC = "各种样式的按钮展示";

// ── Input / keyboard shortcuts card ─────────────────────────────────
export const INPUT_CARD_TITLE = "输入控件";
export const INPUT_CARD_DESC = "文本输入和文本域";

// ── Toggle / switch card ────────────────────────────────────────────
export const TOGGLE_CARD_TITLE = "开关和切换";
export const TOGGLE_CARD_DESC = "各种状态切换控件";

// ── Tabs card ───────────────────────────────────────────────────────
export const TABS_CARD_TITLE = "选项卡组件";
export const TABS_CARD_DESC = "选项卡切换示例";
export const TAB_ABOUT_DESC =
  "Goose Note 是一个现代化的笔记应用，提供强大的编辑和协作功能。";

// ── Dialog / sheet card ─────────────────────────────────────────────
export const DIALOG_CARD_TITLE = "对话框组件";
export const DIALOG_CARD_DESC = "模态对话框和侧边栏";
export const DIALOG_CONFIRM_TITLE = "确认操作";
export const DIALOG_CONFIRM_DESC =
  "这是一个对话框示例。您可以在这里放置重要的表单或信息。";
export const DIALOG_CONFIRM_BODY =
  "对话框内容区域，可以包含表单、文本或其他组件。";
export const SHEET_TITLE = "侧边栏";
export const SHEET_DESC = "这是一个从右侧滑出的面板";
export const SHEET_BODY = "侧边栏常用于显示设置、表单或详细信息。";

// ── Popover / dropdown card ─────────────────────────────────────────
export const POPOVER_CARD_TITLE = "弹出和下拉菜单";
export const POPOVER_CARD_DESC = "弹出框和下拉菜单组件";
export const POPOVER_BODY =
  "这是一个弹出框，可以显示丰富的内容和交互元素。";
export const TOOLTIP_TEXT = "这是一个工具提示，悬停查看详情";

// ── Feature showcase card ───────────────────────────────────────────
export const FEATURE_CARD_TITLE = "功能展示";
export const FEATURE_CARD_DESC = "应用的主要功能概览";
export const FEATURE_EDIT_TITLE = "富文本编辑";
export const FEATURE_EDIT_DESC =
  "支持Markdown、代码块、图片等多种格式的强大编辑器";
export const FEATURE_FOLDER_TITLE = "文件夹管理";
export const FEATURE_FOLDER_DESC =
  "支持本地文件夹同步，方便管理和组织您的笔记";
export const FEATURE_THEME_TITLE = "主题定制";
export const FEATURE_THEME_DESC =
  "支持深色模式、自定义字体大小等多种个性化设置";

// ── Footer ──────────────────────────────────────────────────────────
export const FOOTER_TEXT =
  "🎉 您已经了解了所有主要控件！点击上方按钮前往子页面继续探索";

// ── Toast messages ──────────────────────────────────────────────────
export const TOAST_BUTTON_SUCCESS = "按钮点击成功！";
export const TOAST_BUTTON_SUCCESS_DESC = "这是一个成功提示消息";
export const TOAST_SWITCH_TOGGLED = (key: string, on: boolean) =>
  `${key} 已${on ? "开启" : "关闭"}`;

// ── Misc labels ─────────────────────────────────────────────────────
export const LABEL_USERNAME = "用户名";
export const LABEL_EMAIL = "邮箱";
export const LABEL_MESSAGE = "留言";
export const INPUT_CHAR_COUNT = (input: number, textarea: number) =>
  `输入长度: ${input} | 留言长度: ${textarea}`;

// ── Version ─────────────────────────────────────────────────────────
export const VERSION = "1.0.0";
