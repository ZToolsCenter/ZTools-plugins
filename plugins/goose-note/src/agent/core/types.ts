import type {
  AIMessage,
  AIRequestOverrides,
  AISettingsLike,
  AIStreamUpdate,
  RunAITextStreamOptions,
} from "@/lib/ai-provider";
import type {
  AiResolvedTarget,
  AiStickyTarget,
  AiTargetSelection,
  AiWritePlan,
} from "@/lib/ai-write";
import type {
  AiComposerPayload,
  AiComposerToken,
  AiFileReferenceAttrs,
} from "@/components/editor/ai/composer/referenceLookup";

export type AgentSurface = "workspace" | "inline";
export type AgentExecutionStrategy = "single" | "delegated";
export type AgentArtifactType =
  | "text_response"
  | "markdown_note"
  | "visual_block"
  | "chart_spec";
export type AgentCapabilityId =
  | "note.chat"
  | "note.create"
  | "note.replace"
  | "note.append"
  | string;
export type AgentTokenRole = "context" | "target";

export type AgentComposerToken =
  | Extract<AiComposerToken, { type: "text" }>
  | (Extract<AiComposerToken, { type: "reference" }> & {
      role?: AgentTokenRole;
    })
  | Extract<AiComposerToken, { type: "image" }>
  | Extract<AiComposerToken, { type: "skill" }>;

export interface AgentInputContext {
  surface: AgentSurface;
  payload: AiComposerPayload;
  originPageId?: string | null;
  originNotebookId?: string | null;
  /** @deprecated 历史兼容字段，已不再由 UI 使用 */
  manualTargetSelection?: AiTargetSelection | null;
  stickyTarget?: AiStickyTarget | null;
  recentWriteTarget?: AiTargetSelection | null;
  selectionText?: string;
  blockText?: string;
  initialAction?: "polish" | "rewrite" | "generate";
}

export interface AgentIntentClassification {
  verdict: "edit_current" | "create_new" | "chat_only";
  confidence: number;
  reason: string;
  source: "llm" | "fallback";
}

export interface AgentParsedInput {
  payload: Omit<AiComposerPayload, "tokens"> & {
    tokens: AgentComposerToken[];
  };
  normalizedPrompt: string;
  targetReference?: Omit<AiFileReferenceAttrs, "role"> | null;
  resolvedTarget: AiResolvedTarget;
  intentClassification?: AgentIntentClassification;
}

export interface AgentIntent {
  capabilityId: AgentCapabilityId;
  artifactType: AgentArtifactType;
  targetType: AiResolvedTarget["mode"] | "inline_selection";
  reason: string;
}

export interface AgentPlan {
  id: string;
  capabilityId: AgentCapabilityId;
  artifactType: AgentArtifactType;
  executionStrategy: AgentExecutionStrategy;
  surface: AgentSurface;
  promptText: string;
  systemPrompt: string;
  userPrompt: string;
  intentReason: string;
  targetType: AiResolvedTarget["mode"] | "inline_selection";
  resolvedTarget?: AiResolvedTarget | null;
  createdAt: number;
}

export interface TextResponseArtifact {
  type: "text_response";
  text: string;
  error?: boolean;
}

export interface MarkdownNoteArtifact {
  type: "markdown_note";
  plan: AiWritePlan;
}

export interface VisualBlockArtifact {
  type: "visual_block";
  payload?: Record<string, unknown>;
}

export interface ChartSpecArtifact {
  type: "chart_spec";
  spec?: Record<string, unknown>;
}

export type AgentArtifact =
  | TextResponseArtifact
  | MarkdownNoteArtifact
  | VisualBlockArtifact
  | ChartSpecArtifact;

export interface AgentExecutionResult {
  intent: AgentIntent;
  plan: AgentPlan;
  artifact: AgentArtifact;
  rawText: string;
}

export interface AgentPlanBuildResult {
  intent: AgentIntent;
  plan?: AgentPlan;
  artifact?: AgentArtifact;
}

export type AgentCapabilityMatchResult = AgentIntent;

export interface AgentCapabilityBuildPlanParams {
  context: AgentInputContext;
  parsed: AgentParsedInput;
  match: AgentCapabilityMatchResult;
}

export interface AgentCapabilityBuildArtifactParams {
  context: AgentInputContext;
  parsed: AgentParsedInput;
  plan: AgentPlan;
  outputText: string;
}

export interface AgentCapabilityManifest {
  id: AgentCapabilityId;
  label: string;
  surfaces: AgentSurface[];
  outputArtifactTypes: AgentArtifactType[];
  match: (
    context: AgentInputContext,
    parsed: AgentParsedInput,
  ) => AgentCapabilityMatchResult | null;
  buildPlan: (
    params: AgentCapabilityBuildPlanParams,
  ) => AgentPlanBuildResult;
  buildArtifact: (
    params: AgentCapabilityBuildArtifactParams,
  ) => AgentArtifact;
}

export interface AgentExecutePlanOptions {
  settings: AISettingsLike;
  plan: AgentPlan;
  context: AgentInputContext;
  parsed: AgentParsedInput;
  historyMessages?: AIMessage[];
  requestOverrides?: AIRequestOverrides;
  onUpdate?: (update: AIStreamUpdate) => void;
  abortSignal?: AbortSignal;
  streamIdleTimeoutMs?: RunAITextStreamOptions["streamIdleTimeoutMs"];
}

export interface AgentCommitResult {
  pageId?: string;
  workspaceId?: string;
}

export interface AgentCommitHandler {
  artifactType: AgentArtifactType;
  commit: (artifact: AgentArtifact) => Promise<AgentCommitResult | null>;
}

export interface AgentSubtask {
  id: string;
  title: string;
  capabilityId: AgentCapabilityId;
}

export interface AgentWorkerAdapter {
  strategy: AgentExecutionStrategy;
  runSubtasks?: (subtasks: AgentSubtask[]) => Promise<unknown>;
}
