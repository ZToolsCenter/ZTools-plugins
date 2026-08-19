import {
  Agent,
  type AgentEvent,
  type AgentLoopTurnUpdate,
} from "@earendil-works/pi-agent-core";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { getCurrentNotebookAiPageId } from "../context";
import { readGlobalAgentsPrompt } from "../localContext";
import { useSettings } from "@/stores/useSettings";
import {
  getSkillToolNames,
  NOTEBOOK_AGENT_INSTRUCTIONS,
  type NotebookSkillId,
} from "../skills";
import type { NotebookAiAgentContext } from "../types";
import { buildPiLanguageModel } from "./model";
import { buildPiDomainTools, getActivePiTools, isKnownSkillId } from "./tools";

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

export type BuildPiAgentResult =
  | {
      ok: true;
      agent: Agent;
      agentContext: NotebookAiAgentContext;
      restoreLoadedSkills: (skillIds: Iterable<NotebookSkillId>) => void;
      abort: () => void;
    }
  | { ok: false; reason: string };

/**
 * 构建以 Pi 为 harness 的笔记本 Agent：loop/tool call/state 归 Pi，
 * 领域 execute 仍走鹅现有 notebookAiTools。
 */
export function buildPiNotebookAgent(
  notebookId: string,
  currentPageId?: string | null,
): BuildPiAgentResult {
  const agentContext: NotebookAiAgentContext = {
    notebookId,
    currentPageId: currentPageId ?? getCurrentNotebookAiPageId(notebookId),
    loadedSkills: new Set(),
  };

  const modelResult = buildPiLanguageModel();
  if (!modelResult.ok) {
    return { ok: false, reason: modelResult.reason };
  }

  const allTools = buildPiDomainTools(agentContext);
  let turnCount = 0;
  const MAX_TURNS = 16;

  const agent: Agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(notebookId, agentContext.currentPageId),
      model: modelResult.model,
      thinkingLevel: "off",
      tools: getActivePiTools(allTools, agentContext),
    },
    streamFn: modelResult.models.streamSimple.bind(modelResult.models),
    getApiKey: async () => {
      const auth = await modelResult.models.getAuth(modelResult.model);
      return auth?.auth.apiKey;
    },
    toolExecution: "sequential",
    prepareNextTurnWithContext: async (
      turnContext,
    ): Promise<AgentLoopTurnUpdate | undefined> => {
      // 只刷新 systemPrompt / tools，绝不替换 messages，避免 DeepSeek 等
      // 出现 Duplicate call_id（重复注入 tool 历史）。
      return {
        context: {
          ...turnContext.context,
          systemPrompt: buildSystemPrompt(
            notebookId,
            agentContext.currentPageId,
          ),
          tools: getActivePiTools(allTools, agentContext),
        },
      };
    },
    afterToolCall: async (context) => {
      if (context.toolCall.name === "loadSkill") {
        const skill = (context.args as { skill?: unknown })?.skill;
        if (isKnownSkillId(skill)) {
          agentContext.loadedSkills.add(skill);
          // 立即刷新 tools，让同批后续工具可见（sequential 模式）
          agent.state.tools = getActivePiTools(allTools, agentContext);
          const skillTools = getSkillToolNames([skill]);
          return {
            details: {
              ...(typeof context.result.details === "object" &&
              context.result.details
                ? (context.result.details as Record<string, unknown>)
                : {}),
              availableTools: skillTools,
            },
            content: context.result.content,
          };
        }
      }
      if (context.toolCall.name === "executeBatchPlan") {
        return { terminate: true };
      }
      return undefined;
    },
  });

  // 用 subscribe 统计 turn，超过上限 abort
  const unsub = agent.subscribe(async (event: AgentEvent) => {
    if (event.type === "turn_start") {
      turnCount += 1;
      if (turnCount > MAX_TURNS) {
        agent.abort();
      }
    }
  });

  return {
    ok: true,
    agent,
    agentContext,
    restoreLoadedSkills: (skillIds) => {
      for (const skillId of skillIds) {
        agentContext.loadedSkills.add(skillId);
      }
      agent.state.tools = getActivePiTools(allTools, agentContext);
    },
    abort: () => {
      unsub();
      agent.abort();
    },
  };
}
