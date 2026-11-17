"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchBrowser, pluginRoot, cacheRoot, screenshotRoot } = require("./browser.cjs");
const { installLocalAiWorkflow } = require("./fixtures/local-ai-workflow.cjs");
const { startMcpFixture } = require("./fixtures/mcp-http.cjs");

test("production UI manages and calls a real HTTP MCP service through packaged preload", async () => {
  const { createMcpService } = require(path.join(pluginRoot, "dist/preload/mcp/service.cjs"));
  const fixture = await startMcpFixture();
  const storageFile = path.join(fs.mkdtempSync(path.join(cacheRoot, "mcp-")), "servers.json");
  const createApi = () => createMcpService({
    loadConfig: () => fs.existsSync(storageFile) ? JSON.parse(fs.readFileSync(storageFile, "utf8")) : [],
    saveConfig: value => fs.writeFileSync(storageFile, JSON.stringify(value))
  });
  let api = createApi();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const cleanupApi = async () => { for (const server of await api.listServers()) if (!server.builtIn) await api.disconnect(server.id); };
  try {
    await page.exposeFunction("__realMcp", async (method, args) => {
      if (!["listServers", "upsertServer", "removeServer", "setEnabled", "connect", "disconnect", "listTools", "callTool", "cancel"].includes(method)) throw new Error("Unsupported test bridge method");
      return api[method](...args);
    });
    await page.addInitScript(installLocalAiWorkflow, { content: "# MCP acceptance\n\nOriginal document.", configured: true });
    await page.addInitScript(() => {
      window.typoraBridge.mcp = Object.fromEntries(["listServers", "upsertServer", "removeServer", "setEnabled", "connect", "disconnect", "listTools", "callTool", "cancel"].map(method => [method, (...args) => window.__realMcp(method, args)]));
    });
    const openMcp = async () => {
      await page.locator("#write .cm-content").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.locator('[data-testid="top-ai-copilot-btn"]').click();
      await page.getByRole("button", { name: "MCP", exact: true }).click();
    };
    await page.goto(pathToFileURL(path.join(pluginRoot, "dist/index.html")).href);
    await openMcp();
    const builtin = page.locator(".ty-ai-mcp-server").filter({ hasText: "内置工具" });
    await builtin.waitFor();
    assert.equal(await builtin.getByRole("button", { name: "编辑", exact: true }).count(), 0);
    assert.equal(await builtin.getByRole("button", { name: /^删除/ }).count(), 0);
    await page.getByRole("button", { name: "添加服务", exact: true }).click();
    const form = page.getByRole("region", { name: "MCP 服务设置" });
    await form.getByLabel("名称", { exact: true }).fill("本地验收服务");
    await form.getByLabel("Streamable HTTP 地址").fill(fixture.url);
    await form.locator('input[type="password"]').fill("acceptance-session-token");
    await form.getByRole("button", { name: "保存连接" }).click();
    let card = page.locator(".ty-ai-mcp-server").filter({ hasText: "本地验收服务" });
    await card.getByRole("button", { name: "连接并发现工具" }).click();
    await card.getByRole("button", { name: /echo_note/ }).click();
    await page.getByLabel("参数 JSON", { exact: true }).fill(JSON.stringify({ text: "中文原文 $& 保留" }));
    await page.getByRole("button", { name: "运行工具", exact: true }).click();
    await page.locator(".ty-ai-mcp-result").filter({ hasText: "MCP 实际返回：中文原文 $& 保留" }).waitFor();
    assert.equal(fixture.requests.filter(item => item.method === "tools/call").length, 1);
    assert.equal(fixture.requests.find(item => item.method === "tools/call").params.arguments.text, "中文原文 $& 保留");
    assert.equal(fixture.requests.find(item => item.method === "tools/call").authorization, "Bearer acceptance-session-token");
    assert.doesNotMatch(fs.readFileSync(storageFile, "utf8"), /acceptance-session-token|token/i);
    assert.doesNotMatch(await page.locator("#write .cm-content").innerText(), /MCP 实际返回/);
    await page.screenshot({ path: path.join(screenshotRoot, "mcp-real-http-result.png") });

    // Invalid arguments must not reach the server.
    await page.getByLabel("参数 JSON", { exact: true }).fill("{invalid");
    await page.getByRole("button", { name: "运行工具", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(fixture.requests.filter(item => item.method === "tools/call").length, 1);

    await card.getByRole("button", { name: "编辑", exact: true }).click();
    await form.getByLabel("名称", { exact: true }).fill("已编辑的验收服务");
    await form.getByRole("button", { name: "保存连接" }).click();
    card = page.locator(".ty-ai-mcp-server").filter({ hasText: "已编辑的验收服务" });
    await card.getByRole("switch").click();
    await page.waitForFunction(() => [...document.querySelectorAll('.ty-ai-mcp-server')].find(el => el.textContent.includes('已编辑的验收服务'))?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await card.getByRole("button", { name: "连接并发现工具" }).isDisabled(), true);
    await card.getByRole("switch").click();
    await cleanupApi();
    api = createApi();
    await page.reload();
    await openMcp();
    card = page.locator(".ty-ai-mcp-server").filter({ hasText: "已编辑的验收服务" });
    await card.waitFor();
    assert.equal((await api.listServers()).find(item => !item.builtIn).hasToken, false);
    await card.getByRole("button", { name: "编辑", exact: true }).click();
    await form.getByLabel("Streamable HTTP 地址").fill(fixture.url.replace("/mcp", "/denied"));
    await form.getByRole("button", { name: "保存连接" }).click();
    await card.getByRole("button", { name: "连接并发现工具" }).click();
    await page.getByRole("alert").filter({ hasText: /认证|authentication|401/i }).waitFor();
    await card.getByRole("button", { name: "删除 已编辑的验收服务", exact: true }).click();
    await card.getByRole("button", { name: "删除", exact: true }).click();
    await card.waitFor({ state: "detached" });
    await page.reload();
    await openMcp();
    assert.equal((await api.listServers()).length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await browser.close();
    await cleanupApi();
    await fixture.close();
  }
});
