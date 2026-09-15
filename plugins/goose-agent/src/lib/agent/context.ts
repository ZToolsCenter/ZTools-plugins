import { composeAgentsBody } from "./localContext/merge";
import {
  PERMISSION_MODE_LABELS,
  type PermissionMode,
} from "./permission";
import { AGENT_INSTRUCTIONS } from "./skills";

/**
 * 默认系统边界：优先 `src/agent/AGENTS.md`（经 skills 以 ?raw 打入）；
 * 若为空则用内联简短中文边界。
 */
const INLINE_AGENT_SYSTEM_BOUNDARY = `你是「鹅的 Agent」，运行在 uTools 本地工作台中。

# 行为边界
- 先判断本轮任务是否需要工具；需要时优先 loadSkill 加载最匹配的 Skill，再执行。
- 文件读写受当前 Permission Mode 与工作区沙箱约束；无工作区时不可用文件类工具。
- 不臆造已执行的工具结果；拿不到的信息就说明并请用户补充。
- 回答使用大陆简体中文（用户要求其它语言时除外）。`;

export const DEFAULT_AGENT_SYSTEM_BOUNDARY =
  AGENT_INSTRUCTIONS.trim() || INLINE_AGENT_SYSTEM_BOUNDARY;

export type BuildAgentSystemPromptOptions = {
  permissionMode: PermissionMode;
  workspaceRoot: string | null;
  /**
   * 角色 systemSnippet，置于最前。
   * null / 空串：不注入；未传时由调用方决定是否用默认 Persona。
   */
  personaSnippet?: string | null;
  /** ~/AGENTS.md（开关打开且读到时） */
  globalAgentsMd?: string | null;
  /** 工作区根 AGENTS.md */
  projectAgentsMd?: string | null;
  /**
   * 兼容旧路径：若提供则作为整块 agents body，
   * 覆盖「内置边界」位置（仍可再叠 global / project 段）。
   */
  agentsMd?: string | null;
  /** 本轮实际可用工具名（可空） */
  toolNames?: string[];
  /**
   * 非原生 function calling 时：工具仅经 prompt 约定描述。
   * 当前 claude 走此路径；openai / openai-responses 为原生 FC。
   * UI / 上层可再调 executeTool 手动执行。
   */
  toolsViaPromptOnly?: boolean;
};

/**
 * 组装本轮 system prompt：
 * persona → 全局提示词 → 项目提示词 → 边界/agents body → 权限/工作区/工具。
 * （与 localContext.composeAgentsBody 顺序一致）
 *
 * 本模块不直接做 FS I/O；层内容由调用方（runTurn / UI）注入。
 */
export function buildAgentSystemPrompt(
  opts: BuildAgentSystemPromptOptions,
): string {
  const modeLabel =
    PERMISSION_MODE_LABELS[opts.permissionMode] ?? opts.permissionMode;
  const workspaceLine = opts.workspaceRoot?.trim()
    ? opts.workspaceRoot.trim()
    : "（未挂载工作区；文件类工具不可用）";

  // agentsMd 兼容覆盖内置边界；否则用 AGENTS.md / 内联默认
  const builtinBoundary = opts.agentsMd?.trim()
    ? opts.agentsMd.trim()
    : DEFAULT_AGENT_SYSTEM_BOUNDARY;

  const personaSnippet = opts.personaSnippet?.trim() || null;
  const agentsBody = composeAgentsBody({
    persona: personaSnippet
      ? {
          id: "inline",
          name: "inline",
          isBuiltin: false,
          systemSnippet: personaSnippet,
        }
      : null,
    // 调用方已按开关决定是否传入 globalAgentsMd
    readGlobalPrompt: true,
    layers: {
      globalAgentsMd: opts.globalAgentsMd?.trim() || null,
      projectAgentsMd: opts.projectAgentsMd?.trim() || null,
    },
    builtinBoundary,
  });

  const toolNames = opts.toolNames?.filter(Boolean) ?? [];
  let toolsSection = "";
  if (toolNames.length > 0) {
    if (opts.toolsViaPromptOnly) {
      toolsSection = `
# 可用工具（经 prompt 约定，非原生 function calling）
本轮协议未走 OpenAI function calling；下列工具名供你规划参考。实际执行由宿主侧 \`executeTool\` 手动路径完成，不要假装已调用。
- ${toolNames.join("\n- ")}
`;
    } else {
      toolsSection = `
# 可用工具
你可通过 function calling 调用：${toolNames.join("、")}。需要领域能力时先 loadSkill（若已注册）。
`;
    }
  }

  const runtime = `# 当前运行上下文
- Permission Mode：${modeLabel}
- 工作区根路径：${workspaceLine}
${toolsSection}`.trim();

  return [agentsBody, runtime].filter(Boolean).join("\n\n").trim();
}

/**
 * 尝试解析「用户可见的 AGENTS 边界」来源说明（调试 / 日志用）。
 * 运行时真正读文件由上层或 tools 负责。
 */
export function describeAgentsMdSource(opts?: {
  agentsMd?: string | null;
  globalAgentsMd?: string | null;
  projectAgentsMd?: string | null;
}): string {
  const tags: string[] = [];
  if (opts?.agentsMd?.trim()) tags.push("agentsMd");
  else tags.push("inline-default");
  if (opts?.globalAgentsMd?.trim()) tags.push("global");
  if (opts?.projectAgentsMd?.trim()) tags.push("project");
  return tags.join("+");
}
