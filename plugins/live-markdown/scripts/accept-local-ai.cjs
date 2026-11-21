"use strict";

// Opt-in real-device acceptance. Downloads stay outside dist, inside this plugin's cache.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { spawn } = require("node:child_process");
const { createLocalAiService } = require("../preload/local-ai/service.cjs");

async function main() {
  const profileId = process.argv[2] || "light";
  const root = path.resolve(__dirname, "../.cache/acceptance");
  fs.mkdirSync(root, { recursive: true });
  const spawnEvents = [];
  const spawnObserved = (binary, args, options) => {
    const child = spawn(binary, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    const log = fs.createWriteStream(path.join(root, `server-${child.pid}.log`), { flags: "a", mode: 0o600 });
    child.stderr.pipe(log);
    child.once("exit", (code, signal) => { spawnEvents.push({ pid: child.pid, code, signal, at: new Date().toISOString() }); });
    return child;
  };
  let lastProgress = "";
  const api = createLocalAiService({
    dataDirectory: path.join(root, "local-ai"),
    spawn: spawnObserved,
    onStatus(status) {
      const progress = `${status.phase}:${Math.floor(status.completedBytes / Math.max(1, status.totalBytes) * 10) * 10}`;
      if (progress !== lastProgress) {
        lastProgress = progress;
        console.log(JSON.stringify({ phase: status.phase, progress: progress.split(":")[1], error: status.error }));
      }
    }
  });
  const report = { platform: process.platform, arch: process.arch, profile: profileId, started: new Date().toISOString(), checks: [] };
  const start = Date.now();
  try {
    const environment = await api.inspect();
    const plan = environment.plans.find(item => item.id === profileId);
    assert.ok(plan?.available, plan?.reason || "Plan unavailable");
    report.plan = plan;
    await api.deploy(profileId);
    const deadline = Date.now() + 20 * 60_000;
    let status;
    do {
      await delay(1_000);
      status = await api.getStatus();
      if (status.phase === "error" || status.phase === "cancelled") throw new Error(status.error || status.message);
    } while (status.phase !== "ready" && Date.now() < deadline);
    assert.equal(status.phase, "ready", "Deployment timed out");
    report.deploymentMs = Date.now() - start;
    report.checks.push("download, SHA-256, extract, startup, actual inference");
    const input = { source: "managed", modelId: plan.modelId, contextTokens: 4096, maxTokens: 512 };
    const inferenceStart = Date.now();
    let chunks = 0;
    const polished = await api.generate({ ...input, requestId: "accept-polish", systemPrompt: "你是中文编辑。保持原意，只输出润色后的 Markdown，不添加解释。/no_think", prompt: "润色以下全文：\n# 项目进展\n\n我们已经把功能做完了，但是还有一些问题需要在发布之前检查。\n\n- 明天会把测试补上。\n- 确认没问题以后再发布。" }, () => chunks++);
    assert.ok(polished.includes("项目") && polished.length > 20 && chunks > 0);
    assert.ok(!polished.includes("<think>"));
    report.polish = { text: polished, elapsedMs: Date.now() - inferenceStart, chunks };
    report.checks.push("Chinese Markdown streamed output");
    let lateChunks = 0;
    let settled = false;
    const cancelled = api.generate({ ...input, requestId: "accept-cancel", maxTokens: 2048, prompt: "用中文写一篇详细的长篇技术文章，至少五千字。" }, () => { if (settled) lateChunks++; });
    const observed = cancelled.then(() => ({ completed: true }), error => ({ completed: false, error: error.message }));
    await delay(150);
    await api.cancelGeneration("accept-cancel");
    const cancellation = await observed;
    settled = true;
    assert.equal(cancellation.completed, false);
    await delay(200);
    assert.equal(lateChunks, 0);
    report.checks.push("cancel rejects; no late chunks");
    const recovered = await api.generate({ ...input, requestId: "accept-after-cancel", prompt: "请只回复：准备就绪", maxTokens: 64 });
    assert.ok(recovered.trim().length);
    report.checks.push("new request succeeds after cancellation");
    await api.release();
    const cold = createLocalAiService({ dataDirectory: path.join(root, "local-ai"), spawn: spawnObserved });
    try {
      assert.equal((await cold.getStatus()).phase, "ready", "New instance restores persisted readiness");
      const coldText = await cold.generate({ ...input, requestId: "accept-cold", prompt: "请只回复：重启成功", maxTokens: 64 });
      assert.ok(coldText.trim());
      report.checks.push("new service instance cold-starts installed model after release");
      await assert.rejects(cold.generate({ ...input, requestId: "accept-truncated", prompt: "请写一篇介绍 Markdown 的长文章。", maxTokens: 1 }), /truncat|complete/);
      report.checks.push("truncated real-model output is rejected");
    } finally { await cold.release(); }
    report.result = "passed";
  } catch (error) {
    report.result = "failed";
    report.error = error.stack;
    process.exitCode = 1;
  } finally {
    await api.release();
    report.elapsedMs = Date.now() - start;
    report.spawnEvents = spawnEvents;
    fs.writeFileSync(path.join(root, `real-model-${profileId}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
