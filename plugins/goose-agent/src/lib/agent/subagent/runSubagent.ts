/**
 * runSubagent 执行体：独立子 turn，父仅收 summary。
 * 由 runTurn 工具环调用（动态 import，避免循环依赖）。
 */

import {
  getCustomSelectedModelId,
  getRequestReasoningLevel,
} from "@/lib/ai-provider/modelCatalog";
import type { AgentToolContext, AgentTurnEvent, AgentTurnSettings } from "../types";
import type { AgentTokenUsage } from "../usage";
import { mergeUsage } from "../usage";
import {
  MAX_SUBAGENT_DEPTH,
  normalizeReasoningLevel,
  parseRunSubagentInput,
  type RunSubagentResult,
  type SubAgentRunSnapshot,
  type SubAgentToolStep,
} from "./types";
import {
  registerSubagentRun,
  unregisterSubagentRun,
  waitForSubagentSlot,
} from "./concurrency";

function createRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `sub-${globalThis.crypto.randomUUID()}`;
  }
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function linkAbort(
  parent: AbortSignal,
  child: AbortController,
): () => void {
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => {
    if (!child.signal.aborted) child.abort();
  };
  parent.addEventListener("abort", onAbort);
  return () => parent.removeEventListener("abort", onAbort);
}

function summarizeText(text: string, max = 4000): string {
  const t = text.trim();
  if (!t) return "（子代理未返回文本摘要）";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export type ExecuteRunSubagentOptions = {
  input: Record<string, unknown>;
  toolCtx: AgentToolContext;
  settings: AgentTurnSettings;
  /** 父 turn 模型快照 */
  parentSelectedModelId?: string | null;
  /** 父 turn 思考长度快照 */
  parentReasoningLevel: "low" | "medium" | "high";
  personaSnippet?: string | null;
  globalAgentsMd?: string | null;
  projectAgentsMd?: string | null;
  agentsMd?: string;
  toolCallId: string;
  onProgress: (subRun: SubAgentRunSnapshot) => void;
};

/**
 * 是否应向模型暴露 runSubagent：
 * - 仅 openai / openai-responses（由调用方协议门控后再调）
 * - 当前 depth < MAX_SUBAGENT_DEPTH（根 depth=0 可派发 depth1；depth1 可派发 depth2；depth2 禁）
 */
export function shouldExposeRunSubagent(
  subagentDepth: number | undefined,
): boolean {
  const depth = typeof subagentDepth === "number" ? subagentDepth : 0;
  return depth < MAX_SUBAGENT_DEPTH;
}

export async function executeRunSubagent(
  opts: ExecuteRunSubagentOptions,
): Promise<RunSubagentResult> {
  const parsed = parseRunSubagentInput(opts.input);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const { task, name: nameOpt, modelId: modelOverride, reasoningLevel: levelOverride } =
    parsed.value;

  const parentDepth =
    typeof opts.toolCtx.subagentDepth === "number"
      ? opts.toolCtx.subagentDepth
      : 0;
  if (parentDepth >= MAX_SUBAGENT_DEPTH) {
    return {
      ok: false,
      error: `子代理嵌套已达上限（${MAX_SUBAGENT_DEPTH} 层），无法再派发`,
    };
  }

  const childDepth = parentDepth + 1;
  const runId = createRunId();
  const displayName = nameOpt || "子代理";

  const modelId =
    modelOverride ||
    opts.parentSelectedModelId ||
    getCustomSelectedModelId(opts.settings) ||
    opts.settings.selectedModelId ||
    "unknown";

  const reasoningLevel = normalizeReasoningLevel(
    levelOverride ?? opts.parentReasoningLevel,
    opts.parentReasoningLevel,
  );

  const startedAt = Date.now();
  let snapshot: SubAgentRunSnapshot = {
    runId,
    name: displayName,
    task,
    modelId,
    reasoningLevel,
    status: "queued",
    depth: childDepth,
    startedAt,
    currentTool: null,
    steps: [],
  };

  const emit = (patch: Partial<SubAgentRunSnapshot>) => {
    snapshot = {
      ...snapshot,
      ...patch,
      steps: patch.steps ?? snapshot.steps,
    };
    try {
      opts.onProgress(snapshot);
    } catch {
      // UI 回调异常不打断
    }
  };

  emit({ status: "queued" });

  try {
    await waitForSubagentSlot(opts.toolCtx.signal);
  } catch {
    emit({
      status: "cancelled",
      endedAt: Date.now(),
      errorText: "已取消",
    });
    return {
      ok: false,
      name: displayName,
      runId,
      status: "cancelled",
      error: "已取消",
    };
  }

  if (opts.toolCtx.signal.aborted) {
    emit({
      status: "cancelled",
      endedAt: Date.now(),
      errorText: "已取消",
    });
    return {
      ok: false,
      name: displayName,
      runId,
      status: "cancelled",
      error: "已取消",
    };
  }

  const childController = new AbortController();
  const unlink = linkAbort(opts.toolCtx.signal, childController);

  const registered = registerSubagentRun({
    runId,
    parentConversationId: opts.toolCtx.conversationId,
    controller: childController,
    startedAt,
  });
  if (!registered) {
    // 竞态：再等一次
    try {
      await waitForSubagentSlot(opts.toolCtx.signal);
    } catch {
      unlink();
      emit({
        status: "cancelled",
        endedAt: Date.now(),
        errorText: "已取消",
      });
      return {
        ok: false,
        name: displayName,
        runId,
        status: "cancelled",
        error: "已取消",
      };
    }
    registerSubagentRun({
      runId,
      parentConversationId: opts.toolCtx.conversationId,
      controller: childController,
      startedAt,
    });
  }

  emit({ status: "running" });

  // 子 settings：冻结思考长度
  const childSettings: AgentTurnSettings = {
    ...opts.settings,
    workspaceReasoningLevel: reasoningLevel,
  };

  const steps: SubAgentToolStep[] = [];
  let completionText = "";
  let turnError: string | null = null;
  /** 子 turn usage 累加；仅挂 snapshot，不写父会话 */
  let capturedUsage: AgentTokenUsage | undefined;

  // 动态 import 避免与 runTurn 循环依赖
  const { runAgentTurn } = await import("../runTurn");

  try {
    await runAgentTurn({
      messages: [
        {
          role: "user",
          content: task,
        },
      ],
      settings: childSettings,
      permissionMode: opts.toolCtx.permissionMode,
      workspaceRoot: opts.toolCtx.workspaceRoot,
      signal: childController.signal,
      selectedModelId: modelOverride || opts.parentSelectedModelId,
      personaSnippet: opts.personaSnippet,
      globalAgentsMd: opts.globalAgentsMd,
      projectAgentsMd: opts.projectAgentsMd,
      agentsMd: opts.agentsMd,
      conversationId: opts.toolCtx.conversationId,
      // 子代理独立 skill 上下文
      loadedSkills: [],
      subagentDepth: childDepth,
      onEvent: (event: AgentTurnEvent) => {
        if (event.type === "text-delta") {
          completionText += event.text;
          // liveText：末尾 ~4000 字，供详情流式展示
          const live =
            completionText.length <= 4000
              ? completionText
              : completionText.slice(-4000);
          emit({
            status: "running",
            liveText: live,
          });
          return;
        }
        if (event.type === "usage") {
          capturedUsage = capturedUsage
            ? mergeUsage(capturedUsage, event.usage)
            : event.usage;
          emit({
            status: "running",
            usage: capturedUsage,
          });
          return;
        }
        if (event.type === "tool-start") {
          const step: SubAgentToolStep = {
            id: event.id,
            name: event.name,
            state: "call",
            input: event.input,
          };
          const idx = steps.findIndex((s) => s.id === event.id);
          if (idx >= 0) steps[idx] = { ...steps[idx]!, ...step };
          else steps.push(step);
          emit({
            status: "running",
            currentTool: event.name,
            steps: steps.map((s) => ({ ...s })),
          });
          return;
        }
        if (event.type === "tool-end") {
          const result = event.result;
          const isErr =
            result &&
            typeof result === "object" &&
            (result as { ok?: boolean }).ok === false;
          const errorText =
            isErr &&
            typeof (result as { error?: unknown }).error === "string"
              ? (result as { error: string }).error
              : undefined;
          const idx = steps.findIndex((s) => s.id === event.id);
          const patch: SubAgentToolStep = {
            id: event.id,
            name: event.name,
            state: errorText ? "output-error" : "output-available",
            output: result,
            errorText,
          };
          if (idx >= 0) {
            steps[idx] = {
              ...steps[idx]!,
              ...patch,
              input: steps[idx]!.input,
            };
          } else {
            steps.push(patch);
          }
          emit({
            status: "running",
            currentTool: null,
            steps: steps.map((s) => ({ ...s })),
          });
          return;
        }
        if (event.type === "tool-progress" && event.subRun) {
          // 嵌套子代理：把嵌套快照压成一步摘要（可选展示）
          const nested = event.subRun;
          const nestedId = `nested-${nested.runId}`;
          const idx = steps.findIndex((s) => s.id === nestedId);
          const nestedStep: SubAgentToolStep = {
            id: nestedId,
            name: "runSubagent",
            state:
              nested.status === "done"
                ? "output-available"
                : nested.status === "error" || nested.status === "cancelled"
                  ? "output-error"
                  : "call",
            input: {
              name: nested.name,
              task: nested.task,
              modelId: nested.modelId,
              reasoningLevel: nested.reasoningLevel,
            },
            output:
              nested.status === "done"
                ? { ok: true, summary: nested.summary }
                : nested.errorText
                  ? { ok: false, error: nested.errorText }
                  : undefined,
            errorText: nested.errorText,
          };
          if (idx >= 0) steps[idx] = nestedStep;
          else steps.push(nestedStep);
          emit({
            status: "running",
            currentTool:
              nested.status === "running" || nested.status === "queued"
                ? nested.currentTool || "runSubagent"
                : null,
            steps: steps.map((s) => ({ ...s })),
          });
          return;
        }
        if (event.type === "error") {
          turnError = event.message || "子代理运行失败";
        }
      },
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.message.trim()
        ? err.message.trim()
        : "子代理运行失败";
    turnError = msg;
  } finally {
    unlink();
    unregisterSubagentRun(runId);
  }

  const aborted =
    childController.signal.aborted || opts.toolCtx.signal.aborted;
  const summary = summarizeText(completionText);
  const endedAt = Date.now();
  const finalUsage = capturedUsage;

  if (aborted && !completionText.trim()) {
    emit({
      status: "cancelled",
      endedAt,
      currentTool: null,
      steps: steps.map((s) => ({ ...s })),
      errorText: "已取消",
      summary: undefined,
      usage: finalUsage,
      liveText: undefined,
    });
    return {
      ok: false,
      name: displayName,
      runId,
      status: "cancelled",
      error: "已取消",
    };
  }

  if (turnError && !completionText.trim()) {
    emit({
      status: "error",
      endedAt,
      currentTool: null,
      steps: steps.map((s) => ({ ...s })),
      errorText: turnError,
      summary: undefined,
      usage: finalUsage,
      liveText: undefined,
    });
    return {
      ok: false,
      name: displayName,
      runId,
      status: "error",
      error: turnError,
    };
  }

  emit({
    status: "done",
    endedAt,
    currentTool: null,
    steps: steps.map((s) => ({ ...s })),
    summary,
    errorText: turnError || undefined,
    usage: finalUsage,
    liveText: undefined,
  });

  return {
    ok: true,
    name: displayName,
    runId,
    status: "done",
    summary,
  };
}

/** 解析父 turn 思考长度快照（供 runTurn 调用） */
export function resolveParentReasoningLevel(
  settings: AgentTurnSettings,
  selectedModelId?: string | null,
): "low" | "medium" | "high" {
  const level = getRequestReasoningLevel(
    settings,
    selectedModelId ? { selectedModelId } : undefined,
  );
  return level ?? "medium";
}
