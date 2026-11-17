/** Captures the exact production request-body shape for schema and non-schema transports. */
export function auditTransportRequestBodies({ buildChatRequest, modelId, outputSchema, hash }) {
  if (typeof buildChatRequest !== "function" || typeof hash !== "function" || !outputSchema) {
    throw new Error("Production HTTP request builder and planner schema are required for the transport audit");
  }

  const common = { model: modelId, prompt: "transport audit", systemPrompt: "intent audit", maxTokens: 384, contextTokens: 4096 };
  const managedStructured = buildChatRequest({ ...common, source: "managed", outputSchema });
  const managedUnstructured = buildChatRequest({ ...common, source: "managed" });
  const ollama = buildChatRequest({ ...common, source: "ollama" });
  const schemaText = JSON.stringify(outputSchema);
  const schemaSha256 = hash(schemaText);

  if (managedStructured.isOllama || managedStructured.pathname !== "/v1/chat/completions" ||
      managedStructured.body.temperature !== 0 || managedStructured.body.response_format?.type !== "json_object" ||
      JSON.stringify(managedStructured.body.response_format.schema) !== schemaText) {
    throw new Error("Managed structured requests must pass the exact output schema with temperature=0");
  }
  if (Object.hasOwn(managedUnstructured.body, "temperature") || Object.hasOwn(managedUnstructured.body, "response_format")) {
    throw new Error("Managed non-schema requests must keep the existing sampling configuration");
  }
  if (!ollama.isOllama || ollama.pathname !== "/api/chat" || Object.hasOwn(ollama.body, "temperature") ||
      Object.hasOwn(ollama.body.options ?? {}, "temperature")) {
    throw new Error("Ollama request configuration must remain unchanged");
  }

  const summarize = (request) => ({
    source: request.isOllama ? "ollama" : "managed",
    pathname: request.pathname,
    bodyKeys: Object.keys(request.body).sort(),
    model: request.body.model,
    stream: request.body.stream,
    temperature: Object.hasOwn(request.body, "temperature") ? request.body.temperature : null,
    responseFormatType: request.body.response_format?.type ?? null,
    responseSchemaSha256: request.body.response_format?.schema ? hash(JSON.stringify(request.body.response_format.schema)) : null,
    options: request.body.options ? { keys: Object.keys(request.body.options).sort(), ...request.body.options } : null
  });
  const requests = {
    managedStructured: summarize(managedStructured),
    managedUnstructured: summarize(managedUnstructured),
    ollama: summarize(ollama)
  };
  return {
    schemaSha256,
    requests,
    configurationSha256: hash(JSON.stringify(requests)),
    assertions: {
      managedStructuredUsesGreedySampling: requests.managedStructured.temperature === 0,
      managedUnstructuredHasNoSamplingOverride: requests.managedUnstructured.temperature === null,
      ollamaHasNoSamplingOverride: requests.ollama.temperature === null
    }
  };
}
