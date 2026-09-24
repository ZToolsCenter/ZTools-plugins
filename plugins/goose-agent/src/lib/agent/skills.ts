import agentInstructions from "@/agent/AGENTS.md?raw";
import chatSkill from "@/lib/agent/skills/chat/SKILL.md?raw";
import filesSkill from "@/lib/agent/skills/files/SKILL.md?raw";
import officeSkill from "@/lib/agent/skills/office/SKILL.md?raw";
import settingsSkill from "@/lib/agent/skills/settings/SKILL.md?raw";
import visualSkill from "@/lib/agent/skills/visual/SKILL.md?raw";
import webResearchSkill from "@/lib/agent/skills/webResearch/SKILL.md?raw";
import type { DiscoveredSkill } from "./localContext/types";
import type { AgentSkillId } from "./skillIds";
import { isAgentSkillId } from "./skillIds";

export type { AgentSkillId } from "./skillIds";

export const AGENT_INSTRUCTIONS = agentInstructions.trim();

export type SkillEntry = {
  description: string;
  content: string;
  tools: readonly string[];
  /** 来源：内置 / 全局用户 / 项目 */
  source?: "builtin" | "global" | "project";
};

export const AGENT_SKILLS = {
  chat: {
    description: "基于已有上下文回答，不读写文件",
    content: chatSkill.trim(),
    tools: [] as const,
    source: "builtin" as const,
  },
  visual: {
    description: "生成表格、图表、流程图、HTML 预览、SVG 或 AI 图片",
    content: visualSkill.trim(),
    tools: [
      "showTable",
      "showChart",
      "showDiagram",
      "showSvg",
      "showHtml",
      "generateImage",
    ] as const,
    source: "builtin" as const,
  },
  webResearch: {
    description: "读取网页、联网搜索并基于来源研究",
    content: webResearchSkill.trim(),
    tools: ["searchWeb", "readWebPage"] as const,
    source: "builtin" as const,
  },
  files: {
    description: "列出、读取、写入、搜索或管理本地工作区文件（含建目录/删除/重命名）",
    content: filesSkill.trim(),
    tools: [
      "listDir",
      "readFile",
      "writeFile",
      "searchFiles",
      "mkdir",
      "deletePath",
      "renamePath",
    ] as const,
    source: "builtin" as const,
  },
  office: {
    description: "解析 Office 文档并生成修订版 Word / Excel / PowerPoint",
    content: officeSkill.trim(),
    tools: ["parseOffice", "writeDocx", "writeXlsx", "writePptx"] as const,
    source: "builtin" as const,
  },
  settings: {
    description: "查看或修改本机设置（模型、供应商、角色、外观、权限）",
    content: settingsSkill.trim(),
    tools: ["getAppSettings", "updateAppSettings"] as const,
    source: "builtin" as const,
  },
} as const satisfies Record<
  AgentSkillId,
  {
    description: string;
    content: string;
    tools: readonly string[];
    source: "builtin";
  }
>;

/**
 * 合并 skills catalog 供 loadSkill / getActiveTools 使用。
 *
 * 优先级（高 → 低）：
 * 1. **内置** AGENT_SKILLS — 与用户 id 冲突时**内置优先**
 * 2. **项目** discovered — 同名覆盖全局
 * 3. **全局** discovered
 *
 * 即：项目优先于全局；内置优先于用户（全局+项目）。
 * 与 localContext.mergeSkills（项目>全局>builtin 用于列表展示）不同：
 * 运行时 catalog 强制内置覆盖，避免用户 skill 劫持内置工具面。
 */
export function mergeSkillCatalog(
  globalSkills: DiscoveredSkill[] = [],
  projectSkills: DiscoveredSkill[] = [],
): Record<string, SkillEntry> {
  const catalog: Record<string, SkillEntry> = {};

  // 先全局再项目 → 项目同名覆盖全局
  for (const skill of globalSkills) {
    catalog[skill.name] = {
      description: skill.description,
      content: skill.content,
      tools: [],
      source: skill.scope === "project" ? "project" : "global",
    };
  }
  for (const skill of projectSkills) {
    catalog[skill.name] = {
      description: skill.description,
      content: skill.content,
      tools: [],
      source: "project",
    };
  }

  // 内置最后写入，覆盖同名用户 skill
  for (const id of Object.keys(AGENT_SKILLS) as AgentSkillId[]) {
    const builtin = AGENT_SKILLS[id];
    catalog[id] = {
      description: builtin.description,
      content: builtin.content,
      tools: [...builtin.tools],
      source: "builtin",
    };
  }

  return catalog;
}

/** 仅内置 catalog（无用户 skill） */
export function getBuiltinSkillCatalog(): Record<string, SkillEntry> {
  return mergeSkillCatalog([], []);
}

export function getSkillToolNames(
  skillIds: Iterable<string>,
  catalog?: Record<string, SkillEntry>,
): string[] {
  const table = catalog ?? getBuiltinSkillCatalog();
  const names = new Set<string>();
  for (const id of skillIds) {
    const entry = table[id];
    if (!entry) continue;
    for (const tool of entry.tools) {
      names.add(tool);
    }
  }
  return [...names];
}

/** catalog 中是否含该 skill id（内置或用户） */
export function hasSkillInCatalog(
  skillId: string,
  catalog?: Record<string, SkillEntry>,
): boolean {
  if (catalog) return skillId in catalog;
  return isAgentSkillId(skillId);
}
