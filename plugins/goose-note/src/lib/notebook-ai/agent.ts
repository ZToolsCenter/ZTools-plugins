import { ToolLoopAgent, hasToolCall, stepCountIs } from "ai";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { buildLanguageModel } from "./model";
import { notebookAiTools } from "./tools";
import {
  getSkillToolNames,
  NOTEBOOK_AGENT_INSTRUCTIONS,
} from "./skills";
import { getCurrentNotebookAiPageId } from "./context";
import { readGlobalAgentsPrompt } from "./localContext";
import { useSettings } from "@/stores/useSettings";
import { repairExecuteBatchPlanInput } from "./batch-plan/tool";
import type { ModelAvailability } from "./model";
import type { NotebookAiAgentContext } from "./types";

/** 只注入当前任务所需的稳定上下文，具体能力由 loadSkill 渐进加载。 */
function buildSystemPrompt(
  notebookId: string,
  currentPageId?: string | null,
): string {
  const notebook = useNotebooks.getState().notebooks[notebookId];
  const notebookName = notebook?.name ?? "未知笔记本";

  const pages = usePages.getState().pages;
  const activePageId = currentPageId ?? getCurrentNotebookAiPageId(notebookId);
  const activePage =
    activePageId && pages[activePageId]?.workspaceId === notebookId
      ? pages[activePageId]
      : undefined;
  const activePageLine =
    activePage && !activePage.trashedAt
      ? `[${activePage.id}] ${getPageTitle(activePage)}`
      : "（无当前打开页面）";

  const globalPrompt = useSettings.getState().ai.readGlobalPrompt
    ? readGlobalAgentsPrompt()
    : "";

  return `${NOTEBOOK_AGENT_INSTRUCTIONS}

${globalPrompt ? `# 用户全局提示词\n\n${globalPrompt}\n` : ""}
# 当前上下文

- 当前笔记本：${notebookName}
- 当前笔记本 id：${notebookId}
- 当前打开页面：${activePageLine}

先判断本轮需求是否在路由能力内。然后调用 loadSkill 加载最匹配的 Skill，再执行。`;
}

export type BuildAgentResult =
  | { ok: true; agent: ToolLoopAgent<never, typeof notebookAiTools> }
  | { ok: false; reason: string };

/**
 * 构建绑定指定笔记本的 ToolLoopAgent。
 * 每次调用都会重新构建以获取最新的笔记本上下文。
 */
export function buildNotebookAgent(
  notebookId: string,
  currentPageId?: string | null,
): BuildAgentResult {
  const agentContext: NotebookAiAgentContext = {
    notebookId,
    currentPageId: currentPageId ?? getCurrentNotebookAiPageId(notebookId),
    loadedSkills: new Set(),
  };
  const modelResult: ModelAvailability = buildLanguageModel();
  if (!modelResult.ok) {
    return { ok: false, reason: modelResult.reason };
  }

  const agent = new ToolLoopAgent({
    model: modelResult.model,
    tools: notebookAiTools,
    instructions: buildSystemPrompt(notebookId, agentContext.currentPageId),
    // executeBatchPlan 已经返回本地审批卡；不要再让模型看到该结果后继续一轮。
    // hasToolCall 在本步工具执行完成后才检查，因此不会阻止冻结计划的生成。
    stopWhen: [hasToolCall("executeBatchPlan"), stepCountIs(16)],
    experimental_context: agentContext,
    prepareStep: () => {
      const activeTools = [
        "loadSkill",
        ...getSkillToolNames(agentContext.loadedSkills),
      ] as Array<keyof typeof notebookAiTools>;
      return { activeTools };
    },
    experimental_repairToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== "executeBatchPlan") return null;
      const input = repairExecuteBatchPlanInput(toolCall.input);
      return input ? { ...toolCall, input } : null;
    },
  });

  return { ok: true, agent };
}
