"use strict";

// Fixed-input, real-model harness comparison. Never downloads model resources.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("../tests/e2e/browser.cjs");
const { installLocalAiWorkflow } = require("../tests/e2e/fixtures/local-ai-workflow.cjs");
const { createLocalAiService } = require("../preload/local-ai/service.cjs");

const stage = process.argv[2];
if (!new Set(["baseline", "optimized"]).has(stage)) {
  throw new Error("Usage: node scripts/accept-harness-ai.cjs baseline|optimized");
}
const modelProfiles = [
  { profile: "light", model: "Qwen3 0.6B Q4_K_M", modelId: "Qwen3-0.6B-Q4_K_M.gguf" },
  { profile: "balanced", model: "Qwen3 1.7B Q4_K_M", modelId: "Qwen3-1.7B-Q4_K_M.gguf" }
];
const nativeInputPath = path.join(pluginRoot, ".cache/acceptance/native-host/native-rich-input.md");
const nativeInput = fs.readFileSync(nativeInputPath, "utf8");
const longParagraphs = [
  "发布计划第1段记录了代码冻结时间为2026年10月21日，负责人需要确认构建产物、变更清单和回滚入口。所有数值来自本段原文，润色时只能改善表达，不能把日期改写成其他版本或把检查项合并删除。",
  "发布计划第2段说明，冒烟检查需要依次覆盖登录、文档打开、编辑、保存和撤销操作。测试环境中的成功率目标为99.5%，目前实测值为98.7%，差距必须保留并明确标注为待处理，不得推断已达标。",
  "发布计划第3段列出资源限制：插件解包预算为15 MB，模型文件存放在插件目录之外，单次请求上下文上限按4096 token估算。超过限制时应减少输入范围或拒绝请求，不能通过截断正文来伪装完整处理。",
  "发布计划第4段要求部署前检查Windows、macOS和Linux三个系统的包路径、权限与启动命令。当前仅macOS完成本机验证，Windows和Linux还没有实测结果。文案需要保留这种验收状态，不能把计划描述成已完成。",
  "发布计划第5段记录复杂Markdown验收范围，包括🧭图标、任务清单、含转义竖线的表格、LaTeX公式、Mermaid流程图、脚注和代码围栏。渲染正确只说明显示链路可用，不代表模型理解了数学目标或图表分支。",
  "发布计划第6段要求操作人确认AI预览后再写回源文档，写回作为单次撤销操作处理。停止生成或任意一个分块校验失败时，不得出现可确认的局部提案，原始文档内容需要保持完整。",
  "发布计划第7段规定，选区任务只能发送映射到源码的精确范围，没有选区时才使用当前文件全文。模型切换、编辑期间文档变化和迟到流都应取消当前提案，不能把旧输出覆盖到新内容上。",
  "发布计划第8段总结验收证据：每个场景需记录输入摘要、模型档位、请求次数、总耗时、首字耗时、原始输出、保护结构和最终预览。语法、安全、任务完成和语言质量分别判定，未检查的能力继续标记为待验证。"
];
const longDetails = [
  "交付前还要逐项核对构建日志、产物文件列表和校验摘要，发现不一致时保留原始证据并停止发布。记录中应明确由谁复核、何时复核，以及哪些问题仍需负责人处理，不能把缺少证据的状态改写成通过。",
  "每个测试结果都应绑定测试环境、执行时间、输入数据和实际观察值，避免只留下无法复现的截图。若目标与实测之间存在差距，应保留两者并说明差距，不得通过四舍五入或省略单位让结果看起来达标。",
  "模型资源清单需要独立于插件发布包，核对下载来源、摘要值、解压后的文件位置和剩余磁盘空间。准备失败时应停止写入并显示原因，不能把不完整模型标记为可用，也不能把外部缓存复制回插件目录。",
  "跨系统检查需要分别保存操作系统版本、CPU架构、启动结果和失败日志，不能从一个平台推断另两个平台可用。未执行的系统测试继续列为待验证，后续补测后再更新状态并附上对应机器上的观察证据。",
  "复杂文档验收应把源码结构与屏幕渲染分开检查，逐字比较表格单元格、公式定界符和代码围栏，再查看实际预览。不能仅凭出现了图标或公式样式，就推断图表逻辑正确或数学表达已经得到验证。",
  "预览确认前需要再次比较文档标识、版本号和选区范围，确认期间保持原文不变。任何部分失败都要丢弃整个提案；成功写回以后，操作人应能用一次撤销恢复同一份完整源码。",
  "选择范围必须来自宿主提供的源码位置，记录所用文档版本和边界。若宿主无法映射选区，应明确拒绝本次修改；停止请求后还要丢弃迟到结果，不得将旧版本内容拼接到当前文档。",
  "验收报告应记录每个子请求的上下文配置、输出上限、首段流延迟和最终错误，并保留原始预览以供复查。工具校验通过只代表执行边界正常，语义是否完成仍须按用户要求逐项审核。"
];
const evidenceRule = "复核记录需要保留原始输入、实际观察、责任人和执行时间；如果证据缺失或步骤尚未执行，应标记为待确认并说明需补充的材料，不能从其他段落借用结论来填补。";
const longInput = `# 🧪 固定分块验收\n\n${longParagraphs.map((paragraph, index) => `## 场景 ${index + 1}\n\n${paragraph}\n\n${longDetails[index]} ${evidenceRule}`).join("\n\n")}\n\n| 检查项 | 目标值 | 当前值 |\n| --- | ---: | ---: |\n| 插件预算 | 15 MB | 543 KB |\n| 上下文 | 4096 token | 4096 token |\n\n公式：$q = 0.995 - 0.987 = 0.008$。\n\n结尾原样保留。`;
const fixedEditPrompt = "仅将第一段中的“还需要进行一下检查”改为“仍需检查”，保留所有其他文字、图标、清单、表格、公式与代码。只返回完整 Markdown 正文。";
const cases = [
  { id: "native-rich-polish", title: "原生富文本正文润色", kind: "action", action: "润色", source: nativeInput, anchors: ["结尾保持原样。", "| 正文 | 代码 | 公式 |", "\\bar{x}", "flowchart TD"], facts: ["x^2", "\\frac{1}{n}", "x_i"], expectedFormats: ["| 正文 | 代码 | 公式 |", "flowchart TD", "- [x]", "- [ ]"] },
  { id: "native-rich-focused-edit", title: "复杂 Markdown 定向修改", kind: "custom", prompt: fixedEditPrompt, source: nativeInput, anchors: ["结尾保持原样。", "| 正文 | 代码 | 公式 |", "\\bar{x}", "flowchart TD"], facts: ["x^2", "\\frac{1}{n}", "x_i"], expectedFormats: ["| 正文 | 代码 | 公式 |", "flowchart TD", "- [x]", "- [ ]"], expectedReplacement: "仍需检查" },
  { id: "eight-section-polish", title: "八段长文分块润色", kind: "action", action: "润色", source: longInput, anchors: longParagraphs.map((_, index) => `场景 ${index + 1}`), facts: ["2026年10月21日", "99.5%", "98.7%", "15 MB", "4096 token", "0.008"], expectedFormats: ["| 检查项 | 目标值 | 当前值 |", "公式：$q = 0.995 - 0.987 = 0.008$。", "结尾原样保留。"] }
];
const caseFilter = process.argv.find((argument) => argument.startsWith("--case="))?.slice("--case=".length);
const selectedCases = caseFilter ? cases.filter((item) => item.id === caseFilter) : cases;
if (caseFilter && selectedCases.length === 0) throw new Error(`Unknown case id: ${caseFilter}`);
const modelFilter = process.argv.find((argument) => argument.startsWith("--model="))?.slice("--model=".length);
const selectedModels = modelFilter ? modelProfiles.filter((item) => item.profile === modelFilter) : modelProfiles;
if (modelFilter && selectedModels.length === 0) throw new Error(`Unknown model profile: ${modelFilter}`);
const frozenDist = path.join(pluginRoot, ".cache/acceptance/harness/baseline-dist");
const indexHtml = path.join(stage === "baseline" ? frozenDist : path.join(pluginRoot, "dist"), "index.html");
const attemptId = new Date().toISOString().replace(/[:.]/g, "-");
const artifactRoot = path.join(pluginRoot, `.cache/acceptance/harness/${stage}-${attemptId}`);
const serviceData = path.join(pluginRoot, ".cache/acceptance/local-ai");

function sha256(text) { return crypto.createHash("sha256").update(text).digest("hex"); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeText(file, value) { fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`); }
async function sourceText(page) {
  const textarea = page.locator("textarea.ty-source-textarea");
  if (await textarea.count()) return textarea.inputValue();
  return page.locator("#write .cm-content").evaluate((node) => node.textContent || "");
}
async function switchToSourceMode(page) {
  const source = page.locator("textarea.ty-source-textarea");
  if (await source.count()) return;
  await page.locator(".ty-menu-trigger").filter({ hasText: "视图" }).click();
  await page.locator(".ty-menu-dropdown .ty-menu-option").filter({ hasText: "源代码模式" }).click();
  await source.waitFor();
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function ensureCached(service, profileId) {
  const environment = await service.inspect();
  const plan = environment.plans.find((item) => item.id === profileId);
  assert.ok(plan, `Model profile ${profileId} is unavailable`);
  assert.equal(plan.cached, true, `${profileId} is not cached; refusing to download`);
  assert.equal(plan.downloadBytes, 0, `${profileId} reports bytes to download; refusing`);
  const started = Date.now();
  await service.deploy(profileId);
  while (Date.now() - started < 120_000) {
    const status = await service.getStatus();
    if (status.phase === "ready") return { environment, plan, status, startupMs: Date.now() - started };
    if (["error", "cancelled"].includes(status.phase)) throw new Error(status.error || status.message || `${profileId} startup failed`);
    await wait(500);
  }
  throw new Error(`${profileId} startup timed out`);
}

async function runCase(browser, service, model, testCase) {
  const folder = path.join(artifactRoot, model.profile, testCase.id);
  fs.mkdirSync(folder, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.exposeFunction("__harnessGenerate", async (input) => {
    const started = Date.now();
    const record = { input, chunks: [], startedAt: new Date().toISOString(), firstChunkMs: null, elapsedMs: null, output: null, error: null };
    requests.push(record);
    try {
      const output = await service.generate(input, (chunk) => {
        if (record.firstChunkMs === null) record.firstChunkMs = Date.now() - started;
        record.chunks.push(chunk);
        void page.evaluate(({ requestId, text }) => window.__harnessStream.get(requestId)?.(text), { requestId: input.requestId, text: chunk }).catch(() => undefined);
      });
      record.output = output;
      return output;
    } catch (error) {
      record.error = error.message;
      throw error;
    } finally {
      record.elapsedMs = Date.now() - started;
      record.finishedAt = new Date().toISOString();
    }
  });
  const initConfig = {
    provider: "local", model: model.modelId, providerConfigured: true, localAiSource: "managed", activeRoleId: "general",
    permissionLevel: "confirm", harnessGates: { syntaxHealing: false, panguSpacing: false, stripChitchat: false, securityLeakScan: false }
  };
  const fixtureOptions = { configured: true, content: testCase.source, captureClipboard: true };
  const initSource = `(${installLocalAiWorkflow.toString()})(${JSON.stringify(fixtureOptions)});\n` +
    `localStorage.setItem("typora_agent_orchestration_config_v1", ${JSON.stringify(JSON.stringify(initConfig))});\n` +
    `window.__harnessStream = new Map();\n` +
    `const localAi = window.typoraBridge.localAi;\n` +
    `localAi.getStatus = async () => ({ phase: "ready", modelId: ${JSON.stringify(model.modelId)} });\n` +
    `localAi.generate = async (input, onChunk) => { window.__harnessStream.set(input.requestId, onChunk); try { return await window.__harnessGenerate(input); } finally { window.__harnessStream.delete(input.requestId); } };`;
  await page.addInitScript({ content: initSource });

  const result = {
    id: testCase.id, title: testCase.title, status: "blocked", outcome: null,
    inputSha256: sha256(testCase.source), inputBytes: Buffer.byteLength(testCase.source),
    inputMarkdown: testCase.source, requestedTask: testCase.prompt || testCase.action,
    model: model.model, profile: model.profile, modelId: model.modelId,
    requests, pageErrors, elapsedMs: null, preview: null, editorBefore: null, editorAfter: null,
    anchorCoverage: null, protection: null, confirmed: false, undoRestored: null,
    semanticReview: { status: "pending_human_review", details: "Structural anchors and preservation checks do not determine whether the requested prose edit is semantically good." }
  };
  const started = Date.now();
  try {
    await page.goto(pathToFileURL(indexHtml).href, { waitUntil: "domcontentloaded" });
    await page.locator("#write .cm-content").waitFor();
    await switchToSourceMode(page);
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".typora-ai-assistant-drawer").waitFor();
    if (testCase.kind === "custom") {
      await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(testCase.prompt);
      await page.getByRole("button", { name: "发送指令" }).click();
    } else {
      await page.locator(".ty-ai-actions").getByRole("button", { name: testCase.action, exact: true }).click();
    }
    await page.waitForFunction(() => document.querySelector(".ty-ai-review") || document.querySelector(".ty-ai-error"), null, { timeout: 180_000 });
    result.requests = requests;
    result.editorBefore = await sourceText(page);
    if (await page.locator(".ty-ai-error").count()) {
      result.error = await page.locator(".ty-ai-error").innerText();
      result.editorAfter = await sourceText(page);
      result.previewExists = (await page.locator(".ty-ai-review").count()) > 0;
      result.status = result.previewExists || result.editorAfter !== testCase.source ? "qualityFailure" : "safeRejected";
      result.outcome = result.status;
      result.anchorCoverage = { found: testCase.anchors.filter((anchor) => result.editorAfter.includes(anchor)), missing: [] };
    } else {
      await page.locator(".ty-ai-result-actions").getByRole("button", { name: "复制结果" }).click();
      result.preview = await page.evaluate(() => window.__workflow.copiedText);
      assert.equal(typeof result.preview, "string", "the real copy action must expose the full proposal for acceptance artifacts");
      result.previewVisibleBeforeConfirmation = true;
      assert.equal(result.editorBefore, testCase.source, "Editor content must not change before confirmation");
      result.anchorCoverage = {
        found: testCase.anchors.filter((anchor) => result.preview.includes(anchor)),
        missing: testCase.anchors.filter((anchor) => !result.preview.includes(anchor))
      };
      result.protection = {
        expectedFormats: Object.fromEntries(testCase.expectedFormats.map((value) => [value, result.preview.includes(value)])),
        factualValuesRetained: testCase.facts.every((value) => result.preview.includes(value)),
        requestedChangePresent: !testCase.expectedReplacement || (result.preview.includes(testCase.expectedReplacement) && !result.preview.includes("还需要进行一下检查"))
      };
      result.status = result.anchorCoverage.missing.length || Object.values(result.protection).some((value) => value === false)
        ? "qualityFailure" : "proposal";
      result.outcome = result.status;
      await page.getByRole("button", { name: /确认并/ }).click();
      await page.locator(".ty-ai-review").waitFor({ state: "detached" });
      result.confirmed = true;
      result.editorAfter = await sourceText(page);
      await page.locator("textarea.ty-source-textarea").press("Meta+z");
      await page.waitForFunction((initial) => document.querySelector("textarea.ty-source-textarea")?.value === initial, testCase.source, { timeout: 10_000 }).catch(() => undefined);
      result.undoRestored = (await sourceText(page)) === testCase.source;
    }
    assert.deepEqual(pageErrors, [], "Page errors were observed");
  } catch (error) {
    result.status = "blocked";
    result.outcome = "blocked";
    result.failure = error.stack || error.message;
    result.debug = {
      assistantText: await page.locator(".typora-ai-assistant-drawer").innerText().catch(() => null),
      requestInputs: await page.evaluate(() => window.__workflow?.requestInputs?.() || []).catch(() => null)
    };
    result.editorAfter = await sourceText(page).catch(() => null);
    result.previewExists = (await page.locator(".ty-ai-review").count().catch(() => 0)) > 0;
  } finally {
    result.elapsedMs = Date.now() - started;
    result.requests = requests;
    result.totalModelCalls = requests.length;
    result.totalModelMs = requests.reduce((sum, request) => sum + (request.elapsedMs || 0), 0);
    result.firstChunkMs = requests.find((request) => request.firstChunkMs !== null)?.firstChunkMs ?? null;
    result.previewBeforeConfirmationUnchanged = result.editorBefore === testCase.source;
    result.afterConfirmationChanged = result.confirmed ? result.editorAfter !== testCase.source : null;
    writeText(path.join(folder, "input.md"), testCase.source);
    writeText(path.join(folder, "requested-task.txt"), testCase.prompt || testCase.action);
    if (result.preview !== null) writeText(path.join(folder, "preview.md"), result.preview);
    if (result.editorAfter !== null) writeText(path.join(folder, "after.md"), result.editorAfter);
    writeJson(path.join(folder, "case.json"), result);
    await page.close();
  }
  return result;
}

async function main() {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const browser = await launchBrowser();
  const report = {
    title: "Live Markdown Harness fixed-input comparison",
    stage, attemptId, startedAt: new Date().toISOString(), status: "running",
    build: stage === "baseline" ? "frozen pre-optimization dist" : "current dist",
    indexHtmlSha256: sha256(fs.readFileSync(indexHtml)),
    comparisonMethod: "Same fixed user input and cached model/runtime per stage; current sampling does not fix temperature or seed, so outputs are observations rather than deterministic causal proof.",
    noDownloadPolicy: "Cached model required, downloadBytes must equal zero. This script never downloads model resources.",
    budgets: "All actual prompt/system/maxTokens/contextTokens values are retained per request; parameter changes between stages must be considered when comparing results.",
    modelRuntime: [], cases: []
  };
  try {
    for (const model of selectedModels) {
      const service = createLocalAiService({ dataDirectory: serviceData });
      try {
        const startup = await ensureCached(service, model.profile);
        const activeModelPath = path.join(serviceData, "active-model.json");
        const activeModel = fs.existsSync(activeModelPath) ? JSON.parse(fs.readFileSync(activeModelPath, "utf8")) : null;
        report.modelRuntime.push({
          profile: model.profile, model: model.model, modelId: model.modelId, plan: startup.plan,
          runtime: activeModel ? { runtimeId: activeModel.runtimeId, runtimeVersion: activeModel.runtimeVersion, modelResourceId: activeModel.modelResourceId, modelVersion: activeModel.modelVersion } : null,
          startupMs: startup.startupMs, downloadBytes: startup.plan.downloadBytes
        });
        for (const testCase of selectedCases) {
          const result = await runCase(browser, service, model, testCase);
          report.cases.push(result);
          process.stdout.write(`${model.profile}/${testCase.id}: ${result.status} (${result.totalModelCalls || 0} calls)\n`);
        }
      } finally {
        await service.release();
      }
    }
    report.status = report.cases.some((item) => item.status === "blocked") ? "partial" : "completed";
  } catch (error) {
    report.status = "blocked";
    report.failure = error.stack || error.message;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
    report.outcomeCounts = Object.fromEntries(["safeRejected", "proposal", "blocked", "qualityFailure"].map((key) => [key, report.cases.filter((item) => item.status === key).length]));
    report.totalModelCalls = report.cases.reduce((sum, item) => sum + (item.totalModelCalls || 0), 0);
    report.inferenceCaveat = "Syntax/protection checks and human semantic quality review are distinct. A successful proposal is not a semantic-quality pass.";
    writeJson(path.join(artifactRoot, "report.json"), report);
    await browser.close();
  }
  process.stdout.write(`Artifacts: ${artifactRoot}\n`);
  process.stdout.write(`Report: ${report.status}; model calls ${report.totalModelCalls}\n`);
  if (report.status === "blocked") process.exitCode = 2;
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 2; });
