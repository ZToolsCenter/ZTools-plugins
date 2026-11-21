import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assessControlledB8Report, assessControlledB8Supplement } from "./b8-controlled-assessment.mjs";

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

export function verifyRun03ParentLineage(evaluationRoot, attempt) {
  const parentRoot = path.join(evaluationRoot, "authorized-run-02");
  const parentManifestPath = path.join(parentRoot, "attempt-manifest.json");
  const parentLedgerPath = path.join(parentRoot, "execution-ledger.json");
  const parentLedgerEventsPath = path.join(parentRoot, "execution-ledger.jsonl");
  const parentReportPath = path.join(parentRoot, "runs/balanced/B-controlled-common-b8-balanced-r1/controlled-report.json");
  const inputs = attempt.inputs?.previousAttempt;
  if (!inputs || inputs.attemptId !== "authorized-run-02" || sha256(fs.readFileSync(parentManifestPath)) !== inputs.manifestSha256 ||
      sha256(fs.readFileSync(parentLedgerPath)) !== inputs.ledgerSha256 || sha256(fs.readFileSync(parentLedgerEventsPath)) !== inputs.eventLedgerSha256 ||
      sha256(fs.readFileSync(parentReportPath)) !== inputs.controlledReportSha256) {
    throw new Error("B8 run 03 parent attempt, ledger, or original controlled report changed.");
  }
  const lines = fs.readFileSync(parentLedgerEventsPath, "utf8").trimEnd().split("\n");
  const stopBytes = Buffer.from(`${lines.at(-1)}\n`);
  const stopEvent = JSON.parse(lines.at(-1));
  if (sha256(stopBytes) !== inputs.stopRecordSha256 || stopEvent.eventHash !== inputs.stopEventHash ||
      stopEvent.type !== "attempt-stopped" || stopEvent.data?.status !== "controlled-failed") {
    throw new Error("B8 run 03 must link to the original run 02 controlled-stop record.");
  }
  const ledger = readJson(parentLedgerPath);
  if (ledger.status !== "controlled-failed" || ledger.completedGroups?.length !== 1 ||
      ledger.completedGroups[0]?.runId !== "common-b8-balanced-r1" || ledger.completedGroups[0]?.real ||
      fs.readFileSync(parentLedgerEventsPath, "utf8").includes('"type":"real-started"')) {
    throw new Error("B8 run 03 parent must remain a pre-inference controlled-only stop.");
  }
  const report = readJson(parentReportPath);
  const strict = assessControlledB8Report(report, {
    caseManifestSha256: attempt.inputs.caseManifestSha256,
    sourceManifestSha256: inputs.controlledSourceManifestSha256
  });
  const supplement = assessControlledB8Supplement(report, {
    caseManifestSha256: attempt.inputs.caseManifestSha256,
    sourceManifestSha256: inputs.controlledSourceManifestSha256
  });
  if (strict.status !== "controlled-failed" || strict.strictPasses !== 14 ||
      JSON.stringify(strict.failedCaseIds) !== JSON.stringify(["E15", "E16"]) || supplement.status !== "controlled-safety-passed") {
    throw new Error("B8 run 03 may continue only from the exact preserved 14/16 strict result with verified-safe E15/E16 precondition rejections.");
  }
  return { strictPasses: strict.strictPasses, strictFailedIds: strict.failedCaseIds, supplementalSafeIds: supplement.supplementalSafeIds };
}
