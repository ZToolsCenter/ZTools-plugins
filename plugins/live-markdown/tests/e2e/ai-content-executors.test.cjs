"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { thinProseResponse, assertOnlyAuthorizedProse } = require("./fixtures/thin-prose-response.cjs");
const distRoot = process.env.LIVE_MARKDOWN_DIST || path.join(pluginRoot, "dist");

async function open(browser, content, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  await page.addInitScript(installLocalAiWorkflow, { content, ...options });
  await page.goto(pathToFileURL(path.join(distRoot, "index.html")).href);
  await page.locator("#write").waitFor();
  await page.getByTestId("top-viewmode-cycle-btn").click();
  await page.locator("textarea.ty-source-textarea").waitFor();
  await page.getByTestId("top-ai-copilot-btn").click();
  await page.locator(".typora-ai-assistant-drawer").waitFor();
  return page;
}

async function send(page, instruction) {
  await page.getByRole("textbox", { name: "输入 AI 指令" }).fill(instruction);
  await page.getByRole("button", { name: "发送指令", exact: true }).click();
}

async function firstRequest(page) {
  try {
    await page.waitForFunction(() => window.__workflow.requests.length > 0);
  } catch (cause) {
    const state = await page.evaluate(() => ({
      requestCount: window.__workflow.requests.length,
      requestInputs: window.__workflow.requestInputs(),
      providerStatus: { ...window.__workflow.localStatus },
      cancelledCalls: window.__workflow.cancelGenerationCalls,
      assistantText: document.querySelector(".typora-ai-assistant-drawer")?.innerText ?? null,
      messages: [...document.querySelectorAll(".ty-ai-error,.ty-ai-warning,.ty-ai-notice,.ty-ai-stream,.ty-ai-review")]
        .map(element => ({ className: element.className, text: element.innerText })),
      buttons: [...document.querySelectorAll(".typora-ai-assistant-drawer button")]
        .map(button => ({ text: button.innerText, ariaLabel: button.getAttribute("aria-label"), disabled: button.disabled })),
      source: document.querySelector("textarea.ty-source-textarea")?.value ?? null
    }));
    throw new Error(`No provider request was emitted; assistant state: ${JSON.stringify(state)}`, { cause });
  }
  return (await page.evaluate(() => window.__workflow.requestInputs()))[0];
}

async function resolve(page, text, index = 0) {
  await page.waitForFunction(expected => window.__workflow.requests.length > expected, index);
  await page.evaluate(({ output, requestIndex }) => window.__workflow.resolve(requestIndex, output), { output: text, requestIndex: index });
}

async function assertApplyUndo(page, original, expected, button) {
  const editor = page.locator("textarea.ty-source-textarea");
  assert.equal(await editor.inputValue(), original, "a generated result never writes before confirmation");
  await page.getByRole("button", { name: button, exact: true }).click();
  assert.equal(await editor.inputValue(), expected);
  await page.locator(".ty-menu-trigger", { hasText: "编辑" }).click();
  await page.locator(".ty-menu-dropdown .ty-menu-option").first().click();
  assert.equal(await editor.inputValue(), original, "one undo restores the full original source");
}

test("content executors preserve source ownership and fixed presentation", async t => {
  const browser = await launchBrowser();
  try {
    await t.test("a small local model edits a readable sentence and the program projects it onto inline Markdown", async () => {
      const source = "OPEN-EDGE\n\nThe **release note** need a check. Read the [guide](https://private.invalid/doc).\n\n```js\nconst privateCode = 'KEEP';\n```\n\nCLOSE-EDGE";
      const page = await open(browser, source, { modelId: "Qwen3-0.6B-Q4_K_M.gguf" });
      try {
        await send(page, "只润色可读正文，保留代码、链接目标、强调格式和文首文末标记原样。");
        const request = await firstRequest(page);
        assert.equal(request.outputSchema, undefined, "the small model receives a plain readable sentence");
        assert.match(request.prompt, /The release note need a check/u);
        assert.doesNotMatch(request.prompt, /private\.invalid|privateCode|OPEN-EDGE|CLOSE-EDGE/u);
        await resolve(page, "The release note needs a check. Read the guide.");
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, source.replace("need a check", "needs a check"), "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("an explicit exact-duplicate removal creates one confirmed diff and one undo", async () => {
      const sentence = "请在周四提交结果。";
      const source = sentence + sentence;
      const page = await open(browser, source, { modelId: "Qwen3-0.6B-Q4_K_M.gguf" });
      try {
        await send(page, "润色正文，删除完全重复的第二个句子，只保留一次提交结果的要求。");
        const request = await firstRequest(page);
        assert.match(request.prompt, new RegExp(`${sentence}${sentence}`));
        await resolve(page, sentence);
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, sentence, "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("literal heading lists create one diff with no provider call", async () => {
      const source = "# Existing\n\nKeep the original.";
      const page = await open(browser, source);
      try {
        await send(page, "按顺序在文末新增两个 H2 标题：迁移观察、后续计划。只需要标题。");
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
        await assertApplyUndo(page, source, `${source}\n\n## 迁移观察\n\n## 后续计划`, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("spelled-out equivalent counts return to the original digits before one confirmed edit", async () => {
      const source = "The release have 3 stages, and each stage need approval.";
      const page = await open(browser, source, { modelId: "Qwen3-0.6B-Q4_K_M.gguf" });
      try {
        await send(page, "润色正文，保留数字和单位不变。");
        const request = await firstRequest(page);
        assert.equal(request.outputSchema, undefined);
        await resolve(page, "The release has three stages, and each stage needs approval.");
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, "The release has 3 stages, and each stage needs approval.", "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("an owner-bound date reorder stays a review diff and one undo restores the source", async () => {
      const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";
      const expected = "林安负责的2026-11-03排期，请大家确认。";
      const page = await open(browser, source, { modelId: "Qwen3-0.6B-Q4_K_M.gguf" });
      try {
        await send(page, "润色正文使其简洁，不改变日期和负责人。");
        const first = await firstRequest(page);
        assert.equal(first.outputSchema, undefined, "date ownership does not replace the readable prose protocol");
        assert.match(first.prompt, /由林安负责的排期日期是2026-11-03/u);
        await resolve(page, "林安负责的2026-11-03排期");
        await page.waitForFunction(() => window.__workflow.requests.length > 1);
        await resolve(page, "请大家确认。", 1);
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2);
        await assertApplyUndo(page, source, expected, "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("identical generated TypeScript copies are recovered without another model call", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source);
      try {
        await send(page, "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数。");
        await firstRequest(page);
        const code = "function greetUser(name: string): string { return `Hello ${name}`; }";
        await resolve(page, JSON.stringify({ payload: `${code}\n\n### API v2\n\n\`\`\`typescript\n${code}\n\`\`\`` }));
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, `${source}\n\n## API v2\n\n\`\`\`typescript\n${code}\n\`\`\``, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("an async TypeScript primitive return annotation is normalized before one confirmed append", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source, { modelId: "Qwen3-1.7B-Q4_K_M.gguf" });
      try {
        await send(page, "在文末添加 TypeScript 代码块，定义异步函数 loadLabel，接收字符串参数并返回该字符串，不要添加标题。");
        await firstRequest(page);
        const captured = "async function loadLabel(label: string): string { return label; }";
        await resolve(page, JSON.stringify({ payload: captured }));
        await page.locator(".ty-ai-review").waitFor();
        assert.match(await page.locator(".typora-ai-assistant-drawer").innerText(), /Promise<T>/u);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        const expected = source + "\n\n```typescript\n" + captured.replace("): string", "): Promise<string>") + "\n```";
        await assertApplyUndo(page, source, expected, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("invalid TypeScript stops with editable instruction and leaves the document untouched", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source);
      try {
        const instruction = "在文末新增 TypeScript 代码块，定义 greetUser 函数。";
        await send(page, instruction);
        await firstRequest(page);
        await resolve(page, JSON.stringify({ payload: "function greetUser(name: string): string {" }));
        await page.locator(".ty-ai-error").waitFor();
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        assert.equal(await page.getByRole("textbox", { name: "输入 AI 指令" }).inputValue(), instruction);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
      } finally { await page.close(); }
    });

    await t.test("literal JSON retains false, null and ordered Unicode values without inference", async () => {
      const source = "# Existing\n\nKeep the original.";
      const page = await open(browser, source);
      try {
        await send(page, "在文末追加 JSON 对象，仅包含 enabled:false、owner:null 和 tags:[“青”,“蓝”]。");
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
        const json = JSON.stringify({ enabled: false, owner: null, tags: ["青", "蓝"] }, null, 2);
        await assertApplyUndo(page, source, `${source}\n\n\`\`\`json\n${json}\n\`\`\``, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("a contradictory heading count stops before inference and keeps the instruction editable", async () => {
      const source = "# Existing\n\nKeep the original.";
      const page = await open(browser, source);
      try {
        const instruction = "在文末新增两个 H2 标题：甲、乙、丙。只需要标题。";
        await send(page, instruction);
        await page.locator(".ty-ai-error").waitFor();
        assert.match(await page.locator(".ty-ai-error").innerText(), /标题数量与清单不一致/u);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        assert.equal(await page.getByRole("textbox", { name: "输入 AI 指令" }).inputValue(), instruction);
      } finally { await page.close(); }
    });

    await t.test("code data becomes the specified H2 and TypeScript fence", async () => {
      const source = "# Existing\n\nPRIVATE_SOURCE stays here.";
      const page = await open(browser, source);
      try {
        await send(page, "在文末新增 Markdown 二级标题“API v2”，其后放 TypeScript 代码围栏并定义 greetUser 函数。");
        const request = await firstRequest(page);
        assert.ok(request.outputSchema?.properties?.payload);
        assert.doesNotMatch(request.prompt, /PRIVATE_SOURCE/u);
        const body = 'function greetUser(name: string): string {\n  return `Hello ${name}`;\n}';
        await resolve(page, JSON.stringify({ payload: body }));
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, `${source}\n\n## API v2\n\n\`\`\`typescript\n${body}\n\`\`\``, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("English draft heading lists receive structured bodies rather than a fenced document", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source);
      try {
        await send(page, "At the end, write a release rehearsal draft with these headings in order: Goal, Steps, Risks. Include executable steps and concrete risk scenarios.");
        const request = await firstRequest(page);
        assert.deepEqual(Object.keys(request.outputSchema.properties.payload.properties.sections.properties), ["Goal", "Steps", "Risks"]);
        assert.doesNotMatch(request.prompt, /Keep source/u);
        const sections = { Goal: "Propose checking that the release can be rolled back.", Steps: "Rehearse the deployment in an isolated test copy and verify health checks.", Risks: "If a health check fails, pause the rehearsal and inspect the test logs." };
        await resolve(page, JSON.stringify({ payload: { sections } }));
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, source + Object.entries(sections).map(([name, body]) => `\n\n## ${name}\n\n${body}`).join(""), "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("a requested heading and list remain separate content inside a Markdown code block", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source);
      try {
        await send(page, "在文末新增代码块 markdown 格式，内容为标题一 hello 和一条无序列表 world。");
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "complete literal Markdown is assembled without inference");
        await assertApplyUndo(page, source, `${source}\n\n\`\`\`markdown\n# hello\n\n- world\n\`\`\``, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("small-model paragraph chunks produce one confirmed replacement and one undo", async () => {
      const source = "First line need review.\n\nThese notes needs approval.";
      const page = await open(browser, source, { modelId: "Qwen3-0.6B-Q4_K_M.gguf" });
      try {
        await send(page, "校对正文，保留换行和格式。");
        const request = await firstRequest(page);
        assert.equal(request.outputSchema, undefined);
        await resolve(page, "First line needs review.", 0);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        await resolve(page, "These notes need approval.", 1);
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 2);
        await assertApplyUndo(page, source, "First line needs review.\n\nThese notes need approval.", "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("small-model sections retain one complete structured request", async () => {
      const source = "# Existing\n\nKeep source.";
      const page = await open(browser, source, { modelId: "Qwen3-1.7B-Q4_K_M.gguf" });
      try {
        await send(page, "在文末写一个发布演练草案，按顺序用小标题 目标、步骤、风险 组织。");
        const request = await firstRequest(page);
        assert.ok(request.outputSchema.properties.payload.properties.sections);
        const bodies = ["验证模拟发布和回滚流程可以完成。", "在隔离副本中模拟发布，并检查服务状态。", "若检查失败，暂停演练并检查日志。"];
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        await resolve(page, JSON.stringify({ payload: { sections: { 目标: bodies[0], 步骤: bodies[1], 风险: bodies[2] } } }));
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, `${source}\n\n## 目标\n\n${bodies[0]}\n\n## 步骤\n\n${bodies[1]}\n\n## 风险\n\n${bodies[2]}`, "确认并追加");
      } finally { await page.close(); }
    });

    await t.test("polish receipts cannot rewrite code, math, table, or document markers", async () => {
      const source = "OPEN-EDGE\n\nThe release notes needs a review.\n\n| Field | Value |\n| --- | --- |\n| Status | draft |\n\n$$E = mc^2$$\n\n```js\nconst stable = 'KEEP';\n```\n\nCLOSE-EDGE";
      const page = await open(browser, source);
      try {
        await send(page, "只润色可读正文，保留代码块、公式、表格和文首文末标记原样不变。");
        const request = await firstRequest(page);
        assert.ok(request.outputSchema?.properties?.edits);
        assertOnlyAuthorizedProse(request.prompt, source);
        assert.doesNotMatch(request.prompt, /OPEN-EDGE|CLOSE-EDGE|const stable|E = mc\^2|\| Status/u);
        await resolve(page, thinProseResponse(request.prompt, "notes needs", "notes need"));
        await page.locator(".ty-ai-review").waitFor();
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 1);
        await assertApplyUndo(page, source, source.replace("notes needs", "notes need"), "确认并替换");
      } finally { await page.close(); }
    });

    await t.test("source-bound field answer preserves subject relations and has no write control", async () => {
      const source = "Cedar 由林安负责，预算 30 万元。\n\nMaple 由周岚负责，预算也是 30 万元。";
      const page = await open(browser, source);
      try {
        await send(page, "只回答 Cedar 和 Maple 各自的负责人及预算。");
        await page.locator(".ty-ai-result").waitFor();
        const answer = await page.locator(".ty-ai-result").innerText();
        assert.match(answer, /Cedar[\s\S]*林安/u);
        assert.match(answer, /Maple[\s\S]*周岚/u);
        assert.match(answer, /30 万元/u);
        assert.equal(await page.locator(".ty-ai-review").count(), 0);
        assert.equal(await page.getByRole("button", { name: /确认并/u }).count(), 0);
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        assert.equal(await page.evaluate(() => window.__workflow.requests.length), 0, "explicit source fields are read directly");
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
