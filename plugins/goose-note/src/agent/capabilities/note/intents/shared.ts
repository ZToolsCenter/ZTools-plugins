export {
  DATAVIZ_SYSTEM_PROMPT,
  JSON_RENDER_PROMPT_FRAGMENT,
  NOTE_SEARCH_TOOLS_PROMPT,
  WORKSPACE_NOTE_SYSTEM_PROMPT,
  INLINE_NOTE_SYSTEM_PROMPT,
  buildWorkspaceSystemPrompt,
  type SystemPromptSignals,
} from "./shared/prompts";

export {
  getTargetPage,
  createPlan,
  createTargetErrorArtifact,
  validateWorkspaceWriteTarget,
  buildWorkspacePlan,
  buildInlinePlan,
  buildNoteArtifact,
  markdownNoteCommitHandler,
} from "./shared/planBuilder";

export {
  buildInlinePrompt,
  type IntentRouterDeps,
  parseNoteAgentInput,
} from "./shared/parser";
