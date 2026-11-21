const expectedIds = Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`);
const safeCursorIds = ["E15", "E16"];

function completeCaseSet(report, { caseManifestSha256, sourceManifestSha256 } = {}) {
  const actualIds = report?.cases?.map(({ id }) => id) ?? [];
  return report?.expectedTotal === 16 && report?.actualTotal === 16 && report?.notRunIds?.length === 0 &&
    JSON.stringify(actualIds) === JSON.stringify(expectedIds) && report?.errors?.length === 0 &&
    report?.source?.stableAfter === true &&
    (!caseManifestSha256 || report?.tools?.caseManifestSha256 === caseManifestSha256) &&
    (!sourceManifestSha256 || report?.source?.manifestSha256 === sourceManifestSha256);
}

function safeInfrastructure(report) {
  return report?.model?.newModelCalls === 0 && report?.model?.deploymentAllowed === false &&
    report?.network?.used === false && report?.network?.fetchAttempts === 0 &&
    report?.cases?.every(item => item.newModelCalls === 0 && item.evidence?.controlled === true);
}

function isSafeCursorPreconditionRejection(item, id) {
  const evidence = item?.evidence;
  return item.id === id && item.status === "failed" && item.passed === false && item.newModelCalls === 0 &&
    item.expected?.rejected === true && item.expected?.proposal === false && item.expected?.planningCalls === 1 &&
    item.expected?.contentCalls === 0 && item.expected?.failure?.stage === "binding" &&
    item.expected?.failure?.name === "Error" && item.expected?.failure?.code === null &&
    item.expected?.failure?.messageIncludes === "目标位置切开了换行符或 Unicode 字符" &&
    evidence?.outcome === "rejected" && evidence?.newModelCalls === 0 &&
    evidence?.planningCalls === 0 && evidence?.contentCalls === 0 && evidence?.proposal === null &&
    Array.isArray(evidence?.invocations) && evidence.invocations.length === 0 &&
    Array.isArray(evidence?.requestStarts) && evidence.requestStarts.length === 0 && evidence?.abortCalls === 0 &&
    evidence?.diagnostic?.name === "PlanValidationError" && evidence?.diagnostic?.code === "cursor_required";
}

export function assessControlledB8Report(report, bindings = {}) {
  const actualIds = report?.cases?.map(({ id }) => id) ?? [];
  const complete = completeCaseSet(report, bindings);
  const infrastructureClean = safeInfrastructure(report);
  const strictPassed = report?.status === "passed" && report.cases?.every(item => item.status === "passed" && item.passed === true);
  const passed = complete && infrastructureClean && strictPassed;
  return {
    status: passed ? "controlled-passed" : complete ? "controlled-failed" : "controlled-incomplete",
    expectedCases: 16, actualCases: report?.actualTotal ?? 0,
    strictPasses: report?.cases?.filter(item => item.status === "passed" && item.passed === true).length ?? 0,
    modelCalls: Number.isFinite(report?.model?.newModelCalls) ? report.model.newModelCalls : null,
    networkUsed: report?.network?.used ?? null, fetchAttempts: report?.network?.fetchAttempts ?? null,
    failedCaseIds: report?.cases?.filter(item => item.status !== "passed" || item.passed !== true).map(item => item.id) ?? [],
    notRunIds: report?.notRunIds ?? []
  };
}

export function assessControlledB8Supplement(report, bindings = {}) {
  const complete = completeCaseSet(report, bindings);
  const infrastructureClean = safeInfrastructure(report);
  const byId = new Map(report?.cases?.map(item => [item.id, item]) ?? []);
  const strictPassIds = report?.cases?.filter(item => item.status === "passed" && item.passed === true).map(item => item.id) ?? [];
  const strictFailedIds = report?.cases?.filter(item => item.status !== "passed" || item.passed !== true).map(item => item.id) ?? [];
  const ordinaryCasesPass = expectedIds.filter(id => !safeCursorIds.includes(id)).every(id => {
    const item = byId.get(id);
    return item?.status === "passed" && item?.passed === true;
  });
  const safeCursorPreconditions = safeCursorIds.every(id => isSafeCursorPreconditionRejection(byId.get(id), id));
  const passed = complete && infrastructureClean && ordinaryCasesPass && safeCursorPreconditions &&
    JSON.stringify(strictFailedIds) === JSON.stringify(safeCursorIds);
  return {
    status: passed ? "controlled-safety-passed" : complete ? "controlled-safety-failed" : "controlled-incomplete",
    gate: "strict-cases-plus-verified-cursor-precondition-safety-v1",
    expectedCases: 16, actualCases: report?.actualTotal ?? 0, strictPasses: strictPassIds.length,
    strictDenominator: 16, strictStatus: report?.status ?? "missing",
    strictFailedIds,
    supplementalSafeIds: passed ? safeCursorIds : [],
    oldOracle: Object.fromEntries(safeCursorIds.map(id => [id, "not-applicable: frozen oracle expects planning/binding, actual safe precondition rejection occurs before planning"])),
    modelCalls: Number.isFinite(report?.model?.newModelCalls) ? report.model.newModelCalls : null,
    networkUsed: report?.network?.used ?? null, fetchAttempts: report?.network?.fetchAttempts ?? null,
    notRunIds: report?.notRunIds ?? []
  };
}

export function assessControlledCandidate(report, bindings = {}) {
  const strict = assessControlledB8Report(report, bindings);
  const supplement = assessControlledB8Supplement(report, bindings);
  const useStrict = strict.status === "controlled-passed";
  const passed = useStrict || supplement.status === "controlled-safety-passed";
  return {
    status: useStrict ? "controlled-passed" : passed ? "controlled-safety-passed" : strict.status === "controlled-incomplete" ? "controlled-incomplete" : "controlled-safety-failed",
    gate: useStrict ? "strict-16-of-16" : supplement.gate,
    strict,
    supplement: !useStrict && passed ? supplement : null
  };
}

export function controlledCandidateRecord(assessment, { sourceManifestSha256, canonicalSourceManifestSha256, caseManifestSha256 }) {
  return {
    schemaVersion: 1, type: "controlled-candidate-assessment", status: assessment.status, gate: assessment.gate,
    strictOracle: assessment.strict,
    supplementalSafety: assessment.supplement,
    sourceManifestSha256, canonicalSourceManifestSha256, caseManifestSha256,
    interpretation: "The controlled-report strict oracle remains unchanged; only an exact no-proposal, no-invocation cursor precondition rejection can supplement the E15/E16 gate."
  };
}
