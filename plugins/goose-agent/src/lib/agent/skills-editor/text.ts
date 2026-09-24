/**
 * 技能编辑：文本文件判定与模板。
 */

/** 常见可编辑文本扩展（小写，含点） */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".csv",
  ".tsv",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sql",
  ".graphql",
  ".gql",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".log",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
]);

/** 无扩展名但通常为文本的文件名 */
const TEXT_BASENAMES = new Set([
  "license",
  "licence",
  "readme",
  "changelog",
  "authors",
  "contributors",
  "makefile",
  "dockerfile",
  "gemfile",
  "rakefile",
  "procfile",
]);

function basename(path: string): string {
  const n = path.replace(/\\/g, "/");
  const parts = n.split("/");
  return parts[parts.length - 1] || path;
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  // 点文件如 .gitignore
  if (lower.startsWith(".") && !lower.slice(1).includes(".")) {
    return lower;
  }
  const i = lower.lastIndexOf(".");
  if (i <= 0) return "";
  return lower.slice(i);
}

/** 是否可能为可编辑文本文件（按扩展名 / 常见 basename） */
export function isProbablyTextFile(filePath: string): boolean {
  const name = basename(filePath);
  if (!name || name === "." || name === "..") return false;
  const lower = name.toLowerCase();
  if (TEXT_BASENAMES.has(lower)) return true;
  // .gitignore 等
  if (lower.startsWith(".") && TEXT_EXTENSIONS.has(lower)) return true;
  const ext = extensionOf(name);
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  // SKILL.md 已覆盖；无扩展名默认不当文本（避免二进制误开）
  return false;
}

/** 新建技能包默认 SKILL.md 模板 */
export function buildSkillMdTemplate(
  name: string,
  description = "本地 Skill",
): string {
  return `---
name: ${name}
description: ${description}
---

# ${name}

## 适用

- 描述何时使用本技能。

## 执行

- 说明主要步骤。

## 输出

- 说明期望输出格式。
`;
}

/** 校验 skill 目录名（与 normalizeSkillName 对齐） */
export function validateSkillPackageName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return null;
  if (normalized.length > 64) return null;
  return normalized;
}

/** 校验包内文件名（禁止路径穿越） */
export function validateSkillFileName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  if (name === "." || name === "..") return null;
  // 允许常见文件名
  if (!/^[a-zA-Z0-9._@+-][a-zA-Z0-9._@+ -]*$/.test(name)) return null;
  if (name.length > 128) return null;
  return name;
}
