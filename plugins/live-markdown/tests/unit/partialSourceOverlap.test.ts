import { expect, it } from "vitest";
import { validateTaskCandidate } from "../../src/core/ai/aiOutputContract";

const paragraph = "项目采用本地推理引擎，先完成离线回归再开展跨平台实机验收。所有结果保留原始证据，交付前核对版本、参数和来源关系。".repeat(4);
const source = `${paragraph}\n\n尚未完成的事项需要另行核实，不得擅自认定全部通过。`;
const request = { source, instruction: "补充一段执行说明", mode: "fragment" as const, format: "none" as const };
it("surfaces partial overlap for explicit review while retaining the strict diagnostic default", () => {
  expect(() => validateTaskCandidate({ ...request, raw: paragraph })).toThrow(/重复/u);
  const result = validateTaskCandidate({ ...request, raw: paragraph, reviewPartialOverlap: true });
  expect(result.text).toBe(paragraph);
  expect(result.evidence.some(item => item.kind === "source_overlap_review")).toBe(true);
});
it("still rejects a complete unrequested source copy even in review mode", () => {
  expect(() => validateTaskCandidate({ ...request, raw: source, reviewPartialOverlap: true })).toThrow(/重复/u);
});
it("requires real source receipts before authorizing artifact-local reuse", () => {
  expect(() => validateTaskCandidate({ ...request, raw: "| 内容 |\n| --- |\n| 原文 |", format: "table", sourceFacts: ["凭空的引用"], allowArtifactReuseFromFacts: true })).toThrow(/事实/u);
});
