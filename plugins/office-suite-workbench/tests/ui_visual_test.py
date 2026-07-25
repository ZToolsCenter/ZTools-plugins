import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5188"
OUTPUT_DIR = Path(os.environ.get("OFFICE_SUITE_VISUAL_OUTPUT", "/tmp/office-suite-visuals"))


MOCK_BRIDGE = r"""
window.officeSuite = {
  async getStatus() {
    return { ok: true, data: { installed: true, binaryPath: '/opt/homebrew/bin/officecli', version: '1.0.141' } };
  },
  async run(command) {
    const args = Array.isArray(command) ? command : [command];
    return {
      ok: true,
      data: {
        command: args[0],
        args: args.slice(1),
        exitCode: 0,
        stdout: JSON.stringify({ success: true, data: { Results: [{ path: '/body/p[1]', text: 'Executive summary' }] } }, null, 2),
        stderr: '',
        json: { success: true, data: { Results: [{ path: '/body/p[1]', text: 'Executive summary' }] } },
        durationMs: 84,
        previewImages: [{
          path: '/tmp/officecli-preview.png',
          mimeType: 'image/png',
          size: 68,
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        }]
      }
    };
  },
  async runForAi(command) { return this.run(command); },
  async getMcpStatus() {
    return { ok: true, data: { raw: 'Claude registered\nCursor not registered', targets: { claude: true, cursor: false } } };
  },
  async registerMcp(target) { return { ok: true, data: { target, stdout: 'registered', stderr: '' } }; },
  async unregisterMcp(target) { return { ok: true, data: { target, stdout: 'removed', stderr: '' } }; },
  async probeMcp() {
    return { ok: true, data: { serverInfo: { name: 'officecli', version: '1.0.141' }, protocolVersion: '2024-11-05', toolNames: ['officecli'] } };
  },
  async getMcpConfigs() {
    const entry = { command: '/opt/homebrew/bin/officecli', args: ['mcp'] };
    return {
      ok: true,
      data: {
        binaryPath: entry.command,
        configs: {
          generic: entry,
          codex: '[mcp_servers.officecli]\ncommand = "/opt/homebrew/bin/officecli"\nargs = ["mcp"]',
          claude: { mcpServers: { officecli: entry } },
          cursor: { mcpServers: { officecli: entry } },
          vscode: { servers: { officecli: { type: 'stdio', ...entry } } }
        }
      }
    };
  }
};
window.ztools = {
  onPluginEnter(callback) { window.__pluginEnter = callback; },
  async showOpenDialog() {
    return ['/tmp/Annual Report.docx', '/tmp/Budget 2026.xlsx', '/tmp/Launch Deck.pptx'];
  },
  async showSaveDialog() { return '/tmp/Untitled.docx'; },
  copyText(text) { window.__copiedText = text; },
  async shellOpenExternal() {},
  async shellOpenPath() {},
  async allAiModels() {
    return [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', description: 'ZTools configured model' },
      { id: 'qwen-plus', label: 'Qwen Plus', description: 'Backup model' }
    ];
  },
  ai(options, onChunk) {
    window.__lastAiOptions = options;
    const request = Promise.resolve().then(async () => {
      const toolResult = await window.office_document({
        operation: 'get',
        filePath: '/tmp/Annual Report.docx',
        args: ['/body']
      });
      window.__lastAiToolResult = toolResult;
      onChunk({ role: 'assistant', content: '已通过 ZTools AI 检查当前文档。' });
    });
    request.abort = () => { window.__aiAborted = true; };
    return request;
  }
};
"""


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    console_errors = []
    page_errors = []

    with sync_playwright() as playwright:
        chrome_candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
        executable = next((candidate for candidate in chrome_candidates if Path(candidate).is_file()), None)
        launch_options = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context(viewport={"width": 1280, "height": 780}, device_scale_factor=1)
        context.add_init_script(MOCK_BRIDGE)
        context.add_init_script("localStorage.setItem('office-suite.history', '[null]')")
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        page.get_by_role("heading", name="一个工作台， 三种文档世界。").wait_for()
        page.screenshot(path=str(OUTPUT_DIR / "office-suite-home.png"), full_page=True)

        runtime_button = page.get_by_role("button", name=re.compile(r"OfficeCLI 1\.0\.141"))
        runtime_button.focus()
        runtime_button.click()
        dialog = page.get_by_role("dialog", name="OfficeCLI 运行时")
        dialog.wait_for()
        assert page.evaluate("document.activeElement?.closest('dialog') !== null")
        page.keyboard.press("Escape")
        dialog.wait_for(state="hidden")
        assert runtime_button.evaluate("element => document.activeElement === element")

        page.get_by_role("button", name="选择文档").click()
        page.get_by_role("heading", name="Word 工作站").wait_for()
        assert page.get_by_text("Annual Report.docx").count() >= 1
        page.get_by_title("总览").click()
        remove_button = page.get_by_role("button", name="移除 Launch Deck.pptx")
        remove_button.focus()
        page.keyboard.press("Enter")
        assert page.get_by_role("button", name="移除 Launch Deck.pptx").count() == 0
        page.get_by_title("Word").click()
        page.get_by_role("heading", name="Word 工作站").wait_for()
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUTPUT_DIR / "office-suite-word.png"), full_page=True)

        page.get_by_role("button", name="结构速览 读取文档层级与关键节点").click()
        page.get_by_text("COMMAND OUTPUT").wait_for()
        assert "Executive summary" in page.locator(".result-drawer pre").inner_text()
        assert page.locator(".result-drawer .result-previews img").is_visible()
        page.locator('.result-drawer button[title="关闭"]').click()

        page.get_by_title("AI 助手").click()
        page.get_by_role("heading", name="使用你已经配置的 AI。").wait_for()
        assert page.get_by_role("combobox", name="ZTools AI 模型").input_value() == "deepseek-chat"
        page.evaluate("window.ztools.showOpenDialog = async () => ['/tmp/Replacement.docx']")
        page.get_by_role("button", name="更换").click()
        page.get_by_role("heading", name="使用你已经配置的 AI。").wait_for()
        page.get_by_text("Replacement.docx", exact=True).wait_for()
        write_toggle = page.locator(".ai-write-inline input[type='checkbox']")
        write_toggle.check()
        assert write_toggle.is_checked()
        ai_prompt = page.get_by_role("textbox", name="向 Office AI 提问")
        ai_prompt.fill("检查当前文档")
        page.get_by_role("button", name="发送").click()
        page.get_by_text("已通过 ZTools AI 检查当前文档。").wait_for()
        assert page.evaluate("window.__lastAiOptions.model") == "deepseek-chat"
        assert page.evaluate("window.__lastAiOptions.tools[0].function.name") == "office_document"
        assert page.evaluate("window.__lastAiOptions.tools[0].function.parameters.properties.operation.enum.includes('view')") is True
        assert page.evaluate("window.__lastAiToolResult.ok") is True
        assert write_toggle.is_checked() is False

        page.get_by_title("MCP 接入").click()
        page.get_by_role("heading", name="让 AI 直接操作 Office。").wait_for()
        page.get_by_role("button", name="运行握手").click()
        page.get_by_text("HANDSHAKE OK").wait_for()
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUTPUT_DIR / "office-suite-mcp.png"), full_page=True)

        page.get_by_role("button", name="OfficeCLI stdio 高级 · 直接完整能力").click()
        page.get_by_role("button", name="Codex", exact=True).click()
        assert "mcp_servers.officecli" in page.locator(".config-code pre").inner_text()

        page.get_by_title("总览").click()
        page.evaluate("""window.officeSuite.getMcpConfigs = async () => ({
          ok: false,
          error: { code: 'OFFICECLI_NOT_FOUND', message: 'runtime unavailable' }
        })""")
        page.get_by_title("MCP 接入").click()
        page.get_by_role("button", name="OfficeCLI stdio 高级 · 直接完整能力").click()
        page.get_by_text("读取失败：runtime unavailable").wait_for()
        assert page.locator(".config-code button").is_disabled()

        page.get_by_title("命令台").click()
        command_input = page.get_by_role("textbox", name="OfficeCLI 命令")
        command_input.focus()
        outline = command_input.evaluate("element => getComputedStyle(element).outlineStyle")
        assert outline != "none"

        browser.close()

    summary = {
        "screenshots": [
            str(OUTPUT_DIR / "office-suite-home.png"),
            str(OUTPUT_DIR / "office-suite-word.png"),
            str(OUTPUT_DIR / "office-suite-mcp.png"),
        ],
        "console_errors": console_errors,
        "page_errors": page_errors,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if console_errors or page_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
