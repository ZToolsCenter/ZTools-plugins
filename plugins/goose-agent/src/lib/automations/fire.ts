import { toast } from "@/lib/toast";
import {
  getActiveCredentialMissingMessage,
  hasActiveCredential,
  resolveEffectiveModelId,
} from "@/lib/ai-provider";
import { resolvePersona } from "@/lib/agent/persona";
import { runAgentTurn } from "@/lib/agent/runTurn";
import type {
  AgentChatMessage,
  AgentTurnEvent,
} from "@/lib/agent/types";
import { useSettings } from "@/stores/settings";
import {
  createAgentMessageId,
  getMessageText,
  useAgentChats,
  type AgentMessage,
  type AgentMessagePart,
  type AgentToolPart,
} from "@/stores/useAgentChats";
import {
  createAutomationRunId,
  useAutomations,
} from "@/stores/useAutomations";
import { useSessionRuns } from "@/stores/useSessionRuns";
import { useWorkspaces } from "@/stores/useWorkspaces";
import {
  MAX_CONSECUTIVE_FAILURES,
  type AutomationFireReason,
  type AutomationRun,
} from "./types";

const UNATTENDED_PREAMBLE =
  "【系统】你是定时无人值守任务，直接交付结果，不要向用户提问澄清。";

/** 全局串行：同时只允许 1 个 automation fire（promise 链） */
let globalFireTail: Promise<unknown> = Promise.resolve();

export type FireAutomationOptions = {
  reason: AutomationFireReason;
};

export type FireAutomationResult = {
  ok: boolean;
  skipped?: boolean;
  runId?: string;
  conversationId?: string | null;
  error?: string;
};

function toChatMessages(messages: AgentMessage[]): AgentChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: getMessageText(m),
    }))
    .filter((m) => typeof m.content === "string" && m.content.trim() !== "");
}

function upsertToolPart(
  parts: AgentMessagePart[],
  toolCallId: string,
  patch: Partial<AgentToolPart> & { type: string },
): AgentMessagePart[] {
  const next = parts.slice();
  const idx = next.findIndex(
    (p) =>
      p.type !== "text" &&
      "toolCallId" in p &&
      (p as AgentToolPart).toolCallId === toolCallId,
  );
  if (idx >= 0) {
    const prev = next[idx] as AgentToolPart;
    next[idx] = {
      ...prev,
      ...patch,
      toolCallId,
      subRun: patch.subRun !== undefined ? patch.subRun : prev.subRun,
    };
    return next;
  }
  next.push({
    type: patch.type,
    toolCallId,
    state: patch.state,
    input: patch.input,
    output: patch.output,
    errorText: patch.errorText,
    subRun: patch.subRun,
  });
  return next;
}

function setTextPart(
  parts: AgentMessagePart[],
  text: string,
): AgentMessagePart[] {
  const tools = parts.filter((p) => p.type !== "text");
  return [...tools, { type: "text", text }];
}

function formatRunTitle(name: string, atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${name} · ${stamp}`;
}

function finishSkipped(
  automationId: string,
  reason: AutomationFireReason,
  error: string,
): FireAutomationResult {
  const runId = createAutomationRunId();
  const now = Date.now();
  const run: AutomationRun = {
    id: runId,
    automationId,
    conversationId: null,
    startedAt: now,
    finishedAt: now,
    status: "skipped",
    reason,
    error,
  };
  useAutomations.getState().recordRun(run);
  useAutomations.getState().applyRunOutcome(automationId, {
    status: "skipped",
    atMs: now,
  });
  return { ok: false, skipped: true, runId, error };
}

/**
 * 触发一次定时任务（全局串行）。
 * - schedule / catchup：仅 enabled 时执行
 * - manual：暂停也可「立即运行」
 */
export function fireAutomation(
  id: string,
  options: FireAutomationOptions,
): Promise<FireAutomationResult> {
  const run = globalFireTail.then(() => fireAutomationUnlocked(id, options));
  // 后续排队，不因本轮 reject 打断链
  globalFireTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fireAutomationUnlocked(
  id: string,
  options: FireAutomationOptions,
): Promise<FireAutomationResult> {
  const { reason } = options;
  const store = useAutomations.getState();
  const auto = store.getAutomation(id);

  if (!auto) {
    return { ok: false, error: "automation-missing" };
  }

  // schedule/catchup 仅在启用时跑；manual 允许暂停态
  if (!auto.enabled && reason !== "manual") {
    return { ok: false, skipped: true, error: "disabled" };
  }

  // 同任务仍在跑 → skip
  if (store.isInFlight(id)) {
    return finishSkipped(id, reason, "already-running");
  }

  // 工作区：可空（null = 不选择，按快速对话工具面跑）；有 id 则必须仍存在
  const workspaceId =
    typeof auto.workspaceId === "string" && auto.workspaceId.trim()
      ? auto.workspaceId.trim()
      : null;
  let workspaceRoot: string | null = null;
  if (workspaceId) {
    const ws = useWorkspaces
      .getState()
      .workspaces.find((w) => w.id === workspaceId);
    if (!ws?.path) {
      const runId = createAutomationRunId();
      const now = Date.now();
      const run: AutomationRun = {
        id: runId,
        automationId: id,
        conversationId: null,
        startedAt: now,
        finishedAt: now,
        status: "error",
        reason,
        error: "workspace-missing",
      };
      useAutomations.getState().recordRun(run);
      useAutomations.getState().applyRunOutcome(id, {
        status: "error",
        atMs: now,
      });
      maybeDisableOnFailures(id);
      toast.error(`定时任务「${auto.name}」失败`, {
        description: "工作区不存在或已移除",
      });
      return { ok: false, runId, error: "workspace-missing" };
    }
    workspaceRoot = ws.path;
  }

  const settingsState = useSettings.getState();
  const settings = settingsState.ai;
  if (!hasActiveCredential(settings)) {
    const runId = createAutomationRunId();
    const now = Date.now();
    const run: AutomationRun = {
      id: runId,
      automationId: id,
      conversationId: null,
      startedAt: now,
      finishedAt: now,
      status: "error",
      reason,
      error: "credential-missing",
    };
    useAutomations.getState().recordRun(run);
    useAutomations.getState().applyRunOutcome(id, {
      status: "error",
      atMs: now,
    });
    maybeDisableOnFailures(id);
    toast.error(`定时任务「${auto.name}」失败`, {
      description: getActiveCredentialMissingMessage(settings),
    });
    return { ok: false, runId, error: "credential-missing" };
  }

  const startedAt = Date.now();
  const title = formatRunTitle(auto.name, startedAt);
  const conversationId = useAgentChats.getState().createConversation({
    workspaceId,
    title,
    source: "automation",
    automationId: id,
    forceNew: true,
  });

  const userText = `${UNATTENDED_PREAMBLE}\n\n${auto.prompt}`.trim();
  const userMsg: AgentMessage = {
    id: createAgentMessageId("user"),
    role: "user",
    parts: [{ type: "text", text: userText }],
    createdAt: startedAt,
    metadata: { displayText: auto.prompt },
  };
  const assistantId = createAgentMessageId("assistant");
  const assistantMsg: AgentMessage = {
    id: assistantId,
    role: "assistant",
    parts: [{ type: "text", text: "" }],
    createdAt: startedAt,
  };

  // 全局会话 cap：若无法 beginRun 则记 skip（不占 inFlight）
  const controller = useSessionRuns
    .getState()
    .beginRun(conversationId, assistantId);
  if (!controller) {
    // 清理刚建的空会话可选：保留以便排查
    return finishSkipped(id, reason, "session-cap");
  }

  useAgentChats.getState().appendMessage(conversationId, userMsg);
  useAgentChats.getState().appendMessage(conversationId, assistantMsg);

  const runId = createAutomationRunId();
  const runningRecord: AutomationRun = {
    id: runId,
    automationId: id,
    conversationId,
    startedAt,
    finishedAt: null,
    status: "running",
    reason,
  };
  useAutomations.getState().recordRun(runningRecord);
  useAutomations.getState().setInFlight(id, conversationId);

  const persona = resolvePersona(
    settingsState.persona.selectedPersonaId,
    settingsState.persona.customPersonas,
  );
  const selectedModelId = resolveEffectiveModelId(settings);
  const history = toChatMessages(
    useAgentChats
      .getState()
      .getConversationMessages(conversationId)
      .filter((m) => m.id !== assistantId),
  );

  let textAcc = "";
  let turnError: string | undefined;
  let finished = false;

  const patchAssistant = (
    updater: (parts: AgentMessagePart[]) => AgentMessagePart[],
  ) => {
    useAgentChats.getState().updateMessage(conversationId, assistantId, (m) => ({
      ...m,
      parts: updater(m.parts),
    }));
  };

  const flushText = () => {
    const acc = textAcc;
    useAgentChats.getState().updateMessage(conversationId, assistantId, (m) => ({
      ...m,
      parts: setTextPart(m.parts, acc),
    }));
  };

  const complete = (status: "success" | "error", error?: string) => {
    if (finished) return;
    finished = true;
    flushText();
    useSessionRuns.getState().endRun(conversationId);
    useAutomations.getState().setInFlight(id, null);
    const finishedAt = Date.now();
    useAutomations.getState().patchRun(runId, {
      status,
      finishedAt,
      error,
    });
    useAutomations.getState().applyRunOutcome(id, {
      status,
      atMs: finishedAt,
    });

    if (status === "success") {
      toast.success(`定时任务「${auto.name}」已完成`);
    } else {
      toast.error(`定时任务「${auto.name}」失败`, {
        description: error || "运行出错",
      });
      maybeDisableOnFailures(id);
    }
  };

  const onEvent = (event: AgentTurnEvent) => {
    if (finished) return;

    if (event.type === "text-delta") {
      textAcc += event.text;
      flushText();
      return;
    }

    if (event.type === "tool-start") {
      flushText();
      const toolType = event.name.startsWith("tool-")
        ? event.name
        : `tool-${event.name}`;
      patchAssistant((parts) =>
        upsertToolPart(parts, event.id, {
          type: toolType,
          state: "call",
          input: event.input,
        }),
      );
      return;
    }

    if (event.type === "tool-progress") {
      flushText();
      const toolType = event.name.startsWith("tool-")
        ? event.name
        : `tool-${event.name}`;
      patchAssistant((parts) =>
        upsertToolPart(parts, event.id, {
          type: toolType,
          state: "call",
          subRun: event.subRun as AgentToolPart["subRun"],
        }),
      );
      return;
    }

    if (event.type === "tool-end") {
      flushText();
      const toolType = event.name.startsWith("tool-")
        ? event.name
        : `tool-${event.name}`;
      const result = event.result;
      const isErr =
        result &&
        typeof result === "object" &&
        (result as { ok?: boolean }).ok === false;
      const errorText =
        isErr && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : undefined;
      patchAssistant((parts) =>
        upsertToolPart(parts, event.id, {
          type: toolType,
          state: errorText ? "output-error" : "output-available",
          output: result,
          errorText,
        }),
      );
      return;
    }

    if (event.type === "usage") {
      useAgentChats.getState().recordTurnUsage(conversationId, event.usage);
      return;
    }

    if (event.type === "error") {
      turnError = event.message || "请求失败";
      if (!textAcc.trim()) {
        textAcc = turnError;
        flushText();
      }
      return;
    }

    if (event.type === "done") {
      complete(turnError ? "error" : "success", turnError);
    }
  };

  try {
    await runAgentTurn({
      messages: history,
      settings,
      permissionMode: auto.permissionMode,
      workspaceRoot,
      signal: controller.signal,
      selectedModelId,
      personaSnippet: persona.systemSnippet,
      conversationId,
      onEvent,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "运行异常";
    if (!finished) {
      turnError = turnError || msg;
      complete("error", turnError);
    }
  }

  // runAgentTurn 保证 done；若异常未 done 上面 catch 已 complete
  if (!finished) {
    complete(turnError ? "error" : "success", turnError);
  }

  return {
    ok: !turnError,
    runId,
    conversationId,
    error: turnError,
  };
}

function maybeDisableOnFailures(automationId: string) {
  const auto = useAutomations.getState().getAutomation(automationId);
  if (!auto) return;
  if (auto.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && auto.enabled) {
    useAutomations.getState().setEnabled(automationId, false);
    toast.warning(`定时任务「${auto.name}」已自动停用`, {
      description: `连续失败 ${MAX_CONSECUTIVE_FAILURES} 次`,
    });
  }
}
