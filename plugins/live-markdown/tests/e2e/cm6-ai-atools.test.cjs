const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { launchBrowser, cacheRoot, screenshotRoot } = require('./browser.cjs');

const pluginRoot = path.resolve(__dirname, "../..");
const distIndexHtml = path.join(pluginRoot, "dist/index.html");
const distPreloadPath = path.join(pluginRoot, "dist/preload/services.cjs");


test("Real Chromium E2E: CodeMirror 6 Live Preview + AI Copilot + Skills + MCP + ATools Dual Engine Verification", async () => {
  assert.equal(fs.existsSync(distIndexHtml), true, "dist/index.html must exist");
  assert.equal(fs.existsSync(distPreloadPath), true, "dist/preload/services.cjs must exist");

  const storageMap = new Map();

  // Pre-seed preference with CM6 engine enabled to verify next-gen continuous live preview
  storageMap.set(
    "typora_ztools_preferences_v1",
    JSON.stringify({
      editorEngine: "cm6",
      theme: "github",
      fontSize: 16,
      lineWidth: "default",
      autoSave: true,
      enableAiCopilot: true
    })
  );

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 }
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    page.on("console", (msg) => {
      console.log("[Chromium Console]", msg.type(), msg.text());
    });

    await page.addInitScript(() => {
      const mcpServers = [{ id: "builtin", name: "ZTools 内置 MCP 工具服务", transport: "builtin", url: "ztools://internal/mcp", enabled: true, builtIn: true, hasToken: false, status: "connected" }];
      const bridge = {
        getDefaultNotesDir() {
          return "/tmp";
        },
        loadPersistedState() {
          return { preferences: { editorEngine: "cm6", enableAiCopilot: true } };
        },
        savePersistedState() {
          return {};
        },
        openExternalUrl() {
          return true;
        },
        readDocument(p) {
          return {
            content: "# Welcome CM6\n\n- [ ] Task in CM6",
            name: "cm6.md",
            dir: "/tmp",
            path: p
          };
        },
        writeDocument() {
          return {};
        },
        copyImageToAssets() {
          return {};
        },
        resolveImageUrl(_d, src) {
          return src;
        },
        scanWorkspace() {
          return {
            rootDir: "/tmp",
            rootName: "tmp",
            tree: { type: "directory", name: "tmp", path: "/tmp", children: [] },
            files: []
          };
        },
        mcp: {
          async listServers() { return mcpServers.map((server) => ({ ...server })); },
          async upsertServer(input) {
            const existing = mcpServers.find((server) => server.id === input.id);
            const hasToken = input.token === "" ? false : input.token ? true : Boolean(existing?.hasToken && existing.url === input.url);
            const server = { ...existing, ...input, id: input.id || `custom-${mcpServers.length}`, transport: "streamable-http", builtIn: false, hasToken, status: "disconnected" };
            if (existing) Object.assign(existing, server); else mcpServers.push(server);
            return { ...server };
          },
          async removeServer(id) { const index = mcpServers.findIndex((server) => server.id === id); if (index >= 0) mcpServers.splice(index, 1); },
          async setEnabled(id, enabled) { const server = mcpServers.find((item) => item.id === id); Object.assign(server, { enabled }); return { ...server }; },
          async connect(serverId) { const server = mcpServers.find((item) => item.id === serverId); Object.assign(server, { status: "connected" }); return { serverId, status: "connected", toolCount: 1 }; },
          async disconnect(serverId) { const server = mcpServers.find((item) => item.id === serverId); Object.assign(server, { status: "disconnected" }); },
          async listTools(serverId) { return serverId === "builtin" || serverId.startsWith("custom-") ? [{ name: "get_diagram_template", description: "获取 Mermaid 模板", inputSchema: { type: "object", properties: { type: { type: "string", enum: ["architecture", "sequence"] } }, required: ["type"] } }] : []; },
          async callTool(serverId, toolName, args) { const fence = String.fromCharCode(96).repeat(3); return { serverId, toolName, content: [{ type: "text", text: [fence + "mermaid", "graph LR", "  UI[前端视图] --> Engine[CM6 流式引擎]", fence].join("\n") }], isError: false, structuredContent: { args } }; },
          async cancel() {}
        }
      };
      window.typoraBridge = bridge;
      window.services = bridge;

      window.ztools = {
        setExpendHeight() {},
        onPluginEnter() {},
        dbStorage: {
          getItem(k) {
            return localStorage.getItem(k);
          },
          setItem(k, v) {
            localStorage.setItem(k, v);
          }
        },
        ai(options, onChunk) {
          window.__aiCallCount = (window.__aiCallCount || 0) + 1;
          const streamText = "\n\n### 自动化 AI 评测结论\n1. 统一 CM6 全文本流式引擎已完全打通；\n2. 彻底消除行高跳动与撤销割裂。";
          if (window.__holdAi) return new Promise((resolve) => { window.__releaseAi = () => { onChunk(streamText); resolve(streamText); }; });
          const chunks = streamText.split(/(?<=[，。\n\s])/);
          let idx = 0;
          const timer = setInterval(() => {
            if (idx < chunks.length) {
              onChunk(chunks[idx++]);
            } else {
              clearInterval(timer);
            }
          }, 20);
          return Promise.resolve(streamText);
        },
        allAiModels() {
          return Promise.resolve([
            { id: "ztools-model-pro", name: "ZTools 官方推理大模型" }
          ]);
        }
      };

      // Emulate ATools dual-engine compatibility presence
      window.atools = {
        ai(options, onChunk) {
          window.__aiCallCount = (window.__aiCallCount || 0) + 1;
          const prompt = String(options?.prompt || "");
          if (prompt.includes("本次用户指令：")) {
            return Promise.resolve(JSON.stringify({ version: 1, kind: "clarify", reason: "missing_operation" }));
          }
          const matched = prompt.match(/【当前分块】\n([\s\S]*?)(?:\n只改写当前正文块|$)/);
          const response = matched?.[1] || "ATools Rust AI Complete";
          if (window.__holdAi) return new Promise((resolve) => { window.__releaseAi = () => { onChunk(response); resolve(response); }; });
          onChunk(response);
          return Promise.resolve(response);
        },
        allAiModels() {
          return Promise.resolve([
            { id: "atools-rust-fast", name: "ATools Rust Fast Engine" }
          ]);
        }
      };
      window.__TAURI__ = {
        core: {
          invoke(cmd) {
            if (cmd === "atools_myers_diff") return Promise.resolve({ diffs: [] });
            return Promise.resolve("tauri_ok");
          }
        }
      };

      localStorage.setItem(
        "typora_ztools_preferences_v1",
        JSON.stringify({
          editorEngine: "cm6",
          theme: "github",
          fontSize: 16,
          lineWidth: "default",
          autoSave: true,
          enableAiCopilot: true
        })
      );
    });

    const targetUrl = pathToFileURL(distIndexHtml).href;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    // 1. Verify Workbench Shell and CM6 Engine Mounting
    await page.waitForSelector(".typora-workbench");
    assert.equal(pageErrors.length, 0, `Expected 0 page errors, got: ${pageErrors.join("; ")}`);

    // Verify .cm-editor is mounted in #write
    await page.waitForSelector("#write .cm-editor");
    const isCmEditorMounted = await page.locator("#write .cm-editor").count();
    assert.equal(isCmEditorMounted, 1, "CodeMirror 6 .cm-editor must be mounted inside #write");

    // 2. Verify Workspace Bottom Status Footer & Sidebar Footer are visible within viewport
    await page.waitForSelector(".ty-footer-bar");
    const footerBox = await page.locator(".ty-footer-bar").boundingBox();
    assert.ok(footerBox, "Footer status bar bounding box must exist");
    assert.ok(
      footerBox.y >= 750 && footerBox.y + footerBox.height <= 825,
      `Footer status bar must be anchored at the bottom of the window, got y=${footerBox.y}`
    );

    const sidebarFooterBox = await page.locator(".ty-sidebar-footer").boundingBox();
    assert.ok(sidebarFooterBox, "Sidebar footer bounding box must exist");
    assert.ok(
      sidebarFooterBox.y >= 750 && sidebarFooterBox.y + sidebarFooterBox.height <= 825,
      `Sidebar footer must be anchored at the bottom of the sidebar, got y=${sidebarFooterBox.y}`
    );

    // 2b. Verify CM6 Heading Decoration & Zero Jump
    const firstHeadingLine = page.locator("#write .cm-line.cm-heading-1").first();
    await firstHeadingLine.waitFor();
    const headingBox = await firstHeadingLine.boundingBox();
    assert.ok(headingBox && headingBox.height >= 28, "CM6 H1 line must have proper heading height");

    // Keep a precise insertion point before moving focus into the assistant.
    await page.locator('#write .cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');

    // 3. Verify AI Copilot Drawer & Capabilities
    const aiCopilotBtn = page.locator('[data-testid="top-ai-copilot-btn"]');
    await aiCopilotBtn.click();
    await page.waitForSelector(".typora-ai-assistant-drawer");
    await page.locator(".typora-ai-assistant-drawer").evaluate(async drawer => {
      await Promise.all(drawer.getAnimations().map(animation => animation.finished.catch(() => undefined)));
    });

    const editorColumn = await page.locator(".ty-editor-column").boundingBox();
    const assistantDock = await page.locator(".typora-ai-assistant-drawer").boundingBox();
    assert.ok(editorColumn && assistantDock, "the editor and assistant dock must be visible");
    assert.ok(assistantDock.width <= 420 && assistantDock.width < editorColumn.width, "assistant remains a compact right-side panel");
    assert.ok(Math.abs(assistantDock.x + assistantDock.width - 1280) < 3, `assistant panel remains anchored to the right edge (x=${assistantDock.x}, width=${assistantDock.width})`);
    const composerBox = await page.locator(".ty-ai-composer").boundingBox();
    assert.ok(composerBox && composerBox.width >= assistantDock.width - 40, "composer must span the available width inside the assistant panel");
    const assistantHeader = await page.locator(".ty-ai-drawer-header").boundingBox();
    const titleGroup = await page.locator(".ty-ai-drawer-title-group").boundingBox();
    assert.ok(assistantHeader && titleGroup && assistantHeader.height >= 48 && titleGroup.y >= assistantHeader.y && titleGroup.y + titleGroup.height <= assistantHeader.y + assistantHeader.height, "assistant header title must stay inside the single-line header");
    const assistantMain = await page.locator(".ty-ai-main").boundingBox();
    assert.ok(assistantMain && composerBox.y + composerBox.height >= assistantMain.y + assistantMain.height - 100, "composer must stay at the bottom of the assistant panel, below scrollable results");
    assert.equal(await page.locator("#write .cm-editor").count(), 1, "opening the assistant must keep the editor mounted for continued editing");

    await page.locator(".ty-ai-model-trigger").click();
    await page.locator(".ty-ai-model-setup").waitFor();
    const modelChoices = await page.locator(".ty-ai-model-setup nav").innerText();
    assert.doesNotMatch(modelChoices, /ATools/i, "model picker must not expose a separate ATools entry");
    await page.locator(".ty-ai-model-setup nav").getByRole("button", { name: "宿主模型" }).click();
    await page.waitForFunction(() => { const button = [...document.querySelectorAll(".ty-ai-model-setup button")].find((node) => node.textContent.includes("使用此模型")); return Boolean(button && !button.disabled); });
    await page.getByRole("button", { name: "使用此模型" }).click();

    // AI and MCP must keep independent busy ownership while the user changes tabs.
    const callsBeforeBusySwitch = await page.evaluate(() => window.__aiCallCount || 0);
    await page.evaluate(() => { window.__holdAi = true; });
    await page.getByRole("button", { name: "润色", exact: true }).click();
    try { await page.waitForFunction((count) => (window.__aiCallCount || 0) === count + 1, callsBeforeBusySwitch, { timeout: 5000 }); }
    catch (cause) { throw new Error(`${cause.message}\nAI state: ${await page.locator(".ty-ai-main").innerText()}\nCalls: ${await page.evaluate(() => window.__aiCallCount || 0)}`); }
    await page.getByRole("button", { name: "MCP", exact: true }).click();
    await page.getByRole("button", { name: "助手", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "润色", exact: true }).isDisabled(), true, "AI action remains locked after a tab switch during generation");
    await page.getByRole("button", { name: "停止生成" }).click();
    await page.evaluate(() => { window.__holdAi = false; window.__releaseAi?.(); });
    await page.getByText("已停止生成。", { exact: true }).waitFor();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.__aiCallCount || 0), callsBeforeBusySwitch + 1, "switching tabs must not allow a second AI request");
    assert.equal(await page.locator(".ty-ai-result").count(), 0, "a late result from a stopped request must not be applied");

    // Verify Tab switching
    await page.getByRole("button", { name: "Skills" }).click();
    assert.ok(
      await page.getByText("Mermaid 架构图生成").count() >= 1,
      "Should list built-in Mermaid architecture skill"
    );
    const mermaidSkill = page.locator(".ty-ai-skills-card").filter({ hasText: "Mermaid 架构图生成" });
    const skillCopy = await mermaidSkill.locator(".ty-ai-skills-card-copy").boundingBox();
    const skillActions = await mermaidSkill.locator(".ty-ai-skills-card-actions").boundingBox();
    assert.ok(skillCopy && skillActions && skillActions.y >= skillCopy.y + skillCopy.height, "skill actions must wrap below full-width title and description in the sidebar");

    await page.getByRole("button", { name: "MCP" }).click();
    try { await page.getByText("get_diagram_template", { exact: true }).first().waitFor({ timeout: 5000 }); }
    catch (error) { throw new Error(`${error.message}\nMCP panel: ${await page.locator(".ty-ai-mcp-panel").innerText()}`); }
    assert.ok(
      await page.getByText("get_diagram_template").count() >= 1,
      "Should list MCP get_diagram_template tool"
    );

    const builtinCard = page.locator(".ty-ai-mcp-server").filter({ hasText: "内置服务 · 不可删除" });
    await builtinCard.waitFor();
    assert.equal(await builtinCard.getByRole("button", { name: "编辑" }).count(), 0, "built-in MCP entries cannot be edited");
    assert.equal(await builtinCard.locator("button[aria-label^='删除']").count(), 0, "built-in MCP entries cannot be deleted");
    await page.getByRole("button", { name: "添加服务" }).click();
    await page.getByRole("textbox", { name: "名称" }).fill("Custom MCP");
    await page.getByRole("textbox", { name: "Streamable HTTP 地址" }).fill("https://mcp.example.test/mcp");
    await page.getByRole("textbox", { name: /会话 Bearer Token/ }).fill("session-token");
    await page.getByRole("button", { name: "保存连接" }).click();
    const customCard = page.locator(".ty-ai-mcp-server").filter({ hasText: "Custom MCP" });
    await customCard.waitFor();
    await customCard.getByRole("button", { name: "连接并发现工具" }).click();
    await customCard.getByRole("button", { name: /get_diagram_template/ }).waitFor();
    await customCard.getByRole("button", { name: "编辑" }).click();
    await page.getByRole("textbox", { name: "Streamable HTTP 地址" }).fill("https://mcp.example.test/v2");
    await page.getByRole("button", { name: "保存连接" }).click();
    await customCard.waitFor();
    await customCard.getByRole("button", { name: "删除 Custom MCP" }).click();
    await customCard.getByText("删除此服务？").waitFor();
    await customCard.getByRole("button", { name: "删除", exact: true }).click();
    await customCard.waitFor({ state: "detached" });

    // Call MCP Tool get_diagram_template
    await page.getByRole('button', { name: /get_diagram_template/ }).click();
    await page.getByRole("button", { name: "运行工具" }).click();
    await page.getByText("工具结果", { exact: true }).waitFor();
    await page.getByRole("button", { name: "插入到原光标位置" }).click();
    await page.getByRole("button", { name: "助手", exact: true }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector(".typora-ai-assistant-drawer");
      return el && el.textContent.includes("graph LR");
    });

    // 4. Test Inserting AI generated content into document (replace mode)
    await page.getByRole("button", { name: "确认并插入" }).click();
    await page.waitForFunction(() => {
      const write = document.querySelector("#write");
      return write && write.textContent.includes("前端视图");
    });

    // The full-width composer guards IME Enter and uses Shift+Enter for a newline.
    const composer = page.locator("#ty-ai-composer");
    const callsBeforeIme = await page.evaluate(() => window.__aiCallCount || 0);
    await composer.fill("IME-safe instruction");
    await composer.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
    assert.equal(await page.evaluate(() => window.__aiCallCount || 0), callsBeforeIme, "Enter during IME composition must not submit");
    await composer.press("Shift+Enter");
    assert.equal(await page.evaluate(() => window.__aiCallCount || 0), callsBeforeIme, "Shift+Enter must insert a newline instead of submitting");
    await composer.press("Enter");
    await page.waitForFunction((count) => (window.__aiCallCount || 0) > count, callsBeforeIme);
    assert.ok((await composer.boundingBox()).height <= 150, "composer auto-height must stop before occupying the editing canvas");
    await page.locator(".ty-ai-error").waitFor();
    assert.equal(await page.locator(".ty-ai-review").count(), 0, "an unspecified IME test instruction must request clarification, not create an edit");

    // Close AI Copilot Drawer via close button
    await page.getByRole('button', { name: '关闭 AI 助手' }).click();
    assert.equal(await page.locator(".typora-ai-assistant-drawer").count(), 0, "AI Drawer should close");

    // 5. Verify Engine Switcher in View Menu (seamless toggle between CM6 and Block engine)
    await page.locator(".ty-menu-trigger", { hasText: "视图" }).click();
    await page.locator(".ty-menu-option", { hasText: "经典分块 Textarea" }).click();
    await page.waitForSelector("#write .ty-diagram-block");
    assert.equal(await page.locator("#write .ty-diagram-block").count() > 0, true, "Should switch back to block engine");

    await page.locator(".ty-menu-trigger", { hasText: "视图" }).click();
    await page.locator(".ty-menu-option", { hasText: "CM6 全文本流式" }).click();
    await page.waitForSelector("#write .cm-editor");
    assert.equal(await page.locator("#write .cm-editor").count(), 1, "Should switch back to CM6 continuous engine");
  } finally {
    await browser.close();
  }
});
