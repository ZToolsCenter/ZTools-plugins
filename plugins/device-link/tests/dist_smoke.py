import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
URL = os.environ.get("DEVICE_LINK_TEST_URL", "http://127.0.0.1:4173")

STATE = {
    "settings": {
        "deviceName": "测试电脑",
        "port": 32125,
        "pairingCodeMode": "random",
        "customPairingCodeSet": False,
        "autoAcceptTrustedText": True,
        "autoAcceptTrustedFiles": False,
        "maxIncomingFileBytes": 10 * 1024**3,
        "webdav": {
            "enabled": False,
            "baseUrl": "",
            "username": "",
            "hasPassword": False,
            "hasSyncPassword": False,
            "status": "disabled",
        },
    },
    "server": {
        "running": True,
        "port": 32125,
        "lanIPs": ["192.168.1.2"],
        "selectedIP": "192.168.1.2",
        "accessUrl": "http://192.168.1.2:32125",
        "pairingUrl": "http://192.168.1.2:32125/#pair=test",
        "pairingCode": "123456",
        "pairingExpiresAt": "2099-01-01T00:00:00.000Z",
        "qrDataUrl": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
    "devices": [],
    "messages": [{
        "id": "production-message",
        "conversationId": "shared",
        "senderId": "desktop",
        "senderName": "测试电脑",
        "direction": "outgoing",
        "kind": "text",
        "text": "生产构建消息",
        "attachments": [],
        "createdAt": "2026-08-13T00:00:00.000Z",
        "updatedAt": "2026-08-13T00:00:00.000Z",
        "status": "sent",
    }],
}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 820})
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        f"""
        (() => {{
          const state = {json.dumps(STATE)};
          const clone = value => JSON.parse(JSON.stringify(value));
          window.ztools = {{ onPluginEnter() {{}} }};
          window.deviceLink = {{
            async getState() {{ return clone(state); }},
            async clearHistory() {{ const deleted = state.messages.length; state.messages = []; return {{ deleted }}; }},
            subscribe() {{ return () => {{}}; }}
          }};
        }})()
        """
    )
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("heading", name="全部设备").wait_for()
    assert page.locator("#app > .app-shell").count() == 1
    page.evaluate(
        """
        () => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(['drop'], 'production-drop.txt', { type: 'text/plain' }));
          window.__deviceLinkDropTransfer = transfer;
          document.querySelector('.conversation').dispatchEvent(new DragEvent('dragenter', {
            bubbles: true, cancelable: true, dataTransfer: transfer
          }));
        }
        """
    )
    page.get_by_text("释放以发送 1 个项目", exact=True).wait_for()
    page.evaluate(
        """
        () => document.querySelector('.conversation').dispatchEvent(new DragEvent('dragleave', {
          bubbles: true, cancelable: true, dataTransfer: window.__deviceLinkDropTransfer
        }))
        """
    )
    assert page.get_by_text("释放以发送 1 个项目", exact=True).count() == 0
    page.get_by_role("button", name="搜索消息").click()
    search_popover = page.locator("#conversation-search")
    search_popover.wait_for()
    assert int(search_popover.evaluate("element => getComputedStyle(element).zIndex")) >= 200
    page.get_by_role("searchbox", name="搜索会话消息").fill("no-result")
    page.get_by_role("heading", name="没有找到匹配消息").wait_for()
    page.keyboard.press("Escape")
    page.get_by_role("button", name="更多操作").click()
    more_menu = page.get_by_label("会话操作")
    more_menu.wait_for()
    assert int(more_menu.evaluate("element => getComputedStyle(element).zIndex")) >= 200
    page.get_by_role("button", name="清理全部历史 删除所有会话消息与本地附件").click()
    page.get_by_role("heading", name="清理历史消息？").wait_for()
    page.get_by_role("button", name="清理历史", exact=True).click()
    page.get_by_role("heading", name="把内容放进这段私人会话").wait_for()
    assert not errors, errors
    page.screenshot(path=str(ARTIFACTS / "dist-main.png"), full_page=True)
    browser.close()
