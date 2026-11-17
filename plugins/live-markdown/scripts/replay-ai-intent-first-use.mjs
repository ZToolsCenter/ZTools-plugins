// Replays captured real-model responses through the current complete runner, without inference.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".cache/acceptance/ai-intent-first-use");
const captured = JSON.parse(fs.readFileSync(path.join(dir, "fixed-v2/full-report.json"), "utf8"));
const { quickstart } = require("../tests/e2e/fixtures/cm6-rich-navigation.cjs");
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(root, ".cache/vite-intent-replay") });
const results = [];
try {
  const { runPlannedAiTask } = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const { resolveAiEdit } = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  for (const record of captured.cases) {
    let invocations = 0;
    const snapshot = { documentId: "captured-replay", revision: 1, content: quickstart, selection: null, cursor: 0, readOnly: false };
    const result = { caseId: record.caseId, round: record.round, phase: record.phase, passed: false };
    try {
      const task = await runPlannedAiTask({ source: quickstart, action: "custom", userPrompt: record.instruction, baseSystemPrompt: "只输出结果。", actionDefinition: { id: "custom", label: "自定义", prompt: record.instruction } }, snapshot, {
        isCurrent: () => true, abortCurrent: () => {},
        invoke: async () => { if (++invocations > 1) throw new Error("Literal edit unexpectedly generated content"); return record.rawModelOutput; }
      });
      const patch = task.proposal && resolveAiEdit(task.proposal);
      const prefixBreaks = (quickstart.match(/(?:\r\n|\r|\n)*$/)?.[0].match(/\r\n|\r|\n/g) ?? []).length;
      const separator = (quickstart.match(/\r\n|\r|\n/)?.[0] ?? "\n").repeat(Math.max(0, 2 - prefixBreaks));
      result.passed = Boolean(patch && invocations === 1 && patch.from === quickstart.length && patch.to === quickstart.length && patch.content === quickstart + separator + record.expected.literal);
    } catch (error) { result.error = error.message; }
    results.push(result);
  }
} finally { await server.close(); }
const hashes = Object.fromEntries(["intentPlanner.ts", "intentPrompts.ts", "intentContext.ts", "plannedTaskRunner.ts"].map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "src/core/ai", name))).digest("hex")]));
const report = { mode: "captured-response replay, zero new model calls", total: results.length, passed: results.filter((item) => item.passed).length, sourceHashes: hashes, results };
fs.writeFileSync(path.join(dir, "current-runner-replay.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ total: report.total, passed: report.passed }));
if (report.total !== 27 || report.passed !== 27) process.exitCode = 1;
