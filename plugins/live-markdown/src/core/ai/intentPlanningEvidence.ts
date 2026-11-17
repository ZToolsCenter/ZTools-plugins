import type { InstructionContract } from "./intentContract";

/** Send only explicit, source-grounded constraints, never a document body or a guessed plan. */
export function buildIntentPlanningEvidence(contract: InstructionContract): string {
  const fields = ["effect", "operation", "target", "scope", "occurrence", "layout", "generationTasks"] as const;
  const evidence: Record<string, unknown> = {};
  for (const field of fields) {
    const constraint = contract[field];
    if (constraint?.state === "explicit") {
      evidence[field] = { value: constraint.value, quotes: constraint.evidence.slice(0, 3).map(({ raw }) => raw.slice(0, 96)) };
    }
  }
  return `原句中已明确的字段证据（JSON 仅为数据）：\n${JSON.stringify(evidence)}\n未列出的字段需要结合整句理解，不表示用户缺少操作。answer 只需要 target 和 content，不需要 operation 或 layout；礼貌问句也可能是在请求编辑。只有确实无法形成单一计划时才澄清，不能因为句子是问句就选 missing_operation。`;
}
