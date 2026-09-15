from pathlib import Path
import os

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "screenshots" / "main.png"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
URL = os.environ.get("E2E_URL", "http://127.0.0.1:5178").rstrip("/")


def assert_no_overflow(page):
    dimensions = page.evaluate("""() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    })""")
    assert dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1, dimensions


with sync_playwright() as playwright:
    launch = {"headless": True}
    if CHROME.exists():
        launch["executable_path"] = str(CHROME)
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 720, "height": 480}, color_scheme="light")
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    bridge_fixture = """(() => {
      let used = false;
      const candidates = [
        { id: 'a', category: 'cache', label: '浏览器渲染缓存', location: '~/Library/Caches/Browser', sizeBytes: 1524713390, ageDays: 16, kind: 'directory', selectedByDefault: true },
        { id: 'b', category: 'cache', label: '设计工具预览缓存', location: '~/Library/Caches/DesignTool', sizeBytes: 1027604480, ageDays: 11, kind: 'directory', selectedByDefault: true },
        { id: 'c', category: 'logs', label: '应用诊断日志', location: '~/Library/Logs/App', sizeBytes: 272629760, ageDays: 31, kind: 'directory', selectedByDefault: true }
      ];
      window.systemCleaner = {
        async scan() { used = false; return { snapshotId: 'e2e-fixture', generatedAt: new Date().toISOString(), totalBytes: candidates.reduce((sum, item) => sum + item.sizeBytes, 0), warnings: [], candidates }; },
        async clean({ candidateIds }) { if (used) throw new Error('扫描结果已使用'); used = true; return { movedBytes: candidates.filter((item) => candidateIds.includes(item.id)).reduce((sum, item) => sum + item.sizeBytes, 0), results: candidateIds.map((id) => ({ candidateId: id, status: 'trashed' })) }; },
        async reveal() { return true; },
        cancelScan() { return true; }
      };
    })()"""
    page.add_init_script(bridge_fixture)

    page.goto(URL, wait_until="networkidle")
    page.get_by_role("heading", name="清理预览").wait_for()
    assert page.locator(".candidate").count() == 3
    select_box = page.locator(".candidate-select").first.bounding_box()
    assert select_box and select_box["width"] >= 44 and select_box["height"] >= 44
    assert page.get_by_text("已选 3 项").is_visible()
    assert page.get_by_role("button", name="移到废纸篓").is_enabled()
    assert_no_overflow(page)

    page.get_by_role("button", name="移到废纸篓").click()
    page.get_by_role("heading", name="确认移到废纸篓").wait_for()
    page.get_by_label("请输入“移到废纸篓”以继续").fill("移到废纸篓")
    confirm = page.get_by_role("button", name="确认清理")
    assert confirm.is_enabled()
    confirm.click()
    page.wait_for_function("""() =>
      document.querySelectorAll('.candidate').length === 3
      && document.querySelector('#resultPanel').hidden === false
      && document.querySelector('#statusPanel').hidden === true
      && document.querySelector('#confirmDialog').open === false
      && document.querySelector('#scanButton').disabled === false
    """)

    page.get_by_role("button", name="切换深浅主题").click()
    page.locator("html[data-theme='dark']").wait_for()
    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOT), full_page=True)

    compact = browser.new_page(viewport={"width": 360, "height": 480})
    compact.add_init_script(bridge_fixture)
    compact.goto(URL, wait_until="networkidle")
    compact.get_by_role("heading", name="清理预览").wait_for()
    assert_no_overflow(compact)
    compact.close()

    missing_bridge = browser.new_page(viewport={"width": 720, "height": 480})
    missing_bridge.goto(URL, wait_until="networkidle")
    missing_bridge.get_by_text("本地清理能力未加载").wait_for()
    assert missing_bridge.locator(".candidate").count() == 0
    missing_bridge.close()

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    browser.close()

print(f"E2E smoke passed: {SCREENSHOT}")
