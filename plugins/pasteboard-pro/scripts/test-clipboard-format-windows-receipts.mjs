import assert from "node:assert/strict";
import test from "node:test";
import { requiredProbeCases } from "./lib/clipboard-format-g0-cases.mjs";
import { validateProbeReport } from "./lib/clipboard-format-g0-report.mjs";
import { requiredWindowsReceiptGroups, validateWindowsFormatReceipts,
  windowsReceiptCaseIds } from "./lib/clipboard-format-g0-windows-receipts.mjs";
import { makeWindowsFormatReceipts } from "../tests/fixtures/windows-format-receipts.mjs";

const MAX_BYTES = 20 * 1024 * 1024;
const passingCases = () => windowsReceiptCaseIds.map(id => ({ id, status: "pass" }));
const validate = (receipts = makeWindowsFormatReceipts(), options = {}) =>
  validateWindowsFormatReceipts(receipts, { success: true, cases: passingCases(), codePage: 1252, ...options });
const cloneReceipts = () => structuredClone(makeWindowsFormatReceipts());
const report = (overrides = {}) => ({ schemaVersion: 1, platform: "win32", scope: "isolated-window-station",
  success: true, cases: requiredProbeCases.win32.map(id => ({ id, status: "pass" })),
  environment: { osVersion: "fixture", architecture: "x64", codePage: 1252 },
  unverified: ["general-clipboard-monitoring"], windowsFormatReceipts: makeWindowsFormatReceipts(), ...overrides });

test("complete receipt groups bind all seven required format families and allow DWORD wrap", () => {
  const receipts = makeWindowsFormatReceipts();
  assert.deepEqual(receipts.map(group => group.caseId), requiredWindowsReceiptGroups);
  assert.equal(receipts[0].sourceRevision, 0xffff_ffff);
  assert.equal(receipts[0].writeRevision, 1);
  assert.equal(validate(receipts), receipts);
});

test("failed probes may retain only groups tied to passing receipt cases", () => {
  const receipts = cloneReceipts().slice(0, 2);
  const cases = windowsReceiptCaseIds.map(id => ({ id, status: receipts.some(group => group.caseId === id) ? "pass" : "fail" }));
  assert.equal(validateWindowsFormatReceipts(receipts, { success: false, cases, codePage: 1252 }).length, 2);
  assert.equal(validateWindowsFormatReceipts([], { success: false, cases, codePage: 1252 }).length, 0);
  assert.throws(() => validateWindowsFormatReceipts(receipts, { success: false,
    cases: cases.map(item => item.id === receipts[0].caseId ? { ...item, status: "fail" } : item), codePage: 1252 }));
});

test("successful reports need every group exactly once and no unsupported receipt case", () => {
  assert.throws(() => validate(cloneReceipts().slice(0, -1)));
  const duplicate = cloneReceipts();
  duplicate[5] = structuredClone(duplicate[4]);
  assert.throws(() => validate(duplicate));
  const invented = cloneReceipts();
  invented[0].caseId = "receipt-sha256-known-answers";
  assert.throws(() => validate(invented));
});

test("required format coverage is enforced while known additional formats remain valid", () => {
  const missing = cloneReceipts();
  missing[0].formats = missing[0].formats.filter(format => format.key !== "rtf");
  assert.throws(() => validate(missing));
  const extended = cloneReceipts();
  extended[0].formats.push({ ...structuredClone(extended[1].formats[0]), key: "tiff" });
  assert.equal(validate(extended).length, requiredWindowsReceiptGroups.length);
  const duplicateKey = cloneReceipts();
  duplicateKey[0].formats.push(structuredClone(duplicateKey[0].formats[0]));
  assert.throws(() => validate(duplicateKey));
  const unknown = cloneReceipts();
  unknown[0].formats[0].key = "clipboard-payload";
  assert.throws(() => validate(unknown));
});

test("prototype property names cannot bypass the Windows format allowlist", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    const receipts = cloneReceipts();
    receipts[0].formats.push({ key,
      planned: { byteLength: 1, sha256: "a".repeat(64) },
      readback: { byteLength: 1, sha256: "a".repeat(64) }, comparison: "exact" });
    assert.throws(() => validate(receipts), TypeError, key);
  }
});

test("revision evidence requires nonzero DWORD bindings without imposing monotonic order", () => {
  for (const mutate of [
    group => { group.sourceRevision = 0; group.expectedRevision = 0; },
    group => { group.sourceRevision = 12; group.expectedRevision = 13; },
    group => { group.writeRevision = 8; group.readbackRevision = 9; group.observedRevision = 9; },
    group => { group.observedRevision = 8; },
    group => { group.writeRevision = 0x1_0000_0000; group.readbackRevision = 0x1_0000_0000; group.observedRevision = 0x1_0000_0000; },
  ]) {
    const receipts = cloneReceipts();
    mutate(receipts[0]);
    assert.throws(() => validate(receipts));
  }
});

test("groups and formats reject undeclared source, native identity, and raw payload fields", () => {
  for (const mutate of [
    group => { group.sourceOrigin = "Codex"; },
    group => { group.sourcePath = "C:\\secret"; },
    group => { group.processId = 42; },
    group => { group.sourceOrigin = "unknown"; group.formats[0].payload = "clipboard contents"; },
    group => { group.formats[0].nativeFormatId = 13; },
    group => { group.formats[0].nativeName = "unregistered custom format"; },
  ]) {
    const receipts = cloneReceipts();
    mutate(receipts[0]);
    assert.throws(() => validate(receipts));
  }
});

test("format descriptors and hashes are fixed allowlists with exact byte comparisons", () => {
  const mutations = [
    format => { format.codec = "arbitrary-codec"; },
    format => { format.encoding = "utf8"; },
    format => { format.fidelity = "best-effort"; },
    format => { format.materialization = "read-the-clipboard-later"; },
    format => { format.planned.sha256 = "A".repeat(64); },
    format => { format.readback.sha256 = "x".repeat(64); },
    format => { format.readback.byteLength += 1; },
  ];
  for (const mutate of mutations) {
    const receipts = cloneReceipts();
    mutate(receipts[0].formats[0]);
    assert.throws(() => validate(receipts));
  }
});

test("zero-length format evidence is valid while negative lengths are rejected", () => {
  const empty = cloneReceipts();
  const format = empty[0].formats[0];
  format.planned = { byteLength: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" };
  format.readback = structuredClone(format.planned);
  assert.equal(validate(empty).length, requiredWindowsReceiptGroups.length);
  const negative = cloneReceipts();
  negative[0].formats[0].planned.byteLength = -1;
  negative[0].formats[0].readback.byteLength = -1;
  assert.throws(() => validate(negative));
});

test("visible-RGB compatibility is restricted to CF_BITMAP and permits normalized bytes", () => {
  const redundantCompatibility = cloneReceipts();
  redundantCompatibility[2].formats.find(format => format.key === "bitmap").comparison = "visible-rgb-compatible";
  assert.throws(() => validate(redundantCompatibility));
  const receipts = cloneReceipts();
  const bitmap = receipts[2].formats.find(format => format.key === "bitmap");
  bitmap.comparison = "visible-rgb-compatible";
  bitmap.readback.byteLength = 2;
  bitmap.readback.sha256 = "f".repeat(64);
  assert.equal(validate(receipts).length, requiredWindowsReceiptGroups.length);
  const other = cloneReceipts();
  other[1].formats[0].comparison = "visible-rgb-compatible";
  assert.throws(() => validate(other));
  const mismatch = cloneReceipts();
  mismatch[1].formats[0].readback.sha256 = "f".repeat(64);
  assert.throws(() => validate(mismatch));
});

test("per-format and separate planned/readback byte budgets are capped at 20 MiB", () => {
  const tooLargeRow = cloneReceipts();
  const row = tooLargeRow[0].formats[0];
  row.planned.byteLength = MAX_BYTES + 1;
  row.readback.byteLength = MAX_BYTES + 1;
  assert.throws(() => validate(tooLargeRow));

  const plannedOverflow = cloneReceipts();
  plannedOverflow[0].formats.push(structuredClone(plannedOverflow[2].formats.find(format => format.key === "bitmap")));
  const plannedBitmap = plannedOverflow[0].formats.at(-1);
  plannedBitmap.planned.byteLength = 1;
  plannedBitmap.readback.byteLength = 0;
  plannedBitmap.comparison = "visible-rgb-compatible";
  const plannedRows = plannedOverflow[0].formats.slice(0, 5);
  plannedRows[0].planned.byteLength = MAX_BYTES - 4;
  plannedRows[0].readback.byteLength = MAX_BYTES - 4;
  plannedRows.slice(1).forEach(format => {
    format.planned.byteLength = 1;
    format.readback.byteLength = 1;
  });
  assert.throws(() => validate(plannedOverflow));

  const readbackOverflow = cloneReceipts();
  readbackOverflow[0].formats.push(structuredClone(readbackOverflow[2].formats.find(format => format.key === "bitmap")));
  const readbackBitmap = readbackOverflow[0].formats.at(-1);
  readbackBitmap.planned.byteLength = 0;
  readbackBitmap.readback.byteLength = 1;
  readbackBitmap.comparison = "visible-rgb-compatible";
  const readbackRows = readbackOverflow[0].formats.slice(0, 5);
  readbackRows[0].planned.byteLength = MAX_BYTES - 4;
  readbackRows[0].readback.byteLength = MAX_BYTES - 4;
  readbackRows.slice(1).forEach(format => {
    format.planned.byteLength = 1;
    format.readback.byteLength = 1;
  });
  assert.throws(() => validate(readbackOverflow));
});

test("ACP and OEM contexts are bounded and never claimed as producer encoding", () => {
  for (const [field, value] of [["helperCodePage", 0], ["helperCodePage", 65536],
    ["helperCodePage", 1252.5], ["helperOemCodePage", -1], ["helperOemCodePage", "437"]]) {
    const receipts = cloneReceipts();
    receipts[0][field] = value;
    assert.throws(() => validate(receipts));
  }
  assert.throws(() => validate(cloneReceipts(), { codePage: 65001 }));
  const claimed = cloneReceipts();
  claimed[4].formats.find(format => format.key === "text-acp").validationCodePage = 1252;
  assert.throws(() => validate(claimed));
});

test("ANSI URL and ANSI HDROP have distinct, explicit helper ACP validation fields", () => {
  const wrongUrlCp = cloneReceipts();
  wrongUrlCp[5].formats.find(format => format.key === "url-ansi").urlCodePage = 437;
  assert.throws(() => validate(wrongUrlCp));
  const noUrlCp = cloneReceipts();
  delete noUrlCp[5].formats.find(format => format.key === "url-ansi").urlCodePage;
  assert.throws(() => validate(noUrlCp));

  const ansiDrop = cloneReceipts();
  const row = { ...structuredClone(ansiDrop[3].formats[0]), encoding: "ansi-dropfiles", validationCodePage: 1252 };
  ansiDrop[0].formats.push(row);
  assert.equal(validate(ansiDrop).length, requiredWindowsReceiptGroups.length);
  const wrongDropCp = cloneReceipts();
  wrongDropCp[0].formats.push({ ...structuredClone(wrongDropCp[3].formats[0]),
    encoding: "ansi-dropfiles", validationCodePage: 437 });
  assert.throws(() => validate(wrongDropCp));
  const missingDropCp = cloneReceipts();
  missingDropCp[0].formats.push({ ...structuredClone(missingDropCp[3].formats[0]), encoding: "ansi-dropfiles" });
  assert.throws(() => validate(missingDropCp));
  const falselyWide = cloneReceipts();
  falselyWide[3].formats[0] = row;
  assert.throws(() => validate(falselyWide));
});

test("the required ANSI file-list group carries its real HDROP validation ACP", () => {
  const receipts = cloneReceipts();
  const group = receipts.find(item => item.caseId === "receipt-files-ansi");
  assert.equal(group.formats.length, 1);
  assert.equal(group.formats[0].key, "file-list");
  assert.equal(group.formats[0].encoding, "ansi-dropfiles");
  assert.equal(group.formats[0].validationCodePage, group.helperCodePage);
  assert.equal(validate(receipts).length, 7);

  const wrongAcp = cloneReceipts();
  wrongAcp.find(item => item.caseId === "receipt-files-ansi").formats[0].validationCodePage = 437;
  assert.throws(() => validate(wrongAcp));
  const missingAcp = cloneReceipts();
  delete missingAcp.find(item => item.caseId === "receipt-files-ansi").formats[0].validationCodePage;
  assert.throws(() => validate(missingAcp));
  const wideOnly = cloneReceipts();
  const wideRow = wideOnly.find(item => item.caseId === "receipt-files-ansi").formats[0];
  wideRow.encoding = "utf16le-dropfiles";
  delete wideRow.validationCodePage;
  assert.throws(() => validate(wideOnly));
});

test("report envelope permits Windows receipts only for Windows and allows receipt-free failures", () => {
  assert.equal(validateProbeReport(report(), "win32").windowsFormatReceipts.length, 7);
  assert.throws(() => validateProbeReport(report({ windowsFormatReceipts: undefined }), "win32"));
  assert.throws(() => validateProbeReport(report({ windowsFormatReceipts: [] }), "win32"));
  assert.throws(() => validateProbeReport({ schemaVersion: 1, platform: "darwin", scope: "isolated-named-pasteboard",
    success: false, cases: requiredProbeCases.darwin.map(id => ({ id, status: "fail" })),
    environment: { osVersion: "fixture", architecture: "arm64" }, unverified: ["general-clipboard-monitoring"],
    windowsFormatReceipts: [] }, "darwin"));
  const failed = report({ success: false, cases: requiredProbeCases.win32.map(id => ({ id, status: "fail" })) });
  delete failed.windowsFormatReceipts;
  assert.equal(validateProbeReport(failed, "win32").success, false);
});

test("Windows rejects the Apple format summary while Darwin keeps its existing summary contract", () => {
  const appleFormatSummary = { planned: [], captured: [], compatibleAliases: [], codecFixtures: [] };
  assert.throws(() => validateProbeReport(report({ formatSummary: appleFormatSummary }), "win32"),
    /Apple format summaries/u);
  const darwin = { schemaVersion: 1, platform: "darwin", scope: "isolated-named-pasteboard", success: true,
    cases: requiredProbeCases.darwin.map(id => ({ id, status: "pass" })),
    environment: { osVersion: "fixture", architecture: "arm64" },
    unverified: ["general-clipboard-monitoring"], formatSummary: appleFormatSummary };
  assert.equal(validateProbeReport(darwin, "darwin").formatSummary, appleFormatSummary);
});
