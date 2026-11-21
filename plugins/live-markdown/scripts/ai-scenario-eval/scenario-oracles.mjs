import { evaluateGeneratedQuality } from "./generation-quality.mjs";

const score = (pass, reason, extra = {}) => ({ pass, reason, ...extra });
const notApplicable = (reason) => score(null, reason);

function compareIntent(item, record) {
  // Raw validated JSON grades model classification; a later scope guard is a separate safety layer.
  const actual = record.rawParsedIntent;
  const expected = item.expected.intent;
  if (!actual) return score(false, record.rawParsedError?.message ?? "No valid model intent captured.");
  const mismatches = [];
  for (const key of ["kind", "operation", "target", "reason", "find", "occurrence", "layout", "matchScope"]) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) mismatches.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
  }
  if (expected.mode !== undefined && expected.mode !== actual.content?.mode) mismatches.push(`mode: expected ${expected.mode}, got ${actual.content?.mode}`);
  if (expected.mode === "literal") {
    const actualText = actual.content?.text ?? record.candidates?.literals?.find((literal) => literal.id === actual.content?.literalId)?.text;
    if (actualText !== expected.text) mismatches.push(`literal: expected ${JSON.stringify(expected.text)}, got ${JSON.stringify(actualText)}`);
    if (item.expected.requiresLiteralId && !actual.content?.literalId) mismatches.push("Long literal did not use grounded candidate ID.");
  }
  if (expected.mode === "generate") {
    const allowed = expected.taskAnyOf ?? [expected.task];
    if (!allowed.includes(actual.content?.task)) mismatches.push(`task: expected ${allowed.join("|")}, got ${actual.content?.task}`);
  }
  if (expected.expectedHeading) {
    const heading = expected.expectedHeading;
    const candidate = record.candidates?.headings?.find((value) => value.id === actual.targetId);
    const from = /^heading:(\d+):\d+$/u.exec(actual.targetId ?? "")?.[1];
    if (candidate?.text !== heading.text || Number(from) !== heading.lineFrom) mismatches.push(`heading identity: expected ${heading.text} at ${heading.lineFrom}, got ${actual.targetId}`);
  }
  return score(mismatches.length === 0, mismatches.length ? mismatches.join("; ") : "Model intent matches the frozen semantic oracle.", {
    acceptedByPlanner: Boolean(record.plannerIntent), plannerError: record.plannerError ?? null
  });
}

function errorIdentity(record) {
  const message = record.error?.message ?? "";
  if (record.error?.code) return record.error.code;
  if (/无法准确定位当前选区/u.test(message)) return "selection_mapping_invalid";
  if (/找到 \d+ 处匹配内容，请指定第几处/u.test(message)) return "ambiguous_match";
  if (/只找到 \d+ 处匹配内容，不存在第/u.test(message)) return "occurrence_out_of_range";
  if (/没有找到指令中的精确匹配内容/u.test(message)) return "exact_match_not_found";
  if (/当前文档为只读/u.test(message)) return "readonly_document";
  if (/底部\/开头.*没有明确指向全文/u.test(message)) return "selection_scope_ambiguous";
  if (/文档头部 frontmatter 被修改或遗漏/u.test(message)) return "protected_frontmatter";
  if (/数学公式被修改或遗漏/u.test(message)) return "protected_math";
  if (/脚注标记被修改或遗漏/u.test(message)) return "protected_footnote";
  if (/代码、表格、HTML、链接目标或其所在结构被修改/u.test(message)) return "protected_ast_content";
  if (/没有改变原文/u.test(message)) return "proposal-noop";
  // The operation guard can reject a partial compound intent independently of model classification.
  if (/多个编辑操作|拆分成单条指令|包含多个操作/u.test(message)) return "clarify:compound";
  if (record.plannerIntent?.kind === "clarify" || record.plannerIntent?.kind === "unsupported") return `${record.plannerIntent.kind}:${record.plannerIntent.reason}`;
  return "unclassified";
}

function matchesExpectedReject(item, record) {
  const expected = item.expected;
  if (!record.error || record.result || record.resolvedEdit) return score(false, "Expected a specific rejection with zero proposal/answer result.");
  const identity = errorIdentity(record);
  const allowed = expected.rejectCodes ?? [expected.rejectStage];
  const genericProtected = identity === "protected_ast_content" && allowed.some((code) => ["protected_code", "protected_table", "protected_link_target"].includes(code));
  const identityMatches = allowed.includes(identity) || genericProtected;
  const patternMatches = expected.rejectPatterns?.some((pattern) => new RegExp(pattern, "u").test(record.error.message)) ?? false;
  return score(identityMatches && patternMatches,
    identityMatches && patternMatches ? `Specific ${identity} protection/clarification reached.` : `Wrong rejection identity or diagnostic: ${identity}: ${record.error.message}`,
    { identity, expectedStage: expected.rejectStage, expectedCodes: allowed });
}

function comparePatch(item, record) {
  const expected = item.expected.patch;
  const actual = record.resolvedEdit;
  if (record.error || !actual || !record.result?.proposal || record.result.answerOnly) return score(false, record.error?.message ?? "No complete edit proposal.");
  const mismatches = [];
  for (const key of ["from", "to", "expectedText", "insertText"]) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) mismatches.push(`patch.${key} differs`);
  }
  const computed = item.source.slice(0, actual.from) + actual.insertText + item.source.slice(actual.to);
  if (actual.content !== computed) mismatches.push("Resolved content differs from the exact applied patch.");
  if (!actual.insertText.trim() || actual.content === item.source) mismatches.push("Empty/no-op edit.");
  return score(mismatches.length === 0, mismatches.length ? mismatches.join("; ") : "Exact range/content and single proposal match the frozen oracle.");
}

function evaluateSafety(item, record, modules) {
  if (record.inputSnapshotUnchanged === false || record.sourceUnchanged === false) return score(false, "Input snapshot changed during inference.");
  const proposal = record.result?.proposal;
  if (!proposal) return score(true, "No write proposal exists; input snapshot stayed unchanged. Host apply was not exercised.");
  if (["answer", "reject", "no_change"].includes(item.expected.effect)) return score(false, "An unsolicited proposal was created for an answer/rejection/no-change case.");
  if (item.readOnly) return score(false, "Read-only input received an edit proposal.");
  const patch = record.resolvedEdit;
  const expected = item.expected.patch;
  if (!patch || record.resolveError) return score(false, "Proposal could not be resolved.");
  if (patch.from !== expected.from || patch.to !== expected.to || patch.expectedText !== expected.expectedText) return score(false, "Proposal affects a different source range than requested.");
  if (item.expected.effect === "patch" && patch.insertText !== expected.insertText) return score(false, "Literal edit content differs from exact user payload.");
  try {
    if (!modules.isAiProposalCurrent(proposal, record.snapshot)) return score(false, "Proposal is already stale against its original snapshot.");
    modules.validateMarkdownFragmentCompleteness(patch.content);
    if (patch.from === item.source.length && patch.to === item.source.length) modules.validateMarkdownAppendIntegrity(item.source, patch.insertText);
    else modules.validateMarkdownAstIntegrity(item.source, patch.content, item.expected.intent.operation === "rewrite");
  } catch (error) { return score(false, error.message); }
  return score(true, "Source range, original bytes outside the range, proposal currency and Markdown guards passed; no native apply performed.");
}

function evaluateCalls(item, record) {
  const planning = record.calls.filter((call) => call.phase === "planning").length;
  const content = record.calls.filter((call) => call.phase === "generation").length;
  const expected = item.expected.calls;
  const correct = planning === expected.planning && content >= expected.contentMin && content <= expected.contentMax;
  return score(correct, `Observed ${planning} planning and ${content} content calls; expected ${expected.planning} and ${expected.contentMin}..${expected.contentMax}.`, { planning, content });
}

export function evaluateScenario(item, record, modules) {
  const intent = compareIntent(item, record);
  const callBudget = evaluateCalls(item, record);
  const safety = evaluateSafety(item, record, modules);
  let task;
  let policy = notApplicable("Not a rejection case.");
  if (item.expected.effect === "reject") {
    policy = matchesExpectedReject(item, record);
    task = item.capabilityLimited ? score(false, "Legitimate requested edit is blocked by current AST protection; safety is not task completion.") : policy;
  } else if (item.expected.effect === "no_change") {
    const preserved = !record.result?.proposal && !record.resolvedEdit && (
      record.error ? item.expected.noChangePatterns.some((pattern) => new RegExp(pattern, "u").test(record.error.message))
        : record.result?.text === item.source || record.result?.preservedSource === true
    );
    task = score(preserved, preserved ? "No editable prose; source preserved with zero content calls, either preserved result or explicit no-op diagnostic." : "No-change request did not preserve its input with an explicit no-op outcome.");
  } else if (item.expected.effect === "answer") {
    const answered = !record.error && record.result?.answerOnly === true && !record.result.proposal && !record.resolvedEdit && Boolean(record.result.text?.trim());
    task = score(answered, answered ? "Completed answer-only result; no proposal." : record.error?.message ?? "Missing answer-only result.");
  } else task = comparePatch(item, record);
  const quality = item.expected.quality
    ? evaluateGeneratedQuality(record.result?.text ?? "", item.expected.quality, item.source)
    : notApplicable("Literal/rejection case: no generated-content rubric.");
  const timedOut = record.harnessTimedOut || record.error?.name === "AiTaskDeadlineError";
  const layers = { intent, task, safety, quality, callBudget };
  const passed = !timedOut && Object.values(layers).every((layer) => layer.pass !== false);
  const reasons = Object.entries(layers).filter(([, layer]) => layer.pass === false).map(([key, layer]) => `${key}: ${layer.reason}`);
  return {
    passed, outcome: timedOut ? "blocked" : passed ? "passed" : item.capabilityLimited && policy.pass ? "capability-limited" : "failed",
    reasons, ...layers, policy, errorIdentity: record.error ? errorIdentity(record) : null,
    evidenceLimit: "Frozen production runner with real local inference; editor/native apply and visual rendering are outside this run."
  };
}
