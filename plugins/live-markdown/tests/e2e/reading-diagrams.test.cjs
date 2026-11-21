"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, screenshotRoot } = require("./browser.cjs");

function install({ content, engine }) {
  const state = {
    preferences: { editorEngine: engine, theme: engine === "block" ? "night" : "github", enableInlineMath: true, enableAiCopilot: false, autoSave: false },
    lastOpenDoc: { path: "/tmp/reading-diagrams.md", name: "reading-diagrams.md", dir: "/tmp", content, isDirty: false, mtimeMs: 1 }
  };
  window.__visual = { external: [], writes: [], executed: 0 };
  window.typoraBridge = {
    getDefaultNotesDir: () => "/tmp", loadPersistedState: () => structuredClone(state),
    savePersistedState: async (patch) => Object.assign(state, patch),
    resolveImageUrl: (_doc, src) => src,
    openExternalUrl: async (url) => window.__visual.external.push(url),
    writeDocumentAsync: async (...args) => window.__visual.writes.push(args)
  };
  window.services = window.typoraBridge;
  window.ztools = { setExpendHeight() {}, onPluginEnter() {}, dbStorage: { getItem: () => null, setItem() {} } };
}
async function mode(page, label) {
  await page.getByTestId("footer-viewmode-btn").click();
  await page.locator(".ty-footer-popover-item").filter({ hasText: label }).click();
}
const source = ["# 阅读公式与图表", "行内 $x^2 + y_1$。", "$$", "\\frac{a+b}{c} = \\sqrt{x^2+y^2}", "$$",
  "```mermaid", "flowchart LR", "  A[开始] -->|通过| B[完成]", "```",
  "```mermaid", "graph TD", "  C[第二流程] --> D[结束]", "```",
  "```mermaid", "sequenceDiagram", "  Alice->>Bob: 请求一", "  Bob-->>Alice: 响应一", "```",
  "```mermaid", "sequenceDiagram", "  Client->>Server: 请求二", "  Server-->>Client: 响应二", "```",
  "```mermaid", "nonsense ???", "```", "![错误图片](missing.png)", "结尾文字"].join("\n\n");

for (const engine of ["cm6", "block"]) {
  test(`reading rendered visuals: real local renderer, ${engine}, geometry, keyboard, readonly and lifecycle`, async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript(install, { content: source, engine });
      await page.goto(process.env.READING_DIAGRAMS_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
      await mode(page, "阅读模式");
      const diagrams = page.locator('#write svg[data-reading-visual="true"]');
      const math = page.locator('#write .ty-math-block-render[data-reading-visual="true"]');
      const inline = page.locator('#write .ty-math-inline-render[data-reading-visual="true"]');
      await math.waitFor();
      assert.equal(await diagrams.count(), 4);
      assert.equal(await inline.count(), 1);
      assert.equal(await page.locator('#write .ty-mermaid-fallback[data-reading-visual]').count(), 0);
      assert.equal(await page.locator('#write textarea, #write [contenteditable="true"]').count(), 0);
      const viewer = page.getByRole("dialog", { name: "图片查看器" });
      for (let index = 0; index < 4; index++) {
        const diagram = diagrams.nth(index);
        const original = await diagram.evaluate((svg) => ({
          text: svg.textContent, width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height, viewBox: svg.getAttribute("viewBox"),
          fill: getComputedStyle(svg.querySelector("text")).fill,
          markers: [...svg.querySelectorAll("marker")].map((node) => node.id)
        }));
        // Exercise nested labels and edge paths rather than only the outer SVG box.
        const target = diagram.locator(index % 2 ? "path" : "text").first();
        await target.click({ force: true });
        await viewer.waitFor();
        assert.equal(await viewer.locator(".ty-rendered-visual-content svg").textContent(), original.text);
        assert.equal(await viewer.locator(".ty-rendered-visual-content svg").evaluate((svg) => getComputedStyle(svg.querySelector("text")).fill), original.fill);
        const viewBox = await viewer.locator(".ty-rendered-visual-content svg").getAttribute("viewBox");
        assert.equal(viewBox, original.viewBox);
        const duplicateIds = await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
          return ids.filter((id, index) => ids.indexOf(id) !== index);
        });
        assert.deepEqual(duplicateIds, []);
        assert.equal(await viewer.locator(".ty-rendered-visual-content svg").evaluate((svg) => [...svg.querySelectorAll('[marker-end]')].every((element) => {
          const id = element.getAttribute("marker-end")?.match(/#([^)'"\s]+)/)?.[1];
          return id && svg.querySelector(`[id="${id}"]`);
        })), true);
        await page.getByRole("button", { name: "图片原始大小" }).click();
        const frame = viewer.locator(".ty-rendered-visual-frame");
        assert.ok(Math.abs((await frame.boundingBox()).width - original.width) < 1);
        await page.getByRole("button", { name: "放大图片", exact: true }).click();
        assert.ok((await frame.boundingBox()).width > original.width);
        await page.keyboard.press("Escape");
        await viewer.waitFor({ state: "detached" });
        assert.equal(await diagram.evaluate((element) => document.activeElement === element), true);
        await diagram.press("Enter");
        await viewer.waitFor();
        await page.getByRole("button", { name: "关闭图片查看器" }).click();
      }
      await math.locator(".ty-math-frac-num").click();
      await viewer.waitFor();
      assert.ok(parseInt(await viewer.locator("output").textContent()) > 100);
      assert.equal(await viewer.locator(".ty-math-frac-num").evaluate((element) => getComputedStyle(element).borderBottomStyle), "solid");
      assert.equal(await viewer.locator(".ty-math-sqrt-body").evaluate((element) => getComputedStyle(element).borderTopStyle), "solid");
      assert.match(await viewer.locator(".ty-math-block-render").evaluate((element) => getComputedStyle(element).fontFamily), /Math|Georgia/);
      await page.screenshot({ path: path.join(screenshotRoot, `reading-formulas-${engine}.png`) });
      await page.keyboard.press("Escape");
      await inline.press("Space");
      await viewer.waitFor();
      assert.ok(await viewer.locator("sup").count() > 0);
      assert.ok(await viewer.locator("sub").count() > 0);
      await page.getByRole("button", { name: "关闭图片查看器" }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog")), true);
      await page.keyboard.press("Escape");
      await diagrams.first().press("Space");
      await viewer.waitFor();
      // Preserve the displayed CSS snapshot while resizing the open viewer.
      await page.setViewportSize({ width: 360, height: 640 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("button", { name: "放大图片", exact: true }).click();
      await page.getByRole("button", { name: "放大图片", exact: true }).click();
      const scrolling = await viewer.locator(".ty-image-viewer-stage").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth, frame: element.querySelector(".ty-rendered-visual-frame")?.getBoundingClientRect().width, scale: document.querySelector("dialog output")?.textContent }));
      assert.ok(scrolling.scroll > scrolling.client, JSON.stringify(scrolling));
      await page.screenshot({ path: path.join(screenshotRoot, `reading-diagrams-${engine}-narrow.png`) });
      await page.mouse.click(1, 1);
      await viewer.waitFor({ state: "detached" });
      await page.setViewportSize({ width: 1100, height: 820 });
      await mode(page, "源代码模式");
      assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), source);
      assert.deepEqual(await page.evaluate(() => window.__visual), { external: [], writes: [], executed: 0 });
      await mode(page, "阅读模式");
      await math.press("Enter");
      await viewer.waitFor();
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", metaKey: true, shiftKey: true, bubbles: true })));
      await viewer.waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      await mode(page, "阅读模式");
      await diagrams.first().press("Enter");
      await viewer.waitFor();
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true, bubbles: true })));
      await viewer.waitFor({ state: "detached" });
      assert.equal(await page.locator(".ty-rendered-visual-content").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); await browser.close(); }
  });
}

test("reading structural compatibility: delayed Mermaid foreignObject, MathJax SVG/CHTML; passive isolated snapshots", async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  try {
    await page.addInitScript(install, { content: "# Structural fixtures\n\nActual runtime is the local renderer.", engine: "cm6" });
    await page.goto(process.env.READING_DIAGRAMS_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await mode(page, "阅读模式");
    await page.evaluate(() => {
      const host = document.createElement("div"); host.id = "compatibility-fixtures";
      host.innerHTML = '<div class="mermaid" id="delayed-diagram">graph LR A-->B</div><mjx-container id="pending-math">loading</mjx-container>';
      document.querySelector("#write").append(host);
    });
    assert.equal(await page.locator("#delayed-diagram [data-reading-visual], #pending-math[data-reading-visual]").count(), 0);
    // These are explicit output-structure fixtures, not claims of official runtime coverage.
    await page.evaluate(() => {
      document.querySelector("#delayed-diagram").innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 180"><defs><marker id="compat-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="rgb(20, 80, 160)"/></marker></defs><path d="M10 90L800 90" stroke="rgb(20, 80, 160)" marker-end="url(#compat-arrow)"/><foreignObject x="20" y="20" width="250" height="60"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:20px;color:rgb(20,80,160)"><a href="https://example.test/blocked" onclick="window.__visual.executed++">清晰 HTML label</a><button>active control</button><script>window.__visual.executed++</script></div></foreignObject></svg>`;
      document.querySelector("#pending-math").outerHTML = `<mjx-container id="svg-math" jax="SVG" style="display:inline-block;width:90px;height:40px;color:rgb(230,180,70)"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90000 40000" width="90" height="40"><use href="#global-math-glyph" onclick="window.__visual.executed++"/></svg><mjx-assistive-mml><math><mi>x</mi></math></mjx-assistive-mml></mjx-container>`;
      const global = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      global.setAttribute("style", "position:absolute;width:0;height:0");
      global.innerHTML = '<defs><path id="global-math-glyph" d="M10 10L70 30M70 10L10 30" stroke="currentColor" stroke-width="3"/></defs>';
      document.body.append(global);
      const css = document.createElement("style"); css.textContent = '.compat-glyph::before{content:"𝑥";font-family:Georgia,serif;font-size:32px}'; document.head.append(css);
      const html = document.createElement("div");
      html.innerHTML = '<mjx-container id="chtml-math" jax="CHTML" style="display:inline-block;width:80px;height:50px"><mjx-math><mjx-mi><mjx-c class="compat-glyph"></mjx-c></mjx-mi></mjx-math><mjx-assistive-mml><math><mi>x</mi></math></mjx-assistive-mml></mjx-container><mjx-container id="error-math"><mjx-merror>invalid</mjx-merror></mjx-container><div class="mermaid" id="error-diagram"><svg viewBox="0 0 100 50"><text class="error-text">Syntax error</text></svg></div>';
      document.querySelector("#compatibility-fixtures").append(html);
    });
    const diagram = page.locator('#delayed-diagram svg[data-reading-visual="true"]');
    await diagram.waitFor();
    assert.equal(await page.locator("#error-math[data-reading-visual], #error-diagram [data-reading-visual], mjx-assistive-mml [data-reading-visual]").count(), 0);
    const viewer = page.getByRole("dialog", { name: "图片查看器" });
    await diagram.locator("foreignObject a").click();
    await viewer.waitFor();
    assert.match(await viewer.locator("foreignObject").textContent(), /清晰 HTML label/);
    assert.equal(await viewer.locator("script, a, button:not(.ty-image-viewer-toolbar button), iframe, input").count(), 0);
    assert.equal(await viewer.locator("[onclick], [onload], [onerror]").count(), 0);
    assert.equal(await viewer.locator(".ty-rendered-visual-content").evaluate((host) => [...host.querySelectorAll("*")].some((element) => [...element.attributes].some((attribute) => attribute.name !== "xmlns" && /https?:|javascript:/i.test(attribute.value)))), false);
    assert.equal(await viewer.locator("foreignObject div").evaluate((element) => getComputedStyle(element).color), "rgb(20, 80, 160)");
    await page.keyboard.press("Escape");
    const svgMath = page.locator('#svg-math[data-reading-visual="true"]');
    await svgMath.press("Enter");
    await viewer.waitFor();
    assert.equal(await viewer.locator("mjx-assistive-mml").count(), 0);
    const reference = await viewer.locator("use").getAttribute("href");
    assert.match(reference, /^#reading-visual-/);
    await page.getByRole("button", { name: "图片原始大小" }).click();
    assert.equal((await viewer.locator(".ty-rendered-visual-frame").boundingBox()).width, 90);
    assert.equal(await viewer.locator(`[id="${reference.slice(1)}"]`).count(), 1);
    assert.equal(await viewer.locator("use").evaluate((element) => getComputedStyle(element).color), "rgb(230, 180, 70)");
    assert.equal(await viewer.locator(`[id="${reference.slice(1)}"]`).evaluate((element) => element.style.stroke), "currentcolor");
    await page.keyboard.press("Escape");
    await page.locator('#chtml-math[data-reading-visual="true"]').press("Space");
    await viewer.waitFor();
    assert.match(await viewer.locator(".ty-rendered-visual-content").textContent(), /𝑥/);
    assert.equal(await viewer.locator("mjx-c").count(), 0, "pseudo glyph becomes one passive span, avoiding duplicated ::before");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.querySelector("#delayed-diagram").textContent = "rerender pending"; });
    assert.equal(await page.locator('#delayed-diagram [data-reading-visual="true"]').count(), 0);
    await page.evaluate(() => {
      const host = document.createElement("div"); host.className = "mermaid";
      host.innerHTML = '<svg width="90" height="40" id="over-complex"><path d="M0 0L90 40"/>' + '<g/>'.repeat(6001) + '</svg><svg width="90" height="40" id="failed-snapshot"><use href="#deep-cache"/></svg>';
      document.querySelector("#write").append(host);
      const cache = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      cache.style.display = "none";
      cache.innerHTML = '<g id="deep-cache">' + '<g>'.repeat(82) + '<path d="M0 0L90 40"/>' + '</g>'.repeat(82) + '</g>';
      document.body.append(cache);
    });
    await page.locator('#failed-snapshot[data-reading-visual="true"]').press("Enter");
    await page.getByRole("status").filter({ hasText: "此图形暂时无法打开" }).waitFor();
    assert.equal(await viewer.count(), 0);
    assert.equal(await page.locator("#over-complex[data-reading-visual]").count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.deepEqual(await page.evaluate(() => window.__visual), { external: [], writes: [], executed: 0 });
  } finally { await page.close(); await browser.close(); }
});

for (const regression of ["css-size", "rerender-open", "nested-image"]) {
  test(`reading visual review regression: ${regression}`, async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    try {
      await page.addInitScript(install, { content: "# Review regressions\n\nUnchanged source", engine: "cm6" });
      await page.goto(process.env.READING_DIAGRAMS_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
      await mode(page, "阅读模式");
      await page.evaluate((regression) => {
        const host = document.createElement("div"); host.id = "review-fixture"; host.className = "mermaid";
        host.innerHTML = regression === "css-size"
          ? '<svg id="review-svg" width="90" height="40" viewBox="10000 -20000 90000 40000"><path d="M10000 -20000L100000 20000" stroke="currentColor"/><text x="15000" y="0">Large coordinates</text></svg>'
          : '<svg id="review-svg" width="300" height="120" viewBox="10 20 300 120"><path d="M10 20L310 140" stroke="currentColor"/><foreignObject x="20" y="30" width="120" height="60"><div xmlns="http://www.w3.org/1999/xhtml">Top-level diagram<img id="nested-picture" width="30" height="30" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'30\' height=\'30\'%3E%3Crect width=\'30\' height=\'30\' fill=\'red\'/%3E%3C/svg%3E"/></div></foreignObject></svg>';
        document.querySelector("#write").append(host);
      }, regression);
      const svg = page.locator('#review-svg[data-reading-visual="true"]');
      const viewer = page.getByRole("dialog", { name: "图片查看器" });
      if (regression === "css-size") {
        await svg.waitFor({ timeout: 1500 });
        await svg.press("Enter");
        await viewer.waitFor();
        await page.getByRole("button", { name: "图片原始大小" }).click();
        const frame = await viewer.locator(".ty-rendered-visual-frame").boundingBox();
        assert.equal(frame.width, 90); assert.equal(frame.height, 40);
        assert.equal(await viewer.locator(".ty-rendered-visual-content svg").getAttribute("viewBox"), "10000 -20000 90000 40000");
      } else if (regression === "nested-image") {
        await svg.waitFor();
        assert.equal(await page.locator("#nested-picture[data-reading-visual]").count(), 0);
        await page.locator("#nested-picture").click();
        await viewer.waitFor();
        assert.equal(await viewer.locator(".ty-image-viewer-name").textContent(), "Mermaid 图表");
        assert.equal(await viewer.locator(".ty-rendered-visual-content svg").count(), 1);
      } else {
        await svg.press("Enter");
        await viewer.waitFor();
        await page.evaluate(() => document.querySelector("#review-svg").replaceWith(document.querySelector("#review-svg").cloneNode(true)));
        await viewer.waitFor({ state: "detached", timeout: 1500 });
        assert.equal(await page.evaluate(() => document.body.style.overflow), "");
        assert.equal(await svg.evaluate((element) => document.activeElement === element), true);
        await svg.press("Enter"); await viewer.waitFor();
        // The top-level trigger stays connected while asynchronous renderer output changes.
        await page.evaluate(() => document.querySelector("#review-svg").innerHTML = '<text class="error-text">Render failed</text>');
        await viewer.waitFor({ state: "detached", timeout: 1500 });
        assert.equal(await page.locator("#review-svg[data-reading-visual]").count(), 0);
        assert.equal(await page.evaluate(() => document.body.style.overflow), "");
        await page.evaluate(() => document.querySelector("#review-svg").innerHTML = '<path d="M10 20L310 140"/><text x="20" y="40">New rendered content</text>');
        await svg.press("Space"); await viewer.waitFor();
        assert.match(await viewer.locator(".ty-rendered-visual-content").textContent(), /New rendered content/);
        await page.evaluate(() => document.querySelector("#review-svg").querySelector("text").textContent = "Replaced while open");
        await viewer.waitFor({ state: "detached", timeout: 1500 });
      }
      await page.keyboard.press("Escape");
      await viewer.waitFor({ state: "detached" });
      await mode(page, "源代码模式");
      assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), "# Review regressions\n\nUnchanged source");
      assert.deepEqual(await page.evaluate(() => window.__visual), { external: [], writes: [], executed: 0 });
    } finally { await page.close(); await browser.close(); }
  });
}

for (const engine of ["cm6", "block"]) {
  test(`tiny CSS diagram opens at readable stage size: ${engine}`, async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    const content = "# Tiny diagram\n\nUnchanged source";
    try {
      await page.addInitScript(install, { content, engine });
      await page.goto(process.env.READING_DIAGRAMS_URL || pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
      await mode(page, "阅读模式");
      await page.evaluate(() => {
        const host = document.createElement("div"); host.className = "mermaid";
        host.innerHTML = '<svg id="tiny-diagram" style="width:6px;height:3px" viewBox="0 0 1800 900"><path d="M0 0L1800 900" stroke="currentColor"/><text x="100" y="400">Diagram label</text></svg>';
        document.querySelector("#write").append(host);
      });
      const svg = page.locator('#tiny-diagram[data-reading-visual="true"]');
      await svg.waitFor();
      const original = await svg.evaluate((node) => ({ html: node.outerHTML, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
      assert.equal(original.width, 6); assert.equal(original.height, 3);
      await svg.click({ force: true });
      const viewer = page.getByRole("dialog", { name: "图片查看器" });
      await viewer.waitFor();
      const frame = viewer.locator(".ty-rendered-visual-frame");
      const stage = viewer.locator(".ty-image-viewer-stage");
      const fitWidth = (await frame.boundingBox()).width;
      assert.ok(fitWidth >= (await stage.boundingBox()).width * 0.7, `fit width ${fitWidth}`);
      await page.getByRole("button", { name: "放大图片", exact: true }).click();
      assert.ok((await frame.boundingBox()).width > fitWidth);
      await page.getByRole("button", { name: "图片原始大小" }).click();
      const actual = await frame.boundingBox();
      assert.equal(actual.width, 6); assert.equal(actual.height, 3);
      await page.getByRole("button", { name: "图片适应窗口" }).click();
      assert.ok((await frame.boundingBox()).width >= (await stage.boundingBox()).width * 0.7);
      await page.keyboard.press("Escape");
      assert.equal(await svg.evaluate((node) => node.outerHTML), original.html);
      await mode(page, "源代码模式");
      assert.equal(await page.locator("textarea.ty-source-textarea").inputValue(), content);
      assert.deepEqual(await page.evaluate(() => window.__visual), { external: [], writes: [], executed: 0 });
    } finally { await page.close(); await browser.close(); }
  });
}
