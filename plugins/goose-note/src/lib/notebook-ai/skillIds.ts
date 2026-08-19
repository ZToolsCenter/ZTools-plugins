export const NOTEBOOK_SKILL_IDS = [
  "createNoote",
  "updateNote",
  "deleteNote",
  "searchNotes",
  "chat",
  "visual",
  "webResearch",
] as const;

export type NotebookSkillId = (typeof NOTEBOOK_SKILL_IDS)[number];

const NOTEBOOK_SKILL_ID_SET = new Set<string>(NOTEBOOK_SKILL_IDS);

export function isNotebookSkillId(value: unknown): value is NotebookSkillId {
  return typeof value === "string" && NOTEBOOK_SKILL_ID_SET.has(value);
}
