import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseScopedFollowupArgs, runScopedFollowup, scopedExecutionStatus } from "./run-scoped-followup.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = ".cache/acceptance/ai-common-failures/v1";
const CANDIDATE = ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B10";
const RUNTIME = ".cache/acceptance/ai-model-comparison/v1/runtime";
const OUTPUT = ".cache/acceptance/ai-common-failures/scoped-followup-v1";
const tempRoots = [];
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");

function write(root, relative, content) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-md-scoped-followup-"));
  tempRoots.push(root);
  const sampleDocs = "export const TYPORA_QUICKSTART_MARKDOWN = `# Welcome\n\nA frozen rich source fixture.`;\n";
  const candidateSource = write(root, `${CANDIDATE}/source/src/core/sampleDocs.ts`, sampleDocs);
  const candidateBytes = fs.readFileSync(candidateSource);
  write(root, `${CANDIDATE}/source-manifest.json`, `${JSON.stringify({
    schemaVersion: 1,
    capture: { name: "B10", stability: { stable: true } },
    paths: ["src/core/sampleDocs.ts"],
    files: { "src/core/sampleDocs.ts": { sha256: sha(candidateBytes), bytes: candidateBytes.byteLength } }
  })}\n`);

  const frozenCases = fs.readFileSync(path.join(pluginRoot, BASE, "run-inputs/case-manifest.json"));
  write(root, `${BASE}/run-inputs/case-manifest.json`, frozenCases);
  write(root, `${BASE}/run-inputs/derived-manifest.json`, `${JSON.stringify({
    caseManifestSha256: sha(frozenCases), counts: { totalReal: 87 }
  })}\n`);
  const fixture = fs.readFileSync(path.join(pluginRoot, BASE, "native-host-20261023/executed-native-fixture.md"));
  write(root, `${BASE}/native-host-20261023/executed-native-fixture.md`, fixture);

  const profiles = [];
  for (const profileId of ["light", "balanced"]) {
    const modelId = `${profileId}.gguf`;
    const modelBytes = Buffer.from(`non-model-fixture:${profileId}`);
    const modelSha256 = sha(modelBytes);
    const runtimePath = `${RUNTIME}/${profileId}`;
    write(root, `${runtimePath}/model.gguf`, modelBytes);
    write(root, `${runtimePath}/active-model.json`, `${JSON.stringify({
      profileId, modelId, runtimeId: "runtime", runtimeVersion: "1", modelResourceId: `${profileId}-resource`, modelVersion: "1", modelPath: "model.gguf"
    })}\n`);
    write(root, `${runtimePath}/managed-resources.json`, `${JSON.stringify({ resources: [
      { id: "runtime", version: "1" }, { id: `${profileId}-resource`, version: "1" }
    ] })}\n`);
    profiles.push({ profileId, modelId, modelSha256, path: runtimePath, cachedIntegrityVerified: true });
  }
  write(root, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json", `${JSON.stringify({
    status: "configured-from-verified-cache", deploymentPerformed: false, downloadBytes: 0, profiles
  })}\n`);
  return root;
}

afterEach(() => {
  while (tempRoots.length) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe("scoped follow-up runner", () => {
  it("counts completed product clarifications and validation stops as execution-complete", () => {
    const clarify = { raw: JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" }), error: null };
    expect(scopedExecutionStatus({ calls: [clarify], result: null, error: { name: "Error", message: "请说明要对文档执行什么操作" } })).toBe("completed");
    expect(scopedExecutionStatus({ calls: [clarify], result: null, error: { name: "PlanValidationError", code: "invalid_evidence" } })).toBe("completed");
    expect(scopedExecutionStatus({ calls: [clarify], result: null, error: null })).toBe("completed");
  });

  it("keeps incomplete execution for transport faults, timeouts, and silent missing outcomes", () => {
    expect(scopedExecutionStatus({ calls: [{ raw: null, error: { name: "FetchError", code: "ECONNRESET" } }], result: null, error: { name: "FetchError", code: "ECONNRESET" } })).toBe("incomplete");
    expect(scopedExecutionStatus({ calls: [{ raw: null, error: null }], result: null, error: null })).toBe("incomplete");
    expect(scopedExecutionStatus({ calls: [], result: null, error: null })).toBe("incomplete");
    expect(scopedExecutionStatus({ calls: [{ raw: "{}", error: null }], result: null, error: { name: "TypeError", message: "Runtime crashed" } })).toBe("incomplete");
    expect(scopedExecutionStatus({ calls: [], result: null, error: { name: "HarnessTimeoutError", code: "independent_case_timeout" }, harnessTimedOut: true })).toBe("incomplete");
  });

  it("parses only a candidate and the optional execute flag", () => {
    expect(parseScopedFollowupArgs(["--candidate=B10", "--execute"])).toEqual({ candidate: "B10", execute: true });
    expect(parseScopedFollowupArgs(["--candidate=B10"])).toEqual({ candidate: "B10", execute: false });
    expect(() => parseScopedFollowupArgs(["--candidate=../B10"])).toThrow(/safe frozen snapshot/u);
    expect(() => parseScopedFollowupArgs(["--candidate=B10", "--execute", "--execute"])).toThrow(/Duplicate/u);
  });

  it("writes and hashes the frozen manifests before sequential mock rounds, then refuses overwrite", async () => {
    const root = makeFixtureRoot();
    const order = [];
    const runRound = vi.fn(async ({ round, outputDir, items }) => {
      order.push(round.roundId);
      const caseManifestBytes = fs.readFileSync(path.join(outputDir, "case-manifest.json"));
      const runManifest = JSON.parse(fs.readFileSync(path.join(outputDir, "run-manifest.json"), "utf8"));
      expect(runManifest.caseManifestSha256).toBe(sha(caseManifestBytes));
      expect(JSON.parse(caseManifestBytes.toString("utf8")).cases).toHaveLength(items.length);
      expect(runManifest.limits.maxCallsPerCase).toBe(64);
      expect(runManifest.toolSources).toHaveLength(3);
      for (const source of runManifest.toolSources) {
        expect(sha(fs.readFileSync(path.join(outputDir, "tool-source", source.path)))).toBe(source.sha256);
      }
      return {
        roundId: round.roundId, profileId: round.profileId, sourceTreeVerifiedBeforeAfter: true,
        records: items.map(({ id }, index) => ({ caseId: id, executionStatus: "completed", status: index === 0 ? "failed" : "passed", outcome: index === 0 ? "fixture-quality-failure" : "fixture-pass" })),
        summary: { expected: items.length }, notRunCaseIds: []
      };
    });
    const result = await runScopedFollowup({
      root, candidate: "B10", execute: true, dependencies: { runRound },
      paths: { nativeFixture: `${BASE}/native-host-20261023/executed-native-fixture.md`, output: OUTPUT }
    });
    expect(result.status).toBe("execution-complete");
    expect(result.report.executionStatus).toBe("complete");
    expect(result.report.contentSummary).toMatchObject({ expected: 44, failed: 4, passed: 40 });
    expect(order).toEqual(["balanced-r1", "light-r1", "light-r2", "balanced-r2"]);
    expect(runRound).toHaveBeenCalledTimes(4);
    expect(fs.existsSync(path.join(root, OUTPUT, "B10/run-report.json"))).toBe(true);
    await expect(runScopedFollowup({ root, candidate: "B10", execute: true, dependencies: { runRound } })).rejects.toThrow(/refusing to overwrite/u);
    expect(runRound).toHaveBeenCalledTimes(4);
  });

  it("rejects a candidate tree that differs from its full frozen manifest before execution", async () => {
    const root = makeFixtureRoot();
    write(root, `${CANDIDATE}/source/src/core/sampleDocs.ts`, "export const TYPORA_QUICKSTART_MARKDOWN = `changed`;\n");
    const runRound = vi.fn();
    await expect(runScopedFollowup({ root, candidate: "B10", execute: true, dependencies: { runRound } })).rejects.toThrow(/hash mismatch/u);
    expect(runRound).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, OUTPUT, "B10"))).toBe(false);
  });
});
