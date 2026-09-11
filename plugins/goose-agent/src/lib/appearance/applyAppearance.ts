import {
  resolveCodeFontStack,
  resolveFontSizeTokens,
  resolveUiFontStack,
  type CodeFontId,
  type FontSizeId,
  type UiFontId,
} from "./fonts";
import { ensureCodeFontLoaded } from "./loadCodeFont";
import { applyUiZoom } from "./uiZoom";

/** 与 `AppearanceSettings` 字段对齐（避免 lib → stores 反向依赖） */
export interface AppearanceFontsInput {
  uiFont: UiFontId;
  codeFont: CodeFontId;
  customCodeFont: string;
  fontSize: FontSizeId;
  uiZoom?: number;
}

/**
 * 将外观字体设置写入 `document.documentElement` CSS 变量。
 * 无 DOM（SSR / 测试）时静默跳过。
 * 选择 JetBrains Mono 时会懒加载 Fontsource 打包字体。
 */
export function applyAppearanceFonts(appearance: AppearanceFontsInput): void {
  ensureCodeFontLoaded(appearance.codeFont);
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const uiStack = resolveUiFontStack(appearance.uiFont);
  const monoStack = resolveCodeFontStack(
    appearance.codeFont,
    appearance.customCodeFont,
  );
  const sizes = resolveFontSizeTokens(appearance.fontSize);

  root.style.setProperty("--font-sans", uiStack);
  root.style.setProperty("--font-mono", monoStack);
  root.style.setProperty("--font-size-ui", sizes.ui);
  root.style.setProperty("--font-size-chat", sizes.chat);
  root.style.setProperty("--line-height-chat", sizes.lineHeight);
  if (appearance.uiZoom !== undefined) {
    applyUiZoom(appearance.uiZoom);
  }
}
