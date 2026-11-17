"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

test("AI diagram at the initial cursor stays a distinct block and one undo restores the original", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const source = "# 发布流程\n\n测试通过后才允许部署，失败则退回修复。";
  const diagram = [
    "```mermaid", "graph TD",
    '  Node1["提交代码"]', '  Node2["CI测试"]', '  Node3["部署"]', '  Node4["退回修复"]',
    "  Node1 --> Node2", "  Node2 --> Node3", "  Node2 --> Node4", "```"
  ].join("\n");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content: source });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-content").waitFor();
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".ty-ai-more-trigger").click();
    await page.locator(".ty-ai-more-actions").getByRole("button", { name: "图表", exact: true }).click();
    await page.waitForFunction(() => window.__workflow.requests.length === 1);
    const request = await page.evaluate(() => window.__workflow.requestInputs()[0]);
    assert.ok(request.outputSchema?.properties?.payload?.properties?.nodes, "diagram generation requests structured node labels");
    assert.ok(request.outputSchema?.properties?.payload?.properties?.edges, "diagram generation requests structured index edges");
    const response = JSON.stringify({ payload: {
      nodes: ["提交代码", "CI测试", "部署", "退回修复"],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }]
    } });
    await page.evaluate((output) => window.__workflow.resolve(0, output), response);
    await page.locator(".ty-ai-review").waitFor();
    assert.equal(await page.locator(".ty-ai-review-heading").innerText(), "当前光标处插入段落", "the review identifies the structured diagram's initial cursor target");
    const confirmInsertion = page.getByRole("button", { name: "确认并插入" });
    assert.equal(await confirmInsertion.isEnabled(), true, "the footer confirmation action should be available for this located insertion");
    assert.equal(await page.locator(".ty-ai-review .ty-diff-row-deleted").count(), 0, "a Mermaid insertion should appear as added content without marking the source document deleted");
    assert.match(await page.locator(".ty-ai-review .ty-diff-row-added .ty-diff-content").allTextContents().then((parts) => parts.join("\n")), /```mermaid[\s\S]*?```/);
    await confirmInsertion.click();
    await page.locator(".ty-ai-review").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "关闭 AI 助手" }).click();
    const editor = page.locator("#write .cm-content");
    await editor.locator(".cm-line").filter({ hasText: "测试通过后才允许部署" }).click();
    await page.locator(".ty-diagram-block svg").waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, "ai-diagram-insertion-boundary.png"), fullPage: true });

    // Inspect the source, then return to CM6 and check transaction grouping.
    const viewMode = page.locator('[data-testid="top-viewmode-cycle-btn"]');
    await viewMode.click();
    const textarea = page.locator("textarea.ty-source-textarea");
    await textarea.waitFor();
    assert.equal(await textarea.inputValue(), `${diagram}\n\n${source}`);
    await viewMode.click(); // source -> reading
    await viewMode.click(); // reading -> live
    await editor.waitFor();
    await editor.click();
    await editor.press("Meta+z");
    await viewMode.click();
    await textarea.waitFor();
    assert.equal(await textarea.inputValue(), source, "One undo must remove the entire inserted block and its separators");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
  }
});
