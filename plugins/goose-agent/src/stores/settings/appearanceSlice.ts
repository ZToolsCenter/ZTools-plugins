import {
  isCodeFontId,
  isFontSizeId,
  isUiFontId,
  sanitizeCustomFontFamily,
  type CodeFontId,
  type FontSizeId,
  type UiFontId,
} from "@/lib/appearance/fonts";
import {
  clampWindowHeight,
  WINDOW_HEIGHT_DEFAULT,
} from "@/lib/platform/windowHeight";
import { clampUiZoom, UI_ZOOM_DEFAULT } from "@/lib/appearance/uiZoom";

export interface AppearanceSettings {
  uiFont: UiFontId;
  codeFont: CodeFontId;
  customCodeFont: string;
  fontSize: FontSizeId;
  /** 插件主窗口高度（px），仅 uTools 生效 */
  windowHeight: number;
  /** 整体界面缩放倍率（0.8–1.4） */
  uiZoom: number;
}

export interface AppearanceSliceState {
  appearance: AppearanceSettings;
}

export interface AppearanceSliceActions {
  setUiFont: (id: UiFontId) => void;
  setCodeFont: (id: CodeFontId) => void;
  setCustomCodeFont: (value: string) => void;
  setFontSize: (id: FontSizeId) => void;
  setWindowHeight: (height: number) => void;
  setUiZoom: (zoom: number) => void;
}

export type AppearanceSlice = AppearanceSliceState & AppearanceSliceActions;

export const APPEARANCE_INITIAL_STATE: AppearanceSliceState = {
  appearance: {
    uiFont: "system",
    codeFont: "jetbrains",
    customCodeFont: "",
    fontSize: "md",
    windowHeight: WINDOW_HEIGHT_DEFAULT,
    uiZoom: UI_ZOOM_DEFAULT,
  },
};

export function normalizeAppearanceSettings(
  raw: Partial<AppearanceSettings> | undefined,
): AppearanceSettings {
  const uiFont = isUiFontId(raw?.uiFont) ? raw.uiFont : "system";
  // Missing/invalid → jetbrains (new default). Explicit system-mono etc. preserved via isCodeFontId.
  const codeFont = isCodeFontId(raw?.codeFont) ? raw.codeFont : "jetbrains";
  const customCodeFont =
    sanitizeCustomFontFamily(
      typeof raw?.customCodeFont === "string" ? raw.customCodeFont : "",
    ) ?? "";
  const fontSize = isFontSizeId(raw?.fontSize) ? raw.fontSize : "md";
  const windowHeight = clampWindowHeight(raw?.windowHeight);
  const uiZoom = clampUiZoom(raw?.uiZoom);
  return { uiFont, codeFont, customCodeFont, fontSize, windowHeight, uiZoom };
}

type SetFn = (
  updater:
    | Partial<AppearanceSlice>
    | ((state: AppearanceSlice) => Partial<AppearanceSlice>),
) => void;

export function createAppearanceSlice(set: SetFn): AppearanceSlice {
  return {
    ...APPEARANCE_INITIAL_STATE,
    setUiFont: (id) =>
      set((state) => {
        if (!isUiFontId(id)) return {};
        return {
          appearance: { ...state.appearance, uiFont: id },
        };
      }),
    setCodeFont: (id) =>
      set((state) => {
        if (!isCodeFontId(id)) return {};
        return {
          appearance: { ...state.appearance, codeFont: id },
        };
      }),
    setCustomCodeFont: (value) =>
      set((state) => ({
        appearance: {
          ...state.appearance,
          customCodeFont:
            sanitizeCustomFontFamily(
              typeof value === "string" ? value : "",
            ) ?? "",
        },
      })),
    setFontSize: (id) =>
      set((state) => {
        if (!isFontSizeId(id)) return {};
        return {
          appearance: { ...state.appearance, fontSize: id },
        };
      }),
    setWindowHeight: (height) =>
      set((state) => ({
        appearance: {
          ...state.appearance,
          windowHeight: clampWindowHeight(height),
        },
      })),
    setUiZoom: (zoom) =>
      set((state) => ({
        appearance: {
          ...state.appearance,
          uiZoom: clampUiZoom(zoom),
        },
      })),
  };
}
