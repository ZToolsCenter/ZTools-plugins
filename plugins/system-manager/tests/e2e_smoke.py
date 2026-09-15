from pathlib import Path
import os

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "screenshots" / "main.png"
BASE_URL = os.environ.get("SYSTEM_MANAGER_E2E_URL", "http://127.0.0.1:8877").rstrip("/")
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
MODULES = [
    "system-diagnostic-report",
    "application-uninstaller",
    "startup-manager",
    "system-cleaner",
    "lan-device-discovery",
]
AGENT_ACCESS_INIT_SCRIPT = """
(() => {
  let state = {
    available: true,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    scopes: [],
  }
  const snapshot = () => ({ ...state, scopes: [...state.scopes] })
  window.__agentAccessCalls = []
  window.systemManagerAgentAccess = {
    getState() {
      return Promise.resolve(snapshot())
    },
    grant({ scopes }) {
      window.__agentAccessCalls.push({ method: "grant", payload: { scopes: [...scopes] } })
      state = {
        available: true,
        active: true,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        remainingMs: 600000,
        scopes: [...scopes],
      }
      return Promise.resolve(snapshot())
    },
    revoke() {
      window.__agentAccessCalls.push({ method: "revoke" })
      state = {
        available: true,
        active: false,
        expiresAt: null,
        remainingMs: 0,
        scopes: [],
      }
      return Promise.resolve(snapshot())
    },
  }
})()
"""


def assert_no_overflow(page):
    dimensions = page.evaluate(
        """() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        })"""
    )
    assert dimensions["scrollWidth"] <= dimensions["clientWidth"] + 1, dimensions


with sync_playwright() as playwright:
    launch = {"headless": True}
    if CHROME.exists():
        launch["executable_path"] = str(CHROME)
    browser = playwright.chromium.launch(**launch)

    page = browser.new_page(viewport={"width": 720, "height": 480}, color_scheme="light")
    page.add_init_script(AGENT_ACCESS_INIT_SCRIPT)
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("heading", name="系统管家", exact=True).wait_for()
    assert page.locator(".module-card").count() == 5
    assert len(page.locator(".module-grid").evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ')")) == 2
    page.get_by_text("未授权 · 默认关闭", exact=True).wait_for()
    agent_panel = page.locator(".agent-access-panel")
    agent_action = page.locator("#agent-access-action")
    agent_status = page.locator("#agent-access-status")
    agent_announcement = page.locator("#agent-access-announcement")
    assert agent_panel.get_attribute("data-agent-access-state") == "inactive"
    assert agent_status.get_attribute("aria-live") == "off"
    assert agent_announcement.get_attribute("role") == "status"
    assert agent_action.is_enabled()
    assert_no_overflow(page)
    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SCREENSHOT), full_page=True)

    agent_action.click()
    agent_dialog = page.locator("#agent-access-dialog")
    agent_dialog.wait_for(state="visible")
    assert agent_dialog.get_attribute("aria-labelledby") == "agent-access-dialog-title"
    assert agent_dialog.get_attribute("aria-describedby") == "agent-access-dialog-description"
    scope_inputs = agent_dialog.locator('input[name="agent-scope"]')
    assert scope_inputs.count() == 5
    assert agent_dialog.locator('input[name="agent-scope"]:checked').count() == 0
    assert page.locator("#agent-access-confirm").is_disabled()
    assert page.evaluate("document.activeElement === document.querySelector('input[value=\"report_export\"]')")

    page.keyboard.press("Escape")
    agent_dialog.wait_for(state="hidden")
    page.wait_for_function("document.activeElement === document.querySelector('#agent-access-action')")

    agent_action.click()
    agent_dialog.locator('input[value="report_export"]').check()
    agent_dialog.locator('input[value="lan_scan"]').check()
    agent_confirm = page.locator("#agent-access-confirm")
    assert agent_confirm.is_enabled()
    agent_confirm.click()
    page.wait_for_function("document.querySelector('.agent-access-panel').dataset.agentAccessState === 'active'")
    assert page.evaluate("document.activeElement === document.querySelector('#agent-access-action')")
    grant_calls = page.evaluate("window.__agentAccessCalls")
    assert grant_calls == [
        {"method": "grant", "payload": {"scopes": ["report_export", "lan_scan"]}}
    ], grant_calls
    active_status = agent_status.inner_text()
    assert "已授权 2 项" in active_status and "剩余" in active_status, active_status
    grant_announcement = agent_announcement.inner_text()
    assert grant_announcement == "Agent 已获得 2 项授权，有效期 10 分钟。"
    page.wait_for_timeout(1100)
    assert agent_announcement.inner_text() == grant_announcement

    page.get_by_role("button", name="撤销授权", exact=True).click()
    page.wait_for_function("document.querySelector('.agent-access-panel').dataset.agentAccessState === 'inactive'")
    assert page.evaluate("document.activeElement === document.querySelector('#agent-access-action')")
    assert page.evaluate("window.__agentAccessCalls")[-1] == {"method": "revoke"}
    assert agent_announcement.inner_text() == "Agent 授权已撤销。"

    page.locator('[data-feature="application-uninstaller"]').click(modifiers=["Shift"])
    modified_home_link = page.get_by_role("link", name="返回系统管家首页")
    modified_home_link.wait_for()
    modified_home_link.click(button="middle")
    page.get_by_role("heading", name="系统管家", exact=True).wait_for()

    for module_id in MODULES:
        page.goto(f"{BASE_URL}/modules/{module_id}/index.html", wait_until="networkidle")
        home_link = page.get_by_role("link", name="返回系统管家首页")
        home_link.wait_for()
        assert home_link.get_attribute("href") == "../../index.html"
        assert_no_overflow(page)
        if module_id in {"system-diagnostic-report", "system-cleaner"}:
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            suite_box = page.locator(".system-manager-suitebar").bounding_box()
            topbar_box = page.locator(".topbar").first.bounding_box()
            assert suite_box and topbar_box, module_id
            assert topbar_box["y"] >= suite_box["height"] - 1, {
                "module": module_id,
                "suitebar": suite_box,
                "topbar": topbar_box,
            }
            page.evaluate("window.scrollTo(0, 0)")
        home_link.click()
        page.get_by_role("heading", name="系统管家", exact=True).wait_for()

    compact = browser.new_page(viewport={"width": 360, "height": 480}, color_scheme="dark")
    compact.add_init_script(AGENT_ACCESS_INIT_SCRIPT)
    compact_errors = []
    compact.on("console", lambda message: compact_errors.append(message.text) if message.type == "error" else None)
    compact.goto(BASE_URL, wait_until="networkidle")
    compact.get_by_role("heading", name="系统管家", exact=True).wait_for()
    assert compact.locator(".module-card").count() == 5
    assert len(compact.locator(".module-grid").evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ')")) == 1
    compact.get_by_text("未授权 · 默认关闭", exact=True).wait_for()
    assert_no_overflow(compact)
    compact_action = compact.locator("#agent-access-action")
    compact_action.click()
    compact_dialog = compact.locator("#agent-access-dialog")
    compact_dialog.wait_for(state="visible")
    assert compact.evaluate("document.activeElement === document.querySelector('input[value=\"report_export\"]')")
    compact_dialog_box = compact_dialog.bounding_box()
    assert compact_dialog_box, "compact agent access dialog is not visible"
    assert compact_dialog_box["x"] >= 0
    assert compact_dialog_box["x"] + compact_dialog_box["width"] <= 361, compact_dialog_box
    assert_no_overflow(compact)
    compact.keyboard.press("Escape")
    compact_dialog.wait_for(state="hidden")
    compact.wait_for_function("document.activeElement === document.querySelector('#agent-access-action')")
    compact.close()

    preview = browser.new_page(viewport={"width": 720, "height": 480}, color_scheme="light")
    preview_errors = []
    preview_page_errors = []
    preview.on("console", lambda message: preview_errors.append(message.text) if message.type == "error" else None)
    preview.on("pageerror", lambda error: preview_page_errors.append(str(error)))
    preview.goto(BASE_URL, wait_until="networkidle")
    preview.get_by_text("当前环境不可用 · 需 ZTools 2.4 或更高版本", exact=True).wait_for()
    assert preview.locator(".agent-access-panel").get_attribute("data-agent-access-state") == "unavailable"
    assert preview.locator("#agent-access-action").is_disabled()
    assert_no_overflow(preview)
    assert not preview_errors, preview_errors
    assert not preview_page_errors, preview_page_errors
    preview.close()

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    assert not compact_errors, compact_errors
    browser.close()

print(f"System Manager E2E passed: {SCREENSHOT}")
