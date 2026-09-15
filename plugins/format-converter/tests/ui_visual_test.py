from pathlib import Path
import json
from playwright.sync_api import sync_playwright


ARTIFACT_DIR = Path(__file__).parent / ".artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

CAPABILITIES = {
    "formats": [],
    "routes": [],
    "limits": {"maxUiFiles": 200},
    "runtimes": [
        {"id": "officecli", "label": "OfficeCLI", "available": True, "version": "1.0.0", "bundled": False, "note": "Office"},
        {"id": "sharp", "label": "图片引擎", "available": True, "version": "0.34.4", "bundled": True, "note": "图片"},
        {"id": "pdf", "label": "PDF 引擎", "available": True, "version": "3.11.174", "bundled": True, "note": "PDF"},
        {"id": "excel", "label": "Excel 引擎", "available": False, "bundled": False, "installable": True, "estimateMb": 8, "note": "首次使用时按需安装"},
    ],
}

MOCK_SCRIPT = f"""
window.ztools = {{ onPluginEnter() {{}}, getPathForFile() {{ return ''; }} }};
const capabilities = {json.dumps(CAPABILITIES, ensure_ascii=False)};
const inputGrant = {{ id: 'input-grant', totalBytes: 3072, files: [
  {{ name: '季度报告.docx', path: '/approved/季度报告.docx', extension: 'docx', format: 'docx', family: 'office', size: 2048 }},
  {{ name: '产品截图.png', path: '/approved/产品截图.png', extension: 'png', format: 'png', family: 'image', size: 1024 }}
] }};
const outputGrant = {{ id: 'output-grant', directory: '/approved/output' }};
const plan = {{ executable: true, warnings: ['混合来源会按各自路线转换。'], estimatedOutputCount: 2, items: [
  {{ route: {{ description: '验证、渲染并输出 PDF', engines: ['officecli', 'pdf'], warnings: [], available: true }} }}
] }};
const job = {{ id: '12345678-1234-1234-1234-123456789abc', status: 'succeeded', progress: 100,
  summary: {{ total: 2, succeeded: 2, failed: 0, skipped: 0, cancelled: 0 }}, items: inputGrant.files.map((input, index) => ({{
    id: String(index), input, route: plan.items[0].route, status: 'succeeded', progress: 100,
    outputs: ['/approved/output/' + input.name + '.pdf'], warnings: []
  }})) }};
const ok = data => Promise.resolve({{ ok: true, data }});
window.formatConverter = {{
  getCapabilities: () => ok(capabilities), refreshRuntimes: () => ok(capabilities.runtimes),
  selectInputs: () => ok(inputGrant), acceptInputs: () => ok(inputGrant),
  selectOutputDirectory: () => ok(outputGrant), getApprovedRoots: () => ok(['/approved']),
  removeApprovedRoot: () => ok([]), planConversion: () => ok(plan), startConversion: () => ok(job),
  getJob: () => ok(job), cancelJob: () => ok(job), retryFailed: () => ok(job),
  installRuntime: () => ok(capabilities.runtimes),
  installOfficeCli: () => ok(capabilities.runtimes[0]), revealPath: () => ok(true)
}};
"""


def assert_layout(page, width: int, height: int):
    page.set_viewport_size({"width": width, "height": height})
    page.goto("http://127.0.0.1:5192")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="拖入文件，或点击选择").click()
    page.get_by_role("button", name="选择输出目录").click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="开始转换").click()
    page.get_by_role("heading", name="转换完成").wait_for()
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert page.get_by_role("button", name="转换设置").is_visible()
    assert page.get_by_role("button", name="开始转换").is_visible()
    assert page.get_by_role("button", name="按需安装").is_visible()
    dialogs = []
    def handle_dialog(dialog):
        dialogs.append(dialog.message)
        dialog.dismiss()
    page.once("dialog", handle_dialog)
    page.get_by_role("button", name="按需安装").click()
    assert dialogs and "国内镜像" in dialogs[0] and "8 MB" in dialogs[0]
    page.get_by_role("button", name="转换设置").click()
    assert page.get_by_text("安全与兼容策略").is_visible()
    page.screenshot(path=str(ARTIFACT_DIR / f"format-converter-{width}x{height}.png"), full_page=True)


with sync_playwright() as playwright:
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    browser = playwright.chromium.launch(headless=True, executable_path=str(chrome) if chrome.exists() else None)
    page = browser.new_page()
    errors = []
    page.on("console", lambda message: errors.append(f"console:{message.type}:{message.text}") if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(f"page:{error}"))
    page.add_init_script(MOCK_SCRIPT)
    assert_layout(page, 1280, 780)
    assert_layout(page, 900, 650)
    assert not errors, "\n".join(errors)
    browser.close()
