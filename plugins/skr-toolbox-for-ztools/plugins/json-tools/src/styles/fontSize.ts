import { FontSize } from "@/store/useSettingsStore";

// 字体大小配置映射
export const FONT_SIZE_CONFIG = {
  small: {
    // 基础字体大小
    base: "14px",
    // 标题字体大小
    h1: "24px",
    h2: "20px",
    h3: "18px",
    h4: "16px",
    h5: "14px",
    h6: "12px",
    // 正文字体大小
    text: "13px",
    // 按钮字体大小
    button: "13px",
    // 标签页字体大小
    tab: "12px",
    // 输入框字体大小
    input: "13px",
    // 图标大小
    icon: "18px",
    // 间距缩放比例
    spacingScale: 0.85,
    // 行高
    lineHeight: 1.4,
  },
  medium: {
    // 基础字体大小
    base: "16px",
    // 标题字体大小
    h1: "28px",
    h2: "24px",
    h3: "20px",
    h4: "18px",
    h5: "16px",
    h6: "14px",
    // 正文字体大小
    text: "15px",
    // 按钮字体大小
    button: "15px",
    // 标签页字体大小
    tab: "14px",
    // 输入框字体大小
    input: "15px",
    // 图标大小
    icon: "20px",
    // 间距缩放比例
    spacingScale: 1,
    // 行高
    lineHeight: 1.5,
  },
  large: {
    // 基础字体大小
    base: "18px",
    // 标题字体大小
    h1: "32px",
    h2: "28px",
    h3: "24px",
    h4: "20px",
    h5: "18px",
    h6: "16px",
    // 正文字体大小
    text: "17px",
    // 按钮字体大小
    button: "17px",
    // 标签页字体大小
    tab: "16px",
    // 输入框字体大小
    input: "17px",
    // 图标大小
    icon: "22px",
    // 间距缩放比例
    spacingScale: 1.15,
    // 行高
    lineHeight: 1.6,
  },
} as const satisfies Record<FontSize, {
  base: string;
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  h5: string;
  h6: string;
  text: string;
  button: string;
  tab: string;
  input: string;
  icon: string;
  spacingScale: number;
  lineHeight: number;
}>;

// Tailwind CSS 类名映射
export const FONT_SIZE_TAILWIND_CLASSES = {
  small: {
    // 文本大小
    "text-xs": "text-xs",
    "text-sm": "text-sm",
    "text-base": "text-[13px]",
    "text-lg": "text-[14px]",
    "text-xl": "text-[16px]",
    "text-2xl": "text-[18px]",
    "text-3xl": "text-[20px]",
    "text-4xl": "text-[24px]",
    // 标题大小
    "text-h1": "text-[24px]",
    "text-h2": "text-[20px]",
    "text-h3": "text-[18px]",
    "text-h4": "text-[16px]",
    "text-h5": "text-[14px]",
    "text-h6": "text-[12px]",
    // 特殊组件
    "text-tab": "text-[12px]",
    "text-button": "text-[13px]",
    "text-input": "text-[13px]",
  },
  medium: {
    // 文本大小
    "text-xs": "text-xs",
    "text-sm": "text-sm",
    "text-base": "text-base",
    "text-lg": "text-lg",
    "text-xl": "text-xl",
    "text-2xl": "text-2xl",
    "text-3xl": "text-3xl",
    "text-4xl": "text-4xl",
    // 标题大小
    "text-h1": "text-[28px]",
    "text-h2": "text-[24px]",
    "text-h3": "text-[20px]",
    "text-h4": "text-[18px]",
    "text-h5": "text-[16px]",
    "text-h6": "text-[14px]",
    // 特殊组件
    "text-tab": "text-[14px]",
    "text-button": "text-[15px]",
    "text-input": "text-[15px]",
  },
  large: {
    // 文本大小
    "text-xs": "text-[14px]",
    "text-sm": "text-[15px]",
    "text-base": "text-[17px]",
    "text-lg": "text-[18px]",
    "text-xl": "text-[20px]",
    "text-2xl": "text-[22px]",
    "text-3xl": "text-[24px]",
    "text-4xl": "text-[28px]",
    // 标题大小
    "text-h1": "text-[32px]",
    "text-h2": "text-[28px]",
    "text-h3": "text-[24px]",
    "text-h4": "text-[20px]",
    "text-h5": "text-[18px]",
    "text-h6": "text-[16px]",
    // 特殊组件
    "text-tab": "text-[16px]",
    "text-button": "text-[17px]",
    "text-input": "text-[17px]",
  },
} as const satisfies Record<FontSize, Record<string, string>>;

// 辅助函数：获取当前字体大小的配置
export function getFontSizeConfig(fontSize: FontSize) {
  return FONT_SIZE_CONFIG[fontSize];
}

// 辅助函数：获取当前字体大小的 Tailwind 类名映射
export function getFontSizeTailwindClasses(fontSize: FontSize) {
  return FONT_SIZE_TAILWIND_CLASSES[fontSize];
}

// 动态应用字体大小的 CSS 变量
export function generateFontSizeCSSVariables(fontSize: FontSize): string {
  const config = getFontSizeConfig(fontSize);
  return `
    :root {
      --font-size-base: ${config.base};
      --font-size-h1: ${config.h1};
      --font-size-h2: ${config.h2};
      --font-size-h3: ${config.h3};
      --font-size-h4: ${config.h4};
      --font-size-h5: ${config.h5};
      --font-size-h6: ${config.h6};
      --font-size-text: ${config.text};
      --font-size-button: ${config.button};
      --font-size-tab: ${config.tab};
      --font-size-input: ${config.input};
      --font-size-icon: ${config.icon};
      --spacing-scale: ${config.spacingScale};
      --line-height: ${config.lineHeight};
    }
    
    /* 应用全局字体大小 */
    html, body {
      font-size: var(--font-size-base);
      line-height: var(--line-height);
    }
    
    /* 标题字体大小 */
    h1 { font-size: var(--font-size-h1); }
    h2 { font-size: var(--font-size-h2); }
    h3 { font-size: var(--font-size-h3); }
    h4 { font-size: var(--font-size-h4); }
    h5 { font-size: var(--font-size-h5); }
    h6 { font-size: var(--font-size-h6); }
    
    /* 特殊组件字体大小 */
    .font-size-text { font-size: var(--font-size-text); }
    .font-size-button { font-size: var(--font-size-button); }
    .font-size-tab { font-size: var(--font-size-tab); }
    .font-size-input { font-size: var(--font-size-input); }
    .font-size-icon { font-size: var(--font-size-icon); }
    
    /* 应用间距缩放 */
    .spacing-scale {
      transform: scale(var(--spacing-scale));
      transform-origin: top left;
    }
  `;
}