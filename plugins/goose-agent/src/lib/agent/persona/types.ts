/**
 * Agent 角色（Persona）数据模型。
 * 由设置 / 运行时选择，经 composeAgentsBody 注入 system。
 */

export type AgentPersona = {
  id: string;
  name: string;
  isBuiltin: boolean;
  /** 注入 system 的短性格段 */
  systemSnippet: string;
};
