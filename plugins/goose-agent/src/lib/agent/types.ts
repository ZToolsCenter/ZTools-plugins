import type { AISettingsLike } from "@/lib/ai-provider";
import type { PermissionMode } from "./permission";
import type { SubAgentRunSnapshot } from "./subagent/types";
import type { AgentToolContext as RegistryToolContext } from "./tools/types";
import type { AgentTokenUsage } from "./usage";

/** 三档权限：与 permission.ts 同源（ADR 0007）。 */
export type { PermissionMode } from "./permission";

export type { AgentTokenUsage, UsageSource } from "./usage";
export type { SubAgentRunSnapshot } from "./subagent/types";

export type AgentChatRole = "user" | "assistant" | "system";

/** 多模态 content part（用户附图）；runtime 侧负责编入各协议 */
export type AgentChatContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; dataBase64: string };

export type AgentChatMessage = {
  role: AgentChatRole;
  /**
   * 纯文本为 string；含图时为 parts 数组。
   * 无图路径保持 string，兼容现有 toAIMessages / tool loop。
   */
  content: string | AgentChatContentPart[];
};

export type AgentTurnEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-start"; id: string; name: string; input?: unknown }
  | { type: "tool-end"; id: string; name: string; result: unknown }
  /** 子代理进度：更新 AgentToolPart.subRun，不结束 tool */
  | {
      type: "tool-progress";
      id: string;
      name: string;
      subRun: SubAgentRunSnapshot;
    }
  | { type: "usage"; usage: AgentTokenUsage }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * 运行时工具上下文 = 注册表上下文 + 中止信号。
 * `loadedSkills` 会在 loadSkill 后被原地更新，供下一轮 getActiveTools。
 * `subagentDepth`：0 根 turn；>= MAX_SUBAGENT_DEPTH 时禁再派发。
 */
export type AgentToolContext = RegistryToolContext & {
  signal: AbortSignal;
  /** 当前嵌套深度（0 = 用户会话 turn） */
  subagentDepth?: number;
};

/**
 * OpenAI function calling 用的工具描述（包装 registry handler）。
 */
export type AgentToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema object */
  parameters?: Record<string, unknown>;
  execute: (input: unknown, ctx: AgentToolContext) => Promise<unknown>;
};

/** settings 与 useSettings().ai / AISettingsLike 对齐。 */
export type AgentTurnSettings = AISettingsLike & {
  /** 是否并入 ~/AGENTS.md（缺省 true，与设置默认一致） */
  readGlobalPrompt?: boolean;
  /** 是否合并本地 discovered skills（缺省 true） */
  readLocalSkills?: boolean;
};

export type RunAgentTurnOptions = {
  messages: AgentChatMessage[];
  settings: AgentTurnSettings;
  permissionMode: PermissionMode;
  workspaceRoot: string | null;
  signal: AbortSignal;
  onEvent: (e: AgentTurnEvent) => void;
  /**
   * 可选：覆盖 system 边界（例如 UI 已读到的 AGENTS.md）。
   * 未传时用 `src/agent/AGENTS.md` / 内联默认。
   */
  agentsMd?: string;
  /** 角色 systemSnippet（最前）；不传则用默认 Persona */
  personaSnippet?: string | null;
  /** 显式全局 AGENTS.md；传了则不再读 gooseAiContext */
  globalAgentsMd?: string | null;
  /** 显式项目 AGENTS.md；传了则不再读 gooseAiContext */
  projectAgentsMd?: string | null;
  /** 会话级已加载 Skill；不传则本轮新建 Set。 */
  loadedSkills?: Set<string> | string[];
  /** 覆盖模型（Composer 工作区模型选择）。 */
  selectedModelId?: string | null;
  /** 当前会话 id；注入 toolCtx，供文件变更追踪。 */
  conversationId?: string;
  /**
   * 子代理嵌套深度。缺省 0（根 turn）。
   * 子 run 由 executeRunSubagent 传入 depth+1。
   */
  subagentDepth?: number;
};

/** OpenAI Chat Completions 一轮里可能出现的 tool_call。 */
export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};
