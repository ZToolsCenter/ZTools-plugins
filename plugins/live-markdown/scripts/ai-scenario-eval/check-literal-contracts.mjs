// Canonical-plan feasibility probe for frozen L01-L40 cases. No model is invoked.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, ".cache/acceptance/ai-scenarios/v1/case-manifest.json");
const reportPath = path.join(root, ".cache/acceptance/ai-scenarios/v2-r3/probes/literal-contract-p0-rerun-20261023-05.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const cases = manifest.realCases.filter(({ id }) => /^L(?:0[1-9]|[1-3][0-9]|40)$/u.test(id));

function schemaAllows(schema, value) {
  if (schema.anyOf && !schema.anyOf.some((branch) => schemaAllows(branch, value))) return false;
  if (Object.hasOwn(schema, "const") && schema.const !== value) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    const length = Array.from(value).length;
    return length >= (schema.minLength ?? 0) && length <= (schema.maxLength ?? Infinity);
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
    return Object.entries(schema.properties ?? {}).every(([key, child]) => !Object.hasOwn(value, key) || schemaAllows(child, value[key]));
  }
  return true;
}

function equalPatch(actual, expected) {
  return Boolean(actual && expected && actual.from === expected.from && actual.to === expected.to &&
    actual.expectedText === expected.expectedText && actual.insertText === expected.insertText);
}

function canonicalPlan(testCase, candidates, headingRanges) {
  const expected = testCase.expected.intent;
  if (!expected || expected.kind !== "edit" || expected.mode !== "literal") throw new Error("unsupported_expected_intent");
  const contentCandidate = candidates.literals.find(({ text }) => text === expected.text);
  const useId = testCase.expected.requiresLiteralId === true;
  if (useId && !contentCandidate) throw new Error("literal_candidate_missing_for_required_id");
  const content = useId
    ? { mode: "literal", literalId: contentCandidate.id }
    : { mode: "literal", text: expected.text };
  const plan = { version: 1, kind: "edit", operation: expected.operation, target: expected.target };

  if (expected.operation === "insert") {
    plan.layout = expected.layout;
    plan.content = content;
    if (expected.target === "heading_end" || expected.target === "section_end") {
      const wanted = expected.expectedHeading;
      const heading = headingRanges.find(({ lineFrom, text }) => lineFrom === wanted?.lineFrom && text === wanted?.text);
      if (!heading) throw new Error("expected_heading_ast_candidate_missing");
      const candidate = candidates.headings.find(({ id }) => id === heading.id);
      if (!candidate) throw new Error("expected_heading_candidate_missing");
      plan.targetId = candidate.id;
    }
  } else if (expected.operation === "replace_exact") {
    plan.content = content;
    plan.find = expected.find;
    plan.occurrence = expected.occurrence;
  } else if (expected.operation === "rewrite") {
    plan.content = content;
  } else throw new Error("unsupported_expected_operation");

  return plan;
}

const server = await createServer({
  root,
  server: { middlewareMode: true, hmr: false, ws: false },
  cacheDir: path.join(root, ".cache/vite-literal-contract-probe")
});
const report = {
  runId: "literal-contract-p0-rerun-20261023-05",
  caseSetId: manifest.caseSetId,
  manifestSha256: createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"),
  method: "canonical expected intent through local schema, parser, binder, and resolveAiEdit; zero model calls",
  counts: { total: cases.length, passed: 0, failed: 0, schemaExcluded: 0 },
  cases: [],
  checks: []
};

try {
  const [{ runPlannedAiTask }, { resolveAiEdit }, { buildAiIntentCandidates }, { deriveInstructionContract }, { readIntentHeadingRanges }, { buildIntentOutputSchema }] = await Promise.all([
    server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts"),
    server.ssrLoadModule("/src/core/ai/editProposal.ts"),
    server.ssrLoadModule("/src/core/ai/intentContext.ts"),
    server.ssrLoadModule("/src/core/ai/instructionConstraints.ts"),
    server.ssrLoadModule("/src/core/ai/intentTargets.ts"),
    server.ssrLoadModule("/src/core/ai/intentOutputSchema.ts")
  ]);

  for (const testCase of cases) {
    const record = {
      id: testCase.id,
      instruction: testCase.instruction,
      expectedIntent: testCase.expected.intent,
      expectedPatch: testCase.expected.patch ?? null,
      passed: false,
      errorCode: null,
      schemaAllowed: null,
      calls: 0,
      planningCalls: 0,
      contentCalls: 0
    };
    try {
      const context = {
        hasSelection: Boolean(testCase.selection && testCase.selection.to > testCase.selection.from),
        hasCursor: testCase.cursor !== null
      };
      const contract = deriveInstructionContract(testCase.instruction, context);
      const candidates = buildAiIntentCandidates(testCase.instruction, testCase.source, contract);
      const headingRanges = readIntentHeadingRanges(testCase.source);
      const plan = canonicalPlan(testCase, candidates, headingRanges);
      record.plan = plan;
      const selected = context.hasSelection;
      const schema = buildIntentOutputSchema(testCase.instruction, selected, candidates, contract);
      record.schemaAllowed = schemaAllows(schema, plan);
      if (!record.schemaAllowed) report.counts.schemaExcluded += 1;

      const snapshot = {
        documentId: `literal-contract-${testCase.id}`,
        revision: 1,
        content: testCase.source,
        selection: testCase.selection ?? null,
        selectionValid: testCase.selectionValid ?? (testCase.selection ? true : undefined),
        cursor: testCase.cursor ?? null,
        readOnly: false
      };
      const result = await runPlannedAiTask({
        source: testCase.source,
        action: "custom",
        userPrompt: testCase.instruction,
        baseSystemPrompt: "Return the supplied canonical edit plan.",
        actionDefinition: { id: "custom", label: "自定义", prompt: testCase.instruction }
      }, snapshot, {
        isCurrent: () => true,
        abortCurrent: () => undefined,
        invoke: async (_prompt, _systemPrompt, _maxTokens, _onChunk, outputSchema) => {
          record.calls += 1;
          if (outputSchema) record.planningCalls += 1;
          else record.contentCalls += 1;
          if (record.calls > 1) throw Object.assign(new Error("unexpected_content_call"), { code: "unexpected_content_call" });
          if (outputSchema && !schemaAllows(outputSchema, plan)) record.schemaAllowed = false;
          return JSON.stringify(plan);
        }
      });

      const resolved = result.proposal ? resolveAiEdit(result.proposal) : null;
      const expectedPatch = testCase.expected.patch;
      record.patchMatches = equalPatch(resolved, expectedPatch);
      record.callsMatch = record.planningCalls === testCase.expected.calls.planning &&
        record.contentCalls >= testCase.expected.calls.contentMin && record.contentCalls <= testCase.expected.calls.contentMax;
      record.passed = record.schemaAllowed && record.patchMatches && record.callsMatch;
      if (!record.passed) record.errorCode = !record.schemaAllowed ? "schema_excluded" : !resolved ? "resolve_no_patch" : !record.patchMatches ? "binder_patch_mismatch" : "call_count_mismatch";
      record.actualPatch = resolved ? { from: resolved.from, to: resolved.to, expectedText: resolved.expectedText, insertText: resolved.insertText } : null;
    } catch (error) {
      record.errorCode = error?.code ?? error?.name ?? "unknown_error";
      record.error = error?.message ?? String(error);
    }
    if (record.passed) report.counts.passed += 1;
    else report.counts.failed += 1;
    report.cases.push(record);
    console.log(`${record.id} ${record.passed ? "PASS" : "FAIL"} schema=${record.schemaAllowed ?? "n/a"} calls=${record.calls} ${record.errorCode ?? ""}`);
  }

  const instruction = "在标题‘结果’后和标题‘摘要’后都添加‘已完成’";
  const source = "# 结果\n\n# 摘要\n";
  const contract = deriveInstructionContract(instruction, { hasSelection: false, hasCursor: false });
  const candidates = buildAiIntentCandidates(instruction, source, contract);
  const schema = buildIntentOutputSchema(instruction, false, candidates, contract);
  const plan = { version: 1, kind: "clarify", reason: "compound" };
  const allowedKinds = (schema.anyOf ?? []).flatMap((branch) => {
    const kind = branch.properties?.kind;
    return kind?.const ? [kind.const] : kind?.enum ?? [];
  });
  const check = { id: "multi-heading-compound", instruction, headingState: contract.heading.state, issues: contract.issues.map(({ code }) => code), allowedKinds, calls: 0, planningCalls: 0, contentCalls: 0, passed: false };
  check.schemaAllowsClarify = schemaAllows(schema, plan);
  try {
    await runPlannedAiTask({
      source,
      action: "custom",
      userPrompt: instruction,
      baseSystemPrompt: "Return a clarification for compound heading targets.",
      actionDefinition: { id: "custom", label: "自定义", prompt: instruction }
    }, {
      documentId: "literal-contract-multi-heading",
      revision: 1,
      content: source,
      selection: null,
      selectionValid: true,
      cursor: null,
      readOnly: false
    }, {
      isCurrent: () => true,
      abortCurrent: () => undefined,
      invoke: async (_prompt, _systemPrompt, _maxTokens, _onChunk, outputSchema) => {
        check.calls += 1;
        if (outputSchema) check.planningCalls += 1;
        else check.contentCalls += 1;
        return JSON.stringify(plan);
      }
    });
    check.errorCode = "expected_clarification_not_thrown";
  } catch (error) {
    check.error = error?.message ?? String(error);
  }
  check.passed = check.headingState === "ambiguous" && check.issues.includes("compound") &&
    check.schemaAllowsClarify && !allowedKinds.includes("edit") && !allowedKinds.includes("answer") &&
    check.planningCalls === 1 && check.contentCalls === 0 && Boolean(check.error);
  report.checks.push(check);
  console.log(`multi-heading-compound ${check.passed ? "PASS" : "FAIL"} calls=${check.calls} content=${check.contentCalls}`);

  const unquotedInstruction = "append hello to the end of the document";
  const unquotedPlan = {
    version: 1,
    kind: "edit",
    operation: "insert",
    target: "document_end",
    layout: "block",
    content: { mode: "literal", text: unquotedInstruction }
  };
  const badAppend = { id: "unquoted-english-append-is-not-payload", instruction: unquotedInstruction, calls: 0, planningCalls: 0, contentCalls: 0, returnedProposal: false, passed: false };
  try {
    const result = await runPlannedAiTask({
      source: "Keep existing.",
      action: "custom",
      userPrompt: unquotedInstruction,
      baseSystemPrompt: "Return the provided test plan.",
      actionDefinition: { id: "custom", label: "自定义", prompt: unquotedInstruction }
    }, {
      documentId: "literal-contract-unquoted-append",
      revision: 1,
      content: "Keep existing.",
      selection: null,
      selectionValid: true,
      cursor: null,
      readOnly: false
    }, {
      isCurrent: () => true,
      abortCurrent: () => undefined,
      invoke: async (_prompt, _systemPrompt, _maxTokens, _onChunk, outputSchema) => {
        badAppend.calls += 1;
        if (outputSchema) badAppend.planningCalls += 1;
        else badAppend.contentCalls += 1;
        badAppend.schemaAllowsMisclassifiedPlan = outputSchema ? schemaAllows(outputSchema, unquotedPlan) : null;
        return JSON.stringify(unquotedPlan);
      }
    });
    badAppend.returnedProposal = Boolean(result.proposal);
    badAppend.errorCode = "unsafe_proposal_returned";
  } catch (error) {
    badAppend.error = error?.message ?? String(error);
  }
  badAppend.passed = !badAppend.returnedProposal && badAppend.planningCalls === 1 && badAppend.contentCalls === 0 &&
    /没有逐字保留您提供的新增内容|literal_mismatch|字面/iu.test(badAppend.error ?? "");
  report.checks.push(badAppend);
  console.log(`unquoted-english-append ${badAppend.passed ? "PASS" : "FAIL"} calls=${badAppend.calls} content=${badAppend.contentCalls}`);
} finally {
  await server.close();
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...report.counts, reportPath }, null, 2));
if (report.counts.failed || report.checks.some(({ passed }) => !passed)) process.exitCode = 1;
