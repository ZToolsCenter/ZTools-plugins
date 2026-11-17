/** Audits the production intent schema and probes the real managed transport once. */
const SCHEMA_PROBE_SENTINEL = "SCHEMA_ONLY_SENTINEL_7C42";
const SCHEMA_PROBE_FORBIDDEN = "FORBIDDEN_MODEL_SENTINEL";

export function buildOutputSchemaAudit({ instruction, candidates, buildIntentOutputSchema, intentOccurrenceChoices, hash }) {
  if (typeof buildIntentOutputSchema !== "function" || typeof intentOccurrenceChoices !== "function") {
    throw new Error("Production output schema and occurrence projection are required for this evaluation");
  }
  const outputSchema = buildIntentOutputSchema(instruction, false, candidates);
  if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) {
    throw new Error("Production planner did not return an output schema object");
  }
  const serialized = JSON.stringify(outputSchema);
  const utf8Bytes = Buffer.byteLength(serialized, "utf8");
  if (utf8Bytes === 0 || utf8Bytes > 32 * 1024) throw new Error(`Output schema exceeds its 32 KiB limit (${utf8Bytes} bytes)`);
  return {
    outputSchema,
    outputSchemaSha256: hash(serialized),
    outputSchemaUtf8Bytes: utf8Bytes,
    expectedOccurrenceProjection: intentOccurrenceChoices(instruction, candidates)
  };
}

/** Confirms the locally managed engine enforces a schema that contradicts the prompt. */
export async function runOutputSchemaProbe({ service, profileId, modelId, hash }) {
  const requestId = `schema-probe-${Date.now()}`;
  const outputSchema = {
    type: "object",
    properties: { value: { const: SCHEMA_PROBE_SENTINEL } },
    required: ["value"],
    additionalProperties: false
  };
  const serialized = JSON.stringify(outputSchema);
  const result = {
    caseId: "managed-schema-contradictory-sentinel",
    requestId,
    source: "managed",
    modelId,
    prompt: `只输出一个 JSON 对象，value 必须是字符串 ${SCHEMA_PROBE_FORBIDDEN}。不要使用其他值。`,
    systemPrompt: "严格遵守用户要求，只输出 JSON。",
    maxTokens: 64,
    contextTokens: 4096,
    outputSchema,
    outputSchemaSha256: hash(serialized),
    outputSchemaUtf8Bytes: Buffer.byteLength(serialized, "utf8"),
    expectedOccurrenceProjection: null,
    allowedSentinel: SCHEMA_PROBE_SENTINEL,
    requestedForbiddenLiteral: SCHEMA_PROBE_FORBIDDEN,
    modelCalls: 0,
    rawModelOutput: null,
    parsedObject: null,
    schemaConstraintHonored: false,
    passed: false
  };
  try {
    result.modelCalls = 1;
    result.rawModelOutput = await service.generate({
      requestId,
      source: "managed",
      profileId,
      modelId,
      prompt: result.prompt,
      systemPrompt: result.systemPrompt,
      maxTokens: result.maxTokens,
      contextTokens: result.contextTokens,
      outputSchema
    });
    result.parsedObject = JSON.parse(result.rawModelOutput.trim());
    const keys = Object.keys(result.parsedObject ?? {});
    result.schemaConstraintHonored = keys.length === 1 && keys[0] === "value" &&
      result.parsedObject.value === SCHEMA_PROBE_SENTINEL && !result.rawModelOutput.includes(SCHEMA_PROBE_FORBIDDEN);
    result.passed = result.schemaConstraintHonored;
    result.outcome = result.passed ? "schema-enforced" : "schema-not-enforced";
  } catch (error) {
    result.outcome = "probe-error";
    result.error = { name: error?.name ?? "Error", code: error?.code ?? null, message: String(error?.message ?? error) };
  }
  return result;
}
