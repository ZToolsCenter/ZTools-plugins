import test from "node:test";
import assert from "node:assert/strict";
import { cleanupRunnerResources } from "./scenario-v2-runner.mjs";

test("each cleanup failure is recorded while later stages and final persistence remain possible", async () => {
  const calls = [];
  let removeResourcesCalls = 0;
  const report = {};
  const firstError = await cleanupRunnerResources({
    report, waitMs: 30,
    auditModuleGraph: async () => { calls.push("audit"); throw Object.assign(new Error("audit failed"), { code: "audit_error" }); },
    service: {
      async release() { calls.push("release"); throw new Error("release failed"); },
      async removeResources() { removeResourcesCalls += 1; }
    },
    requestServer: { async close() { calls.push("request-server"); throw new Error("request server failed"); } },
    server: { async close() { calls.push("vite-server"); } }
  });

  assert.deepEqual(calls, ["audit", "release", "request-server", "vite-server"]);
  assert.equal(firstError?.code, "audit_error");
  assert.deepEqual(report.cleanup.steps.map(({ status }) => status), ["failed", "failed", "failed", "completed"]);
  assert.equal(report.cleanup.errors.length, 3);
  assert.equal(report.moduleGraphAuditError.code, "audit_error");
  assert.equal(report.releaseError.message, "release failed");
  assert.equal(report.requestServerCloseError.message, "request server failed");
  assert.equal(report.cleanup.modelResourcesRemoved, false);
  assert.equal(report.cleanup.modelResourcesRetained, true);
  assert.equal(removeResourcesCalls, 0);
});

test("a never-settling cleanup stage is bounded and does not skip server closes", async () => {
  const calls = [];
  const report = {};
  const started = Date.now();
  const result = await cleanupRunnerResources({
    report, waitMs: 15,
    service: { release: () => new Promise(() => {}) },
    requestServer: { async close() { calls.push("request-server"); } },
    server: { async close() { calls.push("vite-server"); } }
  });

  assert.ok(Date.now() - started < 300);
  assert.equal(result?.code, "cleanup_timeout");
  assert.equal(report.releaseError?.name, "CleanupTimeoutError");
  assert.deepEqual(calls, ["request-server", "vite-server"]);
  assert.deepEqual(report.cleanup.steps.map(({ status }) => status), ["timed_out", "completed", "completed"]);
  assert.equal(report.cleanup.modelResourcesRemoved, false);
});
