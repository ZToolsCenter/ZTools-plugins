import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectG0Sources, verifyBuiltProbe } from "./lib/clipboard-format-g0-sources.mjs";
import { createG0Receipt } from "./lib/clipboard-format-g0-report.mjs";
import { requiredProbeCases } from "./lib/clipboard-format-g0-cases.mjs";
import { makeWindowsFormatReceipts } from "../tests/fixtures/windows-format-receipts.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = data => createHash("sha256").update(data).digest("hex");
const runnerFiles = ["scripts/clipboard-format-g0.mjs", "scripts/lib/clipboard-format-g0-report.mjs",
  "scripts/lib/clipboard-format-g0-windows-receipts.mjs",
  "scripts/lib/clipboard-format-g0-cases.mjs", "scripts/lib/clipboard-format-g0-sources.mjs",
  "scripts/lib/bounded-process.mjs", "scripts/lib/process-rss.mjs"];

async function fixture(t, platform = "darwin") {
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  const directory = await mkdtemp(path.join(root, "artifacts/source-attestation-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const native = platform === "darwin" ? "macos" : "windows";
  const paths = [...runnerFiles, `native/clipboard-format/${native}/main.${platform === "darwin" ? "mm" : "cpp"}`];
  if (platform === "win32") paths.push("native/clipboard-format/windows/CMakeLists.txt",
    "native/clipboard-format/common/clipboard_codecs.cpp", "native/clipboard-format/common/clipboard_codecs.h",
    "native/clipboard-format/common/clipboard_palette.cpp", "native/clipboard-format/common/clipboard_palette.h");
  if (platform === "darwin") paths.push("native/clipboard-format/common/clipboard_uri_syntax.cpp",
    "native/clipboard-format/common/clipboard_uri_syntax.h",
    "native/clipboard-format/common/clipboard_rtf.cpp", "native/clipboard-format/common/clipboard_rtf.h",
    "native/clipboard-format/common/clipboard_capture_wire.cpp", "native/clipboard-format/common/clipboard_capture_wire.h",
    "native/clipboard-format/common/clipboard_sha256.cpp", "native/clipboard-format/common/clipboard_sha256.h",
      "native/clipboard-format/common/clipboard_capture_codec.cpp", "native/clipboard-format/common/clipboard_capture_codec.h");
  for (const name of paths) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), "synthetic-source-fixture");
  }
  const binary = path.join(directory, "fixture-binary");
  const binaryBytes = Buffer.from("synthetic-binary-fixture");
  const { sourceHashes } = await collectG0Sources(directory, platform);
  const report = { schemaVersion: 1, platform,
    scope: platform === "darwin" ? "isolated-named-pasteboard" : "isolated-window-station", success: true,
    cases: requiredProbeCases[platform].map(id => ({ id, status: "pass" })),
    environment: { osVersion: "fixture", architecture: "arm64", ...(platform === "win32" ? { codePage: 1252 } : {}) },
    unverified: ["general-clipboard-monitoring"],
    ...(platform === "win32" ? { windowsFormatReceipts: makeWindowsFormatReceipts() } : {}) };
  const receipt = createG0Receipt({ platform, architecture: "arm64", execution: "PASS", sourceHashes,
    commands: [{ command: "fixture-compiler", args: ["fixture-source"], timeoutMs: 1000 },
      { command: binary, args: ["--self-test"], timeoutMs: 1000,
        resources: { terminationConfirmed: true, stdinReleased: true, memoryLimitBytes: 4096,
          memorySamples: 1, peakRssBytes: 1024, monitorErrors: 0 } }],
    nativeReport: report, binarySha256: digest(binaryBytes), runtime: { node: "24.15.0", electron: null } });
  const verify = (value = receipt, bytes = binaryBytes) => verifyBuiltProbe(directory, { platform,
    architecture: "arm64", receiptBytes: Buffer.from(JSON.stringify(value)), binary, binaryBytes: bytes });
  return { directory, receipt, verify };
}

test("a complete successful build is bound to its exact receipt and source inventory", async t => {
  const { receipt, verify } = await fixture(t);
  const result = await verify();
  assert.equal(result.receiptSha256, digest(Buffer.from(JSON.stringify(receipt))));
  assert.equal(result.binarySha256, receipt.binarySha256);
});

test("omitted, additional, changed and newly introduced native source cannot reuse a receipt", async t => {
  const { directory, receipt, verify } = await fixture(t);
  const omitted = structuredClone(receipt);
  delete omitted.sourceHashes["scripts/lib/process-rss.mjs"];
  await assert.rejects(verify(omitted), /inventory/u);
  const extra = structuredClone(receipt);
  extra.sourceHashes["scripts/unrecorded.mjs"] = "0".repeat(64);
  await assert.rejects(verify(extra), /inventory/u);
  await writeFile(path.join(directory, "native/clipboard-format/macos/main.mm"), "changed-fixture");
  await assert.rejects(verify(), /inventory/u);
  await writeFile(path.join(directory, "native/clipboard-format/macos/main.mm"), "synthetic-source-fixture");
  await writeFile(path.join(directory, "native/clipboard-format/macos/new-codec.mm"), "new-fixture");
  await assert.rejects(verify(), /inventory/u);
});

test("failed, old, wrong-platform, incomplete-case and mismatched-binary evidence is refused", async t => {
  const { receipt, verify } = await fixture(t);
  for (const mutation of [r => { r.execution = "FAIL"; }, r => { r.schemaVersion = 0; },
    r => { r.platform = "win32"; }, r => { r.nativeReport.cases.pop(); },
    r => { r.commands.at(-1).command = "another-binary"; }]) {
    const changed = structuredClone(receipt);
    mutation(changed);
    await assert.rejects(verify(changed));
  }
  await assert.rejects(verify(receipt, Buffer.from("changed-binary")), /Binary/u);
});

test("Windows attestation includes every shared runtime codec source and header", async t => {
  const { directory, receipt, verify } = await fixture(t, "win32");
  await verify();
  for (const name of ["clipboard_codecs.cpp", "clipboard_codecs.h", "clipboard_palette.cpp", "clipboard_palette.h"]) {
    assert.ok(receipt.sourceHashes[`native/clipboard-format/common/${name}`]);
  }
  await writeFile(path.join(directory, "native/clipboard-format/common/new-runtime-codec.cpp"), "new-fixture");
  await assert.rejects(verify(), /inventory/u);
});


test("macOS shared URI syntax is source-bound and cannot reuse stale or omitted evidence", async t => {
  const { directory, receipt, verify } = await fixture(t, "darwin");
  await verify();
  const shared = "native/clipboard-format/common/clipboard_uri_syntax";
  assert.ok(receipt.sourceHashes[`${shared}.cpp`]);
  assert.ok(receipt.sourceHashes[`${shared}.h`]);
  const omitted = structuredClone(receipt);
  delete omitted.sourceHashes[`${shared}.h`];
  await assert.rejects(verify(omitted), /inventory/u);
  await writeFile(path.join(directory, `${shared}.cpp`), "changed-shared-uri");
  await assert.rejects(verify(), /inventory/u);
});
