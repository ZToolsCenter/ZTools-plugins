import { tool } from "ai";
import { z } from "zod";
import { NOTEBOOK_SKILLS, type NotebookSkillId } from "../skills";
import type { NotebookAiAgentContext } from "../types";

const skillIdSchema = z.enum([
  "createNoote",
  "updateNote",
  "deleteNote",
  "searchNotes",
  "chat",
  "visual",
  "webResearch",
]);

export const loadSkill = tool({
  description:
    "有明确任务时加载最匹配的 Skill。短确认或无新需求时不要调用。",
  inputSchema: z.object({
    skill: skillIdSchema.describe("要加载的 Skill"),
  }),
  execute: async (input, { experimental_context }) => {
    const context = experimental_context as NotebookAiAgentContext;
    const skillId = input.skill as NotebookSkillId;
    context.loadedSkills.add(skillId);
    const skill = NOTEBOOK_SKILLS[skillId];

    return {
      skill: skillId,
      supported: true,
      instructions: skill.content,
      availableTools: skill.tools,
    };
  },
});
