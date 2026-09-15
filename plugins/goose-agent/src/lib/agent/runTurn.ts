/**
 * Agent 一轮 / 多轮运行时入口。
 *
 * 策略（务实）：
 * 1. 无 API key / 未开启 → onEvent error（中文），不 throw 崩 UI。
 * 2. 默认纯 chat：走 `runAITextStream` 文本流。
 * 3. 协议为 openai（Chat Completions）或 openai-responses 且存在可调用工具时：
 *    原生 function calling 循环，最多 MAX_TOOL_STEPS 步；工具执行走 registry。
 * 4. claude：暂无原生 tools 环，工具经 prompt 约定（toolsViaPromptOnly）；
 *    宿主可调 registry `executeTool` 手动执行。
 * 5. 不依赖 @earendil-works/pi-*。
 */

import {
  getAIAvailability,
  getCustomAIBaseURL,
  getRequestCredential,
  mapFetchErrorIfGrokCliVersion,
  resolveActiveProtocol,
  resolveGrokCliClientVersion,
  runAITextStream,
  withCliProxyHeaders,
  type AISettingsLike,
} from "@/lib/ai-provider";
import {
  getCustomProviderOptions,
  getCustomSelectedModelId,
  getRequestReasoningLevel,
  readErrorMessage,
} from "@/lib/ai-provider/modelCatalog";
import { readSSELines } from "@/lib/ai-provider/stream";
import { buildAgentSystemPrompt } from "./context";
import {
  listGlobalDiscoveredSkills,
  listProjectDiscoveredSkills,
  readGlobalAgentsPrompt,
  readProjectAgentsPrompt,
} from "./localContext";
import {
  buildToolResultMessage,
  formatToolResultForModel,
  messageHasContent,
  parseToolArguments,
  prependSystemPrompt,
  toAIMessages,
  toOpenAILoopMessages,
  type OpenAILoopMessage,
} from "./messageFormat";
import type { AIContentPart } from "@/lib/ai-provider";
import {
  contentToPlainText,
  toResponsesInputContent,
} from "@/lib/ai-provider/multimodal";
import { DEFAULT_PERSONA } from "./persona/builtins";
import {
  executeTool as registryExecuteTool,
  getActiveTools,
  isAgentToolName,
  type AgentToolName,
} from "./registry";
import {
  getBuiltinSkillCatalog,
  mergeSkillCatalog,
  type SkillEntry,
} from "./skills";
import { getToolSchema } from "./toolSchemas";
import {
  isRunSubagentToolName,
  RUN_SUBAGENT_TOOL_NAME,
} from "./subagent/types";
import { RUN_SUBAGENT_SCHEMA } from "./subagent/schema";
import { shouldExposeRunSubagent } from "./subagent/runSubagent";
import type {
  AgentChatMessage,
  AgentToolContext,
  AgentToolDefinition,
  AgentTurnEvent,
  OpenAIToolCall,
  RunAgentTurnOptions,
} from "./types";
import {
  estimateTokensFromText,
  estimateTurnUsage,
  mergeUsage,
  parseClaudeUsage,
  parseOpenAIChatUsage,
  parseOpenAIResponsesUsage,
  withSpeed,
  type AgentTokenUsage,
} from "./usage";

/** function calling 最大步数（长任务留余量；步数用尽会再请求一轮收尾文本）。 */
const MAX_TOOL_STEPS = 16;

/** 消息 content → 纯文本（估算 token 用；图忽略）。 */
function messageContentToText(
  content: AgentChatMessage["content"] | string | null | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return contentToPlainText(content as string | AIContentPart[]);
}

/**
 * 组装最终 usage 事件并 emit（成功路径、done 前一次）。
 * hasProvider：任一步解析到 provider usage。
 */
function emitTurnUsage(
  onEvent: (e: AgentTurnEvent) => void,
  opts: {
    merged: AgentTokenUsage | null;
    hasProvider: boolean;
    systemPrompt: string;
    systemPromptTokens: number;
    messages: AgentChatMessage[];
    completionText: string;
    turnStartedAt: number;
  },
): void {
  const durationMs = Date.now() - opts.turnStartedAt;
  let usage: AgentTokenUsage;
  if (opts.hasProvider && opts.merged) {
    usage = {
      ...opts.merged,
      systemPromptTokens: opts.systemPromptTokens,
      source: "provider",
      updatedAt: Date.now(),
    };
  } else {
    usage = estimateTurnUsage({
      systemPrompt: opts.systemPrompt,
      messages: opts.messages.map((m) => ({
        content: messageContentToText(m.content),
      })),
      completionText: opts.completionText,
      systemPromptTokens: opts.systemPromptTokens,
    });
  }
  emitSafe(onEvent, {
    type: "usage",
    usage: withSpeed(usage, durationMs),
  });
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { name?: string }).name === "AbortError";
}

function errorMessage(err: unknown, fallback = "Agent 运行失败"): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === "string" && err.trim()) return err.trim();
  return fallback;
}

function emitSafe(
  onEvent: (e: AgentTurnEvent) => void,
  event: AgentTurnEvent,
): void {
  try {
    onEvent(event);
  } catch {
    // UI 回调异常不反向打断 runtime
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input };
}

function normalizeLoadedSkills(
  loaded?: Set<string> | string[],
): Set<string> {
  if (loaded instanceof Set) return loaded;
  if (Array.isArray(loaded)) return new Set(loaded);
  return new Set();
}

function skillsAsArray(loaded: Set<string> | string[]): string[] {
  return loaded instanceof Set ? [...loaded] : [...loaded];
}

/**
 * 按已加载 Skill 组装本轮可暴露工具（包装 registry）。
 * loadSkill 始终在列；其余由 getActiveTools 解锁。
 */
/** 将 catalog 中的 skill 名写入 loadSkill 描述，便于模型选型 */
function enrichLoadSkillDescription(
  base: string,
  catalog?: Record<string, SkillEntry>,
): string {
  if (!catalog) return base;
  const ids = Object.keys(catalog).sort();
  if (ids.length === 0) return base;
  const lines = ids.map((id) => {
    const entry = catalog[id];
    const desc = entry?.description?.trim() || "";
    return desc ? `- ${id}：${desc}` : `- ${id}`;
  });
  return `${base}\n\n本轮可用 Skill：\n${lines.join("\n")}`;
}

export function loadAgentTools(ctx: AgentToolContext): AgentToolDefinition[] {
  const names = getActiveTools(
    skillsAsArray(normalizeLoadedSkills(ctx.loadedSkills)),
    ctx.skillCatalog,
    { permissionMode: ctx.permissionMode },
  );
  const tools: AgentToolDefinition[] = names.map((name) => {
    const schema = getToolSchema(name);
    const description =
      name === "loadSkill"
        ? enrichLoadSkillDescription(schema.description, ctx.skillCatalog)
        : schema.description;
    return {
      name,
      description,
      parameters: schema.parameters,
      execute: async (input, toolCtx) => {
        if (!isAgentToolName(name)) {
          return { ok: false, error: `未知工具：${name}` };
        }
        return registryExecuteTool(name as AgentToolName, asRecord(input), {
          ...toolCtx,
          loadedSkills: toolCtx.loadedSkills ?? normalizeLoadedSkills(),
          skillCatalog: toolCtx.skillCatalog ?? ctx.skillCatalog,
        });
      },
    };
  });

  // 子代理：深度门控；协议门控在 runAgentTurn 的 native FC 路径（仅 openai*）
  if (shouldExposeRunSubagent(ctx.subagentDepth)) {
    tools.push({
      name: RUN_SUBAGENT_TOOL_NAME,
      description: RUN_SUBAGENT_SCHEMA.description,
      parameters: RUN_SUBAGENT_SCHEMA.parameters,
      execute: async () => ({
        ok: false,
        error: "runSubagent 须由 Agent runtime 调度，不可直接 execute",
      }),
    });
  }

  return tools;
}

/**
 * 执行工具调用：runSubagent 走专用路径并发进度；其余走 registry。
 */
async function executeTurnToolCall(opts: {
  name: string;
  input: Record<string, unknown>;
  toolCallId: string;
  toolCtx: AgentToolContext;
  turnOpts: RunAgentTurnOptions;
  promptLayers: {
    personaSnippet: string | null;
    globalAgentsMd: string | null;
    projectAgentsMd: string | null;
  };
  parentReasoningLevel: "low" | "medium" | "high";
}): Promise<unknown> {
  const { name, input, toolCallId, toolCtx, turnOpts, promptLayers } = opts;

  if (isRunSubagentToolName(name)) {
    const { executeRunSubagent } = await import("./subagent/runSubagent");
    return executeRunSubagent({
      input,
      toolCtx,
      settings: turnOpts.settings,
      parentSelectedModelId: turnOpts.selectedModelId,
      parentReasoningLevel: opts.parentReasoningLevel,
      personaSnippet: promptLayers.personaSnippet,
      globalAgentsMd: promptLayers.globalAgentsMd,
      projectAgentsMd: promptLayers.projectAgentsMd,
      agentsMd: turnOpts.agentsMd,
      toolCallId,
      onProgress: (subRun) => {
        emitSafe(turnOpts.onEvent, {
          type: "tool-progress",
          id: toolCallId,
          name: RUN_SUBAGENT_TOOL_NAME,
          subRun,
        });
      },
    });
  }

  return registryExecuteTool(name, input, toolCtx);
}

/**
 * 手动执行单个工具（非 openai function calling 路径的宿主入口）。
 * 薄封装 registry；未知工具返回结构化错误，不 throw。
 */
export async function executeTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  return registryExecuteTool(name, asRecord(input), {
    ...ctx,
    loadedSkills: ctx.loadedSkills ?? normalizeLoadedSkills(),
  });
}

/**
 * 解析本轮 skill catalog。
 * readLocalSkills 开启时合并全局+项目；否则仅内置。
 * 优先级：内置 > 项目 > 全局（见 mergeSkillCatalog）。
 */
export function resolveTurnSkillCatalog(
  readLocalSkills: boolean,
  workspaceRoot: string | null,
): Record<string, SkillEntry> {
  if (!readLocalSkills) {
    return getBuiltinSkillCatalog();
  }
  return mergeSkillCatalog(
    listGlobalDiscoveredSkills(),
    listProjectDiscoveredSkills(workspaceRoot),
  );
}

/** 解析 persona / 全局 / 项目 AGENTS 层（opts 显式值优先于读盘）。 */
export function resolveTurnPromptLayers(opts: RunAgentTurnOptions): {
  personaSnippet: string | null;
  globalAgentsMd: string | null;
  projectAgentsMd: string | null;
} {
  const readGlobal = opts.settings.readGlobalPrompt !== false;

  const personaSnippet =
    opts.personaSnippet !== undefined
      ? opts.personaSnippet?.trim() || null
      : DEFAULT_PERSONA.systemSnippet;

  let globalAgentsMd: string | null = null;
  if (opts.globalAgentsMd !== undefined) {
    globalAgentsMd = opts.globalAgentsMd?.trim() || null;
  } else if (readGlobal) {
    globalAgentsMd = readGlobalAgentsPrompt();
  }

  let projectAgentsMd: string | null = null;
  if (opts.projectAgentsMd !== undefined) {
    projectAgentsMd = opts.projectAgentsMd?.trim() || null;
  } else if (opts.workspaceRoot?.trim()) {
    projectAgentsMd = readProjectAgentsPrompt(opts.workspaceRoot);
  }

  return { personaSnippet, globalAgentsMd, projectAgentsMd };
}

function toOpenAIToolsPayload(tools: AgentToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? {
        type: "object",
        properties: {},
      },
    },
  }));
}

/**
 * OpenAI Responses API tools：扁平 { type, name, description, parameters }，
 * 与 Chat Completions 的 function 嵌套不同。strict 默认 false，避免 schema 不兼容。
 */
function toResponsesToolsPayload(tools: AgentToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? {
      type: "object",
      properties: {},
    },
    strict: false as const,
  }));
}

type OpenAICompletionResult = {
  content: string;
  toolCalls: OpenAIToolCall[];
  finishReason: string | null;
  /** 本步 provider usage 解析结果（无则 null） */
  usage: Partial<AgentTokenUsage> | null;
};

/** Responses 侧 function_call 项（stream 累加后的完整形态）。 */
type ResponsesFunctionCall = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

/** Responses input 可追加的任意 output 项（含 reasoning / message / function_call 等）。 */
type ResponsesInputItem = Record<string, unknown>;

type ResponsesStreamResult = {
  content: string;
  /** 本轮完整 output（按 output_index 排序），下一轮 input 需原样回传。 */
  outputItems: ResponsesInputItem[];
  functionCalls: ResponsesFunctionCall[];
  /** 本步 provider usage 解析结果（无则 null） */
  usage: Partial<AgentTokenUsage> | null;
};

/**
 * OpenAI 兼容 Chat Completions 单次请求（stream），累加 content 与 tool_calls。
 */
async function streamOpenAIChatCompletion(opts: {
  settings: AISettingsLike;
  messages: OpenAILoopMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
  selectedModelId?: string | null;
  onTextDelta: (delta: string) => void;
}): Promise<OpenAICompletionResult> {
  const protocol = "openai" as const;
  const requestOverrides = opts.selectedModelId
    ? { selectedModelId: opts.selectedModelId }
    : undefined;
  const token = getRequestCredential(opts.settings, protocol)?.token ?? "";
  const baseURL = getCustomAIBaseURL(opts.settings, protocol).replace(
    /\/+$/,
    "",
  );
  const modelId = getCustomSelectedModelId(opts.settings, requestOverrides);
  const providerOptions = getCustomProviderOptions(
    opts.settings,
    requestOverrides,
  );

  const body: Record<string, unknown> = {
    model: modelId,
    messages: opts.messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (opts.tools.length > 0) {
    body.tools = toOpenAIToolsPayload(opts.tools);
    body.tool_choice = "auto";
  }

  if (providerOptions?.openaiCompatible) {
    const openaiOpts = providerOptions.openaiCompatible as Record<
      string,
      unknown
    >;
    if (openaiOpts.reasoningEffort) {
      body.reasoning_effort = openaiOpts.reasoningEffort;
    }
  }

  const requestUrl = `${baseURL}/chat/completions`;
  await resolveGrokCliClientVersion();
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: withCliProxyHeaders(requestUrl, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errMs = await readErrorMessage(response);
    const mapped = mapFetchErrorIfGrokCliVersion(response.status, errMs);
    throw new Error(mapped || errMs || "请求 OpenAI 兼容模型失败");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("无法读取底层数据流");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let usagePartial: Partial<AgentTokenUsage> | null = null;
  const toolCallMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  const processDataLine = (line: string) => {
    if (line === "data: [DONE]") return;
    if (!line.startsWith("data: ")) return;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === "[DONE]") return;

    let json: {
      usage?: unknown;
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };
    try {
      json = JSON.parse(dataStr) as typeof json;
    } catch {
      return;
    }

    // OpenAI 常在末包给 usage，且 choices 可能为空 —— 先解析 usage
    const parsedUsage = parseOpenAIChatUsage(json);
    if (parsedUsage) usagePartial = parsedUsage;

    const choice = json.choices?.[0];
    if (!choice) return;

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }

    const delta = choice.delta;
    if (!delta) return;

    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      opts.onTextDelta(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc.index === "number" ? tc.index : 0;
        const prev = toolCallMap.get(index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (tc.id) prev.id = tc.id;
        if (tc.function?.name) prev.name += tc.function.name;
        if (tc.function?.arguments) prev.arguments += tc.function.arguments;
        toolCallMap.set(index, prev);
      }
    }
  };

  try {
    while (!opts.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let eolIndex: number;
      while ((eolIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, eolIndex).trim();
        buffer = buffer.slice(eolIndex + 1);
        if (line) processDataLine(line);
      }
    }
    if (buffer.trim()) processDataLine(buffer.trim());
  } finally {
    reader.releaseLock();
  }

  if (opts.signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  const toolCalls: OpenAIToolCall[] = [...toolCallMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v], i) => ({
      id: v.id || `call_${i}`,
      type: "function" as const,
      function: {
        name: v.name,
        arguments: v.arguments || "{}",
      },
    }))
    .filter((tc) => tc.function.name);

  return { content, toolCalls, finishReason, usage: usagePartial };
}

async function runChatStreamOnly(
  opts: RunAgentTurnOptions,
  systemPrompt: string,
  usageCtx: {
    systemPromptTokens: number;
    turnStartedAt: number;
  },
): Promise<void> {
  const messages = toAIMessages(
    prependSystemPrompt(opts.messages, systemPrompt),
  );

  let prevText = "";
  const streamResult = await runAITextStream(opts.settings, messages, {
    abortSignal: opts.signal,
    requestOverrides: opts.selectedModelId
      ? { selectedModelId: opts.selectedModelId }
      : undefined,
    onUpdate: (update) => {
      const next = update.text ?? "";
      if (next.length > prevText.length) {
        const delta = next.slice(prevText.length);
        prevText = next;
        if (delta) {
          emitSafe(opts.onEvent, { type: "text-delta", text: delta });
        }
      } else if (next !== prevText && next) {
        prevText = next;
        emitSafe(opts.onEvent, { type: "text-delta", text: next });
      }
    },
  });

  const completionText =
    typeof streamResult === "string"
      ? streamResult
      : (streamResult?.text ?? prevText);
  const rawUsage =
    typeof streamResult === "object" && streamResult
      ? streamResult.usage
      : undefined;

  // 按协议解析 raw usage（openai / responses / claude）
  const protocol = resolveActiveProtocol(
    opts.settings,
    opts.selectedModelId
      ? { selectedModelId: opts.selectedModelId }
      : undefined,
  );
  let parsed: Partial<AgentTokenUsage> | null = null;
  if (rawUsage != null) {
    if (protocol === "claude") {
      parsed = parseClaudeUsage({ usage: rawUsage });
    } else if (protocol === "openai-responses") {
      parsed = parseOpenAIResponsesUsage({ usage: rawUsage });
    } else {
      parsed = parseOpenAIChatUsage({ usage: rawUsage });
    }
  }

  emitTurnUsage(opts.onEvent, {
    merged: parsed ? mergeUsage(null, parsed) : null,
    hasProvider: Boolean(parsed),
    systemPrompt,
    systemPromptTokens: usageCtx.systemPromptTokens,
    messages: opts.messages,
    completionText,
    turnStartedAt: usageCtx.turnStartedAt,
  });
}

async function runOpenAIToolLoop(
  opts: RunAgentTurnOptions,
  systemPrompt: string,
  toolCtx: AgentToolContext,
  usageCtx: {
    systemPromptTokens: number;
    turnStartedAt: number;
  },
  loopMeta: {
    promptLayers: {
      personaSnippet: string | null;
      globalAgentsMd: string | null;
      projectAgentsMd: string | null;
    };
    parentReasoningLevel: "low" | "medium" | "high";
  },
): Promise<void> {
  let loopMessages: OpenAILoopMessage[] = toOpenAILoopMessages(
    prependSystemPrompt(opts.messages, systemPrompt),
  );

  let mergedUsage: AgentTokenUsage | null = null;
  let hasProvider = false;
  let completionText = "";

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    if (opts.signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    // 每步按最新 loadedSkills 刷新工具面（loadSkill 后解锁）
    const tools = loadAgentTools(toolCtx);

    const completion = await streamOpenAIChatCompletion({
      settings: opts.settings,
      messages: loopMessages,
      tools,
      signal: opts.signal,
      selectedModelId: opts.selectedModelId,
      onTextDelta: (delta) => {
        emitSafe(opts.onEvent, { type: "text-delta", text: delta });
      },
    });

    if (completion.usage) {
      hasProvider = true;
      mergedUsage = mergeUsage(mergedUsage, completion.usage);
    }
    if (completion.content) {
      completionText += completion.content;
    }

    if (completion.toolCalls.length === 0) {
      emitTurnUsage(opts.onEvent, {
        merged: mergedUsage,
        hasProvider,
        systemPrompt,
        systemPromptTokens: usageCtx.systemPromptTokens,
        messages: opts.messages,
        completionText,
        turnStartedAt: usageCtx.turnStartedAt,
      });
      return;
    }

    loopMessages = [
      ...loopMessages,
      {
        role: "assistant",
        content: completion.content || null,
        tool_calls: completion.toolCalls,
      },
    ];

    for (const tc of completion.toolCalls) {
      if (opts.signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }

      const name = tc.function.name;
      const input = parseToolArguments(tc.function.arguments);
      emitSafe(opts.onEvent, {
        type: "tool-start",
        id: tc.id,
        name,
        input,
      });

      let result: unknown;
      try {
        result = await executeTurnToolCall({
          name,
          input: asRecord(input),
          toolCallId: tc.id,
          toolCtx,
          turnOpts: opts,
          promptLayers: loopMeta.promptLayers,
          parentReasoningLevel: loopMeta.parentReasoningLevel,
        });
      } catch (err) {
        result = {
          ok: false,
          error: errorMessage(err, `工具 ${name} 执行失败`),
        };
      }

      emitSafe(opts.onEvent, {
        type: "tool-end",
        id: tc.id,
        name,
        result,
      });

      loopMessages = [...loopMessages, buildToolResultMessage(tc.id, result)];
    }
  }

  // 步数用尽：再要一轮不带 tools 的收尾文本
  if (!opts.signal.aborted) {
    const final = await streamOpenAIChatCompletion({
      settings: opts.settings,
      messages: loopMessages,
      tools: [],
      signal: opts.signal,
      selectedModelId: opts.selectedModelId,
      onTextDelta: (delta) => {
        emitSafe(opts.onEvent, { type: "text-delta", text: delta });
      },
    });
    if (final.usage) {
      hasProvider = true;
      mergedUsage = mergeUsage(mergedUsage, final.usage);
    }
    if (final.content) completionText += final.content;
  }

  emitTurnUsage(opts.onEvent, {
    merged: mergedUsage,
    hasProvider,
    systemPrompt,
    systemPromptTokens: usageCtx.systemPromptTokens,
    messages: opts.messages,
    completionText,
    turnStartedAt: usageCtx.turnStartedAt,
  });
}

/**
 * 从 Agent 消息列表拆出 Responses 的 instructions + 初始 input。
 * system → instructions；user/assistant → input 角色消息（含 image parts）。
 */
function toResponsesInitialInput(messages: AgentChatMessage[]): {
  instructions: string;
  input: ResponsesInputItem[];
} {
  const systemParts: string[] = [];
  const input: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = contentToPlainText(
        m.content as string | AIContentPart[],
      ).trim();
      if (text) systemParts.push(text);
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      if (!messageHasContent(m.content)) continue;
      input.push({
        role: m.role,
        content: toResponsesInputContent(
          m.content as string | AIContentPart[],
        ),
      });
    }
  }
  return {
    instructions: systemParts.join("\n\n"),
    input,
  };
}

function asResponsesFunctionCall(
  item: ResponsesInputItem,
  fallbackIndex: number,
): ResponsesFunctionCall | null {
  if (item.type !== "function_call") return null;
  const name = typeof item.name === "string" ? item.name : "";
  if (!name) return null;
  const callId =
    (typeof item.call_id === "string" && item.call_id) ||
    (typeof item.id === "string" && item.id) ||
    `call_${fallbackIndex}`;
  const args =
    typeof item.arguments === "string" && item.arguments
      ? item.arguments
      : "{}";
  return {
    type: "function_call",
    id: typeof item.id === "string" ? item.id : undefined,
    call_id: callId,
    name,
    arguments: args,
  };
}

/**
 * OpenAI Responses 单次请求（stream），累加 output_text 与 function_call。
 * 不改动 handleOpenAIResponsesStream 纯文本路径；工具环在 runTurn 内联 fetch。
 */
async function streamOpenAIResponses(opts: {
  settings: AISettingsLike;
  instructions: string;
  input: ResponsesInputItem[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
  selectedModelId?: string | null;
  onTextDelta: (delta: string) => void;
}): Promise<ResponsesStreamResult> {
  const protocol = "openai-responses" as const;
  const requestOverrides = opts.selectedModelId
    ? { selectedModelId: opts.selectedModelId }
    : undefined;
  const token = getRequestCredential(opts.settings, protocol)?.token ?? "";
  const baseURL = getCustomAIBaseURL(opts.settings, protocol).replace(
    /\/+$/,
    "",
  );
  const modelId = getCustomSelectedModelId(opts.settings, requestOverrides);
  const reasoningLevel = getRequestReasoningLevel(
    opts.settings,
    requestOverrides,
  );

  const body: Record<string, unknown> = {
    model: modelId,
    input: opts.input,
    stream: true,
    store: false,
  };

  if (opts.instructions) {
    body.instructions = opts.instructions;
  }

  if (opts.tools.length > 0) {
    body.tools = toResponsesToolsPayload(opts.tools);
    body.tool_choice = "auto";
  }

  if (reasoningLevel) {
    body.reasoning = {
      effort: reasoningLevel,
      summary: "auto",
    };
  }

  const requestUrl = `${baseURL}/responses`;
  await resolveGrokCliClientVersion();
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: withCliProxyHeaders(requestUrl, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!response.ok) {
    const errMs = await readErrorMessage(response);
    const mapped = mapFetchErrorIfGrokCliVersion(response.status, errMs);
    throw new Error(mapped || errMs || "请求 OpenAI Responses 模型失败");
  }

  let content = "";
  let streamError: string | null = null;
  let usagePartial: Partial<AgentTokenUsage> | null = null;
  /** output_index → 累加中的 item（优先 output_item.done 覆盖） */
  const itemMap = new Map<number, ResponsesInputItem>();

  for await (const line of readSSELines(response, opts.signal)) {
    if (!line.startsWith("data: ")) continue;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === "[DONE]") continue;

    let event: {
      type?: string;
      delta?: string;
      output_index?: number;
      item?: ResponsesInputItem;
      item_id?: string;
      arguments?: string;
      message?: string;
      error?: { message?: string };
      response?: {
        error?: { message?: string };
        output?: ResponsesInputItem[];
        usage?: unknown;
      };
    };
    try {
      event = JSON.parse(dataStr) as typeof event;
    } catch {
      continue;
    }

    const type = event.type ?? "";

    if (type === "response.completed" && event.response?.usage != null) {
      const parsed = parseOpenAIResponsesUsage({
        usage: event.response.usage,
      });
      if (parsed) usagePartial = parsed;
    }

    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      if (event.delta) {
        content += event.delta;
        opts.onTextDelta(event.delta);
      }
      continue;
    }

    if (type === "response.output_item.added" && event.item) {
      const index =
        typeof event.output_index === "number" ? event.output_index : itemMap.size;
      const prev = itemMap.get(index) ?? {};
      itemMap.set(index, { ...prev, ...event.item });
      continue;
    }

    if (
      type === "response.function_call_arguments.delta" &&
      typeof event.delta === "string"
    ) {
      const index =
        typeof event.output_index === "number" ? event.output_index : 0;
      const prev = itemMap.get(index) ?? {
        type: "function_call",
        arguments: "",
      };
      const prevArgs =
        typeof prev.arguments === "string" ? prev.arguments : "";
      itemMap.set(index, {
        ...prev,
        type: prev.type ?? "function_call",
        arguments: prevArgs + event.delta,
      });
      continue;
    }

    if (
      type === "response.function_call_arguments.done" &&
      typeof event.arguments === "string"
    ) {
      const index =
        typeof event.output_index === "number" ? event.output_index : 0;
      const prev = itemMap.get(index) ?? { type: "function_call" };
      itemMap.set(index, {
        ...prev,
        type: prev.type ?? "function_call",
        arguments: event.arguments,
      });
      continue;
    }

    if (type === "response.output_item.done" && event.item) {
      const index =
        typeof event.output_index === "number" ? event.output_index : itemMap.size;
      // done 为权威完整项（含 name / call_id / arguments / reasoning 等）
      itemMap.set(index, event.item);
      continue;
    }

    if (type === "error") {
      streamError =
        event.message || event.error?.message || "OpenAI Responses 流式请求失败";
      continue;
    }

    if (type === "response.failed") {
      streamError =
        event.response?.error?.message || "OpenAI Responses 流式请求失败";
      continue;
    }

    // 部分代理仅在 completed 里给完整 output
    if (
      type === "response.completed" &&
      Array.isArray(event.response?.output) &&
      event.response.output.length > 0 &&
      itemMap.size === 0
    ) {
      event.response.output.forEach((item, i) => {
        itemMap.set(i, item);
      });
    }
  }

  if (opts.signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }

  if (streamError) {
    throw new Error(streamError);
  }

  const outputItems = [...itemMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, item]) => item);

  const functionCalls: ResponsesFunctionCall[] = [];
  for (let i = 0; i < outputItems.length; i++) {
    const fc = asResponsesFunctionCall(outputItems[i]!, i);
    if (fc) functionCalls.push(fc);
  }

  return { content, outputItems, functionCalls, usage: usagePartial };
}

/**
 * OpenAI Responses 原生 function calling 循环。
 * 下一轮 input：原样追加本轮 output 项 + 各 call 的 function_call_output。
 * （含 reasoning 项回传，满足 reasoning 模型要求。）
 */
async function runResponsesToolLoop(
  opts: RunAgentTurnOptions,
  systemPrompt: string,
  toolCtx: AgentToolContext,
  usageCtx: {
    systemPromptTokens: number;
    turnStartedAt: number;
  },
  loopMeta: {
    promptLayers: {
      personaSnippet: string | null;
      globalAgentsMd: string | null;
      projectAgentsMd: string | null;
    };
    parentReasoningLevel: "low" | "medium" | "high";
  },
): Promise<void> {
  const withSystem = prependSystemPrompt(opts.messages, systemPrompt);
  const { instructions, input: initialInput } =
    toResponsesInitialInput(withSystem);
  let input: ResponsesInputItem[] = initialInput;

  let mergedUsage: AgentTokenUsage | null = null;
  let hasProvider = false;
  let completionText = "";

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    if (opts.signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }

    const tools = loadAgentTools(toolCtx);

    const completion = await streamOpenAIResponses({
      settings: opts.settings,
      instructions,
      input,
      tools,
      signal: opts.signal,
      selectedModelId: opts.selectedModelId,
      onTextDelta: (delta) => {
        emitSafe(opts.onEvent, { type: "text-delta", text: delta });
      },
    });

    if (completion.usage) {
      hasProvider = true;
      mergedUsage = mergeUsage(mergedUsage, completion.usage);
    }
    if (completion.content) {
      completionText += completion.content;
    }

    if (completion.functionCalls.length === 0) {
      emitTurnUsage(opts.onEvent, {
        merged: mergedUsage,
        hasProvider,
        systemPrompt,
        systemPromptTokens: usageCtx.systemPromptTokens,
        messages: opts.messages,
        completionText,
        turnStartedAt: usageCtx.turnStartedAt,
      });
      return;
    }

    // 官方约定：把整轮 output（含 function_call / reasoning / message）推回 input
    input = [...input, ...completion.outputItems];

    for (const fc of completion.functionCalls) {
      if (opts.signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }

      const name = fc.name;
      const parsed = parseToolArguments(fc.arguments);
      emitSafe(opts.onEvent, {
        type: "tool-start",
        id: fc.call_id,
        name,
        input: parsed,
      });

      let result: unknown;
      try {
        result = await executeTurnToolCall({
          name,
          input: asRecord(parsed),
          toolCallId: fc.call_id,
          toolCtx,
          turnOpts: opts,
          promptLayers: loopMeta.promptLayers,
          parentReasoningLevel: loopMeta.parentReasoningLevel,
        });
      } catch (err) {
        result = {
          ok: false,
          error: errorMessage(err, `工具 ${name} 执行失败`),
        };
      }

      emitSafe(opts.onEvent, {
        type: "tool-end",
        id: fc.call_id,
        name,
        result,
      });

      input = [
        ...input,
        {
          type: "function_call_output",
          call_id: fc.call_id,
          output: formatToolResultForModel(result),
        },
      ];
    }
  }

  // 步数用尽：再要一轮不带 tools 的收尾文本
  if (!opts.signal.aborted) {
    const final = await streamOpenAIResponses({
      settings: opts.settings,
      instructions,
      input,
      tools: [],
      signal: opts.signal,
      selectedModelId: opts.selectedModelId,
      onTextDelta: (delta) => {
        emitSafe(opts.onEvent, { type: "text-delta", text: delta });
      },
    });
    if (final.usage) {
      hasProvider = true;
      mergedUsage = mergeUsage(mergedUsage, final.usage);
    }
    if (final.content) completionText += final.content;
  }

  emitTurnUsage(opts.onEvent, {
    merged: mergedUsage,
    hasProvider,
    systemPrompt,
    systemPromptTokens: usageCtx.systemPromptTokens,
    messages: opts.messages,
    completionText,
    turnStartedAt: usageCtx.turnStartedAt,
  });
}

/**
 * 运行 Agent 一轮（内部可多步 tool call）。
 * 始终以 `done` 收尾（含 error / abort），方便 UI 清理状态。
 */
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<void> {
  const { onEvent, signal } = opts;
  const finish = () => emitSafe(onEvent, { type: "done" });

  try {
    if (signal.aborted) {
      finish();
      return;
    }

    const availability = getAIAvailability(
      opts.settings,
      opts.selectedModelId
        ? { selectedModelId: opts.selectedModelId }
        : undefined,
    );
    if (!availability.ok) {
      emitSafe(onEvent, {
        type: "error",
        message: availability.reason,
      });
      finish();
      return;
    }

    const turnStartedAt = Date.now();

    const loadedSkills = normalizeLoadedSkills(opts.loadedSkills);
    const readLocalSkills = opts.settings.readLocalSkills !== false;
    const skillCatalog = resolveTurnSkillCatalog(
      readLocalSkills,
      opts.workspaceRoot,
    );
    const promptLayers = resolveTurnPromptLayers(opts);

    const subagentDepth =
      typeof opts.subagentDepth === "number" ? opts.subagentDepth : 0;

    const toolCtx: AgentToolContext = {
      permissionMode: opts.permissionMode,
      workspaceRoot: opts.workspaceRoot,
      loadedSkills,
      skillCatalog,
      signal,
      conversationId: opts.conversationId,
      subagentDepth,
      // 生图等需凭证的工具
      aiSettings: opts.settings,
    };

    const protocol = resolveActiveProtocol(
      opts.settings,
      opts.selectedModelId
        ? { selectedModelId: opts.selectedModelId }
        : undefined,
    );
    // openai Chat Completions + openai-responses 原生 FC；claude 仍走 prompt-only
    // runSubagent 仅在 native FC 协议注册；claude 不暴露
    const tools = loadAgentTools(toolCtx).filter((t) => {
      if (!isRunSubagentToolName(t.name)) return true;
      return protocol === "openai" || protocol === "openai-responses";
    });

    const canNativeTools =
      (protocol === "openai" || protocol === "openai-responses") &&
      tools.length > 0;

    const systemPrompt = buildAgentSystemPrompt({
      permissionMode: opts.permissionMode,
      workspaceRoot: opts.workspaceRoot,
      personaSnippet: promptLayers.personaSnippet,
      globalAgentsMd: promptLayers.globalAgentsMd,
      projectAgentsMd: promptLayers.projectAgentsMd,
      agentsMd: opts.agentsMd,
      toolNames: tools.map((t) => t.name),
      toolsViaPromptOnly: tools.length > 0 && !canNativeTools,
    });
    const systemPromptTokens = estimateTokensFromText(systemPrompt);
    const usageCtx = { systemPromptTokens, turnStartedAt };

    const parentReasoningLevel =
      getRequestReasoningLevel(
        opts.settings,
        opts.selectedModelId
          ? { selectedModelId: opts.selectedModelId }
          : undefined,
      ) ?? "medium";
    const loopMeta = {
      promptLayers,
      parentReasoningLevel: parentReasoningLevel as "low" | "medium" | "high",
    };

    if (canNativeTools && protocol === "openai") {
      await runOpenAIToolLoop(
        opts,
        systemPrompt,
        toolCtx,
        usageCtx,
        loopMeta,
      );
    } else if (canNativeTools && protocol === "openai-responses") {
      await runResponsesToolLoop(
        opts,
        systemPrompt,
        toolCtx,
        usageCtx,
        loopMeta,
      );
    } else {
      // 无原生 FC（含 claude）：纯文本流。工具名若存在会写进 system（toolsViaPromptOnly）。
      await runChatStreamOnly(opts, systemPrompt, usageCtx);
    }

    finish();
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      finish();
      return;
    }
    emitSafe(onEvent, {
      type: "error",
      message: errorMessage(err),
    });
    finish();
  }
}
