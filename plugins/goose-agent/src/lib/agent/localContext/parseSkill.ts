/**
 * SKILL.md frontmatter 解析（对齐 agentskills.io 与 goose-note localContext）。
 * 必填语义：name + description；缺 name 时用父目录名回退。
 */

import type { ContextScope, DiscoveredSkill } from "./types";

/** 单 Skill 正文上限，防止异常大文件撑爆上下文 */
export const MAX_SKILL_CONTENT_CHARACTERS = 32_000;

/**
 * 从 YAML frontmatter 取单行键值（不依赖完整 YAML 解析器）。
 * 支持 `key: value` / `key: "value"` / `key: 'value'`。
 */
export function frontmatterValue(content: string, key: string): string {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return "";
  const block = match[1] ?? "";
  const line = block
    .split("\n")
    .find((item) => item.trimStart().startsWith(`${key}:`));
  if (!line) return "";
  return line
    .slice(line.indexOf(":") + 1)
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

/** 从路径取父目录名作为 skill name 回退 */
export function fallbackSkillName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
  const parent = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  // …/skills/<name>/SKILL.md → 取 <name>
  if (parts.length >= 2 && last?.toLowerCase() === "skill.md") {
    return parent ?? "skill";
  }
  return parent ?? last ?? "skill";
}

/**
 * 规范化 skill name：小写、空格/下划线转连字符。
 * 不符合 agentskills 常见 id 形态时返回空串。
 */
export function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : "";
}

export type ParseSkillFileInput = {
  path: string;
  content: string;
  scope: ContextScope;
};

/**
 * 解析单个 SKILL.md 文件为 DiscoveredSkill。
 * name 无效时返回 null（调用方可选择丢弃）。
 */
export function parseSkillFile(
  input: ParseSkillFileInput,
): DiscoveredSkill | null {
  const rawName =
    frontmatterValue(input.content, "name") || fallbackSkillName(input.path);
  const name = normalizeSkillName(rawName);
  if (!name) return null;

  const description =
    frontmatterValue(input.content, "description") || "本地 Skill";

  return {
    name,
    description,
    path: input.path,
    content: input.content.trim().slice(0, MAX_SKILL_CONTENT_CHARACTERS),
    scope: input.scope,
  };
}

/**
 * 批量解析；同 scope 内同名保留先出现的（调用方应先排好序）。
 * 跨 scope 去重请用 merge.mergeSkills。
 */
export function parseSkillFiles(
  files: ParseSkillFileInput[],
): DiscoveredSkill[] {
  const seen = new Set<string>();
  const out: DiscoveredSkill[] = [];
  for (const file of files) {
    const skill = parseSkillFile(file);
    if (!skill || seen.has(skill.name)) continue;
    seen.add(skill.name);
    out.push(skill);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
