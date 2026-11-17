"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");

function installReadingDocument({ content, engine }) {
  const state = {
    preferences: { editorEngine: engine, theme: engine === "block" ? "night" : "github", enableAiCopilot: false, autoSave: false },
    lastOpenDoc: { path: "/tmp/reading-images.md", name: "reading-images.md", dir: "/tmp", content, isDirty: false, mtimeMs: 1 }
  };
  window.__reading = { external: [], writes: [] };
  window.typoraBridge = {
    getDefaultNotesDir: () => "/tmp",
    loadPersistedState: () => structuredClone(state),
    savePersistedState: async (patch) => Object.assign(state, patch),
    resolveImageUrl: (_doc, src) => src === "picture.svg" ? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#4377aa"/></svg>')}` : src,
    openExternalUrl: async (url) => { window.__reading.external.push(url); },
    writeDocumentAsync: async (...args) => { window.__reading.writes.push(args); }
  };
  window.services = window.typoraBridge;
  window.ztools = { setExpendHeight() {}, onPluginEnter() {}, dbStorage: { getItem: () => null, setItem() {} } };
}

async function mode(page, name) {
  await page.getByTestId("footer-viewmode-btn").click();
  await page.locator(".ty-footer-popover-item").filter({ hasText: name }).click();
}

for (const engine of ["cm6", "block"]) {
  test(`reading image viewer: ${engine}, zoom, focus, readonly, cleanup and failed image`, async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const content = '# 阅读图片\n\n![大图](picture.svg)\n\n<img src="missing-image.png" alt="坏图">\n\n- [ ] 只读任务\n\n结尾文字';
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(installReadingDocument, { content, engine });
      await page.goto(process.env.READING_IMAGES_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
      await mode(page, "阅读模式");
      const image = page.locator('#write img[alt="大图"]');
      await image.waitFor();
      assert.equal(await image.evaluate((el) => getComputedStyle(el).cursor), "zoom-in");
      assert.equal(await page.locator('#write textarea, #write [contenteditable="true"]').count(), 0);
      // Linked images open the viewer without navigating or invoking the bridge.
      await image.evaluate((el) => {
        const link = document.createElement("a"); link.href = "https://example.test/image";
        el.replaceWith(link); link.append(el);
      });
      await image.click();
      const viewer = page.getByRole("dialog", { name: "图片查看器" });
      await viewer.waitFor();
      await viewer.locator("img").evaluate((el) => el.decode());
      assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
      await page.waitForFunction(() => {
        const width = document.querySelector("dialog img")?.getBoundingClientRect().width;
        return width > 100 && width < 1100;
      });
      const width = await viewer.locator("img").evaluate((el) => el.getBoundingClientRect().width);
      await page.getByRole("button", { name: "放大图片", exact: true }).click();
      assert.ok(await viewer.locator("img").evaluate((el) => el.getBoundingClientRect().width) > width);
      await page.getByRole("button", { name: "缩小图片", exact: true }).click();
      assert.ok(Math.abs(await viewer.locator("img").evaluate((el) => el.getBoundingClientRect().width) - width) < 2);
      await page.getByRole("button", { name: "图片原始大小" }).click();
      assert.equal(await viewer.locator("img").evaluate((el) => el.getBoundingClientRect().width), 1600);
      await page.getByRole("button", { name: "图片适应窗口" }).click();
      assert.ok(await viewer.locator("img").evaluate((el) => el.getBoundingClientRect().width) < 1100);
      // Programmatic focus cannot escape a native modal dialog.
      await page.getByTestId("footer-viewmode-btn").evaluate((el) => el.focus());
      assert.equal(await page.evaluate(() => document.activeElement.closest("dialog") !== null), true);
      await page.getByRole("button", { name: "关闭图片查看器" }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.closest("dialog") !== null), true);
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "detached" });
      assert.equal(await image.evaluate((el) => document.activeElement === el), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      await image.press("Enter");
      await viewer.waitFor();
      await page.mouse.click(2, 2);
      await viewer.waitFor({ state: "detached" });
      await page.locator('#write img[alt="坏图"]').click();
      await viewer.getByRole("alert").waitFor();
      await page.getByRole("button", { name: "关闭图片查看器" }).click();
      await viewer.waitFor({ state: "detached" });
      const checkbox = page.locator('#write input[type="checkbox"]').first();
      assert.equal(await checkbox.isDisabled(), true);
      await page.setViewportSize({ width: 360, height: 640 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await image.press("Space");
      await viewer.waitFor();
      assert.ok((await viewer.boundingBox()).width <= 360);
      await page.screenshot({ path: path.join(screenshotRoot, `reading-images-${engine}-narrow.png`) });
      await page.keyboard.press("Escape");
      await mode(page, "源代码模式");
      assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), content);
      assert.deepEqual(await page.evaluate(() => window.__reading), { external: [], writes: [] });
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 1100, height: 800 });
      await mode(page, "阅读模式");
      await image.click();
      await viewer.waitFor();
      // Host/native document navigation may occur independently of DOM inertness.
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true })));
      await viewer.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.equal(await page.locator('#write img[alt="大图"]').count(), 0);
    } finally { await page.close(); await browser.close(); }
  });
}


test("CM6 reading transition retains final input, engine, undo history and closes stale viewer", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const content = "# 切换回归\n\n![大图](picture.svg)\n\n末尾";
  try {
    await page.addInitScript(installReadingDocument, { content, engine: "cm6" });
    await page.goto(process.env.READING_IMAGES_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    const cm = page.locator("#write .cm-content");
    await cm.locator(".cm-line").last().click();
    await page.keyboard.press("End");
    await page.keyboard.type("FINAL");
    assert.ok((await cm.innerText()).includes("FINAL"), await cm.innerText());
    // Immediately switch after the last input event, without an artificial flush delay.
    await page.keyboard.press("Meta+Shift+r");
    await page.locator('#write img[alt="大图"]').waitFor();
    assert.ok((await page.locator("#write").innerText()).includes("末尾FINAL"), "first visible reading render must contain the final CM6 input");
    await page.locator('#write img[alt="大图"]').click();
    await page.getByRole("dialog", { name: "图片查看器" }).waitFor();
    // A native menu / host view command may change mode while the modal is open.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", metaKey: true, shiftKey: true, bubbles: true })));
    await page.getByRole("dialog", { name: "图片查看器" }).waitFor({ state: "detached" });
    await cm.waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.ok((await cm.innerText()).includes("末尾FINAL"));
    await cm.click();
    await page.keyboard.press("Meta+z");
    await page.waitForFunction(() => !document.querySelector("#write .cm-content").textContent.includes("FINAL"));
    await mode(page, "源代码模式");
    assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), content);
    assert.deepEqual(await page.evaluate(() => window.__reading), { external: [], writes: [] });
  } finally { await page.close(); await browser.close(); }
});
