"use strict";

// Opt-in real-process check. The only process force-stopped is this script's own child.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { createLocalAiService } = require("../preload/local-ai/service.cjs");
const { readServerState, isHealthy } = require("../preload/local-ai/managed-server.cjs");
const { readProcessCommand, isExpectedServerProcess } = require("../preload/local-ai/process-identity.cjs");
const root = path.resolve(__dirname, "../.cache/acceptance/local-ai");

async function runRequest(api, id) {
  const status = await api.getStatus();
  assert.equal(status.phase, "ready", "Run real-model acceptance first");
  return api.generate({ requestId: id, source: "managed", modelId: status.modelId,
    prompt: "只回复：就绪", maxTokens: 64, contextTokens: 4096 });
}

async function owner() {
  const api = createLocalAiService({ dataDirectory: root });
  await runRequest(api, "lifecycle-owner");
  process.send({ ready: true });
  // Keep the IPC process alive until the parent deliberately terminates it.
  setInterval(() => {}, 1_000);
}

async function checkRecovery(report, unhealthy) {
  let originalServer;
  const child = fork(__filename, ["owner"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  child.stderr.resume();
  const api = createLocalAiService({ dataDirectory: root });
  try {
    await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => { throw new Error("Owner exited before readiness"); }),
      delay(60_000, null, { ref: false }).then(() => { throw new Error("Owner readiness timeout"); })
    ]);
    const recorded = readServerState(root);
    originalServer = recorded;
    assert.ok(recorded && await isHealthy(recorded));
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    assert.equal(await isHealthy(recorded), true, "Fixture must leave an actual orphan for the recovery test");
    if (unhealthy) {
      process.kill(recorded.pid, "SIGSTOP");
      assert.equal(await isHealthy(recorded), false);
    }
    assert.ok((await runRequest(api, "lifecycle-adopter")).trim());
    const active = readServerState(root);
    if (unhealthy) {
      assert.notEqual(active.pid, recorded.pid, "Unresponsive fixture must have been replaced");
      report.checks.push("generate recovered a verified unresponsive orphan despite its own startup request lease; a fresh server generated successfully");
    } else {
      assert.equal(active.pid, recorded.pid, "Healthy fixture must be reused");
      report.checks.push("A fresh service adopted the authenticated orphan and generated successfully");
    }
    assert.equal(api.dispose(), true, "Synchronous disposal must signal the owned or authenticated adopted process");
    for (let attempt = 0; attempt < 20 && await isHealthy(active); attempt++) await delay(100);
    assert.equal(await isHealthy(active), false);
    report.checks.push(`${unhealthy ? "New owner" : "Adopter without ChildProcess handle"} synchronously signalled disposal and server shutdown was observed`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await api.release();
    // Always unfreeze/stop the exact test fixture if a failed assertion interrupted recovery.
    try {
      if (originalServer && isExpectedServerProcess(readProcessCommand(originalServer.pid), originalServer, originalServer.runtimePath, originalServer.modelPath)) {
        if (process.platform !== "win32") process.kill(originalServer.pid, "SIGCONT");
        process.kill(originalServer.pid, "SIGTERM");
      }
    } catch { /* A successfully recovered fixture has already exited. */ }
  }
}

async function main() {
  const report = { platform: process.platform, arch: process.arch, checks: [] };
  try {
    await checkRecovery(report, false);
    if (process.platform !== "win32") await checkRecovery(report, true);
    report.result = "passed";
  } catch (error) {
    report.result = "failed"; report.error = error.message; process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.resolve(root, "../real-lifecycle.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  }
}
(process.argv[2] === "owner" ? owner() : main()).catch(error => { console.error(error.message); process.exitCode = 1; });
