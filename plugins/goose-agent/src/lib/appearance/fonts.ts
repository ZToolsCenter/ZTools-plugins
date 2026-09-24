/** UI 字体预设 ID */
export type UiFontId = "system" | "system-ui";

/** 代码字体预设 ID */
export type CodeFontId =
  | "system-mono"
  | "sf-mono"
  | "cascadia"
  | "jetbrains"
  | "menlo"
  | "consolas"
  | "custom";

/** 字号档位 */
export type FontSizeId = "sm" | "md" | "lg";

export interface FontPresetOption<T extends string> {
  id: T;
  label: string;
}

/** 界面字体默认栈（中文优先 SC 回退） */
export const DEFAULT_UI_FONT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif';

/** 界面字体短栈（仅 system-ui 系） */
export const SYSTEM_UI_SHORT_STACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** 等宽默认栈（无 Inter） */
export const DEFAULT_MONO_FONT_STACK =
  'ui-monospace, "SF Mono", "Cascadia Code", "Cascadia Mono", "Segoe UI Mono", "JetBrains Mono", Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

export const UI_FONT_PRESETS: readonly FontPresetOption<UiFontId>[] = [
  { id: "system", label: "系统界面" },
  { id: "system-ui", label: "系统 UI" },
] as const;

export const CODE_FONT_PRESETS: readonly FontPresetOption<CodeFontId>[] = [
  { id: "system-mono", label: "系统等宽" },
  { id: "sf-mono", label: "SF Mono" },
  { id: "cascadia", label: "Cascadia Code" },
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "menlo", label: "Menlo" },
  { id: "consolas", label: "Consolas" },
  { id: "custom", label: "自定义" },
] as const;

export const FONT_SIZE_PRESETS: readonly FontPresetOption<FontSizeId>[] = [
  { id: "sm", label: "小" },
  { id: "md", label: "中" },
  { id: "lg", label: "大" },
] as const;

const NAMED_MONO_FAMILIES: Record<
  Exclude<CodeFontId, "system-mono" | "custom">,
  string
> = {
  "sf-mono": '"SF Mono"',
  cascadia: '"Cascadia Code", "Cascadia Mono"',
  jetbrains: '"JetBrains Mono"',
  menlo: "Menlo",
  consolas: "Consolas",
};

export function resolveUiFontStack(id: UiFontId): string {
  if (id === "system-ui") return SYSTEM_UI_SHORT_STACK;
  return DEFAULT_UI_FONT_STACK;
}

const CUSTOM_FONT_MAX_LEN = 64;

/**
 * 自定义字体族名清洗：去引号、禁注入字符/函数、仅保留安全字符，最长 64。
 * 无效或空串返回 null。
 */
export function sanitizeCustomFontFamily(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/["']/g, "").trim();
  if (!s) return null;
  // 拒绝 CSS 函数注入
  if (/url\s*\(|var\s*\(|expression\s*\(/i.test(s)) return null;
  // 去掉分号、花括号、括号、反斜杠与换行
  s = s.replace(/[;{}()[\]\\\n\r]/g, "");
  // 仅允许字母（含 unicode）、数字、空格、. _ -
  s = s.replace(/[^\p{L}\p{N}\s._-]/gu, "").trim();
  if (!s) return null;
  if (s.length > CUSTOM_FONT_MAX_LEN) s = s.slice(0, CUSTOM_FONT_MAX_LEN);
  return s;
}

export function resolveCodeFontStack(
  id: CodeFontId,
  custom?: string,
): string {
  if (id === "system-mono") return DEFAULT_MONO_FONT_STACK;

  if (id === "custom") {
    const name = sanitizeCustomFontFamily(custom);
    if (!name) return DEFAULT_MONO_FONT_STACK;
    // 含空格的族名需要引号
    const quoted = /\s/.test(name) ? `"${name}"` : name;
    return `${quoted}, ${DEFAULT_MONO_FONT_STACK}`;
  }

  const named = NAMED_MONO_FAMILIES[id];
  if (!named) return DEFAULT_MONO_FONT_STACK;
  return `${named}, ${DEFAULT_MONO_FONT_STACK}`;
}

export interface FontSizeTokens {
  ui: string;
  chat: string;
  lineHeight: string;
}

export function resolveFontSizeTokens(id: FontSizeId): FontSizeTokens {
  switch (id) {
    case "sm":
      return {
        ui: "12px",
        chat: "13px",
        lineHeight: "1.55",
      };
    case "lg":
      return {
        ui: "14px",
        chat: "15.5px",
        lineHeight: "1.7",
      };
    case "md":
    default:
      return {
        ui: "13px",
        chat: "14px",
        lineHeight: "1.65",
      };
  }
}

export function isUiFontId(value: unknown): value is UiFontId {
  return value === "system" || value === "system-ui";
}

export function isCodeFontId(value: unknown): value is CodeFontId {
  return (
    value === "system-mono" ||
    value === "sf-mono" ||
    value === "cascadia" ||
    value === "jetbrains" ||
    value === "menlo" ||
    value === "consolas" ||
    value === "custom"
  );
}

export function isFontSizeId(value: unknown): value is FontSizeId {
  return value === "sm" || value === "md" || value === "lg";
}
