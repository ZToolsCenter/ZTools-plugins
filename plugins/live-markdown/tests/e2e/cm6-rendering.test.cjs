"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");

const code = 'const value = 42;\n// <script>literal</script> :sparkles: [^n]\nexport function example() { return "hello"; }\n';
const source = [
  "---", "title: Rendering verification", "author: harris", "typora-copy-images-to: ./assets", "---", "",
  "# Rendering :sparkles:", "", "Intro **bold text** and a footnote[^n]. Missing[^missing].", "", "[TOC]", "",
  String.raw`## API \<v2\> & C\+\+ :smile:`,
  String.raw`#### 接口 \(v2\) \[beta\]`,
  String.raw`### \:rocket:`, "",
  "## Code and notes", "", "```typescript", code + "```", "",
  "A literal `[^n] :sparkles:` remains code.", "", "[^n]: Definition **bold** and `literal`.", "    Continuation line.", ""
].join("\n");

test("CM6 renders code, document metadata and footnotes without changing source across themes and view modes", async () => {
  const browser = await launchBrowser();
  try {
    for (const theme of ["github", "night"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.addInitScript(installLocalAiWorkflow, { content: source });
        await page.addInitScript(theme => {
          const bridge = window.typoraBridge;
          const load = bridge.loadPersistedState;
          bridge.loadPersistedState = () => {
            const state = load();
            state.preferences.theme = theme;
            return state;
          };
          window.__copyMode = "host";
          bridge.copyTextToClipboard = async text => {
            if (window.__copyMode !== "host") throw new Error("Host clipboard unavailable");
            window.__copiedCode = text;
            return true;
          };
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            writeText: async text => {
              if (window.__copyMode === "failure") throw new Error("Clipboard denied");
              window.__copiedCode = text;
            }
          } });
        }, theme);
        await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
        const card = page.locator(".cm-frontmatter-card");
        await card.waitFor();
        assert.match(await card.innerText(), /title\s+Rendering verification/);
        assert.equal(await card.locator("script").count(), 0);
        assert.match(await page.locator(".cm-heading-1").innerText(), /Rendering ✨/);
        const apiHeading = page.locator(".cm-heading-2").filter({ hasText: "API" }).first();
        const interfaceHeading = page.locator(".cm-heading-4").filter({ hasText: "接口" }).first();
        const escapedEmojiHeading = page.locator(".cm-heading-3").filter({ hasText: "rocket" }).first();
        assert.equal((await apiHeading.innerText()).trim(), "API <v2> & C++ 😄");
        assert.equal((await interfaceHeading.innerText()).trim(), "接口 (v2) [beta]");
        assert.equal((await escapedEmojiHeading.innerText()).trim(), ":rocket:");
        const tocText = await page.locator(".ty-cm6-toc-widget").innerText();
        assert.match(tocText, /Rendering ✨/);
        assert.ok(tocText.includes("API <v2> & C++ 😄"));
        assert.ok(tocText.includes("接口 (v2) [beta]"));
        assert.ok(tocText.includes(":rocket:"), "escaped emoji shortcodes stay literal in the TOC");
        assert.ok(!tocText.includes(String.raw`\<v2\>`));
        assert.ok(!tocText.includes(String.raw`\(v2\)`));
        assert.ok(!tocText.includes(String.raw`\:rocket:`));
        const reference = page.locator(".cm-footnote-reference").filter({ hasText: "[n]" });
        assert.match(await reference.getAttribute("title"), /Definition/);
        assert.match(await page.locator(".cm-footnote-missing").getAttribute("title"), /未找到/);
        assert.match(await page.locator(".cm-inline-code").last().innerText(), /\[\^n\] :sparkles:/);

        const copy = page.locator(".ty-codeblock-copy-btn");
        await copy.scrollIntoViewIfNeeded();
        assert.equal(await page.locator(".ty-codeblock-lang").textContent(), "typescript");
        const keyword = page.locator(".cm-codeblock-line .hljs-keyword").first();
        await keyword.waitFor();
        const style = await keyword.evaluate(element => ({
          token: getComputedStyle(element).color,
          body: getComputedStyle(element.closest(".cm-line")).color,
          font: getComputedStyle(element.closest(".cm-line")).fontFamily
        }));
        assert.notEqual(style.token, style.body, "Highlight colors must override inherited body colors");
        assert.match(style.font, /monospace|Menlo|Consolas/i);
        assert.equal(await page.locator("#write script").count(), 0);
        await copy.click();
        await page.waitForFunction(expected => window.__copiedCode === expected, code);
        assert.equal(await copy.innerText(), "已复制!");
        await page.evaluate(() => { window.__copyMode = "fallback"; window.__copiedCode = null; });
        await copy.focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(expected => window.__copiedCode === expected, code);
        await page.evaluate(() => { window.__copyMode = "failure"; });
        await copy.click();
        await page.waitForFunction(() => document.querySelector(".ty-codeblock-copy-btn")?.textContent === "复制失败");
        await page.screenshot({ path: path.join(screenshotRoot, `cm6-rendering-${theme}.png`) });

        const toolbar = page.getByTestId("top-viewmode-cycle-btn");
        await page.locator(".cm-scroller").evaluate(element => { element.scrollTop = 0; });
        await card.click();
        await card.waitFor({ state: "detached" });
        assert.match(await page.locator(".cm-content").innerText(), /title: Rendering verification/);
        await toolbar.focus();
        await card.waitFor();

        await reference.click();
        await page.locator(".cm-footnote-definition").waitFor({ state: "detached" });
        assert.match(await page.locator(".cm-content").innerText(), /\[\^n\]: Definition/);
        await toolbar.focus();
        await page.locator(".cm-footnote-definition").waitFor();
        assert.equal(await page.locator(".cm-footnote-definition strong").innerText(), "bold");
        assert.match(await page.locator(".cm-footnote-definition").innerText(), /Continuation line/);

        await page.locator(".cm-codeblock-line").filter({ hasText: "const value" }).click();
        await copy.waitFor({ state: "detached" });
        assert.match(await page.locator(".cm-content").innerText(), /```typescript/);
        await toolbar.focus();
        await copy.waitFor();
        assert.doesNotMatch(await page.locator(".cm-codeblock-line").first().innerText(), /```/);

        await page.getByTestId("footer-viewmode-btn").click();
        await page.locator(".ty-footer-popover-item", { hasText: "阅读模式" }).click();
        await page.locator(".ty-code-render .hljs-keyword").first().waitFor();
        await toolbar.click(); // Reading -> live.
        await toolbar.click(); // Live -> source.
        assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test("CM6 refreshes code preview when background parsing reaches the end of a long document", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const longSource = "# Long document\n\n" + "Paragraph before the final code block.\n\n".repeat(700) + "```ts\nconst atEnd = 123; // :sparkles: [^n]\n```\n";
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.addInitScript(installLocalAiWorkflow, { content: longSource });
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator("#write .cm-editor").waitFor();
    await page.locator(".cm-scroller").evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.locator(".ty-codeblock-lang").waitFor();
    assert.equal(await page.locator(".cm-codeblock-line .hljs-keyword").first().innerText(), "const");
    assert.equal(await page.locator(".cm-codeblock-line .ty-cm6-emoji, .cm-codeblock-line .cm-footnote-reference").count(), 0);
    await page.getByTestId("top-viewmode-cycle-btn").click();
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), longSource);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await browser.close(); }
});
