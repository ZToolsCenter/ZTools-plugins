export const AGENT_SKILL_IDS = [
  "chat",
  "visual",
  "webResearch",
  "files",
  "office",
  "settings",
] as const;

export type AgentSkillId = (typeof AGENT_SKILL_IDS)[number];

const AGENT_SKILL_ID_SET = new Set<string>(AGENT_SKILL_IDS);

export function isAgentSkillId(value: unknown): value is AgentSkillId {
  return typeof value === "string" && AGENT_SKILL_ID_SET.has(value);
}
