/** Replays a captured planner JSON through the production task runner without model access. */
export async function replayCapturedPlan({
  runPlannedAiTask,
  resolveAiEdit,
  item,
  source,
  rawModelOutput,
  oracle,
  hashValue,
  expectedOutputSchema
}) {
  let invocationCount = 0;
  let unexpectedInvocation = null;
  let replayOutputSchema = null;
  const snapshot = {
    documentId: `acceptance-${item.id}`,
    revision: 1,
    content: source,
    selection: null,
    selectionValid: false,
    cursor: 0,
    readOnly: false
  };

  try {
    const result = await runPlannedAiTask({
      source,
      action: "custom",
      userPrompt: item.instruction,
      baseSystemPrompt: "你是中文 Markdown 助手，只输出可执行计划。",
      actionDefinition: { id: "custom", label: "自定义", prompt: item.instruction }
    }, snapshot, {
      isCurrent: () => true,
      abortCurrent: () => undefined,
      maxCalls: 2,
      maxDurationMs: 15_000,
      invoke: async (_prompt, _systemPrompt, _maxTokens, _onChunk, outputSchema) => {
        invocationCount += 1;
        if (invocationCount === 1) replayOutputSchema = outputSchema ?? null;
        if (invocationCount > 1) {
          unexpectedInvocation = "Production runner requested content generation after replaying the captured plan";
          throw new Error(unexpectedInvocation);
        }
        return rawModelOutput;
      }
    });

    const proposal = result.proposal ?? null;
    const patch = proposal?.patch ?? null;
    const resolved = proposal ? resolveAiEdit(proposal) : null;
    return {
      status: proposal ? "proposal-created" : "no-proposal",
      replayInvocationCount: invocationCount,
      noGenerationInvocation: invocationCount === 1 && unexpectedInvocation === null,
      plannerOutputSchemaPassed: Boolean(replayOutputSchema),
      plannerOutputSchemaMatchesExpected: Boolean(replayOutputSchema) && JSON.stringify(replayOutputSchema) === JSON.stringify(expectedOutputSchema),
      unexpectedInvocation,
      proposalMode: proposal?.mode ?? null,
      proposalSummary: proposal?.summary ?? null,
      proposalPatch: patch,
      proposalText: proposal?.text ?? null,
      editResolved: Boolean(resolved),
      finalDocumentSha256: resolved ? hashValue(resolved.content) : null,
      expectedDocumentSha256: oracle.expectedFinalSha256,
      fullDocumentExactOracle: resolved?.content === oracle.expectedFinalText,
      resolvedPatch: resolved ? {
        from: resolved.from,
        to: resolved.to,
        expectedText: resolved.expectedText,
        insertText: resolved.insertText
      } : null,
      proposalIntegrityGateAccepted: Boolean(proposal)
    };
  } catch (error) {
    return {
      status: "runner-error",
      replayInvocationCount: invocationCount,
      noGenerationInvocation: invocationCount === 1 && unexpectedInvocation === null,
      plannerOutputSchemaPassed: Boolean(replayOutputSchema),
      plannerOutputSchemaMatchesExpected: Boolean(replayOutputSchema) && JSON.stringify(replayOutputSchema) === JSON.stringify(expectedOutputSchema),
      unexpectedInvocation,
      proposalIntegrityGateAccepted: false,
      error: { name: error?.name ?? "Error", message: String(error?.message ?? error) }
    };
  }
}
