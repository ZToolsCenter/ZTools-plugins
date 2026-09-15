from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("E2E_URL", "http://127.0.0.1:5173").rstrip("/")

BRIDGE = r"""
window.__lanEmptyResult = false;
window.lanDiscovery = {
  listInterfaces: async () => [{
    id: 'fixture-en0', name: 'en0', address: '192.168.1.50',
    cidr: '192.168.1.50/24', prefixLength: 24, scope: 'private', kind: 'physical',
    requiresConfirmation: false, riskReason: null
  }, {
    id: 'fixture-bridge', name: 'bridge0', address: '192.168.2.1',
    cidr: '192.168.2.1/24', prefixLength: 24, scope: 'private', kind: 'virtual',
    requiresConfirmation: true, riskReason: '虚拟或桥接接口'
  }],
  scan: async () => ({
    scanId: 'scan-1', status: 'completed',
    interface: { id: 'fixture-en0', name: 'en0', address: '192.168.1.50', cidr: '192.168.1.50/24', prefixLength: 24, scope: 'private', kind: 'physical', requiresConfirmation: false, riskReason: null },
    devices: window.__lanEmptyResult ? [] : [
      { ip: '192.168.1.1', hostname: 'router.local', vendor: 'TP-Link', onlineStatus: 'online', evidence: ['neighbor', 'icmp'], isSelf: false },
      { ip: '192.168.1.20', hostname: null, vendor: 'Raspberry Pi', onlineStatus: 'recently-seen', evidence: ['neighbor'], isSelf: false },
      { ip: '192.168.1.50', hostname: 'this-device', vendor: null, onlineStatus: 'online', evidence: ['self'], isSelf: true }
    ],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    durationMs: 842, scannedHostCount: 253, truncated: false, warnings: [], errors: []
  }),
  cancelScan: () => true,
  copyText: async () => true
};
"""


def assert_layout(page, width, screenshot=None):
    page.set_viewport_size({"width": width, "height": 620})
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("heading", name="局域网设备发现").wait_for()
    page.get_by_role("button", name="开始扫描").click()
    page.get_by_text("router.local").wait_for()
    assert page.get_by_text("Raspberry Pi").is_visible()
    assert page.get_by_text("扫描完成").is_visible()
    assert page.get_by_text("结果为当前时刻的局部快照").is_visible()
    overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, f"horizontal overflow at {width}px"
    if screenshot:
        page.screenshot(path=str(ROOT / "screenshots" / screenshot), full_page=True)
    page.evaluate("window.__lanEmptyResult = true")
    page.get_by_role("button", name="开始扫描").click()
    empty = page.get_by_role("status")
    empty.wait_for()
    assert "未发现当前可见设备" in empty.inner_text()
    retry = page.get_by_role("button", name="重新扫描")
    assert retry.is_visible()
    page.evaluate("window.__lanEmptyResult = false")
    retry.click()
    page.get_by_text("router.local").wait_for()
    page.locator("#network-interface").select_option("fixture-bridge")
    start = page.get_by_role("button", name="开始扫描")
    assert start.is_disabled(), "restricted interface must be disabled before confirmation"
    page.get_by_text("我确认扫描此虚拟或桥接接口").click()
    assert start.is_enabled(), "explicit second confirmation must enable scanning"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
    page = browser.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.add_init_script(BRIDGE)
    assert_layout(page, 960, "main.png")
    assert_layout(page, 720)
    assert_layout(page, 360, "narrow.png")
    assert not errors, f"console errors: {errors}"
    browser.close()

print("E2E passed at 960px, 720px and 360px")
