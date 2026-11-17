"use strict";

// Opt-in local Chromium measurement; these numbers do not represent every device or host.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("../tests/e2e/browser.cjs");
const { installLocalAiWorkflow } = require("../tests/e2e/fixtures/local-ai-workflow.cjs");

async function measure(browser, targetBytes, streaming = false) {
  const line = "这是用于编辑器性能验收的普通段落，保留中文、数字 123 和 Markdown。\n\n";
  const content = line.repeat(Math.ceil(targetBytes / Buffer.byteLength(line)));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(installLocalAiWorkflow, { content });
  const started = Date.now();
  await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
  const editor = page.locator("#write .cm-content");
  await editor.waitFor({ timeout: 30_000 });
  const readyMs = Date.now() - started;
  if (streaming) {
    await page.locator('[data-testid="top-ai-copilot-btn"]').click();
    await page.locator(".ty-ai-actions").getByRole("button", { name: "润色", exact: true }).click();
    await page.waitForFunction(() => window.__workflow.requests.length > 0);
    await page.evaluate(() => {
      window.__perfStream = setInterval(() => window.__workflow.emit(0, "正在生成文字。"), 20);
    });
  }
  await editor.click({ position: { x: 10, y: 10 } });
  await editor.press("Home");
  await page.evaluate(() => {
    window.__paintSamples = [];
    document.addEventListener("beforeinput", () => {
      const begin = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__paintSamples.push(performance.now() - begin)));
    }, { capture: true });
  });
  await page.keyboard.type("abcdefghijklmnopqrstuvwxyz", { delay: 100 });
  await page.waitForTimeout(250);
  const samples = await page.evaluate(() => window.__paintSamples);
  if (streaming) await page.evaluate(() => clearInterval(window.__perfStream));
  const sorted = samples.slice().sort((a, b) => a - b);
  if (sorted.length < 20 || errors.length) throw new Error(`Invalid measurement: ${JSON.stringify({ samples: sorted.length, errors })}`);
  const report = {
    inputBytes: Buffer.byteLength(content), streaming, readyMs, samples: sorted.length,
    beforeInputToTwoFramesMs: {
      p50: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
      p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(1),
      max: +sorted.at(-1).toFixed(1)
    }, pageErrors: errors
  };
  if (streaming) await page.screenshot({ path: path.join(screenshotRoot, "local-ai-editing-during-stream.png") });
  await page.close();
  return report;
}

async function main() {
  const browser = await launchBrowser();
  try {
    const results = [];
    for (const [bytes, streaming] of [[100_000, false], [100_000, true], [1_000_000, false]]) {
      results.push(await measure(browser, bytes, streaming));
    }
    const report = {
      timestamp: new Date().toISOString(), platform: process.platform, arch: process.arch,
      cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), browser: browser.version(),
      method: "Chromium file://, synthetic Chinese paragraphs, 26 keyboard events 100ms apart; beforeinput capture to two animation frames. Streaming uses mocked local bridge. No IME or real host measurement.",
      results
    };
    const output = path.join(pluginRoot, ".cache/acceptance/editor-performance.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
