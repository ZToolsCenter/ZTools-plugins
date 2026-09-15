from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "screenshots" / "main.png"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def assert_no_horizontal_overflow(page) -> None:
    overflow = page.evaluate(
        """() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        })"""
    )
    assert overflow["scrollWidth"] <= overflow["clientWidth"] + 1, overflow


with sync_playwright() as playwright:
    launch_options = {"headless": True}
    if CHROME.exists():
        launch_options["executable_path"] = str(CHROME)
    browser = playwright.chromium.launch(**launch_options)
    context = browser.new_context(
        viewport={"width": 720, "height": 480},
        color_scheme="light",
        permissions=["clipboard-read", "clipboard-write"],
    )
    page = context.new_page()
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.get_by_role("heading", name="有项目值得进一步核对").wait_for()

    assert page.locator(".report-group").count() >= 10
    assert page.get_by_role("button", name="重新检查").is_enabled()
    assert page.get_by_role("button", name="复制 Markdown").is_enabled()
    assert page.get_by_role("button", name="导出").is_enabled()
    assert_no_horizontal_overflow(page)

    page.get_by_role("button", name="复制 Markdown").click()
    page.get_by_text("Markdown 已复制").wait_for()

    page.get_by_role("button", name="导出").click()
    page.get_by_role("heading", name="导出安全报告").wait_for()
    assert page.get_by_role("button", name="Markdown 文档").is_visible()
    assert page.get_by_role("button", name="JSON 数据").is_visible()
    page.get_by_role("button", name="关闭导出面板").click()

    page.get_by_role("button", name="切换到深色主题").click()
    page.locator("html[data-theme='dark']").wait_for()
    page.get_by_role("button", name="切换到浅色主题").click()
    page.locator("html[data-theme='light']").wait_for()

    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOT), full_page=True)

    compact = browser.new_page(viewport={"width": 360, "height": 480})
    compact.goto("http://127.0.0.1:5173", wait_until="networkidle")
    compact.get_by_role("heading", name="有项目值得进一步核对").wait_for()
    assert_no_horizontal_overflow(compact)
    compact.close()

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    browser.close()

print(f"E2E smoke passed; screenshot: {SCREENSHOT}")
