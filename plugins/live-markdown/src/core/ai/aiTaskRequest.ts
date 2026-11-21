import type { AgentOrchestrationConfig } from "../../types/aiOrchestration";
import type { AiTaskRequest } from "./aiTaskRunner";
import { ROLE_PRESETS } from "./agentOrchestrator";
import { AI_ACTIONS, type AiTaskAction } from "./aiTaskPrompts";
import { selectAiChunkGranularity } from "./aiChunkingPolicy";

export interface AiTaskRequestInput {
  source: string;
  selected: boolean;
  action: AiTaskAction;
  userPrompt?: string;
  skill?: AiTaskRequest["skill"];
  config: Pick<AgentOrchestrationConfig, "provider" | "activeRoleId" | "customSystemPrompt" | "executionPolicy"> & Partial<Pick<AgentOrchestrationConfig, "model">>;
}

/** Shared by the UI and acceptance harness; preserves production role and chunk policies. */
export function buildAiTaskRequest(input: AiTaskRequestInput): AiTaskRequest {
  const { source, selected, action, userPrompt, skill, config } = input;
  const activeRole = ROLE_PRESETS.find((role) => role.id === config.activeRoleId) || ROLE_PRESETS[0];
  const actionDefinition = AI_ACTIONS.find((item) => item.id === action) ?? {
    id: "custom" as const,
    label: "自定义",
    prompt: `请根据用户要求处理以下 Markdown：${userPrompt || ""}`,
    system: "遵照用户指令操作，保留原文中未要求变更的事实和 Markdown 结构。只输出结果正文。"
  };
  return {
    executionPolicy: config.executionPolicy ?? "thin",
    modelId: config.model,
    source, scope: selected ? "selection" : "document", action, userPrompt, skill, provider: config.provider,
    baseSystemPrompt: config.customSystemPrompt?.trim() || activeRole.systemPrompt,
    actionDefinition,
    granularity: selectAiChunkGranularity(config.provider, action, skill)
  };
}
