import agentInstructions from "@/agent/AGENTS.md?raw";
import chatSkill from "@/agent/chat/SKILL.md?raw";
import createNooteSkill from "@/agent/createNoote/SKILL.md?raw";
import deleteNoteSkill from "@/agent/deleteNote/SKILL.md?raw";
import searchNotesSkill from "@/agent/searchNotes/SKILL.md?raw";
import updateNoteSkill from "@/agent/updateNote/SKILL.md?raw";
import visualSkill from "@/agent/visual/SKILL.md?raw";
import webResearchSkill from "@/agent/webResearch/SKILL.md?raw";
import type { NotebookSkillId } from "./skillIds";

export type { NotebookSkillId } from "./skillIds";

export const NOTEBOOK_AGENT_INSTRUCTIONS = agentInstructions.trim();

export const NOTEBOOK_SKILLS = {
  createNoote: {
    description: "在当前笔记本新建页面",
    content: createNooteSkill.trim(),
    tools: ["executeBatchPlan"],
  },
  updateNote: {
    description: "改写、追加或重命名页面",
    content: updateNoteSkill.trim(),
    tools: ["readPage", "executeBatchPlan"],
  },
  deleteNote: {
    description: "把当前笔记本中的页面移入垃圾箱",
    content: deleteNoteSkill.trim(),
    tools: [
      "listPages",
      "searchNotes",
      "readPage",
      "executeBatchPlan",
    ],
  },
  searchNotes: {
    description: "在当前笔记本搜索并读取页面",
    content: searchNotesSkill.trim(),
    tools: ["listPages", "searchNotes", "readPage"],
  },
  chat: {
    description: "基于已有上下文回答，不写入笔记",
    content: chatSkill.trim(),
    tools: ["readPage"],
  },
  visual: {
    description: "生成表格、图表、流程图或 SVG",
    content: visualSkill.trim(),
    tools: ["showTable", "showChart", "showDiagram", "showSvg"],
  },
  webResearch: {
    description: "读取网页、联网搜索并基于来源研究",
    content: webResearchSkill.trim(),
    tools: ["searchWeb", "readWebPage"],
  },
} as const;

export function getSkillToolNames(skillIds: Iterable<NotebookSkillId>) {
  return [...new Set([...skillIds].flatMap((id) => NOTEBOOK_SKILLS[id].tools))];
}
