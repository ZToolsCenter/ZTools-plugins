import type { AISettingsLike } from "@/lib/ai-provider";
import type { PermissionMode } from "../permission";
import type { SkillEntry } from "../skills";

/**
 * 工具执行上下文。
 * - permissionMode / workspaceRoot：文件沙箱（ADR 0007）
 * - loadedSkills：loadSkill 渐进披露
 * - skillCatalog：合并后的 skills（内置 + 可选用户/项目）
 * - signal：可选中止（runTurn 注入）
 * - aiSettings：生图等需凭证的工具（可选）
 */
export type AgentToolContext = {
  permissionMode: PermissionMode;
  /** 当前工作区根；可空 */
  workspaceRoot: string | null;
  /**
   * 本会话已加载的 Skill id。
   * 传入 Set 时 loadSkill 会原地 add；传入数组时会 push（若尚未包含）。
   */
  loadedSkills?: Set<string> | string[];
  /**
   * 本轮 skill catalog（内置 + 可选 discovered）。
   * loadSkill / getSkillToolNames 优先读此表。
   */
  skillCatalog?: Record<string, SkillEntry>;
  /** 可选 AbortSignal（runTurn 等运行时注入） */
  signal?: AbortSignal;
  /**
   * 当前 Agent 会话 id；用于会话级文件变更追踪。
   * 缺失时 writeFile/deletePath/renamePath 跳过 recordChange。
   */
  conversationId?: string;
  /**
   * 子代理嵌套深度（0 = 用户会话 turn）。
   * 由 runTurn 注入；领域工具一般忽略。
   */
  subagentDepth?: number;
  /**
   * 当前 AI 设置快照（runTurn 注入）。
   * generateImage 等需 baseURL / 凭证的工具使用；缺省时相关工具返回明确错误。
   */
  aiSettings?: AISettingsLike;
};

export type AgentToolHandler = (
  input: Record<string, unknown>,
  ctx: AgentToolContext,
) => Promise<unknown>;
