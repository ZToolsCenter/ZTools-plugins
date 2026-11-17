"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

test("rich tables preserve GFM source through preview, link clicks and widget remounts", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const source = [
    "# 复杂表格验收", "", "点击下面的表格可以编辑源码。", "",
    "| 正文 | 代码 | 链接与公式 |",
    "| :--- | :---: | ---: |",
    "| **左 \\| 右** | `\\|` | [指南](https://example.test/docs) |",
    "| <script>bad()</script> | `a\\|b` | $x^2$ |", "",
    "表格之后的内容保持不变。", ""
  ].join("\n");
  const errors = [];
  const lifecycleWarnings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (/flushSync|unmount.*render|already rendering|synchronously unmount/i.test(message.text())) {
      lifecycleWarnings.push(message.text());
    }
  });
  try {
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content: source });
    await page.addInitScript(() => {
      window.__tableLinks = [];
      window.typoraBridge.openExternalUrl = async (url) => {
        window.__tableLinks.push(url);
        return true;
      };
    });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    const widget = page.locator(".ty-cm6-table-widget");
    await widget.locator("table").waitFor();
    assert.equal(await widget.locator("th").count(), 3);
    assert.equal(await widget.locator("tbody tr").count(), 2);
    assert.equal(await widget.locator("td").count(), 6);
    assert.equal(await widget.locator("strong").innerText(), "左 | 右");
    assert.deepEqual(await widget.locator("code").allTextContents(), ["|", "a|b"]);
    assert.equal(await widget.locator("script").count(), 0);
    assert.ok((await widget.innerText()).includes("<script>bad()</script>"));
    assert.equal(await widget.locator(".ty-math-inline-render").count(), 1);
    assert.equal(await widget.locator("th").nth(1).evaluate((node) => node.style.textAlign), "center");
    assert.equal(await widget.locator("th").nth(2).evaluate((node) => node.style.textAlign), "right");
    await page.screenshot({ path: path.join(screenshotRoot, "rich-table-preview.png"), fullPage: true });

    const loadedUrl = page.url();
    await widget.getByRole("link", { name: "指南" }).click();
    assert.deepEqual(await page.evaluate(() => window.__tableLinks), ["https://example.test/docs"]);
    assert.equal(page.url(), loadedUrl, "A table link must use the host callback without navigating the plugin");

    // Entering table source destroys the React widget; leaving restores it.
    const editor = page.locator("#write .cm-content");
    await editor.locator(".cm-line").first().click();
    await widget.locator("td").first().click();
    await widget.waitFor({ state: "detached" });
    await editor.locator(".cm-line").first().click();
    await widget.locator("table").waitFor();
    assert.equal(await widget.locator("td").count(), 6);

    // Read the actual source textarea rather than rendered CM6 textContent.
    await page.locator('[data-testid="top-viewmode-cycle-btn"]').click();
    const textarea = page.locator("textarea.ty-source-textarea");
    await textarea.waitFor();
    assert.equal(await textarea.inputValue(), source, "All preview interactions must leave the Markdown byte-exact");
    assert.deepEqual(errors, []);
    assert.deepEqual(lifecycleWarnings, []);
  } finally {
    await page.close();
    await browser.close();
  }
});
