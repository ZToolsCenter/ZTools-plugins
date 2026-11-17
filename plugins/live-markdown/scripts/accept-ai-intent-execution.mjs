// Actual inference through the complete planned runner. Never applies a proposal to an editor.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
const { createLocalAiService } = require("../preload/local-ai/service.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, ".cache/acceptance/ai-intent");
const server = await createServer({ root, server: { middlewareMode: true, hmr: false, ws: false }, cacheDir: path.join(root, ".cache/vite-intent-eval") });
const service = createLocalAiService({ dataDirectory: path.join(root, ".cache/acceptance/local-ai") });
const report = { model: "Qwen3-0.6B-Q4_K_M.gguf", status: "running", cases: [] };
const content = "---\ntitle: 验收\n---\n\n# 发布说明\n\n已完成开发，发布前还需检查。\n\n| 状态 | 说明 |\n| --- | --- |\n| 待检查 | 保留 |\n\n公式：$x^2$。\n\n```js\nconst version = 1;\n```\n\n原文结尾。";
try {
  const { runPlannedAiTask } = await server.ssrLoadModule("/src/core/ai/plannedTaskRunner.ts");
  const { resolveAiEdit } = await server.ssrLoadModule("/src/core/ai/editProposal.ts");
  const plan = (await service.inspect()).plans.find((item) => item.id === "light");
  if (!plan?.cached || plan.downloadBytes) throw new Error("No cached light model; refusing downloads");
  await service.deploy("light");
  const startup = Date.now();
  while ((await service.getStatus()).phase !== "ready") {
    if (Date.now() - startup > 60_000) throw new Error("Model startup timed out");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const [id, instruction, selected] of [
    ["rich-literal-append", "底部加hello", false],
    ["selected-explicit-document", "在当前文档最末尾添加hello", true],
    ["summary-answer", "总结这篇文章", false]
  ]) {
    const record = { id, calls: [], passed: false };
    const snapshot = { documentId: "real-inference", revision: 1, content, selection: selected ? { from: 37, to: 43 } : null, cursor: 0, readOnly: false };
    try {
      const result = await runPlannedAiTask({ source: content, action: "custom", userPrompt: instruction, baseSystemPrompt: "你是中文 Markdown 助手，只输出结果。", actionDefinition: { id: "custom", label: "自定义", prompt: instruction } }, snapshot, {
        isCurrent: () => true,
        abortCurrent: () => { void service.cancelGeneration(record.requestId); },
        invoke: async (prompt, systemPrompt, maxTokens, onChunk) => {
          const requestId = `real-execution-${id}-${record.calls.length}-${Date.now()}`;
          record.requestId = requestId;
          const at = Date.now();
          const output = await service.generate({ requestId, source: "managed", modelId: plan.modelId, prompt, systemPrompt, maxTokens, contextTokens: 4096 }, onChunk);
          record.calls.push({ elapsedMs: Date.now() - at, output });
          return output;
        }
      });
      if (id === "summary-answer") {
        record.passed = result.answerOnly === true && !result.proposal && result.text.trim().length > 0 && record.calls.length === 2;
        record.answer = result.text;
      } else {
        const edit = result.proposal && resolveAiEdit(result.proposal);
        record.passed = Boolean(edit && edit.content === content + "\n\nhello" && record.calls.length === 1);
        record.patch = result.proposal?.patch;
      }
    } catch (error) { record.error = error.message; }
    delete record.requestId;
    report.cases.push(record);
    console.log(JSON.stringify({ id, passed: record.passed, calls: record.calls.length, error: record.error }));
  }
  report.status = report.cases.every((item) => item.passed) ? "passed" : "failed";
} catch (error) { report.status = "failed"; report.error = error.stack; }
finally { await service.release(); await server.close(); fs.writeFileSync(path.join(folder, "real-execution.json"), JSON.stringify(report, null, 2) + "\n"); }
if (report.status !== "passed") process.exitCode = 1;
