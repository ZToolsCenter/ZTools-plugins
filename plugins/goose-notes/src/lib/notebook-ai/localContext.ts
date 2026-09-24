const MAX_GLOBAL_PROMPT_CHARACTERS = 24_000;
const MAX_LOCAL_SKILL_CHARACTERS = 32_000;

export interface LocalSkill {
  name: string;
  description: string;
  path: string;
  content: string;
}

function frontmatterValue(content: string, key: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return "";
  const line = match[1]
    .split("\n")
    .find((item) => item.trimStart().startsWith(`${key}:`));
  return line?.slice(line.indexOf(":") + 1).trim().replace(/^['"]|['"]$/g, "") ?? "";
}

function fallbackSkillName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.at(-2) ?? "skill";
}

function normalizeSkillName(name: string) {
  const normalized = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : "";
}

let cachedSkillFiles: ReturnType<NonNullable<Window["gooseAiContext"]>["listLocalSkills"]> | null = null;
let cachedAt = 0;
/** 本地 Skill 列表缓存；避免每次 `/` 同步读 ~/.agents/skills 卡主线程 */
const LOCAL_SKILL_CACHE_MS = 60_000;

export function clearLocalSkillsCache() {
  cachedSkillFiles = null;
  cachedAt = 0;
}

/**
 * 空闲预热：无有效缓存时强制读一次磁盘。
 * composer mount 后可用 requestIdleCallback / setTimeout 调用。
 */
export function warmLocalSkillsCache() {
  const cacheFresh =
    cachedSkillFiles != null && Date.now() - cachedAt < LOCAL_SKILL_CACHE_MS;
  if (cacheFresh) return;
  getLocalSkills(true);
}

export function getLocalSkills(forceRefresh = false): LocalSkill[] {
  const cacheFresh = Date.now() - cachedAt < LOCAL_SKILL_CACHE_MS;
  const files =
    !forceRefresh && cachedSkillFiles && cacheFresh
      ? cachedSkillFiles
      : (window.gooseAiContext?.listLocalSkills?.() ?? []);
  cachedSkillFiles = files;
  cachedAt = Date.now();
  const seenNames = new Set<string>();
  return files
    .map(({ path, content }) => ({
      name: normalizeSkillName(
        frontmatterValue(content, "name") || fallbackSkillName(path),
      ),
      description: frontmatterValue(content, "description") || "本地 Skill",
      path,
      content: content.trim().slice(0, MAX_LOCAL_SKILL_CHARACTERS),
    }))
    .filter((skill) => {
      if (!skill.name || seenNames.has(skill.name)) return false;
      seenNames.add(skill.name);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchLocalSkills(query: string) {
  const normalized = query.trim().toLowerCase();
  return getLocalSkills()
    .filter(
      (skill) =>
        !normalized ||
        skill.name.toLowerCase().includes(normalized) ||
        skill.description.toLowerCase().includes(normalized),
    )
    .slice(0, 30);
}

/**
 * 扫描 prompt 任意位置的 `/name`，返回第一个在 getLocalSkills() 中存在的 skill。
 * 不再限定行首，便于「请用 /grill-me 帮我…」这类写法。
 */
export function resolveInvokedLocalSkill(promptText: string): LocalSkill | null {
  if (!promptText) return null;
  const skills = getLocalSkills();
  if (!skills.length) return null;
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const re = /\/([a-z0-9][a-z0-9-]*)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(promptText)) !== null) {
    const skill = byName.get(match[1].toLowerCase());
    if (skill) return skill;
  }
  return null;
}

/**
 * 优先取 tokens 中第一个 skill chip；若无 chip 则拼文本再走 resolveInvokedLocalSkill。
 */
export function resolveInvokedLocalSkillFromTokens(
  tokens: Array<{ type: string; skill?: { name: string }; text?: string }>,
): LocalSkill | null {
  for (const token of tokens) {
    if (token.type !== "skill" || !token.skill?.name) continue;
    const name =
      normalizeSkillName(token.skill.name) || token.skill.name.toLowerCase();
    return getLocalSkills().find((skill) => skill.name === name) ?? null;
  }

  const text = tokens
    .map((token) => {
      if (token.type === "text") return token.text ?? "";
      if (token.type === "skill" && token.skill?.name) {
        return `/${token.skill.name}`;
      }
      return "";
    })
    .join("");
  return resolveInvokedLocalSkill(text);
}

export function readGlobalAgentsPrompt() {
  return (
    window.gooseAiContext?.readGlobalPrompt?.()?.trim().slice(
      0,
      MAX_GLOBAL_PROMPT_CHARACTERS,
    ) ?? ""
  );
}
