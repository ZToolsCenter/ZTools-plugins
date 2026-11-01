import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBuiltProbe } from "./lib/clipboard-format-g0-sources.mjs";
import { runBoundedProcess } from "./lib/bounded-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const supported = ["darwin", "win32"].includes(process.platform);
const output = path.join(root, "artifacts/pasteboardpro/clipboard-format-g0", process.platform);
const binary = path.join(output, process.platform === "win32"
  ? "build/Release/clipboard-format-probe.exe" : "clipboard-format-probe");
const digest = data => createHash("sha256").update(data).digest("hex");

async function verifiedBinary() {
  const receiptBytes = await readFile(path.join(output, "receipt.json"));
  const verified = await verifyBuiltProbe(root, { platform: process.platform, architecture: process.arch,
    receiptBytes, binary, binaryBytes: await readFile(binary) });
  // Keep the exact source receipt after later Node/Electron runs replace receipt.json.
  const sourceReceipt = `self-test-receipt-${verified.receiptSha256}.json`;
  await writeFile(path.join(output, sourceReceipt), receiptBytes, { mode: 0o600 });
  return { ...verified, sourceReceipt };

}

test("an unsupervised delayed-read fixture refuses before accessing any board",
  { skip: !supported }, async () => {
    await verifiedBinary();
    const env = { ...process.env };
    delete env.PBF_G0_SUPERVISED;
    const result = await runBoundedProcess(binary, ["--delayed-read-fixture"], {
      cwd: root, timeoutMs: 2000, maxOutputBytes: 1024, env });
    assert.equal(result.status, process.platform === "win32" ? 64 : 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.replaceAll("\r\n", "\n"), "supervision-required\n");
    assert.equal(result.resources.terminationConfirmed, true);
  });

test("a real native delayed provider stalls its read and is terminated after the callback marker",
  { skip: !supported }, async () => {
    const verified = await verifiedBinary();
    let failure;
    try {
      await runBoundedProcess(binary, ["--delayed-read-fixture"], { cwd: root, timeoutMs: 5000,
        maxRssBytes: 256 * 1024 * 1024, releaseOnFirstSample: true,
        env: { ...process.env, PBF_G0_SUPERVISED: "1" },
        activeDeadlineMarker: "fixture-entered", activeTimeoutMs: 250 });
    } catch (error) { failure = error; }
    assert.ok(failure, "the deliberately blocked provider must not report success");
    assert.equal(failure.code, "process-active-timeout");
    const result = failure.result;
    const lines = result.stderr.replaceAll("\r\n", "\n").split("\n");
    const call = lines.indexOf("read-call-started");
    const provider = lines.indexOf("fixture-entered");
    assert.ok(call >= 0 && provider > call, "must be stalled in the actual native/provider read call");
    assert.equal(lines.includes("read-call-returned"), false, "native read must not have returned before termination");
    assert.equal(result.resources.activeMarkerObserved, true);
    assert.equal(result.resources.terminationConfirmed, true);
    assert.ok(result.resources.memorySamples > 0);
    assert.ok(result.resources.durationMs - result.resources.timeToMarkerMs >= 250);
    assert.ok(result.resources.durationMs - result.resources.timeToMarkerMs < 2000);
    const evidence = { schemaVersion: 1, platform: process.platform,
      scope: process.platform === "darwin" ? "isolated-named-pasteboard" : "isolated-window-station",
      test: "native-delayed-read-watchdog",
      mechanism: process.platform === "darwin" ? "appkit-data-provider" : "win32-wm-renderformat",
      execution: "PASS", expectedErrorCode: failure.code,
      binarySha256: verified.binarySha256,
      sourceReceipt: { filename: verified.sourceReceipt, sha256: verified.receiptSha256 },
      testScript: { path: "scripts/test-clipboard-native-watchdog.mjs", sha256: digest(await readFile(fileURLToPath(import.meta.url))) },
      markers: { readCallStarted: true, providerEntered: true, readCallReturned: false },
      resources: result.resources, gateComplete: false };
    await writeFile(path.join(output, "delayed-read-watchdog.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  });
