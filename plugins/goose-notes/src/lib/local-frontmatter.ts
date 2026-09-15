/**
 * 本地文件夹页面设置 ↔ YAML frontmatter（方案 A）
 *
 * 白名单键（命名空间 goose-*，默认值省略写盘）：
 * - goose-font: serif | mono（default 不写）
 * - goose-locked: true（false 不写）
 *
 * 未知键原样保留；解析失败时不改写原文 blob。
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { FontFamily } from "@/types";
import { extractFrontmatter } from "@/lib/markdown-raw-guard";

export const GOOSE_FONT_KEY = "goose-font";
export const GOOSE_LOCKED_KEY = "goose-locked";

/** 会写入 / 从 frontmatter 恢复的 Page 字段 */
export const LOCAL_PAGE_FRONTMATTER_SETTINGS_KEYS = [
  "fontFamily",
  "isLocked",
] as const;

export type LocalPageFrontmatterSettingsKey =
  (typeof LOCAL_PAGE_FRONTMATTER_SETTINGS_KEYS)[number];

export type LocalPageFrontmatterSettings = {
  fontFamily: FontFamily;
  isLocked: boolean;
};

const DEFAULT_SETTINGS: LocalPageFrontmatterSettings = {
  fontFamily: "default",
  isLocked: false,
};

const VALID_FONTS = new Set<FontFamily>(["default", "serif", "mono"]);

export function isLocalPageFrontmatterSettingsUpdate(
  updates: Partial<Record<string, unknown>>,
): boolean {
  return LOCAL_PAGE_FRONTMATTER_SETTINGS_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(updates, key),
  );
}

function stripFrontmatterDelimiters(blob: string): string {
  const lines = blob.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length >= 2 && lines[0].trim() === "---") {
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== -1) {
      return lines.slice(1, endIdx).join("\n");
    }
  }
  return blob;
}

function wrapFrontmatter(yamlBody: string): string {
  const body = yamlBody.replace(/\s+$/, "");
  return body ? `---\n${body}\n---` : "---\n---";
}

function normalizeFont(value: unknown): FontFamily {
  if (typeof value !== "string") return "default";
  const trimmed = value.trim().toLowerCase();
  // 兼容早期/手写 default、sans
  if (trimmed === "sans" || trimmed === "default") return "default";
  if (trimmed === "serif" || trimmed === "mono") return trimmed;
  return "default";
}

function normalizeLocked(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "1") return true;
    if (t === "false" || t === "no" || t === "0" || t === "") return false;
  }
  return Boolean(value);
}

function settingsFromData(
  data: Record<string, unknown>,
): LocalPageFrontmatterSettings {
  const fontRaw = data[GOOSE_FONT_KEY];
  const lockedRaw = data[GOOSE_LOCKED_KEY];
  return {
    fontFamily:
      fontRaw === undefined ? "default" : normalizeFont(fontRaw),
    isLocked:
      lockedRaw === undefined ? false : normalizeLocked(lockedRaw),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 解析 frontmatter 原文 blob（可含 --- 定界符）。
 * 失败时 settings 回退默认，调用方应保留原 blob 不覆盖。
 */
export function parseLocalFrontmatterBlob(
  blob: string | null | undefined,
): {
  ok: boolean;
  data: Record<string, unknown>;
  settings: LocalPageFrontmatterSettings;
  error?: string;
} {
  if (!blob || !blob.trim()) {
    return { ok: true, data: {}, settings: { ...DEFAULT_SETTINGS } };
  }

  const yamlText = stripFrontmatterDelimiters(blob);
  if (!yamlText.trim()) {
    return { ok: true, data: {}, settings: { ...DEFAULT_SETTINGS } };
  }

  try {
    const parsed = parseYaml(yamlText);
    if (parsed == null) {
      return { ok: true, data: {}, settings: { ...DEFAULT_SETTINGS } };
    }
    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        data: {},
        settings: { ...DEFAULT_SETTINGS },
        error: "frontmatter 根节点必须是对象",
      };
    }
    return {
      ok: true,
      data: { ...parsed },
      settings: settingsFromData(parsed),
    };
  } catch (error) {
    return {
      ok: false,
      data: {},
      settings: { ...DEFAULT_SETTINGS },
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }
}

/**
 * 从完整 markdown 文本恢复页面设置（扫描/reload 用）。
 */
export function pageSettingsFromMarkdown(
  markdown: string | null | undefined,
): LocalPageFrontmatterSettings {
  if (markdown == null) return { ...DEFAULT_SETTINGS };
  const { frontmatter } = extractFrontmatter(markdown);
  return parseLocalFrontmatterBlob(frontmatter).settings;
}

export type MergeFrontmatterResult = {
  /** undefined = 文件无需 frontmatter 块 */
  blob: string | undefined;
  /** true 时 blob 为原样（或 undefined），未安全 merge */
  parseFailed: boolean;
  error?: string;
  settings: LocalPageFrontmatterSettings;
};

/**
 * 把白名单设置 merge 进 frontmatter。
 * - 默认值省略 goose 键
 * - 其它键保留
 * - 解析失败：不改写原文
 */
export function mergeLocalPageSettingsIntoFrontmatter(
  existingBlob: string | null | undefined,
  settings: LocalPageFrontmatterSettings,
): MergeFrontmatterResult {
  const fontFamily = VALID_FONTS.has(settings.fontFamily)
    ? settings.fontFamily
    : "default";
  const isLocked = Boolean(settings.isLocked);
  const normalized: LocalPageFrontmatterSettings = { fontFamily, isLocked };

  const parsed = parseLocalFrontmatterBlob(existingBlob);
  if (!parsed.ok) {
    return {
      blob: existingBlob?.trim() ? existingBlob : undefined,
      parseFailed: true,
      error: parsed.error,
      settings: normalized,
    };
  }

  const data: Record<string, unknown> = { ...parsed.data };

  if (fontFamily === "default") {
    delete data[GOOSE_FONT_KEY];
  } else {
    data[GOOSE_FONT_KEY] = fontFamily;
  }

  if (!isLocked) {
    delete data[GOOSE_LOCKED_KEY];
  } else {
    data[GOOSE_LOCKED_KEY] = true;
  }

  if (Object.keys(data).length === 0) {
    return {
      blob: undefined,
      parseFailed: false,
      settings: normalized,
    };
  }

  try {
    const yamlBody = stringifyYaml(data, {
      lineWidth: 0,
    }).replace(/\s+$/, "");
    return {
      blob: wrapFrontmatter(yamlBody),
      parseFailed: false,
      settings: normalized,
    };
  } catch (error) {
    return {
      blob: existingBlob?.trim() ? existingBlob : undefined,
      parseFailed: true,
      error: error instanceof Error ? error.message : "YAML 序列化失败",
      settings: normalized,
    };
  }
}
