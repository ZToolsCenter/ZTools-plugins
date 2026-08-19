import type {
  AccentColor,
  Theme,
  CodeStyle,
  CustomFonts,
  UIFontSize,
} from "../types";
import {
  DEFAULT_ACCENT_COLOR,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_DEFAULT,
  DEFAULT_UI_FONT_SIZE,
} from "../types";
import type { WatermarkConfig, CardThemeId } from "@/lib/imageExport";
import {
  DEFAULT_WATERMARK_CONFIG,
  normalizeWatermarkConfig,
} from "@/lib/imageExport";

export interface AppearanceSliceState {
  theme: Theme;
  accentColor: AccentColor;
  codeStyle: CodeStyle;
  defaultCodeBlockWrap: boolean;
  tableEvenColumnWidth: boolean;
  customFonts: CustomFonts;
  uiFontSize: UIFontSize;
  editorFontSize: number;
  /** AI 聊天界面字号缩放比。可选值：0.8 / 0.9 / 1.0 / 1.1 / 1.2。副作用：影响 AI 聊天面板所有文字大小。 */
  aiChatScale: number;
  /** 导出图片的水印/生成选项，跨会话记忆用户选择 */
  imageExportWatermark: WatermarkConfig;
  /** 导出图片上次选择的卡片主题 */
  imageExportThemeId: CardThemeId;
  /** 隐藏侧栏常驻展开箭头，hover 行时用图标位临时展开/收起 */
  hideExpandArrows: boolean;
  /** 单标签模式：所有页面在当前标签中切换，不保留多标签交互。 */
  singleTabMode: boolean;
}

export interface AppearanceSliceActions {
  setTheme: (theme: Theme) => void;
  setAccentColor: (accentColor: AccentColor) => void;
  toggleDarkMode: () => void;
  setCodeStyle: (style: CodeStyle) => void;
  setDefaultCodeBlockWrap: (enabled: boolean) => void;
  setTableEvenColumnWidth: (enabled: boolean) => void;
  setCustomLabel: (
    type: "default" | "serif" | "mono",
    label: string | null,
  ) => void;
  setCustomFont: (
    type: "default" | "serif" | "mono",
    font: string | null,
  ) => void;
  resetCustomFont: (type: "default" | "serif" | "mono") => void;
  setUIFontSize: (size: UIFontSize) => void;
  setEditorFontSize: (size: number) => void;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  resetEditorFontSize: () => void;
  setAiChatScale: (scale: number) => void;
  increaseAiChatScale: () => void;
  decreaseAiChatScale: () => void;
  setImageExportWatermark: (config: Partial<WatermarkConfig>) => void;
  setImageExportThemeId: (id: CardThemeId) => void;
  setHideExpandArrows: (hidden: boolean) => void;
  setSingleTabMode: (enabled: boolean) => void;
}

export type AppearanceSlice = AppearanceSliceState & AppearanceSliceActions;

export const APPEARANCE_INITIAL_STATE: AppearanceSliceState = {
  theme: "system",
  accentColor: DEFAULT_ACCENT_COLOR,
  codeStyle: "github",
  defaultCodeBlockWrap: false,
  tableEvenColumnWidth: true,
  customFonts: {
    default: { label: null, font: null },
    serif: { label: null, font: null },
    mono: { label: null, font: null },
  },
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  aiChatScale: 1.0,
  imageExportWatermark: DEFAULT_WATERMARK_CONFIG,
  imageExportThemeId: "github-light",
  hideExpandArrows: false,
  singleTabMode: true,
};

type SetFn = (
  updater:
    | Partial<AppearanceSlice>
    | ((state: AppearanceSlice) => Partial<AppearanceSlice>),
) => void;
type GetApplyFns = () => {
  applyTheme: (theme: Theme) => void;
  applyAccentColor: (accentColor: AccentColor) => void;
  applyCodeStyle: (codeStyle: CodeStyle) => void;
};

export function createAppearanceSlice(
  set: SetFn,
  getApply: GetApplyFns,
): AppearanceSlice {
  return {
    ...APPEARANCE_INITIAL_STATE,
    setTheme: (theme) => {
      set({ theme });
      getApply().applyTheme(theme);
    },
    setAccentColor: (accentColor) => {
      set({ accentColor });
      getApply().applyAccentColor(accentColor);
    },
    toggleDarkMode: () => {
      set((state) => {
        // 侧栏/快捷键按固定顺序轮转：系统 → 浅色 → 深色 → 系统
        const nextTheme: Theme =
          state.theme === "system"
            ? "light"
            : state.theme === "light"
              ? "dark"
              : "system";
        getApply().applyTheme(nextTheme);
        return { theme: nextTheme };
      });
    },
    setCodeStyle: (codeStyle) => {
      set({ codeStyle });
      getApply().applyCodeStyle(codeStyle);
    },
    setDefaultCodeBlockWrap: (defaultCodeBlockWrap) =>
      set({ defaultCodeBlockWrap }),
    setTableEvenColumnWidth: (tableEvenColumnWidth) =>
      set({ tableEvenColumnWidth }),
    setCustomLabel: (type, label) =>
      set((state) => ({
        customFonts: {
          ...state.customFonts,
          [type]: { ...state.customFonts[type], label },
        },
      })),
    setCustomFont: (type, font) =>
      set((state) => ({
        customFonts: {
          ...state.customFonts,
          [type]: { ...state.customFonts[type], font },
        },
      })),
    resetCustomFont: (type) =>
      set((state) => ({
        customFonts: {
          ...state.customFonts,
          [type]: { label: null, font: null },
        },
      })),
    setUIFontSize: (uiFontSize) => set({ uiFontSize }),
    setEditorFontSize: (size) =>
      set({
        editorFontSize: Math.max(
          EDITOR_FONT_SIZE_MIN,
          Math.min(EDITOR_FONT_SIZE_MAX, size),
        ),
      }),
    increaseEditorFontSize: () =>
      set((state) => ({
        editorFontSize: Math.min(
          EDITOR_FONT_SIZE_MAX,
          state.editorFontSize + 1,
        ),
      })),
    decreaseEditorFontSize: () =>
      set((state) => ({
        editorFontSize: Math.max(
          EDITOR_FONT_SIZE_MIN,
          state.editorFontSize - 1,
        ),
      })),
    resetEditorFontSize: () =>
      set({ editorFontSize: EDITOR_FONT_SIZE_DEFAULT }),
    setAiChatScale: (scale) =>
      set({ aiChatScale: Math.max(0.7, Math.min(1.5, scale)) }),
    increaseAiChatScale: () =>
      set((state) => ({
        aiChatScale: Math.min(
          1.5,
          Math.round((state.aiChatScale + 0.1) * 10) / 10,
        ),
      })),
    decreaseAiChatScale: () =>
      set((state) => ({
        aiChatScale: Math.max(
          0.7,
          Math.round((state.aiChatScale - 0.1) * 10) / 10,
        ),
      })),
    setImageExportWatermark: (config) =>
      set({ imageExportWatermark: normalizeWatermarkConfig(config) }),
    setImageExportThemeId: (imageExportThemeId) => set({ imageExportThemeId }),
    setHideExpandArrows: (hideExpandArrows) => set({ hideExpandArrows }),
    setSingleTabMode: (singleTabMode) => set({ singleTabMode }),
  };
}
