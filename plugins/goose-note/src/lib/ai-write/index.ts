export type {
  AiWriteAction,
  AiBlockRange,
  AiTargetMode,
  AiTargetSource,
  AiTargetSelection,
  AiTargetRef,
  AiStickyTarget,
  AiResolvedTarget,
  AiWritePlan,
  AiContextBundle,
} from "./targetResolution";

export {
  resolveAiTargetReference,
  createAiChatOnlyTarget,
  resolvedTargetToSelection,
  stickyTargetToSelection,
  createStickyTargetFromResolvedTarget,
  resolveAiTargetSelection,
  resolveAiTargetIntent,
  resolveAiTargetFromSelection,
} from "./targetResolution";

export {
  buildAiContextBundle,
  buildAiWorkspaceUserPrompt,
} from "./contextBundle";

export { buildAiWritePlan } from "./planBuilder";

export { commitAiWritePlan } from "./planCommit";

export type {
  BlockTypeTransformIntent,
  BlockTypeTransformBlock,
  BlockTypeTransformPanelOpenDetail,
  BlockTypeTransformPlan,
  BlockTypeTransformResult,
  BlockTypeTransformSelectionSnapshot,
  BlockTypeTransformTarget,
} from "./blockTypeTransform";

export {
  applyBlockTypeTransformToEditor,
  createBlockTypeTransformSelectionSnapshot,
  createPageBodyBlockTypeTransformSnapshot,
  getBlockTypeTransformSignature,
  getBlockTypeTransformTargetLabel,
  hasWholePageBlockTypeTransformScope,
  isBlockTypeTransformSelectionSnapshot,
  planBlockTypeTransform,
  resolveBlockTypeTransformIntent,
  resolveExplicitBlockTypeTarget,
} from "./blockTypeTransform";

export type {
  GeneratedBlockStructureExpectation,
  GeneratedBlockStructureValidationInput,
  GeneratedBlockStructureValidationResult,
  PseudoStructureMarkerIssue,
} from "./blockStructureValidation";

export {
  findPseudoStructureMarkers,
  normalizeGeneratedStructureMarkdown,
  resolveGeneratedBlockStructureExpectation,
  validateGeneratedBlockStructure,
} from "./blockStructureValidation";
