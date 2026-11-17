import type { AiTaskExecution } from "./aiTaskExecution";
import type { AiTaskRunnerOptions } from "./aiTaskRunner";
import { validateProseDateOwnerReplacement } from "./proseDateOwnership";
import { sourceOwnedFactAuthorization } from "./sourceOwnedFactAuthority";
import { readPreparedSourceOwnedFactBinding, type PreparedSourceOwnedFactPlan,
  type SourceOwnedReadableInput } from "./sourceOwnedFactPlan";
import { runReadableProsePlan } from "./readableProseExecution";

function factShape(fact: object): string {
  return JSON.stringify(fact);
}

function skillShape(skill: SourceOwnedReadableInput["skill"]): string {
  return JSON.stringify(skill ? { id: skill.id, category: skill.category, systemPrompt: skill.systemPrompt,
    userPromptTemplate: skill.userPromptTemplate } : null);
}

function scopeShape(scope: SourceOwnedReadableInput["scopeContext"]): string {
  return scope ? JSON.stringify({ document: scope.document, range: scope.range }) : "implicit-full-document";
}

/** Stages source-validated fact copies and runs every remaining job through the original executor. */
export async function runSourceOwnedFactPlan(input: {
  prepared: PreparedSourceOwnedFactPlan;
  readableInput: SourceOwnedReadableInput;
  execution: AiTaskExecution;
  options: AiTaskRunnerOptions;
  onExactSourceReply?: (slotIds: readonly string[]) => void;
}): Promise<Map<string, string>> {
  const binding = readPreparedSourceOwnedFactBinding(input.prepared);
  const { readableInput, execution } = input;
  const authorization = binding && sourceOwnedFactAuthorization(readableInput.sourceOwnedFactAuthority, {
    source: readableInput.source, instruction: readableInput.instruction, task: binding.task,
    effectiveSystemPrompt: readableInput.systemPrompt, skill: readableInput.skill,
    scopeContext: readableInput.scopeContext
  });
  if (!binding || input.prepared.plan !== binding.plan || readableInput.source !== binding.source ||
      readableInput.instruction !== binding.instruction || readableInput.task !== binding.task ||
      readableInput.systemPrompt !== binding.systemPrompt || skillShape(readableInput.skill) !== binding.skillShape ||
      scopeShape(readableInput.scopeContext) !== binding.scopeShape ||
      readableInput.sourceOwnedFactAuthority !== binding.authority || authorization !== binding.authorization) {
    throw new Error("闭合事实计划与原始请求或正文槽不匹配，原文未修改。");
  }
  execution.assertRunning();
  const plan = binding.plan;
  const programIds = new Set(binding.entries.map(entry => entry.decision.slotId));
  const programSlots = plan.slots.filter(slot => programIds.has(slot.id));
  if (!programIds.size || programSlots.length !== programIds.size) {
    throw new Error("闭合事实计划没有完整覆盖来源槽，原文未修改。");
  }
  const staged = new Map<string, string>();
  for (const entry of binding.entries) {
    execution.assertRunning();
    const { decision } = entry;
    const slot = programSlots.find(item => item.id === decision.slotId);
    if (!slot || slot.range.from !== decision.sourceRange.from || slot.range.to !== decision.sourceRange.to ||
        slot.sourceText !== decision.sourceText || !slot.dateOwnerFact ||
        factShape(slot.dateOwnerFact) !== entry.factShape ||
        readableInput.source.slice(slot.range.from, slot.range.to) !== slot.sourceText ||
        validateProseDateOwnerReplacement(decision.fact, decision.sourceText, decision.outputText) !== decision.outputText) {
      throw new Error("闭合事实来源或程序结果已改变，原文未修改。");
    }
    staged.set(decision.slotId, decision.outputText);
  }

  const ordinarySlots = plan.slots.filter(slot => !programIds.has(slot.id));
  const ordinaryIds = new Set(ordinarySlots.map(slot => slot.id));
  const ordinaryJobs = plan.jobs.filter(job => !job.slotIds.some(id => programIds.has(id)));
  if (!ordinaryJobs.some(job => job.kind !== "literal") || ordinaryJobs.some(job =>
      job.slotIds.some(id => programIds.has(id) || !ordinaryIds.has(id)))) {
    throw new Error("闭合事实计划未保留有效的普通模型任务，原文未修改。");
  }
  execution.assertRunning();
  const ordinary = await runReadableProsePlan(readableInput, { slots: ordinarySlots, jobs: ordinaryJobs },
    execution, input.options, undefined, input.onExactSourceReply);
  execution.assertRunning();
  if (!(ordinary instanceof Map) || ordinary.size !== ordinarySlots.length || ordinarySlots.some(slot =>
      !ordinary.has(slot.id) || typeof ordinary.get(slot.id) !== "string")) {
    throw new Error("普通正文任务没有覆盖所有非事实槽，原文未修改。");
  }
  for (const [id, value] of ordinary) {
    if (!ordinaryIds.has(id)) throw new Error("普通正文任务返回了未授权的槽，原文未修改。");
    staged.set(id, value);
  }
  execution.assertRunning();
  if (staged.size !== plan.slots.length || plan.slots.some(slot => !staged.has(slot.id))) {
    throw new Error("闭合事实计划与普通正文任务未覆盖全部源槽，原文未修改。");
  }
  return staged;
}
