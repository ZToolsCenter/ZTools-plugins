export function intentSummary(intent) {
  if (!intent) return null;
  if (intent.kind !== "edit") return intent;
  return {
    ...intent,
    content: intent.content?.mode === "literal"
      ? { mode: "literal", text: intent.content.text ?? null, literalId: intent.content.literalId ?? null }
      : intent.content
  };
}

export function runPatchOracle(source, patch, oracle, hash) {
  const finalSource = source.slice(0, patch.from) + patch.insertText + source.slice(patch.to);
  return {
    finalSha256: hash(finalSource),
    expectedFinalSha256: oracle.expectedFinalSha256,
    exactFinalDocumentMatch: finalSource === oracle.expectedFinalText,
    patchChangesOnlyOracleTarget: finalSource === oracle.expectedFinalText,
    patchWindowBefore: source.slice(Math.max(0, patch.from - 32), Math.min(source.length, patch.to + 48)),
    patchWindowAfter: finalSource.slice(Math.max(0, patch.from - 32), Math.min(finalSource.length, patch.from + patch.insertText.length + 48)),
    changedRange: { from: patch.from, to: patch.to, insertText: patch.insertText },
    expectedChangedRanges: oracle.expectedChangedRanges
  };
}
