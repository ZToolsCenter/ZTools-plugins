import type { AiDocumentSnapshot, AiEditProposal } from "../../types/aiEditing";
import type { AiTaskRequest, AiTaskResult } from "./aiTaskRunner";
import { isSafeMarkdownBoundary } from "./intentTargets";
import { validateMarkdownAstIntegrity } from "./markdownAstIntegrity";

interface SourceRange {
  from: number;
  to: number;
}

function resolveOwnedRange(request: AiTaskRequest, snapshot: AiDocumentSnapshot): SourceRange {
  if (request.scope === "selection") {
    const selection = snapshot.selection;
    if (snapshot.selectionValid === false || !selection || !Number.isInteger(selection.from) || !Number.isInteger(selection.to) ||
        selection.from < 0 || selection.to < selection.from || selection.to > snapshot.content.length ||
        snapshot.content.slice(selection.from, selection.to) !== request.source) {
      throw new Error("当前选区无法与原始 Markdown 源码准确对应，原文未修改。");
    }
    return { ...selection };
  }

  if (request.scope === "document" || request.source === snapshot.content) {
    if (request.source !== snapshot.content) throw new Error("全文任务输入与文档快照不一致，原文未修改。");
    return { from: 0, to: snapshot.content.length };
  }

  const selection = snapshot.selection;
  if (snapshot.selectionValid !== false && selection && Number.isInteger(selection.from) && Number.isInteger(selection.to) &&
      selection.from >= 0 && selection.to >= selection.from && selection.to <= snapshot.content.length &&
      snapshot.content.slice(selection.from, selection.to) === request.source) {
    return { ...selection };
  }
  throw new Error("AI 任务输入无法绑定到文档或有效选区，原文未修改。");
}

/** Creates an exact worker-owned replacement patch after the prose task has validated its local output. */
export function attachSourceOwnedProposal(request: AiTaskRequest, snapshot: AiDocumentSnapshot, result: AiTaskResult): AiTaskResult {
  if (!result.sourceOwned || !result.editAction || result.preservedSource) return result;
  if (result.text === request.source) {
    return { ...result, preservedSource: true, warnings: [...result.warnings, "没有改变原文，未生成可应用的修改。"] };
  }

  const range = resolveOwnedRange(request, snapshot);
  if (!isSafeMarkdownBoundary(snapshot.content, range.from) || !isSafeMarkdownBoundary(snapshot.content, range.to)) {
    throw new Error("选区边界跨越 Markdown 或 Unicode 结构，不能创建编辑提案。");
  }
  const expectedText = snapshot.content.slice(range.from, range.to);
  const candidate = snapshot.content.slice(0, range.from) + result.text + snapshot.content.slice(range.to);
  validateMarkdownAstIntegrity(snapshot.content, candidate, result.conservative);

  const proposal: AiEditProposal = {
    snapshot,
    text: result.text,
    mode: "replace",
    // Buttons/Skills keep their legacy full interaction snapshot fence. A new
    // selection during generation must not silently broaden the apply contract.
    patch: { from: range.from, to: range.to, expectedText, insertText: result.text }
  };
  return { ...result, proposal };
}
