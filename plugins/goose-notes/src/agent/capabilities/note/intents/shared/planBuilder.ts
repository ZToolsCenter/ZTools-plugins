import type { Page } from "@/types";
import { usePages } from "@/stores/usePages";
import {
  buildAiContextBundle,
  buildAiWorkspaceUserPrompt,
  buildAiWritePlan,
  commitAiWritePlan,
  type AiResolvedTarget,
} from "@/lib/ai-write";
import type {
  AgentArtifact,
  AgentCapabilityBuildArtifactParams,
  AgentCapabilityBuildPlanParams,
  AgentCommitHandler,
  AgentInputContext,
  AgentParsedInput,
  AgentPlan,
  AgentPlanBuildResult,
} from "@/agent/core/types";
import { buildWorkspaceSystemPrompt, INLINE_NOTE_SYSTEM_PROMPT } from "./prompts";
import { buildInlinePrompt } from "./parser";

export function getTargetPage(
  resolvedTarget: AiResolvedTarget | undefined | null,
): Page | null {
  if (!resolvedTarget?.pageId) return null;
  return usePages.getState().pages[resolvedTarget.pageId] ?? null;
}

export function createPlan(params: {
  capabilityId: AgentPlan["capabilityId"];
  artifactType: AgentPlan["artifactType"];
  context: AgentInputContext;
  parsed: AgentParsedInput;
  promptText: string;
  systemPrompt: string;
  userPrompt: string;
  targetType: AgentPlan["targetType"];
}) {
  return {
    id: `agent-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capabilityId: params.capabilityId,
    artifactType: params.artifactType,
    executionStrategy: "single",
    surface: params.context.surface,
    promptText: params.promptText,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    intentReason: params.capabilityId,
    targetType: params.targetType,
    resolvedTarget: params.parsed.resolvedTarget,
    createdAt: Date.now(),
  } satisfies AgentPlan;
}

export function createTargetErrorArtifact(message: string) {
  return {
    type: "text_response",
    text: message,
    error: true,
  } satisfies AgentArtifact;
}

export function validateWorkspaceWriteTarget(parsed: AgentParsedInput) {
  const { resolvedTarget, targetReference } = parsed;

  if (targetReference?.pageId) {
    const referencedPage = usePages.getState().pages[targetReference.pageId];
    if (!referencedPage) {
      return createTargetErrorArtifact("你指定的目标页不存在或尚未加载，暂时没法写入。");
    }
    if (referencedPage.localFilePath && referencedPage.localReadState === "error") {
      return createTargetErrorArtifact("你指定的目标页当前不可读取，暂时没法写入。");
    }
    if (referencedPage.isLocked) {
      return createTargetErrorArtifact("你指定的目标页已锁定，暂时不能改写。");
    }
  }

  if (
    resolvedTarget.action === "replace_page" ||
    resolvedTarget.action === "append_page" ||
    resolvedTarget.action === "replace_block_range"
  ) {
    const page = getTargetPage(resolvedTarget);
    if (!page) {
      return createTargetErrorArtifact("目标页不存在或尚未加载，暂时没法写入。");
    }
    if (page.localFilePath && page.localReadState === "error") {
      return createTargetErrorArtifact("目标页当前不可读取，暂时没法写入。");
    }
    if (page.isLocked) {
      return createTargetErrorArtifact("目标页已锁定，暂时不能改写。");
    }

    if (resolvedTarget.action === "replace_block_range" && resolvedTarget.range) {
      const blocks = Array.isArray(page.content)
        ? (page.content as any[])
        : Array.isArray((page.content as any)?.content)
          ? ((page.content as any).content as any[])
          : [];
      const startOk = blocks.some(
        (b: any) => b?.id === resolvedTarget.range?.startBlockId,
      );
      const endOk = blocks.some(
        (b: any) => b?.id === resolvedTarget.range?.endBlockId,
      );
      if (!startOk || !endOk) {
        return createTargetErrorArtifact("目标范围已变化，无法定位旧的块，请重新生成。");
      }
    }
  }

  return null;
}

export function buildWorkspacePlan(
  params: AgentCapabilityBuildPlanParams,
): AgentPlanBuildResult {
  const { context, parsed, match } = params;
  const promptText = parsed.payload.promptText.trim();

  if (match.capabilityId !== "note.chat") {
    const validationArtifact = validateWorkspaceWriteTarget(parsed);
    if (validationArtifact) {
      return {
        intent: match,
        artifact: validationArtifact,
      };
    }
  }

  const contextBundle = buildAiContextBundle({
    payload: parsed.payload,
    resolvedTarget: parsed.resolvedTarget,
    originPageId: context.originPageId,
  });
  const userPrompt = buildAiWorkspaceUserPrompt({
    promptText,
    resolvedTarget: parsed.resolvedTarget,
    contextBundle,
  });

  return {
    intent: match,
    plan: createPlan({
      capabilityId: match.capabilityId,
      artifactType: match.artifactType,
      context,
      parsed,
      promptText,
      systemPrompt: buildWorkspaceSystemPrompt({
        verdict: parsed.intentClassification?.verdict,
        promptText,
        hasReference: parsed.payload.tokens.some((t) => t.type === "reference"),
      }),
      userPrompt,
      targetType: parsed.resolvedTarget.mode,
    }),
  };
}

export function buildInlinePlan(
  params: AgentCapabilityBuildPlanParams,
): AgentPlanBuildResult {
  const { context, parsed, match } = params;
  const promptText = parsed.payload.promptText.trim();
  const basePrompt = buildInlinePrompt({ context, parsed });
  
  const contextBundle = buildAiContextBundle({
    payload: parsed.payload,
    resolvedTarget: parsed.resolvedTarget,
  });
  const userPrompt = [
    basePrompt,
    contextBundle.referenceContextBlock
      ? `补充上下文：\n${contextBundle.referenceContextBlock}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!userPrompt) {
    return {
      intent: match,
      artifact: {
        type: "text_response",
        text: "",
      },
    };
  }

  return {
    intent: match,
    plan: createPlan({
      capabilityId: match.capabilityId,
      artifactType: match.artifactType,
      context,
      parsed,
      promptText,
      systemPrompt: INLINE_NOTE_SYSTEM_PROMPT,
      userPrompt,
      targetType: "inline_selection",
    }),
  };
}

export function buildNoteArtifact(
  params: AgentCapabilityBuildArtifactParams,
): AgentArtifact {
  if (params.plan.artifactType === "markdown_note") {
    const writePlan = buildAiWritePlan({
      markdown: params.outputText,
      promptText: params.plan.promptText,
      resolvedTarget: params.parsed.resolvedTarget,
    });
    if (!writePlan) {
      return createTargetErrorArtifact("写入计划生成失败，请稍后再试。");
    }
    return {
      type: "markdown_note",
      plan: writePlan,
    };
  }

  return {
    type: "text_response",
    text: params.outputText.trim(),
  };
}

export const markdownNoteCommitHandler: AgentCommitHandler = {
  artifactType: "markdown_note",
  commit: async (artifact) => {
    if (artifact.type !== "markdown_note") return null;
    return await commitAiWritePlan(artifact.plan);
  },
};
