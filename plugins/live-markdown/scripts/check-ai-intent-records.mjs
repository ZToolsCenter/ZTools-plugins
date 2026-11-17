// Replay actual captured plans through current deterministic guards without a second model call.
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, ".cache/acceptance/ai-intent");
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(root, ".cache/vite-intent-eval") });
const reports = [];
try {
  const { bindAiIntent, buildBoundIntentPatch } = await server.ssrLoadModule("/src/core/ai/intentBinder.ts");
  const { extractIntentLiterals } = await server.ssrLoadModule("/src/core/ai/intentPrompts.ts");
  for (const model of ["light", "balanced"]) {
    const raw = JSON.parse(fs.readFileSync(path.join(folder, `real-${model}.json`), "utf8"));
    const cases = raw.cases.map((record) => {
      const content = "# 文稿\n\n选择内容。\n\n原文结尾。";
      const selected = ["ambiguous-selection", "selection", "explicit-document"].includes(record.id);
      const result = { id: record.id, repetition: record.repetition, semanticPass: record.passed, executable: false, unsafe: false };
      if (!record.intent) return { ...result, blocked: "invalid_protocol" };
      try {
        const bound = bindAiIntent(record.intent, { documentId: "replay", revision: 1, content, cursor: 0, selection: selected ? { from: 6, to: 11 } : null, readOnly: false }, record.instruction, { headings: [], literals: extractIntentLiterals(record.instruction) });
        result.executable = record.intent.kind === "edit";
        if (bound.literalText !== undefined) result.patch = buildBoundIntentPatch(bound, bound.literalText);
        // The observed failed compound reason is safe when it cannot become a write.
        result.unsafe = result.executable && !record.passed;
      } catch (error) { result.blocked = error.message; }
      return result;
    });
    reports.push({ model, semanticPassed: raw.passed, total: cases.length, unsafeEditablePlans: cases.filter((item) => item.unsafe).length, cases });
  }
} finally { await server.close(); }
fs.writeFileSync(path.join(folder, "recorded-plan-replay.json"), JSON.stringify(reports, null, 2) + "\n");
console.log(JSON.stringify(reports.map(({ cases: _cases, ...report }) => report)));
if (reports.some((report) => report.unsafeEditablePlans)) process.exitCode = 1;
