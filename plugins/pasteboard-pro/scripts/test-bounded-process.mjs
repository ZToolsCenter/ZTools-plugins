import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedProcess } from "./lib/bounded-process.mjs";
import { parseRssOutput } from "./lib/process-rss.mjs";

const run = (source, options = {}) => runBoundedProcess(process.execPath, ["-e", source],
  { timeoutMs: 5000, ...options });

test("captures a direct helper and its exit status without a shell", async () => {
  const result = await run('process.stdout.write("fixture"); process.stderr.write("diagnostic"); process.exitCode=7');
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "fixture");
  assert.equal(result.stderr, "diagnostic");
  assert.equal(result.resources.terminationConfirmed, true);
});
test("timeout force-terminates a helper that ignores SIGTERM", async () => {
  await assert.rejects(run('process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)', { timeoutMs: 150 }), error => {
    assert.equal(error.code, "process-timeout");
    assert.equal(error.result.resources.terminationConfirmed, true);
    assert.ok(error.result.resources.durationMs < 2000);
    return true;
  });
});
test("bounded output is stopped before untrusted stdout grows indefinitely", async () => {
  await assert.rejects(run('setInterval(()=>process.stdout.write("x".repeat(1024)),1)', { maxOutputBytes: 2048 }), error => {
    assert.equal(error.code, "process-output-limit");
    assert.ok(Buffer.byteLength(error.result.stdout) <= 2048);
    assert.equal(error.result.resources.terminationConfirmed, true);
    return true;
  });
});
test("RSS over limit is measured on a real allocating child and terminates it", async () => {
  const source = 'const chunks=[]; setInterval(()=>{chunks.push(Buffer.alloc(4*1024*1024,0x7f));},50);';
  await assert.rejects(run(source, { maxRssBytes: 64 * 1024 * 1024, timeoutMs: 8000, sampleIntervalMs: 20 }), error => {
    assert.equal(error.code, "process-memory-limit");
    assert.ok(error.result.resources.memorySamples > 0);
    assert.ok(error.result.resources.peakRssBytes > 64 * 1024 * 1024);
    assert.equal(error.result.resources.terminationConfirmed, true);
    return true;
  });
});
test("unavailable memory monitoring fails closed instead of running unbounded", async () => {
  await assert.rejects(run('setInterval(()=>{},1000)', { maxRssBytes: 1024,
    sampleRss: async () => { throw new Error("fixture unavailable"); } }), error => {
    assert.equal(error.code, "process-memory-monitor-unavailable");
    assert.equal(error.result.resources.monitorErrors, 1);
    assert.equal(error.result.resources.terminationConfirmed, true);
    return true;
  });
});
test("numeric memory adapters preserve bytes and reject locale/overflow ambiguity", () => {
  assert.equal(parseRssOutput(" 1024 ", "darwin"), 1024 * 1024);
  assert.equal(parseRssOutput("1048576", "win32"), 1048576);
  for (const value of ["", "1,024", "unknown", "9007199254740992"]) {
    assert.throws(() => parseRssOutput(value, "darwin"));
  }
});
test("invalid resource configuration cannot start the child", async () => {
  await assert.rejects(run('process.exit(0)', { maxRssBytes: NaN }), TypeError);
  await assert.rejects(run('process.exit(0)', { timeoutMs: 0 }), TypeError);
});

test("a fast helper without a completed memory observation fails closed", async () => {
  await assert.rejects(run('process.exit(0)', { maxRssBytes: 1024,
    // Electron startup can exceed 50ms; the child must exit normally before sampling expires.
    sampleTimeoutMs: 1000, sampleRss: (_pid, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("fixture cancelled")), { once: true });
    }) }), error => {
    assert.equal(error.code, "process-memory-not-observed");
    assert.equal(error.result.status, 0);
    assert.equal(error.result.resources.memorySamples, 0);
    assert.equal(error.result.resources.terminationConfirmed, true);
    return true;
  });
});
test("a valid high RSS sample completed after process exit cannot be discarded", async () => {
  await assert.rejects(run('process.exit(0)', { maxRssBytes: 1024,
    sampleRss: async () => { await new Promise(resolve => setTimeout(resolve, 100)); return 2048; } }), error => {
    assert.equal(error.code, "process-memory-limit");
    assert.equal(error.result.resources.memorySamples, 1);
    assert.equal(error.result.resources.peakRssBytes, 2048);
    return true;
  });
});
test("supervised helpers are released only after valid RSS observation", async () => {
  const source = 'process.stdin.once("data", b=>{process.stdout.write(b);});';
  const result = await run(source, { maxRssBytes: 1024 * 1024 * 1024, releaseOnFirstSample: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "RUN\n");
  assert.equal(result.resources.stdinReleased, true);
  assert.ok(result.resources.memorySamples > 0);
});
test("active timeout starts only after a complete fixed diagnostic marker", async () => {
  const source = 'process.stdin.once("data",()=>{process.stderr.write("fixture-entered\\n");setInterval(()=>{},1000);});';
  await assert.rejects(run(source, { maxRssBytes: 1024 * 1024 * 1024, releaseOnFirstSample: true,
    activeDeadlineMarker: "fixture-entered", activeTimeoutMs: 100 }), error => {
    assert.equal(error.code, "process-active-timeout");
    assert.equal(error.result.resources.activeMarkerObserved, true);
    assert.equal(error.result.resources.terminationConfirmed, true);
    return true;
  });
});
