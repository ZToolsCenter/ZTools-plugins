/**
 * 合并全局 + 项目上下文：技能、提示词层、system body 组装。
 */

import type { AgentPersona } from "../persona/types";
import type { DiscoveredSkill, PromptLayers } from "./types";

/**
 * 合并技能列表：项目同名优先于全局；builtin 最低。
 * 输入可为任意顺序；输出按 name 字典序。
 */
export function mergeSkills(
  skills: DiscoveredSkill[],
): DiscoveredSkill[] {
  const scopeRank: Record<DiscoveredSkill["scope"], number> = {
    project: 3,
    global: 2,
    builtin: 1,
  };

  const byName = new Map<string, DiscoveredSkill>();
  for (const skill of skills) {
    const prev = byName.get(skill.name);
    if (!prev || scopeRank[skill.scope] >= scopeRank[prev.scope]) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 组装 PromptLayers（空串视为 null）。
 */
export function mergePromptLayers(input: {
  globalAgentsMd?: string | null;
  projectAgentsMd?: string | null;
}): PromptLayers {
  const g = input.globalAgentsMd?.trim() || null;
  const p = input.projectAgentsMd?.trim() || null;
  return { globalAgentsMd: g, projectAgentsMd: p };
}

export type ComposeAgentsBodyOptions = {
  /** 角色性格短段；有则置于最前 */
  persona?: AgentPersona | null;
  /** 是否读入全局 ~/AGENTS.md */
  readGlobalPrompt?: boolean;
  /** 已发现的提示词层 */
  layers?: PromptLayers | null;
  /**
   * 内置默认边界（如 DEFAULT_AGENT_SYSTEM_BOUNDARY）。
   * 有则接在用户/项目提示词之后；调用方也可自行拼接。
   */
  builtinBoundary?: string | null;
};

/**
 * 组装 agents 主体文本（不含权限/工作区等运行时段）。
 *
 * 顺序（锁定）：
 * 1. persona.systemSnippet（有则）
 * 2. 若 readGlobalPrompt 且有 globalAgentsMd：`# 用户全局提示词` + 正文
 * 3. 若有 projectAgentsMd：`# 项目提示词（AGENTS.md）` + 正文
 * 4. 可选 builtinBoundary（内置默认边界）
 *
 * 各段之间空一行；全空时返回 ""。
 */
export function composeAgentsBody(opts: ComposeAgentsBodyOptions): string {
  const parts: string[] = [];

  const snippet = opts.persona?.systemSnippet?.trim();
  if (snippet) {
    parts.push(snippet);
  }

  if (opts.readGlobalPrompt) {
    const global = opts.layers?.globalAgentsMd?.trim();
    if (global) {
      parts.push(`# 用户全局提示词\n\n${global}`);
    }
  }

  const project = opts.layers?.projectAgentsMd?.trim();
  if (project) {
    parts.push(`# 项目提示词（AGENTS.md）\n\n${project}`);
  }

  const builtin = opts.builtinBoundary?.trim();
  if (builtin) {
    parts.push(builtin);
  }

  return parts.join("\n\n").trim();
}
