import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false } });
const report = { kind: "mock-provider end-to-end CPU overhead; excludes module load, real inference and native UI responsiveness", node: process.version, cases: [] };
try {
  const { runPlannedAiTask } = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const { buildAiTaskRequest } = await server.ssrLoadModule("/src/core/ai/aiTaskRequest.ts");
  const { buildProseEditPlan } = await server.ssrLoadModule("/src/core/ai/proseEditPlan.ts");
  report.intervalPreflight = [];
  for (const count of [500, 5_000]) {
    const source = "1234567890123456789012345678901234567\r\n\r\n```text\r\nx\r\n```\r\n\r\n".repeat(count);
    const samples = [];
    for (let iteration = 0; iteration < 8; iteration++) {
      const started = performance.now();
      const plan = buildProseEditPlan({ source, instruction: "校对正文。", systemPrompt: "保持结构。" }, 50);
      if (plan.slots.length || plan.batches.length) throw new Error("Protected-range benchmark exposed editable text");
      if (iteration > 1) samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    report.intervalPreflight.push({ paragraphs: count, bytes: Buffer.byteLength(source), samples: samples.length, p50Ms: samples[2], p95Ms: samples[5] });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".cache/acceptance/ai-scenarios/v1/case-manifest.json")));
  for (const id of ["G09", "G11", "1MiB-last-match"]) {
    const item = id === "1MiB-last-match" ? { source: "a".repeat(1_048_576), instruction: "把最后一处“a”改成“b”" } : manifest.realCases.find(item => item.id === id);
    const snapshot = { documentId: id, revision: 1, content: item.source, selection: null, cursor: null, readOnly: false };
    const request = buildAiTaskRequest({ source: item.source, selected: false, action: "custom", userPrompt: item.instruction, config: { provider: "local", activeRoleId: "general", customSystemPrompt: "" } });
    const samples = [];
    let last;
    let calls;
    for (let iteration = 0; iteration < 12; iteration++) {
      calls = 0;
      const started = performance.now();
      last = await runPlannedAiTask(request, snapshot, { isCurrent: () => true, abortCurrent() {}, async invoke(prompt, _system, _tokens, _chunk, schema) {
        calls++;
        if (schema?.anyOf?.some(branch => branch.properties?.version?.const === 1)) {
          return JSON.stringify(id === "G09" ? { version: 1, kind: "answer", target: "document", content: { mode: "generate", task: "summarize" } }
            : id === "G11" ? { version: 1, kind: "edit", operation: "rewrite", target: "document", content: { mode: "generate", task: "polish" } }
            : { version: 1, kind: "edit", operation: "replace_exact", target: "document", find: "a", occurrence: "last", content: { mode: "literal", text: "b" } });
        }
        if (prompt.includes("【待编辑文本槽】\n")) {
          const input = JSON.parse(prompt.split("【待编辑文本槽】\n")[1]);
          return JSON.stringify({ protocol: input.protocol, batchId: input.batchId, edits: input.slots.map(slot => {
            const text = slot.text.replaceAll("以经", "已经");
            return text === slot.text ? { id: slot.id, status: "unchanged" } : { id: slot.id, status: "replace", text };
          }) });
        }
        const line = prompt.split("\n").find(line => line.startsWith("候选："));
        if (!line) throw new Error("Unexpected provider request in the fixed CPU benchmark");
        const facts = JSON.parse(line.slice(3));
        return JSON.stringify({ ids: facts.filter(({ quote }) => quote.includes("决定")).map(({ id }) => id) });
      } });
      if (iteration > 1) samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    report.cases.push({ id, bytes: Buffer.byteLength(item.source), samples: samples.length, p50Ms: samples[4], p95Ms: samples[9], mockCalls: calls, summaryStats: last.summaryStats, proseStats: last.proseStats });
  }
} finally { await server.close(); }
const out = path.join(root, ".cache/acceptance/ai-common-failures/v1", "cpu-performance-" + Date.now() + ".json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output: out, ...report }, null, 2));

