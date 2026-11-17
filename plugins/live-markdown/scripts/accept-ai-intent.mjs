// Opt-in local inference evaluation. Cached resources only; no downloads or editor writes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
const { createLocalAiService } = require("../preload/local-ai/service.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2] ?? "light";
const repetitions = Math.max(1, Math.min(3, Number(process.argv.find((arg) => arg.startsWith("--repeat="))?.split("=")[1] ?? 1)));
const artifacts = path.join(root, ".cache/acceptance/ai-intent");
fs.mkdirSync(artifacts, { recursive: true });
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(root, ".cache/vite-intent-eval") });
const service = createLocalAiService({ dataDirectory: path.join(root, ".cache/acceptance/local-ai") });
const report = { profile, date: new Date().toISOString(), platform: process.platform, arch: process.arch, cases: [], status: "running" };
const cases = [
  ["append", "底部加hello", "edit", "document_end", "literal"],
  ["paraphrase", "把 hello 放到全文最末尾", "edit", "document_end", "literal"],
  ["quoted", "在文末原样添加“你好，世界！”", "edit", "document_end", "literal"],
  ["negative", "不要在底部加hello", "clarify"],
  ["explain", "解释‘底部加hello’是什么意思", "answer"],
  ["summary", "总结这篇文章", "answer", "document", "generate"],
  ["append-summary", "在文末写一段总结", "edit", "document_end", "generate"],
  ["polish", "润色全文，保留原意", "edit", "document", "generate"],
  ["compound", "底部加hello，再润色第一段", "clarify"],
  ["ambiguous-selection", "底部加hello", "clarify", undefined, undefined, true],
  ["selection", "只润色选区", "edit", "selection", "generate", true],
  ["explicit-document", "在当前文档最末尾添加hello", "edit", "document_end", "literal", true]
];
try {
  const { planAiIntent } = await server.ssrLoadModule("/src/core/ai/intentPlanner.ts");
  const { extractIntentLiterals, INTENT_SYSTEM_PROMPT } = await server.ssrLoadModule("/src/core/ai/intentPrompts.ts");
  const { bindAiIntent, buildBoundIntentPatch } = await server.ssrLoadModule("/src/core/ai/intentBinder.ts");
  report.prompt = INTENT_SYSTEM_PROMPT;
  report.repetitions = repetitions;
  const env = await service.inspect();
  const plan = env.plans.find((item) => item.id === profile);
  if (!plan?.cached || plan.downloadBytes !== 0) throw new Error("Model not cached; refusing to download");
  report.model = plan.modelId;
  await service.deploy(profile);
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const status = await service.getStatus();
    if (status.phase === "ready") break;
    if (["error", "cancelled"].includes(status.phase)) throw new Error(status.error || status.message);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if ((await service.getStatus()).phase !== "ready") throw new Error("Cached model startup timed out");
  for (let repetition = 1; repetition <= repetitions; repetition++) for (const [id, instruction, kind, target, mode, selected] of cases) {
    const record = { id, repetition, instruction, calls: 0, elapsedMs: 0, passed: false, raw: null };
    const at = Date.now();
    try {
      const candidates = { headings: [], literals: extractIntentLiterals(instruction) };
      const intent = await planAiIntent(instruction, Boolean(selected), candidates, async (prompt, systemPrompt, maxTokens) => {
        record.calls++;
        const output = await service.generate({ requestId: `intent-${profile}-${id}-${Date.now()}`, source: "managed", modelId: plan.modelId, prompt, systemPrompt, maxTokens, contextTokens: 4096 });
        record.raw = output;
        return output;
      });
      record.intent = intent;
      record.passed = intent.kind === kind && (!target || intent.target === target) && (!mode || intent.content?.mode === mode);
      if (mode === "literal" && instruction.includes("hello")) record.passed &&= intent.content.text === "hello";
      const reason = { negative: "missing_operation", compound: "compound", "ambiguous-selection": "scope_conflict" }[id];
      if (reason) record.passed &&= intent.reason === reason;
      if (intent.kind === "edit") {
        const content = "# 文稿\n\n选择内容。\n\n原文结尾。";
        try {
          const bound = bindAiIntent(intent, { documentId: "evaluation", revision: 1, content, cursor: 0, selection: selected ? { from: 6, to: 11 } : null, readOnly: false }, instruction, candidates);
          if (bound.literalText !== undefined) record.patch = buildBoundIntentPatch(bound, bound.literalText);
          record.binding = "bound";
        } catch (error) { record.binding = "blocked"; record.bindingError = error.message; }
      }
    } catch (error) { record.error = error.message; }
    record.elapsedMs = Date.now() - at;
    report.cases.push(record);
    console.log(JSON.stringify({ id, repetition, passed: record.passed, elapsedMs: record.elapsedMs, intent: record.intent, binding: record.binding, error: record.error }));
  }
  report.passed = report.cases.filter((item) => item.passed).length;
  report.status = report.passed === cases.length * repetitions ? "passed" : "failed";
} catch (error) { report.status = "failed"; report.error = error.stack; }
finally {
  await service.release();
  await server.close();
  fs.writeFileSync(path.join(artifacts, `real-${profile}.json`), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ profile, status: report.status, passed: report.passed, total: report.cases.length, error: report.error }));
if (report.status !== "passed") process.exitCode = 1;
