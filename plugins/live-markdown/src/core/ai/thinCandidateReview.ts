import type { AiDocumentSnapshot, AiEditProposal } from "../../types/aiEditing";
import type { ArtifactSpec } from "./artifactSpec";
import type { BoundIntent } from "./intentBinder";
import { buildBoundIntentPatch } from "./intentBinder";
import { validateArtifactCandidate } from "./artifactValidation";
import { validateMarkdownFragmentCompleteness } from "./markdownAstIntegrity";
import { resolveAiEdit } from "./editProposal";

/** Diagnostics are advisory; exact source ownership and write lifecycle remain hard fences. */
export function reviewThinCandidate(bound: BoundIntent, snapshot: AiDocumentSnapshot, text: string, spec: ArtifactSpec): {
  proposal?: AiEditProposal; warnings: string[]; preservedSource?: boolean;
} {
  if (!text.trim()) throw new Error("模型返回空结果，原文未修改。");
  if (new TextEncoder().encode(text).byteLength > 1_048_576) throw new Error("结果超过 1 MiB 上限，原文未修改。");
  const warnings: string[] = [];
  try { validateMarkdownFragmentCompleteness(text); }
  catch { warnings.push("结果可能含未闭合的 Markdown 结构，请检查预览后再确认。"); }
  if (spec.kind !== "none" && !spec.issues.length) {
    try { validateArtifactCandidate(spec, text); }
    catch (cause) { warnings.push(cause instanceof Error ? cause.message : "结果可能不符合所需格式，请在修改对照中核对。"); }
  }
  if (bound.intent.kind === "answer") return { warnings };
  if (snapshot.readOnly) throw new Error("当前文档为只读，不能创建修改提案。");
  const patch = buildBoundIntentPatch(bound, text);
  if (patch.expectedText === patch.insertText) return { preservedSource: true, warnings: [...warnings, "处理结果与原文一致，文档保持不变。"] };
  const proposal: AiEditProposal = { snapshot, patch, text: patch.insertText, dependency: bound.dependency,
    mode: bound.intent.kind === "edit" && bound.intent.operation === "insert"
      ? bound.intent.target === "document_end" ? "append" : "insert" : "replace", summary: bound.summary };
  const resolved = resolveAiEdit(proposal);
  if (!resolved || snapshot.content !== bound.documentContent) throw new Error("修改位置或原文版本不一致，原文未修改。");
  if (new TextEncoder().encode(resolved.content).byteLength > 1_048_576) throw new Error("最终文档超过 1 MiB 上限，原文未修改。");
  return { proposal, warnings };
}
