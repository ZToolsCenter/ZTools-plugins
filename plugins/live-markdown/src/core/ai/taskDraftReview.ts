import type { AiDocumentSnapshot, AiEditProposal } from "../../types/aiEditing";
import { artifactOutputFormat } from "./artifactSpec";
import { validateMarkdownTableSourceRelations } from "./aiTableArtifact";
import { validateArtifactCandidate } from "./artifactValidation";
import { validateTaskCandidate } from "./aiOutputContract";
import { bindAiIntent } from "./intentBinder";
import { buildAiIntentCandidates } from "./intentContext";
import { deriveInstructionContract } from "./instructionConstraints";
import { isSafeMarkdownBoundary } from "./intentTargets";
import { createPlannedEditProposal } from "./plannedEditProposal";
import { readTaskCandidateDraft, type TaskCandidateDraft } from "./taskCandidateFailure";

function fail(message: string): never { throw new Error(message); }

/** Revalidates a user-corrected failed candidate against its original edit plan and snapshot. */
export function reviewTaskDraft(draft: TaskCandidateDraft, snapshot: AiDocumentSnapshot, editedText: string): AiEditProposal {
  const safeDraft = readTaskCandidateDraft({ draft });
  if (!safeDraft) fail("失败草稿无效、不是编辑任务或超过 1 MiB 安全上限。");
  const { plan, intent } = safeDraft;
  if (plan.kind !== "edit" || intent.kind !== "edit") fail("只有编辑任务可以回验并创建修改提案。");
  if (plan.target.documentId !== snapshot.documentId || plan.target.revision !== snapshot.revision) {
    fail("失败草稿与原始文档版本不一致，不能创建修改提案。");
  }
  if (!editedText.trim()) fail("修正后的草稿不能为空。");

  const instruction = plan.instruction;
  const selected = Boolean(snapshot.selectionValid !== false && snapshot.selection && snapshot.selection.to > snapshot.selection.from);
  const contract = deriveInstructionContract(instruction, {
    hasSelection: selected,
    hasCursor: snapshot.cursor !== null && isSafeMarkdownBoundary(snapshot.content, snapshot.cursor)
  });
  const candidates = buildAiIntentCandidates(instruction, snapshot.content, contract);
  const bound = bindAiIntent(intent, snapshot, instruction, candidates, contract);
  if (bound.range.from !== plan.target.from || bound.range.to !== plan.target.to || bound.dependency !== plan.target.dependency) {
    fail("重新定位结果与失败计划不一致，不能创建修改提案。");
  }
  if ((plan.content.mode === "literal") !== (bound.literalText !== undefined)) {
    fail("失败草稿的字面内容计划与原指令不一致。");
  }

  const mode = plan.content.mode === "literal" ? "literal"
    : plan.task === "summarize" ? "summary"
      : intent.operation === "rewrite" ? "rewrite" : "fragment";
  const outputFormat = plan.artifact.kind === "code" && !plan.artifact.language
    ? "none" : artifactOutputFormat(plan.artifact);
  const validated = validateTaskCandidate({
    mode,
    source: bound.source,
    raw: editedText,
    instruction,
    format: outputFormat,
    sourceFacts: safeDraft.sourceFacts,
    reviewPartialOverlap: true,
    allowArtifactReuseFromFacts: plan.content.mode === "source_transform" && Boolean(safeDraft.sourceFacts?.length),
    ...(mode === "literal" ? { literalSource: bound.literalText } : {}),
    displaySource: plan.artifact.displaySource
  }).text;
  validateArtifactCandidate(plan.artifact, validated);
  if (plan.content.mode === "source_transform" && plan.artifact.kind === "table") {
    if (!safeDraft.sourceFacts?.length) fail("原文转换表格缺少来源事实，无法回验每行关系。");
    validateMarkdownTableSourceRelations(bound.source, safeDraft.sourceFacts, editedText);
  }
  return createPlannedEditProposal(bound, snapshot, validated, safeDraft.conservative);
}
