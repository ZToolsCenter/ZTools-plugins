import { buildOutputSchemaAudit } from "./ai-replace-intent-output-schema.mjs";

/** Deterministic prompt-budget, protocol, binding, and patch checks before inference. */
export function runIntentPreflight({
  cases,
  quickstart,
  buildAiIntentCandidates,
  buildIntentSystemPrompt,
  buildIntentPlanningPrompt,
  buildIntentOutputSchema,
  intentOccurrenceChoices,
  requireOutputSchema = false,
  calculateLocalAiBudget,
  parseIntentOutput,
  bindAiIntent,
  buildBoundIntentPatch,
  sourceForCase,
  buildIntentOracle,
  intentMatchesOracle,
  hash
}) {
  const promptSnapshots = [];
  const results = [];

  if (requireOutputSchema && (typeof buildIntentOutputSchema !== "function" || typeof intentOccurrenceChoices !== "function")) {
    throw new Error("Output schema missing from preflight; refusing to measure an unconstrained planner call");
  }

  for (const item of cases) {
    const source = sourceForCase(quickstart, item);
    const candidates = buildAiIntentCandidates(item.instruction, source);
    const systemPrompt = buildIntentSystemPrompt(false, candidates);
    const planningPrompt = buildIntentPlanningPrompt(item.instruction, false, candidates);
    const budget = calculateLocalAiBudget(planningPrompt, systemPrompt, 384);
    const schemaAudit = buildIntentOutputSchema && intentOccurrenceChoices
      ? buildOutputSchemaAudit({ instruction: item.instruction, candidates, buildIntentOutputSchema, intentOccurrenceChoices, hash })
      : null;
    const expectedPlan = syntheticPlan(item, candidates);
    const rawModelOutput = JSON.stringify(expectedPlan);
    const parsedIntent = parseIntentOutput(rawModelOutput, item.instruction, candidates);
    const oracle = buildIntentOracle(item, source, hash);
    const bound = bindAiIntent(parsedIntent, {
      documentId: `preflight-${item.id}`,
      revision: 1,
      content: source,
      selection: null,
      selectionValid: false,
      cursor: 0,
      readOnly: false
    }, item.instruction, candidates);
    const patch = buildBoundIntentPatch(bound, bound.literalText);
    const finalText = source.slice(0, patch.from) + patch.insertText + source.slice(patch.to);
    const intentCorrect = intentMatchesOracle(item, parsedIntent, candidates);
    const fullSourceCorrect = finalText === oracle.expectedFinalText;
    const record = {
      caseId: item.id,
      budget,
      candidates,
      ...(schemaAudit ?? {}),
      syntheticRawPlan: rawModelOutput,
      parsedIntent,
      binding: {
        from: bound.range.from,
        to: bound.range.to,
        expectedText: bound.range.expectedText,
        literalText: bound.literalText,
        matches: bound.matches ?? null
      },
      patch: { from: patch.from, to: patch.to, expectedText: patch.expectedText, insertText: patch.insertText },
      expectedFinalSha256: oracle.expectedFinalSha256,
      finalSha256: hash(finalText),
      intentCorrect,
      fullSourceCorrect,
      passed: intentCorrect && fullSourceCorrect
    };
    results.push(record);
    promptSnapshots.push({
      id: item.id,
      instruction: item.instruction,
      sourceSha256: hash(source),
      candidates,
      systemPrompt,
      systemPromptSha256: hash(systemPrompt),
      planningPrompt,
      planningPromptSha256: hash(planningPrompt),
      ...(schemaAudit ?? {}),
      preflightBudget: budget
    });
  }

  return {
    status: results.every((record) => record.passed) ? "passed" : "failed",
    totalCases: results.length,
    passedCases: results.filter((record) => record.passed).length,
    results,
    promptSnapshots
  };
}

function syntheticPlan(item, candidates) {
  const contentText = item.operation === "insert" ? item.expectedText : item.replacement;
  const contentLiteral = candidates.literals.find((candidate) => candidate.text === contentText);
  if (!contentLiteral) throw new Error(`Preflight could not find exact content candidate for ${item.id}`);
  const content = { mode: "literal", literalId: contentLiteral.id };
  if (item.operation === "insert") {
    return { version: 1, kind: "edit", operation: "insert", target: item.target, layout: item.layout, content };
  }
  const findLiteral = candidates.literals.find((candidate) => candidate.text === item.find);
  if (!findLiteral) throw new Error(`Preflight could not find exact source candidate for ${item.id}`);
  return {
    version: 1,
    kind: "edit",
    operation: "replace_exact",
    target: "document",
    findId: findLiteral.id,
    occurrence: item.occurrence,
    content
  };
}
