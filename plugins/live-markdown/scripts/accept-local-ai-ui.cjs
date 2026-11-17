"use strict";

// Real model + production file:// UI. Host storage/menus are fixtures, inference is real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("../tests/e2e/browser.cjs");
const { installLocalAiWorkflow } = require("../tests/e2e/fixtures/local-ai-workflow.cjs");
const { createLocalAiService } = require("../preload/local-ai/service.cjs");

async function main() {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const api = createLocalAiService({ dataDirectory: path.join(pluginRoot, ".cache/acceptance/local-ai") });
  const content = "# 项目进展\n\n我们已经把功能做完了，但是还有一些问题需要在发布之前检查。\n\n运行 `npm run build` 检查构建，确认没有问题以后再发布。";
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const report = { inference: "real Qwen3-1.7B", ui: "Chromium production file://; host storage and provider APIs are fixtures", checks: [] };
  try {
    await page.exposeFunction("__realLocalAi", async (method, args) => {
      if (method === "generate") return api.generate(args[0], chunk => {
        void page.evaluate(({ id, chunk }) => window.__realChunks.get(id)?.(chunk), { id: args[0].requestId, chunk }).catch(() => {});
      });
      if (!["inspect", "getStatus", "deploy", "cancelDeployment", "cancelGeneration"].includes(method)) throw new Error("Unsupported acceptance method");
      return api[method](...args);
    });
    await page.addInitScript(installLocalAiWorkflow, { configured: false, content });
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
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
    await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "本地部署" }).click();
    const recommended = page.locator(".ty-ai-plans article").filter({ hasText: "均衡" });
    await recommended.waitFor();
    await page.screenshot({ path: path.join(screenshotRoot, "local-ai-real-model-selection.png") });
    await recommended.getByRole("button", { name: "启动并启用" }).click();
    await page.locator(".ty-ai-review").waitFor({ timeout: 60_000 });
    const review = await page.locator(".ty-ai-review").innerText();
    assert.match(review, /npm run build/);
    assert.doesNotMatch(review, /LOCAL_AI_/);
    const revised = await page.locator(".ty-ai-review-columns article").last().locator("pre").innerText();
    assert.match(revised, /(?<!`)`npm run build`(?!`)/, "Code delimiters must match the protected source exactly");
    report.checks.push("First polish selected the cached balanced model and automatically ran actual inference after startup checks");
    report.checks.push("Exact inline-code protection survived real model output and was restored in before/after preview");
    await page.screenshot({ path: path.join(screenshotRoot, "local-ai-real-model-review.png") });
    await page.getByRole("button", { name: "确认并替换" }).click();
    await page.waitForFunction(() => !document.querySelector(".ty-ai-review"));
    assert.match(await page.locator("#write .cm-content").textContent(), /npm run build/);
    assert.deepEqual(errors, []);
    report.checks.push("Confirmation applied the proposal; no browser page errors");
    report.result = "passed";
  } catch (error) {
    report.result = "failed"; report.error = error.message; process.exitCode = 1;
    await page.screenshot({ path: path.join(screenshotRoot, "local-ai-real-ui-failure.png") }).catch(() => {});
  } finally {
    await page.close();
    await browser.close();
    await api.release();
    fs.writeFileSync(path.join(pluginRoot, ".cache/acceptance/real-ui.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
