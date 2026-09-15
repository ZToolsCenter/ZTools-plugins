import {
  getBuiltinSkillCatalog,
  type SkillEntry,
} from "../skills";
import type { AgentToolContext } from "./types";

function markSkillLoaded(ctx: AgentToolContext, skillId: string) {
  if (ctx.loadedSkills instanceof Set) {
    ctx.loadedSkills.add(skillId);
    return;
  }
  if (Array.isArray(ctx.loadedSkills)) {
    if (!ctx.loadedSkills.includes(skillId)) {
      ctx.loadedSkills.push(skillId);
    }
    return;
  }
  // 缺省时挂到 ctx 上，便于宿主读取
  (ctx as { loadedSkills: string[] }).loadedSkills = [skillId];
}

function resolveCatalog(ctx: AgentToolContext): Record<string, SkillEntry> {
  if (ctx.skillCatalog && Object.keys(ctx.skillCatalog).length > 0) {
    return ctx.skillCatalog;
  }
  return getBuiltinSkillCatalog();
}

/**
 * loadSkill — 渐进披露：返回 skill instructions + availableTools。
 * 支持内置 + 合并后的用户/项目 skill（经 ctx.skillCatalog）。
 */
export async function executeLoadSkill(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const skillRaw = input.skill;
  if (typeof skillRaw !== "string" || !skillRaw.trim()) {
    return {
      supported: false,
      error: "未知 Skill：。请提供 skill id。",
    };
  }
  const skillId = skillRaw.trim();
  const catalog = resolveCatalog(ctx);
  const skill = catalog[skillId];

  if (!skill) {
    const available = Object.keys(catalog).sort().join(" / ");
    return {
      supported: false,
      error: `未知 Skill：${skillId}。可用：${available || "（无）"}`,
    };
  }

  markSkillLoaded(ctx, skillId);

  return {
    skill: skillId,
    supported: true,
    instructions: skill.content,
    availableTools: [...skill.tools],
    source: skill.source ?? "builtin",
  };
}

export const loadSkillDescription =
  "按需加载一个能力说明。执行文件、网页研究、对话、可视化、Office 文档、应用设置任务前必须先调用，并选择与用户需求最匹配的 Skill（chat / visual / webResearch / files / office / settings）。";
