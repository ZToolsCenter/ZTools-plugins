import { runAITextStream, type AIMessage } from "@/lib/ai-provider";
import { getAgentCapabilities, getAgentCapabilityById, getAgentCommitHandler } from "@/agent/core/registry";
import {
  buildToolContinuationPrompt,
  executeNoteToolMarker,
  parseNoteToolMarker,
} from "@/agent/capabilities/note/toolMarkers";
import type {
  AgentArtifact,
  AgentExecutePlanOptions,
  AgentExecutionResult,
  AgentInputContext,
  AgentParsedInput,
  AgentPlanBuildResult,
} from "@/agent/core/types";
import { parseNoteAgentInput, type IntentRouterDeps } from "@/agent/capabilities/note";

export async function parseAgentInput(
  context: AgentInputContext,
  routerDeps?: IntentRouterDeps,
): Promise<AgentParsedInput> {
  return parseNoteAgentInput(context, routerDeps);
}

export async function buildAgentPlan(
  context: AgentInputContext,
  routerDeps?: IntentRouterDeps,
): Promise<AgentPlanBuildResult & {
  parsed: AgentParsedInput;
}> {
  const parsed = await parseAgentInput(context, routerDeps);
  const capability = getAgentCapabilities().find((item) =>
    item.surfaces.includes(context.surface) && item.match(context, parsed),
  );

  if (!capability) {
    return {
      parsed,
      intent: {
        capabilityId: "note.chat",
        artifactType: "text_response",
        targetType: parsed.resolvedTarget.mode,
        reason: "fallback_chat",
      },
      artifact: {
        type: "text_response",
        text: "暂时没有匹配到可执行能力。",
        error: true,
      },
    };
  }

  const match = capability.match(context, parsed);
  if (!match) {
    return {
      parsed,
      intent: {
        capabilityId: "note.chat",
        artifactType: "text_response",
        targetType: parsed.resolvedTarget.mode,
        reason: "unmatched_chat",
      },
      artifact: {
        type: "text_response",
        text: "暂时没有匹配到可执行能力。",
        error: true,
      },
    };
  }

  return {
    parsed,
    ...capability.buildPlan({
      context,
      parsed,
      match,
    }),
  };
}

export async function executeAgentPlan(
  options: AgentExecutePlanOptions,
): Promise<AgentExecutionResult> {
  const capability = getAgentCapabilityById(options.plan.capabilityId);
  if (!capability) {
    throw new Error("未找到可执行的 Agent 能力");
  }

  const baseMessages: AIMessage[] = [
    { role: "system", content: options.plan.systemPrompt },
    ...(options.historyMessages ?? []),
    { role: "user", content: options.plan.userPrompt },
  ];
  const shouldHandleNoteToolMarkers =
    options.plan.capabilityId === "note.chat" && options.context.surface === "workspace";
  const seenToolMarkers = new Set<string>();
  let currentMessages = baseMessages;
  let rawText = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    rawText = await runAITextStream(options.settings, currentMessages, {
      abortSignal: options.abortSignal,
      onUpdate: options.onUpdate,
      requestOverrides: options.requestOverrides,
      streamIdleTimeoutMs: options.streamIdleTimeoutMs,
    });

    if (!rawText?.trim()) {
      throw new Error("AI 没有返回可用内容");
    }

    if (!shouldHandleNoteToolMarkers) {
      break;
    }

    const marker = parseNoteToolMarker(rawText);
    if (!marker) {
      break;
    }

    const markerKey = `${marker.type}:${marker.argument}`;
    if (seenToolMarkers.has(markerKey)) {
      break;
    }
    seenToolMarkers.add(markerKey);

    const toolResult = executeNoteToolMarker(marker, {
      originNotebookId: options.context.originNotebookId,
    });

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: rawText.trim() },
      { role: "user", content: buildToolContinuationPrompt(toolResult) },
    ];
  }

  if (!rawText?.trim()) {
    throw new Error("AI 没有返回可用内容");
  }

  const artifact = capability.buildArtifact({
    context: options.context,
    parsed: options.parsed,
    plan: options.plan,
    outputText: rawText,
  });

  return {
    intent: {
      capabilityId: options.plan.capabilityId,
      artifactType: options.plan.artifactType,
      targetType: options.plan.targetType,
      reason: options.plan.intentReason,
    },
    plan: options.plan,
    artifact,
    rawText: rawText.trim(),
  };
}

export async function commitAgentArtifact(artifact: AgentArtifact) {
  const handler = getAgentCommitHandler(artifact.type);
  if (!handler) return null;
  return await handler.commit(artifact);
}
