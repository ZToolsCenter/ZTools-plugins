import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { notebookAiTools } from "../tools";
import {
  getSkillToolNames,
  NOTEBOOK_SKILLS,
  type NotebookSkillId,
} from "../skills";
import { repairExecuteBatchPlanInput } from "../batch-plan/tool";
import type { NotebookAiAgentContext } from "../types";
import { isNotebookSkillId } from "../skillIds";

type SdkTool = (typeof notebookAiTools)[keyof typeof notebookAiTools];

const TOOL_LABELS: Record<keyof typeof notebookAiTools, string> = {
  loadSkill: "加载 Skill",
  searchWeb: "联网搜索",
  readWebPage: "读取网页",
  listNotebooks: "列出笔记本",
  listPages: "列出页面",
  searchNotes: "搜索笔记",
  readPage: "读取页面",
  executeBatchPlan: "变更计划",
  showTable: "表格",
  showChart: "图表",
  showDiagram: "流程图",
  showSvg: "SVG",
};

/** 与 AI SDK 工具描述对齐的 TypeBox 参数（给模型看）。 */
const TOOL_PARAMETERS: Record<keyof typeof notebookAiTools, TSchema> = {
  loadSkill: Type.Object({
    skill: Type.Union(
      [
        Type.Literal("createNoote"),
        Type.Literal("updateNote"),
        Type.Literal("deleteNote"),
        Type.Literal("searchNotes"),
        Type.Literal("chat"),
        Type.Literal("visual"),
        Type.Literal("webResearch"),
      ],
      { description: "要加载的 Skill" },
    ),
  }),
  searchWeb: Type.Object({
    query: Type.String({ description: "搜索关键词" }),
  }),
  readWebPage: Type.Object({
    url: Type.String({ description: "网页 URL" }),
  }),
  listNotebooks: Type.Object({}),
  listPages: Type.Object({
    notebookId: Type.Optional(
      Type.String({ description: "指定笔记本 id；省略则使用当前绑定笔记本" }),
    ),
  }),
  searchNotes: Type.Object({
    query: Type.Optional(
      Type.String({ description: "搜索关键词", default: "" }),
    ),
  }),
  readPage: Type.Object({
    pageId: Type.Optional(
      Type.String({ description: "页面 id；省略则读取当前打开页面" }),
    ),
  }),
  executeBatchPlan: Type.Object({
    runId: Type.Optional(Type.String({ description: "可选 runId" })),
    title: Type.String({ description: "计划标题" }),
    summary: Type.String({ description: "计划摘要" }),
    operations: Type.Array(
      Type.Object(
        {
          type: Type.Union([
            Type.Literal("create"),
            Type.Literal("edit"),
            Type.Literal("search_replace"),
            Type.Literal("delete"),
          ]),
          operationId: Type.Optional(Type.String()),
          title: Type.Optional(Type.String()),
          markdown: Type.Optional(Type.String()),
          parentId: Type.Optional(Type.String()),
          pageId: Type.Optional(Type.String()),
          pageIds: Type.Optional(Type.Array(Type.String())),
          oldString: Type.Optional(Type.String()),
          newString: Type.Optional(Type.String()),
          replaceAll: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: true },
      ),
      { minItems: 1, maxItems: 50 },
    ),
  }),
  showTable: Type.Object({
    title: Type.Optional(Type.String()),
    columns: Type.Array(Type.String()),
    rows: Type.Array(Type.Array(Type.String())),
  }),
  showChart: Type.Object({
    type: Type.Union([
      Type.Literal("bar"),
      Type.Literal("line"),
      Type.Literal("pie"),
    ]),
    title: Type.Optional(Type.String()),
    data: Type.Any(),
  }),
  showDiagram: Type.Object({
    title: Type.Optional(Type.String()),
    language: Type.Literal("mermaid"),
    source: Type.String(),
  }),
  showSvg: Type.Object({
    title: Type.Optional(Type.String()),
    svg: Type.String(),
  }),
};

function resultToAgentToolResult(value: unknown): AgentToolResult<unknown> {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null, null, 0);
  return {
    content: [{ type: "text", text }],
    details: value,
  };
}

async function runSdkTool(
  tool: SdkTool,
  toolCallId: string,
  params: unknown,
  agentContext: NotebookAiAgentContext,
  signal?: AbortSignal,
): Promise<AgentToolResult<unknown>> {
  const execute = tool.execute;
  if (typeof execute !== "function") {
    throw new Error("工具缺少 execute");
  }

  let input = params;
  if (
    tool === notebookAiTools.executeBatchPlan &&
    (typeof params !== "object" || params === null)
  ) {
    const repaired =
      typeof params === "string" ? repairExecuteBatchPlanInput(params) : null;
    if (repaired) {
      try {
        input = JSON.parse(repaired);
      } catch {
        input = params;
      }
    }
  }

  const output = await execute(
    input as never,
    {
      toolCallId,
      messages: [],
      abortSignal: signal,
      experimental_context: agentContext,
    } as never,
  );

  const result = resultToAgentToolResult(output);
  if (tool === notebookAiTools.executeBatchPlan) {
    // 审批卡已生成：终止后续自动 LLM 轮次（对齐 legacy hasToolCall stopWhen）
    result.terminate = true;
  }
  return result;
}

export function buildPiDomainTools(
  agentContext: NotebookAiAgentContext,
): AgentTool[] {
  const names = Object.keys(notebookAiTools) as Array<
    keyof typeof notebookAiTools
  >;

  return names.map((name) => {
    const sdkTool = notebookAiTools[name];
    const parameters = TOOL_PARAMETERS[name];
    return {
      name,
      label: TOOL_LABELS[name],
      description: sdkTool.description ?? name,
      parameters,
      execute: async (toolCallId, params, signal) =>
        runSdkTool(
          sdkTool,
          toolCallId,
          params as Static<typeof parameters>,
          agentContext,
          signal,
        ),
    } satisfies AgentTool;
  });
}

/** 按已加载 Skill 裁剪 active tools（始终保留 loadSkill）。 */
export function getActivePiTools(
  allTools: AgentTool[],
  agentContext: NotebookAiAgentContext,
): AgentTool[] {
  const activeNames = new Set<string>([
    "loadSkill",
    ...getSkillToolNames(agentContext.loadedSkills),
  ]);
  return allTools.filter((tool) => activeNames.has(tool.name));
}

export function isKnownSkillId(value: unknown): value is NotebookSkillId {
  return isNotebookSkillId(value);
}
