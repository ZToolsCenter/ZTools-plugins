/** One-shot prompt preview: inspect raw JSON and expected fields, not production acceptance. */
import { buildOutputSchemaAudit } from "./ai-replace-intent-output-schema.mjs";

export async function runIntentPromptPreview({
  cases,
  quickstart,
  service,
  profileId,
  modelId,
  buildAiIntentCandidates,
  buildIntentSystemPrompt,
  buildIntentPlanningPrompt,
  buildIntentOutputSchema,
  intentOccurrenceChoices,
  schemaAware = false,
  calculateLocalAiBudget,
  hash,
  onRecord
}) {
  const records = [];
  const prepared = cases.map((item) => {
    const source = `${quickstart}${item.appendedSource}`;
    const candidates = buildAiIntentCandidates(item.instruction, source);
    const systemPrompt = buildIntentSystemPrompt(false, candidates);
    const planningPrompt = buildIntentPlanningPrompt(item.instruction, false, candidates);
    const budget = calculateLocalAiBudget(planningPrompt, systemPrompt, 384);
    const schema = schemaAware ? buildOutputSchemaAudit({
      instruction: item.instruction,
      candidates,
      buildIntentOutputSchema,
      intentOccurrenceChoices,
      hash
    }) : null;
    return { item, candidates, systemPrompt, planningPrompt, budget, source, schema };
  });
  for (const { item, candidates, systemPrompt, planningPrompt, budget, source, schema } of prepared) {
    const requestId = `prompt-preview-${item.id}-${Date.now()}`;
    const record = {
      caseId: item.id,
      instruction: item.instruction,
      sourceSha256: hash(source),
      candidates,
      systemPrompt,
      systemPromptSha256: hash(systemPrompt),
      planningPrompt,
      planningPromptSha256: hash(planningPrompt),
      ...(schema ?? {}),
      budget,
      requestId,
      modelCalls: 0,
      rawModelOutput: null,
      rawJsonComplete: false,
      expectedProtocolShapeComplete: false,
      fieldsMatchExpected: false,
      fieldErrors: []
    };
    const startedAt = Date.now();
    try {
      record.modelCalls = 1;
      record.rawModelOutput = await service.generate({
        requestId,
        source: "managed",
        profileId,
        modelId,
        prompt: planningPrompt,
        systemPrompt,
        maxTokens: budget.maxTokens,
        contextTokens: 4096,
        ...(schema ? { outputSchema: schema.outputSchema } : {})
      });
      const evaluation = evaluateOutput(record.rawModelOutput, item, candidates);
      record.rawJsonComplete = evaluation.rawJsonComplete;
      record.expectedProtocolShapeComplete = evaluation.expectedProtocolShapeComplete;
      record.fieldsMatchExpected = evaluation.fieldsMatchExpected;
      record.fieldErrors = evaluation.fieldErrors;
      record.parsedObject = evaluation.parsedObject;
    } catch (error) {
      record.error = { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
    }
    record.elapsedMs = Date.now() - startedAt;
    records.push(record);
    onRecord?.(record, records);
  }
  return {
    status: "preview_complete",
    scope: "raw-output-only",
    modelCalls: records.reduce((total, record) => total + record.modelCalls, 0),
    rawJsonComplete: records.filter((record) => record.rawJsonComplete).length,
    expectedProtocolShapeComplete: records.filter((record) => record.expectedProtocolShapeComplete).length,
    fieldsMatchExpected: records.filter((record) => record.fieldsMatchExpected).length,
    totalCases: records.length,
    records
  };
}

function evaluateOutput(output, item, candidates) {
  const fieldErrors = [];
  let parsedObject = null;
  if (typeof output !== "string" || !output.trim() || output.trim().startsWith("```") || output.trim().startsWith("~~~")) {
    return { rawJsonComplete: false, expectedProtocolShapeComplete: false, fieldsMatchExpected: false, fieldErrors: ["output_not_single_json_object"], parsedObject };
  }
  try { parsedObject = JSON.parse(output.trim()); }
  catch { return { rawJsonComplete: false, expectedProtocolShapeComplete: false, fieldsMatchExpected: false, fieldErrors: ["invalid_or_incomplete_json"], parsedObject }; }

  const rootKeys = ["version", "kind", "operation", "target", "find", "findId", "occurrence", "content"];
  if (!isRecord(parsedObject) || Object.keys(parsedObject).some((key) => !rootKeys.includes(key))) {
    fieldErrors.push("unexpected_top_level_fields");
  }
  if (parsedObject?.version !== 1) fieldErrors.push("version_mismatch");
  if (parsedObject?.kind !== "edit") fieldErrors.push("kind_mismatch");
  if (parsedObject?.operation !== item.operation) fieldErrors.push("operation_mismatch");
  if (parsedObject?.target !== "document") fieldErrors.push("target_mismatch");
  if (parsedObject?.occurrence !== item.occurrence) fieldErrors.push("occurrence_mismatch");

  const content = parsedObject?.content;
  const hasLiteralText = isRecord(content) && Object.hasOwn(content, "text");
  const hasLiteralId = isRecord(content) && Object.hasOwn(content, "literalId");
  if (!isRecord(content) || Object.keys(content).some((key) => !["mode", "text", "literalId"].includes(key)) || hasLiteralText === hasLiteralId) {
    fieldErrors.push("content_shape_mismatch");
  }
  if (content?.mode !== "literal") fieldErrors.push("content_mode_mismatch");
  const expectedContent = item.replacement;
  const actualContent = content?.text ?? candidates.literals.find((entry) => entry.id === content?.literalId)?.text;
  if (actualContent !== expectedContent) fieldErrors.push("replacement_literal_mismatch");

  const hasFind = Object.hasOwn(parsedObject ?? {}, "find");
  const hasFindId = Object.hasOwn(parsedObject ?? {}, "findId");
  if (hasFind === hasFindId) fieldErrors.push("find_selector_missing_or_ambiguous");
  const actualFind = hasFind ? parsedObject.find : candidates.literals.find((entry) => entry.id === parsedObject.findId)?.text;
  if (actualFind !== item.find) fieldErrors.push("find_literal_mismatch");
  const expectedProtocolShapeComplete = isCompleteReplaceShape(parsedObject);
  return {
    rawJsonComplete: true,
    expectedProtocolShapeComplete,
    fieldsMatchExpected: fieldErrors.length === 0 && expectedProtocolShapeComplete,
    fieldErrors,
    parsedObject
  };
}

function isCompleteReplaceShape(value) {
  if (!isRecord(value)) return false;
  const allowed = new Set(["version", "kind", "operation", "target", "find", "findId", "occurrence", "content"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  const required = ["version", "kind", "operation", "target", "occurrence", "content"];
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.hasOwn(value, "find") === Object.hasOwn(value, "findId")) return false;
  const content = value.content;
  if (!isRecord(content) || content.mode !== "literal" || Object.keys(content).some((key) => !["mode", "text", "literalId"].includes(key))) return false;
  return Object.hasOwn(content, "text") !== Object.hasOwn(content, "literalId");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
