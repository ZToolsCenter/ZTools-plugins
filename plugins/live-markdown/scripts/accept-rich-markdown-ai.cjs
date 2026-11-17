"use strict";

// Real cached models through the production assistant UI and the real managed service.
// Only host persistence/menus are fixture APIs; this is not native ZTools acceptance.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("../tests/e2e/browser.cjs");
const { installLocalAiWorkflow } = require("../tests/e2e/fixtures/local-ai-workflow.cjs");
const { createLocalAiService } = require("../preload/local-ai/service.cjs");
const { validateCaseResult } = require("./rich-markdown-case-validation.cjs");

const outputRoot = path.join(pluginRoot, ".cache/acceptance/rich-markdown");
const dataRoot = path.join(pluginRoot, ".cache/acceptance/local-ai");
const indexUrl = pathToFileURL(path.join(pluginRoot, "dist/index.html")).href;
const attemptId = new Date().toISOString().replace(/[:.]/g, "-");
const attemptRoot = path.join(outputRoot, `attempt-${attemptId}`);
const imagePath = path.join(attemptRoot, "assets", "deploy.svg");
const imageUrl = pathToFileURL(imagePath).href;
const models = [
  { profile: "light", name: "Qwen3 0.6B Q4_K_M", modelId: "Qwen3-0.6B-Q4_K_M.gguf" },
  { profile: "balanced", name: "Qwen3 1.7B Q4_K_M", modelId: "Qwen3-1.7B-Q4_K_M.gguf" }
];
const richSource = `---
title: "部署说明"
tags: [ai, markdown]
---

# 🧭 部署计划

我们已经把这个服务部署好了，但是还需要对它进行一些检查。

任务图标：
- [x] 验证摘要
- [ ] 验证图片说明 😊

图片引用：![部署图](${imageUrl} "架构图")

公式定义：内联损失 $L = \\sum_{i=1}^{n}(y_i-\\hat y_i)^2$，均值为 $\\bar{x}$。

$$
\\mathrm{score} = \\frac{1}{n}\\sum_{i=1}^{n}x_i
$$

| 阶段 | 命令 | 备注 |
| --- | --- | --- |
| 构建 | \`npm run build\` | 支持 \\| 转义 |
| 发布 | \`npm run package\` | 本地校验 |

[^source]: 流程变更后需重新执行完整验证。

\`\`\`mermaid
flowchart TD
  A[编辑] --> B{校验}
  B -->|通过| C[发布]
\`\`\`

\`\`\`js
const ready = true;
\`\`\`
`;
const cases = [
  { id: "full-polish", title: "复杂全文润色和格式保持", kind: "action", action: "润色", source: richSource,
    preservation: ["---\ntitle: \"部署说明\"\ntags: [ai, markdown]\n---", `![部署图](${imageUrl} \"架构图\")`, "$L = \\sum_{i=1}^{n}(y_i-\\hat y_i)^2$", "$$\n\\mathrm{score} = \\frac{1}{n}\\sum_{i=1}^{n}x_i\n$$", "| 构建 | `npm run build` | 支持 \\| 转义 |", "| 发布 | `npm run package` | 本地校验 |", "[^source]", "- [x] 验证摘要", "- [ ] 验证图片说明", "🧭", "```mermaid\nflowchart TD\n  A[编辑] --> B{校验}\n  B -->|通过| C[发布]\n```", "```js\nconst ready = true;\n```"],
    semanticPrompt: "评估润色后中文是否更清晰、自然并保留原意；核对emoji、任务清单图标、图片链接与所有原有Markdown结构。" },
  { id: "selection-only", title: "选区段落润色且文档其他内容原样保留", kind: "selection", action: "润色",
    source: "这是一个需要清楚说明的段落但是表述并不够准确，可能会让读者产生误解。\n\n| 字段 | 值 |\n| --- | --- |\n| 环境 | \`production\` |\n\n全文结尾保持不变。", selection: "这是一个需要清楚说明的段落但是表述并不够准确，可能会让读者产生误解。",
    preservation: ["| 字段 | 值 |\n| --- | --- |\n| 环境 | `production` |", "全文结尾保持不变。"], semanticPrompt: "只改选区文字；选区外必须逐字原样保留。" },
  { id: "mermaid-insert", title: "生成并渲染Mermaid流程图", kind: "skill", skill: "Mermaid 架构图生成",
    source: "# 发布流程\n\n开发提交代码，CI 运行测试；测试通过后才允许部署，失败则退回修复。\n\n", semanticPrompt: "新增内容需是语法有效且渲染的Mermaid流程或时序图fence，含提交、CI、通过与失败分支；验收前后源码及实际渲染SVG。" },
  { id: "math-add", title: "新增数学公式和变量说明", kind: "custom", prompt: "请在文档中增加一个Markdown数学优化目标公式，使用成对的 $$ 块级定界符，并在其下增加变量说明，至少解释 n 与 x_i。保留现有正文、公式和语法。只返回完整Markdown正文。",
    source: "# 优化目标\n\n我们需要说明怎样估算一组样本的平均值。", semanticPrompt: "结果应新增一个成对$$块级公式，并用文字准确解释公式变量 n 和 x_i。" },
  { id: "table-add", title: "新增Markdown表格", kind: "custom", prompt: "请在文档中新增一个有效的 GFM Markdown 表格，用于比较轻量模型与均衡模型；至少有模型、内存、适用场景三列和两行数据。表格前后各保留一句说明。只返回完整Markdown正文。",
    source: "# 模型选择\n\n本文比较两个可选方案。\n\n请根据电脑内存和任务复杂度选择。", semanticPrompt: "结果应新增语法有效且至少含三列、表头分隔行和两条数据行的表格。" },
  { id: "protected-edit", title: "明确要求修改现有表格及公式（验证保护边界）", kind: "custom", prompt: "将表格中“轻量”的内存值从“4 GB”改为“8 GB”，并把公式 \`$J = x + 1$\` 改成 \`$J = x + 2$\`。请保持文档其他部分不变，只返回完整Markdown。",
    source: "# 现有方案\n\n轻量配置适合多数设备。\n\n| 模型 | 内存 |\n| --- | --- |\n| 轻量 | 4 GB |\n| 均衡 | 8 GB |\n\n成本公式为 $J = x + 1$。", protectedEdit: true,
    semanticPrompt: "此用例用来确认当前安全保护是否会拒绝修改表格/公式。若保护内容保留，记录为按设计拒绝；不得把它算作语义编辑成功。" },
  { id: "truncation-guard", title: "超长生成失败时不写回", kind: "custom", prompt: "为了压测输出完整性，请从文档主题出发，生成一个包含 300 个不同条目的Markdown编号清单，每一条都写出序号和一句有实际信息的说明。不要省略、概括或用省略号代替；只返回完整Markdown正文。",
    source: "# Markdown完整性压测\n\n该文档用于验证长输出被截断时编辑器能够拒绝不完整的结果。", expectError: true,
    semanticPrompt: "真实模型响应若因长度限制截断，UI必须显示拒绝错误、无可应用预览，文档源码必须精确保持不变。" }
];

function now() { return new Date().toISOString(); }
function distReceipt() {
  const dist = path.join(pluginRoot, "dist");
  const scripts = fs.readdirSync(path.join(dist, "assets"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => {
      const file = path.join(dist, "assets", name);
      return { file: path.relative(pluginRoot, file), bytes: fs.statSync(file).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
    });
  const html = path.join(dist, "index.html");
  return { indexHtmlMtime: fs.statSync(html).mtime.toISOString(), indexHtmlSha256: crypto.createHash("sha256").update(fs.readFileSync(html)).digest("hex"), scripts };
}
function writeText(file, value) { fs.writeFileSync(file, `${value.replace(/\n?$/, "\n")}`, "utf8"); }
function escapeMarkdown(value) { return value.replace(/[|\\]/g, "\\$&"); }

async function waitForModel(service, profile) {
  const env = await service.inspect();
  const plan = env.plans.find((item) => item.id === profile);
  assert.ok(plan?.cached, `${profile} is not completely cached; refusal to download any model`);
  assert.equal(plan.downloadBytes, 0, `${profile} would require downloading resources; refusal to download`);
  const start = Date.now();
  await service.deploy(profile);
  while (Date.now() - start < 120_000) {
    const status = await service.getStatus();
    if (status.phase === "ready") return { startupMs: Date.now() - start, plan, status };
    if (["error", "cancelled"].includes(status.phase)) throw new Error(`Cached ${profile} model failed to start: ${status.error || status.message}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Cached ${profile} startup timed out`);
}

async function launchCase(browser, api, model, testCase, folder, replay = null) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12_000);
  const pageErrors = [];
  const requestRecords = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.exposeFunction("__realLocalAi", async (method, args) => {
    if (method === "generate") {
      const started = Date.now();
      const record = { model: model.name, mode: replay ? "saved_real_model_output_replay" : "real_inference", sourceArtifact: replay?.sourceArtifact || null, request: args[0], chunks: [], startedAt: now(), elapsedMs: null, output: null, error: null };
      requestRecords.push(record);
      try {
        const onChunk = (chunk) => {
          record.chunks.push(chunk);
          void page.evaluate(({ id, chunk: part }) => window.__realChunks.get(id)?.(part), { id: args[0].requestId, chunk }).catch(() => {});
        };
        let output;
        if (replay) {
          output = replay.output;
          onChunk(output);
        } else output = await api.generate(args[0], onChunk);
        record.output = output;
        return output;
      } catch (error) {
        record.error = error.message;
        throw error;
      } finally {
        record.elapsedMs = Date.now() - started;
        record.finishedAt = now();
      }
    }
    if (!["inspect", "getStatus", "deploy", "cancelDeployment", "cancelGeneration"].includes(method)) throw new Error(`Unsupported acceptance method: ${method}`);
    return api[method](...args);
  });
  await page.addInitScript(installLocalAiWorkflow, { configured: true, content: testCase.source, captureClipboard: true });
  await page.addInitScript((modelId) => {
    window.localStorage.setItem("typora_agent_orchestration_config_v1", JSON.stringify({
      provider: "local", model: modelId, providerConfigured: true, localAiSource: "managed", activeRoleId: "general",
      permissionLevel: "confirm"
    }));
  }, model.modelId);
  await page.addInitScript(() => {
    window.__realChunks = new Map();
    for (const method of ["inspect", "getStatus", "deploy", "cancelDeployment", "cancelGeneration"]) {
      window.typoraBridge.localAi[method] = (...args) => window.__realLocalAi(method, args);
    }
    window.typoraBridge.localAi.generate = async (input, onChunk) => {
      window.__realChunks.set(input.requestId, onChunk);
      try { return await window.__realLocalAi("generate", [input]); }
      finally { window.__realChunks.delete(input.requestId); }
    };
  });
  const result = {
    id: testCase.id, title: testCase.title, status: "blocked", model: model.name,
    inferenceMode: replay ? "saved_real_model_output_replay" : "real_inference",
    startedAt: now(), inputMarkdown: testCase.source, requestedTask: testCase.prompt || testCase.semanticPrompt,
    semanticReview: { status: "pending_human_review", rubric: testCase.semanticPrompt },
    formattingProtection: { status: "not_checked", expectedUnchanged: testCase.preservation || [] },
    rendering: { status: "not_checked", selectors: null },
    elapsedMs: null, pageErrors, rawRequests: requestRecords
  };
  const started = Date.now();
  try {
    await page.goto(indexUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#write .cm-content").waitFor();
    await switchSourceMode(page);
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    if (testCase.kind === "selection") await selectText(page, testCase.selection);
    if (testCase.kind === "skill") {
      await page.locator(".ty-ai-tabs").getByRole("button", { name: "Skills", exact: true }).click();
      const skillCard = page.locator(".ty-ai-skills-card").filter({ hasText: testCase.skill });
      await skillCard.getByRole("button", { name: "运行", exact: true }).click();
    } else if (testCase.kind === "custom") {
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(testCase.prompt);
      await page.getByRole("button", { name: "发送指令" }).click();
    } else {
      await page.locator(".ty-ai-actions").getByRole("button", { name: testCase.action, exact: true }).click();
    }
    const outcome = await waitForOutcome(page, testCase.id === "truncation-guard" ? 300_000 : 180_000);
    result.rawRequests = requestRecords;
    if (outcome === "error") {
      result.error = await page.locator(".ty-ai-error").innerText();
      result.previewExists = (await page.locator(".ty-ai-review").count()) > 0;
      result.beforeSource = await sourceText(page);
      result.afterSource = result.beforeSource;
      await page.screenshot({ path: path.join(folder, "error.png"), fullPage: true });
      assert.equal(result.previewExists, false, "Failed/truncated generation must not offer an applicable preview");
      assert.equal(result.afterSource, testCase.source, "Failed generation must leave source unchanged");
      if (testCase.expectError) {
        assert.match(result.error, /截断|truncat|length/i);
        result.status = "passed";
        result.formattingProtection = { status: "passed", details: "No preview was offered and exact editor source remained unchanged after real truncation rejection." };
      } else if (testCase.id === "full-polish" || testCase.protectedEdit) {
        const protectionError = /protected.*(?:markdown|structure|marker)|受保护.*结构/i.test(result.error);
        result.status = testCase.protectedEdit && !protectionError ? "not_exercised" : "safely_rejected";
        result.formattingProtection = protectionError
          ? { status: "passed", details: "Malformed/altered protected markers caused UI rejection; no preview was offered and source remained exact." }
          : { status: "not_exercised", details: "Generation stopped before a proposal for reasons unrelated to protected-region validation; protection behavior was not exercised." };
        result.semanticReview.status = "task_not_met";
        result.semanticReview.details = "The actual model output failed proposal validation, so semantic completion was not achieved.";
      } else {
        throw new Error(`Unexpected real-model generation error: ${result.error}`);
      }
    } else {
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      result.previewText = await page.evaluate(() => window.__workflow.copiedText);
      assert.equal(typeof result.previewText, "string", "the real copy action must retain the full proposal for rich-markdown checks");
      result.beforeSource = await sourceText(page);
      result.previewVisibleBeforeConfirmation = true;
      await page.screenshot({ path: path.join(folder, "preview.png"), fullPage: true });
      result.previewDiff = { sourceBeforeConfirmation: result.beforeSource, proposedText: result.previewText };
      assert.equal(result.beforeSource, testCase.source, "Proposal must remain preview-only before confirmation");
      if (testCase.expectError) {
        result.status = "not_exercised";
        result.formattingProtection = { status: "not_exercised", details: "The genuine model stopped naturally and did not produce a transport-level length/truncation error; safe rejection was not exercised." };
        result.semanticReview.status = "task_not_met";
        result.semanticReview.details = "The request for 300 substantive rows did not hit the truncation boundary; the observed output is retained but this is not a safe-truncation pass.";
        return result;
      }
      await page.getByRole("button", { name: /确认并/ }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      result.afterSource = await sourceText(page);
      result.confirmed = true;
      await page.locator('[aria-label="关闭 AI 助手"]').click();
      await page.locator(".typora-ai-assistant-drawer").waitFor({ state: "detached" });
      await switchSourceMode(page, "live");
      if (testCase.id.startsWith("mermaid-insert") || testCase.id.startsWith("math-add")) await moveLiveCursorToOriginalParagraph(page, testCase.source);
      await page.screenshot({ path: path.join(folder, "applied.png"), fullPage: true });
      result.rendering.selectors = await page.evaluate(() => ({
        diagramSvg: document.querySelectorAll(".ty-diagram-block svg").length,
        diagramBlock: document.querySelectorAll(".ty-diagram-block").length,
        blockMath: document.querySelectorAll(".ty-math-block-render").length,
        inlineMath: document.querySelectorAll(".ty-math-inline-render").length,
        tables: document.querySelectorAll("table").length,
        tableCellCounts: [...document.querySelectorAll("table")].map((table) => [...table.querySelectorAll("tr")].map((row) => row.querySelectorAll("th,td").length)),
        imageCount: document.querySelectorAll("img").length,
        taskMarkers: document.querySelectorAll("input.ty-task-checkbox").length,
        taskCheckboxes: [...document.querySelectorAll("input.ty-task-checkbox")].map((input) => ({ checked: input.checked, disabled: input.disabled })),
        images: [...document.querySelectorAll("img")].map((image) => ({ src: image.src, srcAttribute: image.getAttribute("src"), alt: image.alt, complete: image.complete, naturalWidth: image.naturalWidth, bounds: (() => { const rect = image.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })() }))
      }));
      result.rendering.status = "observed";
      validateCaseResult(testCase, result, imageUrl);
      if (testCase.protectedEdit) {
        result.semanticReview.status = "unsupported_by_protection";
        result.semanticReview.details = "The prompt explicitly requested edits inside a protected table and formula; originals are checked unchanged. This is a deliberate boundary observation, not semantic task success.";
      }
      result.status = "passed";
    }
    assert.deepEqual(pageErrors, [], "Browser raised uncaught errors");
  } catch (error) {
    result.status = "failed";
    result.failure = error.stack || error.message;
    await page.screenshot({ path: path.join(folder, "failure.png"), fullPage: true }).catch(() => {});
  } finally {
    result.elapsedMs = Date.now() - started;
    result.finishedAt = now();
    result.rawRequests = requestRecords;
    fs.mkdirSync(folder, { recursive: true });
    writeText(path.join(folder, "input.md"), testCase.source);
    writeText(path.join(folder, "requested-task.txt"), testCase.prompt || testCase.semanticPrompt);
    if (result.previewText !== undefined) writeText(path.join(folder, "preview.md"), result.previewText);
    if (result.afterSource !== undefined) writeText(path.join(folder, "after.md"), result.afterSource);
    for (const [index, request] of requestRecords.entries()) {
      writeText(path.join(folder, `raw-request-${index + 1}.json`), JSON.stringify(request, null, 2));
      if (request.output !== null) writeText(path.join(folder, `raw-output-${index + 1}.md`), request.output);
    }
    writeText(path.join(folder, "case.json"), JSON.stringify(result, null, 2));
    await page.close();
  }
  return result;
}

async function selectText(page, selected) {
  const editor = page.locator("textarea.ty-source-textarea");
  await editor.evaluate((node, length) => { node.focus(); node.setSelectionRange(0, length); node.dispatchEvent(new Event("select", { bubbles: true })); }, selected.length);
  await page.getByText(/将处理当前选区/).waitFor();
  const scope = await page.locator(".ty-ai-scope").innerText();
  assert.match(scope, new RegExp(`${selected.length}\\s*字符`));
}
async function moveLiveCursorToOriginalParagraph(page, originalSource) {
  const paragraph = originalSource.split(/\r?\n/).find((line) => line.trim() && !/^\s*#/.test(line));
  const marker = paragraph?.trim().slice(0, Math.min(12, paragraph.trim().length));
  if (!marker) throw new Error("Cannot identify the original explanation paragraph for post-apply rendering observation");
  const line = page.locator("#write .cm-line").filter({ hasText: marker }).first();
  await line.waitFor();
  await line.click({ position: { x: 12, y: 8 } });
}
async function waitForOutcome(page, timeout) {
  await page.waitForFunction(() => Boolean(document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error")), null, { timeout });
  return await page.locator(".ty-ai-error").count() ? "error" : "review";
}
async function switchSourceMode(page, mode = "source") {
  const source = page.locator("textarea.ty-source-textarea");
  const inSourceMode = await source.count() > 0;
  if ((mode === "source") === inSourceMode) return;
  await page.locator(".ty-menu-trigger").filter({ hasText: "视图" }).click();
  const target = mode === "source" ? "源代码模式" : "实时预览 (所见即所得)";
  await page.locator(".ty-menu-dropdown .ty-menu-option").filter({ hasText: target }).click();
  if (mode === "source") await source.waitFor();
  else await page.locator("#write .cm-content").waitFor();
}
async function sourceText(page) { return page.locator("textarea.ty-source-textarea").inputValue(); }

async function runModel(browser, model) {
  const modelFolder = path.join(attemptRoot, model.profile);
  fs.mkdirSync(modelFolder, { recursive: true });
  const service = createLocalAiService({ dataDirectory: dataRoot });
  const deploymentStarted = Date.now();
  let startup;
  const results = [];
  try {
    startup = await waitForModel(service, model.profile);
    for (const testCase of cases) {
      const folder = path.join(modelFolder, testCase.id);
      fs.mkdirSync(folder, { recursive: true });
      results.push(await launchCase(browser, service, model, testCase, folder));
    }
    return { profile: model.profile, model: model.name, startupMs: startup.startupMs, planCached: startup.plan.cached, downloadBytes: startup.plan.downloadBytes, cases: results, elapsedMs: Date.now() - deploymentStarted };
  } finally {
    await service.release();
  }
}

async function runSavedOutputReplays(browser) {
  const baseAttempt = path.join(outputRoot, "attempt-2026-10-22T03-47-23-377Z");
  const results = [];
  for (const model of models) {
    const service = createLocalAiService({ dataDirectory: dataRoot });
    const started = Date.now();
    try {
      const startup = await waitForModel(service, model.profile);
      const modelResults = [];
      const replayIds = process.argv.includes("--math-only") ? ["math-add"] : ["mermaid-insert", "math-add"];
      for (const id of replayIds) {
        const testCase = cases.find((item) => item.id === id);
        const sourceArtifact = path.join(baseAttempt, model.profile, id, "raw-output-1.md");
        const output = fs.readFileSync(sourceArtifact, "utf8").trimEnd();
        const replayCase = { ...testCase, id: `${id}-replay-${model.profile}`, title: `回放已保存的真实模型${id === "mermaid-insert" ? "Mermaid" : "公式"}输出` };
        const folder = path.join(attemptRoot, model.profile, `${id}-saved-replay`);
        fs.mkdirSync(folder, { recursive: true });
        const result = await launchCase(browser, service, model, replayCase, folder, { output, sourceArtifact: path.relative(pluginRoot, sourceArtifact) });
        result.semanticReview = { status: "not_applicable", details: "Replay of the exact saved output from the fixed 03-47 real-inference sample; this checks product confirmation/rendering in the Chromium distribution page and does not perform or claim new inference or native ZTools acceptance." };
        writeText(path.join(folder, "case.json"), JSON.stringify(result, null, 2));
        modelResults.push(result);
      }
      results.push({ profile: model.profile, model: model.name, inferenceMode: "saved_real_model_output_replay", startupMs: startup.startupMs, downloadBytes: startup.plan.downloadBytes, cases: modelResults, elapsedMs: Date.now() - started });
    } finally {
      await service.release();
    }
  }
  return results;
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120"><rect width="360" height="120" rx="12" fill="#edf4ff"/><path d="M48 60h88m0 0 20-20m-20 20 20 20m-20-20h112" stroke="#2563eb" stroke-width="6" fill="none"/><rect x="20" y="35" width="56" height="50" rx="8" fill="#dbeafe" stroke="#2563eb"/><rect x="138" y="20" width="68" height="80" rx="8" fill="#dcfce7" stroke="#16a34a"/><rect x="270" y="35" width="68" height="50" rx="8" fill="#fef3c7" stroke="#d97706"/><text x="48" y="65" text-anchor="middle" font-size="13">编辑</text><text x="172" y="65" text-anchor="middle" font-size="13">校验</text><text x="304" y="65" text-anchor="middle" font-size="13">发布</text></svg>\n');
  const browser = await launchBrowser();
  const report = {
    title: "Live Markdown real-model complex Markdown acceptance",
    startedAt: now(),
    scope: "Production dist/index.html in headless Chromium using genuine cached Qwen inference; persistence/menu APIs are fixtures, not native ZTools host verification.",
    distReceipt: distReceipt(),
    modelCache: dataRoot,
    noDownloadPolicy: "Inspect cached status first; script refuses a model whose profile is not fully cached. It never installs or downloads resources.",
    qualityPolicy: "Syntax protection, semantic task quality, and rendered UI evidence are reported separately. Semantic prose quality remains pending independent human review of preview.md and after.md.",
    casesPerModel: cases.map(({ id, title }) => ({ id, title })),
    attemptId, models: [], status: "running"
  };
  try {
    if (process.argv.includes("--math-only") && !process.argv.includes("--replay-only")) throw new Error("--math-only requires --replay-only; only saved outputs may be replayed in this mode.");
    if (process.argv.includes("--replay-only")) {
      report.replays = await runSavedOutputReplays(browser);
      report.status = report.replays.some((model) => model.cases.some((item) => item.status === "failed")) ? "partial" : "observed";
      report.finishedAt = now();
      report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
      const replayPath = path.join(attemptRoot, "replay-report.json");
      writeText(replayPath, JSON.stringify(report, null, 2));
      const lines = [`# Saved real-model output replay`, "", `Attempt: \`${attemptId}\``, `Based on fixed real-inference attempt: \`attempt-2026-10-22T03-47-23-377Z\``, `Status: **${report.status}**`, "", "| Model | Case | Result | Block math | Inline math | Mermaid SVG | Format |", "| --- | --- | --- | ---: | ---: | ---: | --- |"];
      for (const model of report.replays) for (const item of model.cases) lines.push(`| ${escapeMarkdown(model.model)} | ${escapeMarkdown(item.id)} | ${item.status} | ${item.rendering.selectors?.blockMath ?? "n/a"} | ${item.rendering.selectors?.inlineMath ?? "n/a"} | ${item.rendering.selectors?.diagramSvg ?? "n/a"} | ${item.formattingProtection.status} |`);
      lines.push("", "Each output was generated in the fixed real-inference attempt and replayed through the production distribution page in Chromium; host/menu/persistence APIs are fixtures, so native ZTools behavior remains unverified.", "");
      writeText(path.join(attemptRoot, "replay-report.md"), lines.join("\n"));
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    for (const model of models) report.models.push(await runModel(browser, model));
    report.replays = await runSavedOutputReplays(browser);
    const caseResults = [...report.models.flatMap((item) => item.cases), ...report.replays.flatMap((item) => item.cases)];
    const semanticPending = caseResults.some((item) => item.semanticReview.status === "pending_human_review");
    report.status = caseResults.some((item) => item.status === "failed") ? "failed" :
      caseResults.some((item) => ["not_exercised", "safely_rejected"].includes(item.status)) || semanticPending ? "partial" : "passed";
    report.summary = {
      passed: caseResults.filter((item) => item.status === "passed").length,
      failed: caseResults.filter((item) => item.status === "failed").length,
      notExercised: caseResults.filter((item) => item.status === "not_exercised").length,
      safelyRejected: caseResults.filter((item) => item.status === "safely_rejected").length,
      blocked: caseResults.filter((item) => item.status === "blocked").length,
      semanticReviewPending: caseResults.filter((item) => item.semanticReview.status === "pending_human_review").length
    };
    report.finishedAt = now();
    report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    writeText(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
    const lines = [
      `# ${report.title}`, "", `Started: ${report.startedAt}`, `Finished: ${report.finishedAt}`, `Status: **${report.status}**`, "",
      report.scope, "", `Attempt: \`${attemptId}\``, `Models: ${report.models.map((entry) => `${entry.model} (startup ${entry.startupMs} ms, download bytes ${entry.downloadBytes})`).join("; ")}`, "",
      "| Model | Case | Status | Time | Protection | Rendering | Semantic review |", "| --- | --- | --- | ---: | --- | --- | --- |"
    ];
    for (const item of report.models) for (const testCase of item.cases) lines.push(`| ${escapeMarkdown(item.model)} | ${escapeMarkdown(testCase.title)} | ${testCase.status} | ${testCase.elapsedMs} ms | ${testCase.formattingProtection.status} | ${testCase.rendering.status} | ${testCase.semanticReview.status} |`);
    for (const item of report.replays) for (const testCase of item.cases) lines.push(`| ${escapeMarkdown(`${item.model} (saved-output replay)`)} | ${escapeMarkdown(testCase.title)} | ${testCase.status} | ${testCase.elapsedMs} ms | ${testCase.formattingProtection.status} | ${testCase.rendering.status} | ${testCase.semanticReview.status} |`);
    lines.push("", "Semantic prose quality needs human review. Open each case's `preview.md`, `after.md`, `input.md` and `case.json`; raw requests, streamed chunks, output/error and timings are retained there.", "", `Screenshots and artifacts are under \`.cache/acceptance/rich-markdown/attempt-${attemptId}/<profile>/<case>/\`. The Chromium fixture does not prove native ZTools host behavior.`, "");
    writeText(path.join(outputRoot, "report.md"), lines.join("\n"));
    process.exitCode = report.status === "passed" ? 0 : 1;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "blocked";
    report.blocker = error.stack || error.message;
    report.finishedAt = now();
    writeText(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
    writeText(path.join(outputRoot, "report.md"), `# ${report.title}\n\nAttempt: \`${attemptId}\`\n\nStatus: **blocked**\n\n${report.blocker}\n`);
    process.exitCode = 2;
    console.error(report.blocker);
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 2; });
