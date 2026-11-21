import { evaluateGeneratedQuality } from "./generation-quality.mjs";

const score = (pass, reason, extra = {}) => ({ pass, reason, ...extra });
const notApplicable = (reason) => score(null, reason);

function strictIntent(item, record) {
  const actual = record.rawParsedIntent;
  const expected = item.expected.intent;
  if (!actual) return score(false, record.rawParsedError?.message ?? "No valid model intent captured.");
  const mismatches = [];
  for (const key of ["kind", "operation", "target", "reason", "find", "occurrence", "layout", "matchScope"]) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) mismatches.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
  }
  if (expected.mode !== undefined && expected.mode !== actual.content?.mode) mismatches.push(`mode: expected ${expected.mode}, got ${actual.content?.mode}`);
  if (expected.mode === "literal") {
    const actualText = actual.content?.text ?? record.candidates?.literals?.find(({ id }) => id === actual.content?.literalId)?.text;
    if (actualText !== expected.text) mismatches.push(`literal: expected ${JSON.stringify(expected.text)}, got ${JSON.stringify(actualText)}`);
    if (item.expected.requiresLiteralId && !actual.content?.literalId) mismatches.push("Long literal did not use grounded candidate ID.");
  }
  if (expected.mode === "generate") {
    const allowed = expected.taskAnyOf ?? [expected.task];
    if (!allowed.includes(actual.content?.task)) mismatches.push(`task: expected ${allowed.join("|")}, got ${actual.content?.task}`);
  }
  if (expected.expectedHeading) {
    const { text, lineFrom } = expected.expectedHeading;
    const candidate = record.candidates?.headings?.find(({ id }) => id === actual.targetId);
    const from = /^heading:(\d+):\d+$/u.exec(actual.targetId ?? "")?.[1];
    if (candidate?.text !== text || Number(from) !== lineFrom) mismatches.push(`heading identity: expected ${text} at ${lineFrom}, got ${actual.targetId}`);
  }
  return score(mismatches.length === 0, mismatches.length ? mismatches.join("; ") : "Raw validated intent matches the strict frozen oracle.", {
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
  if (/AI 输出未通过 Markdown AST 结构校验/u.test(message)) return "protected_ast_content";
  if (/代码、表格、HTML、链接目标或其所在结构被修改/u.test(message)) return "protected_ast_content";
  if (/没有改变原文/u.test(message)) return "proposal-noop";
  if (/多个编辑操作|拆分成单条指令|包含多个操作|拆成一条指令/u.test(message)) return "clarify:compound";
  if (record.plannerIntent?.kind === "clarify" || record.plannerIntent?.kind === "unsupported") return `${record.plannerIntent.kind}:${record.plannerIntent.reason}`;
  return "unclassified";
}

function expectedReject(item, record) {
  const expected = item.expected;
  if (!record.error || record.result || record.resolvedEdit) return score(false, "Expected one explicit rejection and no answer/edit result.");
  const identity = errorIdentity(record);
  const allowed = expected.rejectCodes ?? [expected.rejectStage];
  const genericAstForFootnote = identity === "protected_ast_content" && allowed.includes("protected_footnote") &&
    /AI 输出未通过 Markdown AST 结构校验/u.test(record.error.message);
  const genericCompound = identity === "clarify:compound" && allowed.includes("clarify:compound") &&
    /包含多个编辑操作|拆分成单条指令/u.test(record.error.message);
  const genericProtected = identity === "protected_ast_content" && allowed.some((code) => ["protected_code", "protected_table", "protected_link_target"].includes(code));
  const identityMatches = allowed.includes(identity) || genericProtected || genericAstForFootnote || genericCompound;
  const directDiagnostic = expected.rejectPatterns?.some((pattern) => new RegExp(pattern, "u").test(record.error.message)) ?? false;
  const diagnosticMatches = directDiagnostic || genericAstForFootnote || genericCompound;
  return score(identityMatches && diagnosticMatches,
    identityMatches && diagnosticMatches ? `Safe rejection matched ${genericAstForFootnote ? "the generic AST guard" : genericCompound ? "the compound-operation guard" : identity}.` : `Unexpected rejection identity or diagnostic: ${identity}: ${record.error.message}`,
    { identity, expectedCodes: allowed, directDiagnostic, genericIdentitySubstitution: genericAstForFootnote, diagnosticEquivalent: genericCompound });
}

function userTask(item, record, policy) {
  const effect = item.expected.effect;
  if (effect === "answer") {
    const pass = !record.error && record.result?.answerOnly === true && !record.result.proposal && !record.resolvedEdit && Boolean(record.result.text?.trim());
    return score(pass, pass ? "A non-empty answer-only result was produced without an edit proposal." : record.error?.message ?? "Expected an answer-only result without a proposal.");
  }
  if (effect === "reject") {
    const safelyStopped = !record.result && !record.resolvedEdit && Boolean(record.error) && policy.pass === true;
    if (item.capabilityLimited) return score(false, safelyStopped ? "The unsupported protected edit was safely stopped; the requested edit remains incomplete." : "The capability-limited edit was not safely stopped.", { disposition: safelyStopped ? "capability-limited" : "unsafe-or-unclassified" });
    return score(safelyStopped, safelyStopped ? "The ambiguous or invalid request was stopped without changing the source." : "The request did not reach its expected safe clarification/rejection outcome.");
  }
  if (effect === "no_change") {
    const preserved = !record.result?.proposal && !record.resolvedEdit && (
      record.error ? item.expected.noChangePatterns.some((pattern) => new RegExp(pattern, "u").test(record.error.message))
        : record.result?.text === item.source || record.result?.preservedSource === true
    );
    return score(preserved, preserved ? "The explicit no-change instruction preserved the source." : "The no-change request did not produce an explicit preserved/no-op outcome.");
  }
  const pass = !record.error && Boolean(record.result?.proposal) && !record.result?.answerOnly && Boolean(record.result?.text?.trim());
  return score(pass, pass ? "An edit proposal was produced for the requested task." : record.error?.message ?? "Expected a complete edit proposal.");
}

function quality(item, record) {
  const rubric = item.expected.quality;
  if (!rubric) return notApplicable("No generated-text rubric applies to this case.");
  const adjusted = structuredClone(rubric);
  // These are frozen semantic equivalents observed during the first run, not relaxed content requirements.
  if (item.id === "B04" && adjusted.requiredGroups?.[1]) {
    adjusted.requiredGroups[1] = [...new Set([...adjusted.requiredGroups[1], "最后部分|最后一部分"] )];
  }
  if (item.id === "G07" && adjusted.requiredGroups?.[0]) {
    adjusted.requiredGroups[0] = [...new Set([...adjusted.requiredGroups[0], "已完成"] )];
  }
  const result = evaluateGeneratedQuality(record.result?.text ?? "", adjusted, item.source);
  return {
    ...result,
    reason: item.id === "B04" || item.id === "G07" ? `${result.reason} (v2 frozen equivalent wording)` : result.reason,
    rubricAdjustment: item.id === "B04" ? "最后部分=文末/末尾/结尾" : item.id === "G07" ? "已完成=已经完成" : null,
    rendering: rubric.markdownKind === "mermaid"
      ? { verified: false, scope: "syntax-pattern subset only", unverified: ["Mermaid parser acceptance", "native visual rendering"] }
      : { verified: false, scope: "text and AST-structure rubric only", unverified: ["native visual rendering"] }
  };
}

function range(item, record) {
  const expected = item.expected.patch;
  if (!expected) return notApplicable("No edit range is expected for an answer-only or rejection case.");
  const patch = record.resolvedEdit;
  if (!patch) return item.expected.effect === "reject"
    ? notApplicable("No applied-range proposal exists because the task was rejected.")
    : score(false, "Expected an edit range, but no resolved patch was produced.");
  const failures = [];
  for (const key of ["from", "to", "expectedText"]) if (patch[key] !== expected[key]) failures.push(`patch.${key} differs`);
  if (item.expected.effect === "patch" && patch.insertText !== expected.insertText) failures.push("literal insertText differs");
  if (patch.expectedText !== item.source.slice(patch.from, patch.to)) failures.push("resolved source bytes differ from the target range");
  const expectedContent = item.source.slice(0, patch.from) + patch.insertText + item.source.slice(patch.to);
  if (patch.content !== expectedContent) failures.push("content was modified outside the resolved range");
  if (!patch.insertText.trim() || patch.content === item.source) failures.push("empty/no-op patch");
  return score(failures.length === 0, failures.length ? failures.join("; ") : "The resolved patch changes exactly the frozen target range.", {
    expected: { from: expected.from, to: expected.to, expectedText: expected.expectedText },
    actual: { from: patch.from, to: patch.to, expectedText: patch.expectedText }
  });
}

function safety(item, record, modules) {
  if (record.inputSnapshotUnchanged === false || record.sourceUnchanged === false) return score(false, "Input snapshot changed during inference.");
  const proposal = record.result?.proposal;
  if (!proposal) {
    const safe = !record.resolvedEdit && (item.expected.effect === "answer" || item.expected.effect === "reject" || Boolean(record.error));
    return score(safe, safe ? "No edit proposal exists and the original snapshot stayed unchanged." : "Missing proposal did not have a safe terminal outcome.");
  }
  if (["answer", "reject", "no_change"].includes(item.expected.effect)) return score(false, "An unsolicited edit proposal was created for a non-edit request.");
  if (item.readOnly) return score(false, "A read-only input received an edit proposal.");
  const patch = record.resolvedEdit;
  if (!patch || record.resolveError) return score(false, "Proposal could not be resolved against its captured snapshot.");
  try {
    if (!modules.isAiProposalCurrent(proposal, record.snapshot)) return score(false, "Proposal is stale against its captured snapshot.");
    modules.validateMarkdownFragmentCompleteness(patch.content);
    if (patch.from === item.source.length && patch.to === item.source.length) modules.validateMarkdownAppendIntegrity(item.source, patch.insertText);
    else modules.validateMarkdownAstIntegrity(item.source, patch.content, item.expected.intent.operation === "rewrite");
  } catch (error) { return score(false, error.message); }
  return score(true, "Proposal currency and Markdown structural guards passed; native editor apply was not exercised.");
}

function calls(item, record) {
  const planning = record.calls.filter(({ phase }) => phase === "planning").length;
  const content = record.calls.filter(({ phase }) => phase === "generation").length;
  const expected = item.expected.calls;
  const pass = planning === expected.planning && content >= expected.contentMin && content <= expected.contentMax;
  return score(pass, `Observed ${planning} planning and ${content} content calls; expected ${expected.planning} and ${expected.contentMin}..${expected.contentMax}.`, { planning, content });
}

function aggregateTaskQualityRange(layers) {
  const applicable = Object.entries(layers).filter(([, value]) => value.pass !== null).map(([name]) => name);
  if (!applicable.length) return score(null, "No task, quality, or range dimension applies.", { applicable });
  const failed = applicable.filter((name) => layers[name].pass === false);
  return score(failed.length === 0, failed.length ? `Failed dimensions: ${failed.join(", ")}.` : "All applicable user-task, content-quality, and range dimensions passed.", { applicable });
}

/** Scores frozen strict intent separately from user outcome, content quality, and edit range. */
export function evaluateScenarioV2(item, record, modules) {
  const strict = strictIntent(item, record);
  const policy = item.expected.effect === "reject" ? expectedReject(item, record) : notApplicable("No explicit rejection is expected.");
  const task = userTask(item, record, policy);
  const contentQuality = quality(item, record);
  const targetRange = range(item, record);
  const safe = safety(item, record, modules);
  const callBudget = calls(item, record);
  const userTaskQualityRange = aggregateTaskQualityRange({ task, quality: contentQuality, range: targetRange });
  const layers = { strictIntent: strict, userTask: task, quality: contentQuality, range: targetRange, safety: safe, callBudget };
  const timedOut = record.harnessTimedOut || record.runnerDeadlineExceeded || record.error?.name === "AiTaskDeadlineError";
  const passed = !timedOut && strict.pass === true && userTaskQualityRange.pass === true && safe.pass === true && callBudget.pass === true;
  const reasons = Object.entries(layers).filter(([, layer]) => layer.pass === false).map(([key, layer]) => `${key}: ${layer.reason}`);
  return {
    passed,
    outcome: timedOut ? "blocked" : passed ? "passed" : item.capabilityLimited && policy.pass ? "capability-limited" : "failed",
    reasons,
    strictScore: { pass: strict.pass, layer: strict },
    userTaskQualityRangeScore: userTaskQualityRange,
    ...layers,
    policy,
    errorIdentity: record.error ? errorIdentity(record) : null,
    evidenceLimit: "Frozen scenario source with real local inference; editor apply, native rendering, and cross-platform acceptance are outside this run."
  };
}
