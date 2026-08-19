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
    "按需加载一个能力说明。执行任何笔记、搜索、网页研究、对话或可视化任务前必须先调用，并选择与用户需求最匹配的 Skill。",
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
