import assert from "node:assert/strict";
import test from "node:test";
import { requiredProbeCases } from "./lib/clipboard-format-g0-cases.mjs";
import { createG0Receipt, validateProbeReport } from "./lib/clipboard-format-g0-report.mjs";
import { makeWindowsFormatReceipts } from "../tests/fixtures/windows-format-receipts.mjs";

const resource = () => ({ terminationConfirmed: true, stdinReleased: true, memoryLimitBytes: 268435456,
  memorySamples: 1, peakRssBytes: 1048576, monitorErrors: 0 });
const report = () => ({ schemaVersion: 1, platform: "darwin", scope: "isolated-named-pasteboard",
  success: true, cases: requiredProbeCases.darwin.map(id => ({ id, status: "pass" })),
  environment: { osVersion: "test-only", architecture: "arm64" }, unverified: ["target-application-paste"] });

test("general clipboard or another platform cannot masquerade as isolated evidence", () => {
  assert.throws(() => validateProbeReport({ ...report(), scope: "general" }, "darwin"));
  assert.throws(() => validateProbeReport(report(), "win32"));
  assert.throws(() => validateProbeReport({ ...report(), schemaVersion: 2 }, "darwin"));
});
test("failed, missing and not-run cases cannot produce an unsupported success claim", () => {
  for (const cases of [[], [{ id: "only-skipped", status: "not-run" }], [{ id: "failure", status: "fail" }]]) {
    assert.throws(() => validateProbeReport({ ...report(), cases }, "darwin"));
  }
  const value = report();
  value.cases.push({ ...value.cases[0] });
  assert.throws(() => validateProbeReport(value, "darwin"));
});
test("unverified gates remain visible even after a real isolated probe passes", () => {
  const receipt = createG0Receipt({ platform: "darwin", architecture: "arm64", execution: "PASS",
    sourceHashes: { "native/clipboard-format/macos/main.mm": "a".repeat(64), "scripts/clipboard-format-g0.mjs": "b".repeat(64) },
    commands: [{ command: "clang++", args: ["test-source.mm"], timeoutMs: 60_000 },
      { command: "test-probe", args: ["--self-test"], timeoutMs: 20_000, resources: resource() }],
    runtime: { node: "24.15.0", electron: null }, binarySha256: "a".repeat(64), nativeReport: report() });
  assert.equal(receipt.execution, "PASS");
  assert.equal(receipt.gateComplete, false);
  assert.equal(receipt.remainingGates.actualTargetApplications, "NOT-RUN");
  assert.equal(receipt.remainingGates.windows10FullMatrix, "NOT-RUN");
});
test("a passing receipt cannot be created from absence or failed native evidence", () => {
  const base = { platform: "darwin", architecture: "arm64", execution: "PASS", sourceHashes: {}, commands: [] };
  assert.throws(() => createG0Receipt(base));
  assert.throws(() => createG0Receipt({ ...base, nativeReport: { ...report(), success: false } }));
});
test("malformed case detail and absence of remaining scope are rejected", () => {
  assert.throws(() => validateProbeReport({ ...report(), unverified: [] }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), cases: [{ id: "bad", status: "maybe" }] }, "darwin"));
});

test("a mixed pass/not-run report cannot claim success", () => {
  const value = report();
  value.cases.push({ id: "required-not-executed", status: "not-run" });
  assert.throws(() => validateProbeReport(value, "darwin"));
  value.success = false;
  assert.equal(validateProbeReport(value, "darwin").success, false);
});
test("undeclared fields and free-form clipboard detail cannot enter receipts", () => {
  assert.throws(() => validateProbeReport({ ...report(), clipboardText: "test secret" }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), cases: [{ id: "case", status: "pass", detail: "test secret" }] }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), environment: { ...report().environment, clipboardText: "test secret" } }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), unverified: ["test secret"] }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), formatSummary: { clipboardText: "test secret" } }, "darwin"));
});

test("a single invented or accidentally omitted case cannot produce a passing probe", () => {
  assert.throws(() => validateProbeReport({ ...report(), cases: [{ id: "whatever", status: "pass" }] }, "darwin"));
  assert.throws(() => validateProbeReport({ ...report(), cases: report().cases.slice(1) }, "darwin"));
});
test("passing native results without runtime, provenance or commands are not valid receipts", () => {
  const base = { platform: "darwin", architecture: "arm64", execution: "PASS", binarySha256: "a".repeat(64),
    nativeReport: report(), runtime: { node: "24.15.0", electron: null },
    sourceHashes: { "native/clipboard-format/macos/main.mm": "a".repeat(64), "scripts/clipboard-format-g0.mjs": "b".repeat(64) },
    commands: [{ command: "clang++", args: ["test.mm"], timeoutMs: 60_000 }, { command: "probe", args: ["--self-test"], timeoutMs: 20_000, resources: resource() }] };
  assert.throws(() => createG0Receipt({ ...base, runtime: undefined }));
  assert.throws(() => createG0Receipt({ ...base, sourceHashes: {} }));
  assert.throws(() => createG0Receipt({ ...base, commands: [] }));
});

test("unobserved or unconfirmed child resource state cannot produce a passing receipt", () => {
  const base = { platform: "darwin", architecture: "arm64", execution: "PASS", binarySha256: "a".repeat(64),
    nativeReport: report(), runtime: { node: "24.15.0", electron: null },
    sourceHashes: { "native/clipboard-format/macos/main.mm": "a".repeat(64), "scripts/clipboard-format-g0.mjs": "b".repeat(64) } };
  for (const resources of [undefined, { ...resource(), memorySamples: 0, peakRssBytes: null },
    { ...resource(), stdinReleased: false }, { ...resource(), terminationConfirmed: false },
    { ...resource(), peakRssBytes: 536870912 }]) {
    assert.throws(() => createG0Receipt({ ...base, commands: [
      { command: "clang++", args: ["test.mm"], timeoutMs: 60_000 },
      { command: "probe", args: ["--self-test"], timeoutMs: 20_000, resources }] }));
  }
});


test("Windows encoding evidence requires the actual ACP and cannot leak into another platform", () => {
  const windows = { ...report(), platform: "win32", scope: "isolated-window-station",
    cases: requiredProbeCases.win32.map(id => ({ id, status: "pass" })),
    environment: { osVersion: "fixture", architecture: "x64", codePage: 1252 },
    windowsFormatReceipts: makeWindowsFormatReceipts() };
  assert.equal(validateProbeReport(windows, "win32").environment.codePage, 1252);
  const utf8CodePageReport = structuredClone(windows);
  utf8CodePageReport.environment.codePage = 65001;
  utf8CodePageReport.windowsFormatReceipts.forEach(group => { group.helperCodePage = 65001; });
  utf8CodePageReport.windowsFormatReceipts.find(group => group.caseId === "receipt-url-wide-ansi")
    .formats.find(format => format.key === "url-ansi").urlCodePage = 65001;
  utf8CodePageReport.windowsFormatReceipts.find(group => group.caseId === "receipt-files-ansi")
    .formats.find(format => format.key === "file-list").validationCodePage = 65001;
  assert.equal(validateProbeReport(utf8CodePageReport, "win32").environment.codePage, 65001);
  for (const codePage of [undefined, 0, -1, 1.5, NaN, Infinity, 65536, "1252"]) {
    assert.throws(() => validateProbeReport({ ...windows, environment: { ...windows.environment, codePage } }, "win32"));
  }
  assert.throws(() => validateProbeReport({ ...report(), environment: { ...report().environment, codePage: 1252 } }, "darwin"));
});


test("failed probe case metadata remains bounded at 128 after expanding the Windows matrix", () => {
  const bounded = { ...report(), success: false,
    cases: Array.from({ length: 128 }, (_, index) => ({ id: `bounded-case-${index}`, status: "not-run" })) };
  assert.equal(validateProbeReport(bounded, "darwin"), bounded);
  const over = { ...bounded, cases: [...bounded.cases, { id: "bounded-case-over", status: "not-run" }] };
  assert.throws(() => validateProbeReport(over, "darwin"), /bounded/u);
});
