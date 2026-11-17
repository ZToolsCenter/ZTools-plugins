"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const evidenceDir = path.join(pluginRoot, ".cache/acceptance/source-echo-b18-20261026/browser");
const generatedAppendPlan = JSON.stringify({
  version: 1,
  kind: "edit",
  operation: "insert",
  target: "document_end",
  layout: "block",
  content: { mode: "generate", task: "custom" }
});

async function withAssistant(source, run) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  try {
    // Only inference is stubbed; the production Worker, session, gates and editor run unchanged.
    await page.addInitScript(installLocalAiWorkflow, { content: source, executionPolicy: "full" });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-editor").waitFor();
    await page.getByTestId("top-ai-copilot-btn").click();
    await run(page);
  } finally {
    await page.close();
    await browser.close();
  }
}

async function sourceText(page) {
  const textarea = page.locator("textarea.ty-source-textarea");
  if (!(await textarea.count())) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
    await textarea.waitFor();
  }
  return textarea.inputValue();
}

async function send(page, instruction) {
  await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
  await page.getByRole("button", { name: "发送指令", exact: true }).click();
  await page.waitForFunction(() => window.__workflow.requests.length === 1);
  const [planner] = await page.evaluate(() => window.__workflow.requestInputs());
  assert.ok(planner.outputSchema, "a free-form artifact instruction is planned before content generation");
  assert.ok(planner.prompt.includes(instruction));
  await page.evaluate((text) => window.__workflow.resolve(0, text), generatedAppendPlan);
  await page.waitForFunction(() => window.__workflow.requests.length === 2);
  return page.evaluate(() => window.__workflow.requestInputs());
}

async function capture(page, name) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
}

for (const instruction of [
  "在文末新增一个 JavaScript 代码块，复用原配置，包含字段类型校验。只输出新增代码块。",
  "At the end, add a JavaScript code block. Do not modify the original code. Reuse existing code."
]) {
test(`explicit code reuse reaches Diff and one undoable append: ${instruction}`, async () => {
  const source = "const flags = { beta: true, gamma: false };";
  const generated = `\`\`\`javascript\n${source}\nif (typeof flags.beta !== "boolean") throw new Error("invalid flags");\n\`\`\``;
  await withAssistant(source, async page => {
    const inputs = await send(page, instruction);
    const input = inputs[1];
    assert.equal(input.outputSchema, undefined, "the planned artifact uses one content-generation call");
    assert.ok(input.prompt.includes(source), "the explicitly permitted code reuse reaches the content stage with source context");
    await page.evaluate(text => window.__workflow.resolve(1, text), generated);
    await page.locator(".ty-ai-review,.ty-ai-error").first().waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    assert.equal(await page.locator(".ty-ai-review").count(), 1);
    assert.equal(await sourceText(page), source);
    await capture(page, instruction.startsWith("At the end") ? "reuse-after-read-only-sentence" : "permitted-code-reuse-diff");
    await page.getByRole("button", { name: "确认并追加", exact: true }).click();
    assert.equal(await sourceText(page), `${source}\n\n${generated}`);
    await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
    await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
    assert.equal(await sourceText(page), source);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "one planner and one content call complete without repair");
  });
});
}

test("compressed fact-ledger summary keeps section labels and omits repeated background", async () => {
  const facts = ["上线前应先完成离线回归。", "方案采用本地推理引擎。", "跨平台实机验收尚未完成。"];
  const background = "这是用于解释协作流程和记录方式的背景材料，并非每次摘要都需要复述。".repeat(32);
  const source = ["目标", "方案", "风险"].map((title, index) => `# ${title}\n\n${facts[index]}\n\n${background}`).join("\n\n");
  await withAssistant(source, async page => {
    await page.getByRole("button", { name: "总结", exact: true }).click();
    for (let round = 0; round < 12; round++) {
      await page.waitForFunction(index => window.__workflow.requests.length > index ||
        document.querySelector(".ty-ai-result,.ty-ai-error"), round);
      const inputs = await page.evaluate(() => window.__workflow.requestInputs());
      if (inputs.length <= round) break;
      const input = inputs[round];
      const line = input.prompt.split("\n").find(line => line.startsWith("候选："));
      assert.ok(line, "summary uses the source-bound selection pipeline");
      const candidates = JSON.parse(line.slice(3));
      const ids = candidates.filter(({ quote }) => facts.includes(quote)).map(({ id }) => id);
      await page.evaluate(([index, output]) => window.__workflow.resolve(index, output), [round, JSON.stringify({ ids })]);
    }
    await page.locator(".ty-ai-result").waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    const answer = await page.locator(".ty-ai-result").innerText();
    for (const fact of facts) assert.ok(answer.includes(fact));
    for (const title of ["目标", "方案", "风险"]) assert.ok(answer.includes(title));
    assert.ok(answer.length < source.length);
    assert.equal(await page.locator(".ty-ai-review").count(), 0);
    assert.equal(await page.getByRole("button", { name: /确认并(?:替换|追加|插入)/ }).count(), 0, "default summary is read-only");
    assert.equal(await sourceText(page), source);
    await capture(page, "compressed-summary-headings");
  });
});

test("unchanged verified summary is a normal read-only result with zero inference", async () => {
  const source = Array.from({ length: 32 }, (_, index) =>
    `- 项目决定采用离线部署方案${index + 1}，由团队成员负责核对本地工作区的文件编辑、自动保存、文档检索和发布验证流程。`).join("\n");
  await withAssistant(source, async page => {
    await page.getByRole("button", { name: "总结", exact: true }).click();
    await page.locator(".ty-ai-result,.ty-ai-error").first().waitFor();
    assert.equal(await page.locator(".ty-ai-error").count(), 0);
    assert.match(await page.locator(".ty-ai-notice").innerText(), /摘要与原文一致，文档保持不变/);
    assert.equal(await page.locator(".ty-ai-result pre").innerText(), source);
    assert.equal(await page.locator(".ty-ai-error,.ty-ai-review,.ty-ai-result-actions").count(), 0);
    assert.equal(await page.getByRole("button", { name: /确认并|取消修改/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
    assert.equal(await sourceText(page), source);
    await capture(page, "unchanged-summary");
  });
});

test("unrequested whole-source copy remains blocked and leaves instruction editable", async () => {
  const source = "# 原有说明\n\n发布前必须完成备份、恢复演练和回滚验证，所有当前内容均应保留在原文中。";
  const generated = `\`\`\`javascript\nconsole.log("ready");\n\`\`\`\n\n${source}`;
  await withAssistant(source, async page => {
    await send(page, "在文末新增 JavaScript 代码块，输出 ready 日志");
    await page.evaluate(text => window.__workflow.resolve(1, text), generated);
    await page.locator(".ty-ai-error").waitFor();
    assert.match(await page.locator(".ty-ai-error").innerText(), /重复.*原文/);
    assert.equal(await page.locator(".ty-ai-review").count(), 0);
    assert.equal(await sourceText(page), source);
    await page.getByRole("button", { name: "修改指令并聚焦输入框", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "输入 AI 指令" });
    await composer.fill("在文末新增 JavaScript 代码块，仅输出 ready 日志");
    assert.match(await composer.inputValue(), /仅输出 ready/);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "the planner and content request complete without a repair retry");
  });
});

for (const restriction of [
  "保留原代码不变并只输出新增代码块。",
  "请勿复用原代码，只输出新增代码块。",
  "can't reuse existing code; only output the new block.",
  "复用原代码，但不要复用原代码。"
]) {
test(`source copy inside a new code block is blocked for: ${restriction}`, async () => {
  const source = "const flags = { beta: true, gamma: false };";
  await withAssistant(source, async page => {
    await send(page, `在文末新增一个 JavaScript 代码块，${restriction}`);
    await page.evaluate(text => window.__workflow.resolve(1, text), `\`\`\`javascript\n${source}\n\`\`\``);
    await page.locator(".ty-ai-error").waitFor();
    assert.match(await page.locator(".ty-ai-error").innerText(), /重复.*原文/);
    assert.equal(await page.locator(".ty-ai-review").count(), 0);
    assert.equal(await sourceText(page), source);
    assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2, "the source-echo gate blocks the content result without a repair retry");
  });
});
}
