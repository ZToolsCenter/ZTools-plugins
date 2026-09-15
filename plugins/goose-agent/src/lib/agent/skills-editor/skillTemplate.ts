/**
 * 新建技能包模板与命名校验（对齐 agentskills 常见 id 形态）。
 */

/**
 * agentskills 风格目录名：小写字母数字连字符，长度 1–64，
 * 不首尾连字符，无连续 `--`。
 */
export function isValidSkillDirName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false;
  // 单段：纯 alnum；或多段 alnum 用单 `-` 连接
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** 规范化目录名：trim、小写、空格/下划线转连字符 */
function normalizeDirName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * 生成新技能包的目录名、SKILL.md 相对路径与正文模板。
 * dirName 为规范化后的 name（调用方宜先用 isValidSkillDirName 校验）。
 */
export function buildNewSkillPackage(
  name: string,
  description?: string,
): {
  dirName: string;
  skillMdRelativePath: string;
  skillMdContent: string;
} {
  const dirName = normalizeDirName(name);
  const desc =
    description?.trim() ||
    `Skill: ${dirName}`;
  const skillMdRelativePath = `${dirName}/SKILL.md`;
  const skillMdContent = [
    "---",
    `name: ${dirName}`,
    `description: ${desc}`,
    "---",
    "",
    `# ${dirName}`,
    "",
    "在此编写技能说明与使用步骤。",
    "",
  ].join("\n");

  return { dirName, skillMdRelativePath, skillMdContent };
}

/** 建议的新文本文件名，默认 notes.md */
export function suggestNewTextFileName(baseName?: string): string {
  const raw = baseName?.trim();
  if (!raw) return "notes.md";
  return raw;
}
