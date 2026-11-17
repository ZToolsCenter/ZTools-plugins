import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hashFile = (filePath) => sha256(fs.readFileSync(filePath));
const json = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

export function probeLoopbackListen({ createServer = net.createServer, host = "127.0.0.1" } = {}) {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    server.once("error", (error) => finish({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }));
    server.listen({ host, port: 0 }, () => server.close((error) => finish(error
      ? { ok: false, code: error.code ?? null, message: String(error.message ?? error) }
      : { ok: true, host })));
  });
}

function readPriorAttempt(evaluationRoot) {
  const runDirectory = path.join(evaluationRoot, "runs/light/B-common-b6-light-r1");
  const reportPath = path.join(runDirectory, "run-report.json");
  const ledgerPath = path.join(evaluationRoot, "execution-ledger.json");
  const report = json(reportPath);
  const ledger = json(ledgerPath);
  const entries = fs.readdirSync(path.join(runDirectory, "records"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => json(path.join(runDirectory, "records", name)));
  const calls = entries.flatMap((entry) => entry.calls ?? []);
  const modelResponses = calls.filter((call) => call.error == null && typeof call.raw === "string").length;
  const allCasesFailedWithoutOutput = report.cases?.length === 87
    && report.cases.every((item) => item.status === "failed")
    && report.summary?.scores?.userTask?.pass === 0;
  const allObservedCallsEperm = calls.length > 0 && calls.every((call) => call.error?.code === "EPERM" && call.raw === null);
  const ledgerEntry = ledger.runs?.find((run) => run.runId === "common-b6-light-r1");
  if (report.expectedTotal !== 87 || report.executedTotal !== 87 || !allCasesFailedWithoutOutput || !allObservedCallsEperm || modelResponses !== 0) {
    throw new Error("The prior sandbox attempt does not match the recorded zero-inference EPERM failure; refusing to bind a new attempt.");
  }
  if (ledgerEntry?.status !== "execution-complete") throw new Error("Prior attempt ledger state changed; refusing to silently reinterpret it.");
  return {
    runId: "common-b6-light-r1",
    classification: "infrastructure-invalid-no-model-response",
    legacyLedgerStatus: ledgerEntry.status,
    legacyRunnerStatus: report.status,
    harnessCasesEmitted: report.executedTotal,
    expectedCases: report.expectedTotal,
    modelResponses,
    failedCaseCount: report.cases.length,
    callsAttempted: calls.length,
    callErrorCodes: [...new Set(calls.map((call) => call.error?.code ?? "none"))],
    report: {
      path: ".cache/acceptance/ai-common-failures/v1/runs/light/B-common-b6-light-r1/run-report.json",
      sha256: hashFile(reportPath)
    },
    ledger: { path: ".cache/acceptance/ai-common-failures/v1/execution-ledger.json", sha256: hashFile(ledgerPath) }
  };
}

export function createAuthorizedAttempt({ pluginRoot, evaluationRoot, attemptId, config, derived }) {
  const attemptRoot = path.join(evaluationRoot, attemptId);
  const attemptManifestPath = path.join(attemptRoot, "attempt-manifest.json");
  const freezePath = path.join(evaluationRoot, "freeze-manifest.json");
  const prior = readPriorAttempt(evaluationRoot);
  const scheduleSha256 = sha256(JSON.stringify(config.schedule));
  const expected = {
    schemaVersion: 1,
    attemptId,
    createdFor: "authorized rerun after infrastructure failure; model evidence only",
    priorAttempt: prior,
    frozenInputs: {
      freezeManifestSha256: hashFile(freezePath),
      derivedCaseManifestSha256: derived.caseManifestSha256,
      scheduleSha256,
      schedule: config.schedule
    },
    b6SnapshotManifestSha256: hashFile(path.join(evaluationRoot, "snapshots/B6/source-manifest.json")),
    boundary: "New attempt outputs only. The original freeze, reports, records, ledger, and model comparison results remain unchanged."
  };
  fs.mkdirSync(attemptRoot, { recursive: true });
  if (fs.existsSync(attemptManifestPath)) {
    const existing = json(attemptManifestPath);
    for (const key of ["attemptId", "priorAttempt", "frozenInputs", "b6SnapshotManifestSha256", "boundary"]) {
      if (JSON.stringify(existing[key]) !== JSON.stringify(expected[key])) throw new Error(`Authorized attempt manifest binding changed: ${key}`);
    }
    return { attemptRoot, attemptManifestPath, manifest: existing, created: false };
  }
  fs.writeFileSync(attemptManifestPath, `${JSON.stringify(expected, null, 2)}\n`, { flag: "wx" });
  return { attemptRoot, attemptManifestPath, manifest: expected, created: true };
}

export function prepareAttemptProfile({ pluginRoot, attemptRoot, sourceProfileRoot, targetDirectory, outputProfileId, localRuntimeDirectory, viteCacheDirectory }) {
  const targetRoot = path.join(attemptRoot, "profiles", targetDirectory);
  if (fs.existsSync(targetRoot)) {
    const configPath = path.join(targetRoot, "tool-source/config.json");
    const config = json(configPath);
    const manifest = json(path.join(targetRoot, "tool-manifest.json"));
    const expectedOutputRoot = path.relative(pluginRoot, path.join(attemptRoot, "runs", outputProfileId)).split(path.sep).join("/");
    if (config.outputRoot !== expectedOutputRoot || config.localAiDirectory !== localRuntimeDirectory || config.viteCacheRoot !== viteCacheDirectory
      || manifest.configSha256 !== hashFile(configPath) || manifest.files?.["config.json"]?.sha256 !== hashFile(configPath)) {
      throw new Error(`Prepared attempt profile binding changed: ${targetDirectory}`);
    }
    return { profileRoot: targetRoot, configPath, configSha256: hashFile(configPath), toolManifestSha256: hashFile(path.join(targetRoot, "tool-manifest.json")), created: false };
  }
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(sourceProfileRoot, targetRoot, { recursive: true, errorOnExist: true, force: false });
  const toolRoot = path.join(targetRoot, "tool-source");
  const configPath = path.join(toolRoot, "config.json");
  const configBytes = fs.readFileSync(configPath);
  const config = JSON.parse(configBytes.toString("utf8"));
  config.outputRoot = path.relative(pluginRoot, path.join(attemptRoot, "runs", outputProfileId)).split(path.sep).join("/");
  config.localAiDirectory = localRuntimeDirectory;
  config.viteCacheRoot = viteCacheDirectory;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: "w" });
  const configHash = hashFile(configPath);
  const manifestPath = path.join(targetRoot, "tool-manifest.json");
  const manifest = json(manifestPath);
  manifest.configSha256 = configHash;
  manifest.files["config.json"] = { sha256: configHash, bytes: fs.statSync(configPath).size };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
  return {
    profileRoot: targetRoot,
    configPath,
    configSha256: configHash,
    toolManifestSha256: hashFile(manifestPath),
    originalToolManifestSha256: manifest.derivedFromToolManifestSha256,
    created: true
  };
}

export function assessExecutionCompletion({ report, records, exitCode, expectedCases = 87 }) {
  const cases = report.cases ?? [];
  const calls = (records ?? []).flatMap((record) => record.calls ?? []);
  const successfulResponses = calls.filter((call) => call.error == null && typeof call.raw === "string").length;
  const allCasesEperm = cases.length === expectedCases && cases.every((item) => item.evaluation?.errorIdentity === "EPERM");
  if (allCasesEperm && successfulResponses === 0) {
    return { status: "infrastructure-invalid", reason: "systematic-EPERM-before-model-response", successfulResponses, runnerExitCode: exitCode ?? null };
  }
  if (successfulResponses === 0) {
    return { status: "infrastructure-invalid", reason: "no-model-response-evidence", successfulResponses, runnerExitCode: exitCode ?? null };
  }
  const complete = report.executedTotal === expectedCases
    && report.expectedTotal === expectedCases
    && cases.length === expectedCases
    && report.notRunIds?.length === 0
    && report.source?.snapshotStableAfter === true
    && report.toolSnapshot?.stableAfter === true
    && !report.error
    && (report.cleanup?.errors?.length ?? 0) === 0;
  return {
    status: complete ? "execution-complete" : "incomplete",
    reason: complete ? null : "incomplete-or-unstable-run-evidence",
    runnerExitCode: exitCode ?? null,
    successfulResponses
  };
}
