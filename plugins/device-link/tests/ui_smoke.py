from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" and "favicon.ico" not in message.text else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.get_by_role("heading", name="Harris 的 iPhone").wait_for()
    assert page.get_by_text("Harris 的 iPhone", exact=True).count() >= 1
    assert page.get_by_text("刚拍的白板", exact=True).count() == 1
    assert page.get_by_role("button", name="打开附件 IMG_2048.HEIC").is_visible()
    assert page.get_by_role("button", name="下载附件 IMG_2048.HEIC").is_visible()
    download_button = page.locator(".attachment__download").first
    page.evaluate("""
      () => {
        window.__resolveAttachmentSave = undefined
        window.__attachmentSaveCalls = 0
        window.deviceLink.saveAttachment = () => new Promise((resolve) => {
          window.__attachmentSaveCalls += 1
          window.__resolveAttachmentSave = resolve
        })
      }
    """)
    download_button.focus()
    assert download_button.evaluate("element => element === document.activeElement")
    download_button.evaluate("element => { element.click(); element.click() }")
    assert page.evaluate("window.__attachmentSaveCalls") == 1
    assert download_button.is_disabled()
    assert download_button.get_attribute("aria-busy") == "true"
    assert download_button.get_attribute("aria-label") == "正在保存附件 IMG_2048.HEIC"
    assert "保存中" in download_button.inner_text()
    page.evaluate("window.__resolveAttachmentSave({ status: 'saved', name: 'IMG_2048.HEIC' })")
    page.get_by_text("已保存 IMG_2048.HEIC", exact=True).wait_for()
    assert download_button.is_enabled()
    assert page.get_by_text("https://ztools.app/device-link", exact=True).count() == 0
    page.locator(".device-card__select", has_text="Pixel 9 Pro").click()
    page.get_by_role("heading", name="Pixel 9 Pro").wait_for()
    page.get_by_role("heading", name="把内容放进这段私人会话").wait_for()
    assert page.get_by_text("刚拍的白板", exact=True).count() == 0
    page.get_by_role("button", name="设置与同步", exact=True).click()
    page.get_by_role("button", name="立即同步").click()
    page.get_by_text("同步完成：上传 2，下载 0", exact=True).wait_for()
    assert page.get_by_role("heading", name="Pixel 9 Pro").count() == 1
    page.get_by_role("button", name="关闭").click()
    page.locator(".device-card__select", has_text="全部设备").click()
    page.get_by_role("heading", name="全部设备").wait_for()
    assert page.get_by_text("https://ztools.app/device-link", exact=True).count() == 1
    assert page.get_by_text("刚拍的白板", exact=True).count() == 0
    page.locator(".device-card__select", has_text="Harris 的 iPhone").click()
    page.get_by_role("heading", name="Harris 的 iPhone").wait_for()
    page.screenshot(path=str(ARTIFACTS / "desktop-main.png"), full_page=True)

    page.evaluate("""
      () => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['drag-content'], 'drag-demo.zip', { type: 'application/zip' }))
        window.__deviceLinkDropTransfer = transfer
        document.querySelector('.conversation').dispatchEvent(new DragEvent('dragenter', {
          bubbles: true, cancelable: true, dataTransfer: transfer
        }))
      }
    """)
    page.get_by_text("释放以发送 1 个项目", exact=True).wait_for()
    page.wait_for_timeout(200)
    page.screenshot(path=str(ARTIFACTS / "desktop-drop.png"), full_page=True)
    page.evaluate("""
      () => document.querySelector('.conversation').dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: window.__deviceLinkDropTransfer
      }))
    """)
    page.get_by_text("drag-demo.zip", exact=True).wait_for()

    page.get_by_role("button", name="搜索消息").click()
    search = page.get_by_role("searchbox", name="搜索会话消息")
    search.wait_for()
    assert search.evaluate("element => element === document.activeElement")
    search_field = page.locator(".conversation-search__field")
    focused_style = search_field.evaluate("element => ({ borderColor: getComputedStyle(element).borderColor, boxShadow: getComputedStyle(element).boxShadow })")
    search.evaluate("element => element.blur()")
    blurred_style = search_field.evaluate("element => ({ borderColor: getComputedStyle(element).borderColor, boxShadow: getComputedStyle(element).boxShadow })")
    assert focused_style == blurred_style
    search.focus()
    search_trigger_box = page.get_by_role("button", name="搜索消息").bounding_box()
    search_popover = page.locator("#conversation-search")
    search_popover_box = search_popover.bounding_box()
    assert search_trigger_box and search_popover_box
    assert search_popover_box["y"] >= search_trigger_box["y"] + search_trigger_box["height"]
    assert int(search_popover.evaluate("element => getComputedStyle(element).zIndex")) >= 200
    search.fill("白板")
    assert page.get_by_text("刚拍的白板", exact=True).count() == 1
    page.screenshot(path=str(ARTIFACTS / "desktop-search.png"), full_page=True)
    search.fill("不存在的内容")
    page.get_by_role("heading", name="没有找到匹配消息").wait_for()
    page.get_by_role("button", name="清空搜索").click()
    page.keyboard.press("Escape")
    assert search.count() == 0

    page.get_by_role("button", name="更多操作").click()
    more_menu = page.get_by_label("会话操作")
    more_menu.wait_for()
    more_trigger_box = page.get_by_role("button", name="更多操作").bounding_box()
    more_menu_box = more_menu.bounding_box()
    assert more_trigger_box and more_menu_box
    assert more_menu_box["y"] >= more_trigger_box["y"] + more_trigger_box["height"]
    assert int(more_menu.evaluate("element => getComputedStyle(element).zIndex")) >= 200
    page.wait_for_timeout(200)
    page.screenshot(path=str(ARTIFACTS / "desktop-more.png"), full_page=True)
    page.keyboard.press("Escape")
    assert page.get_by_label("会话操作").count() == 0
    assert page.get_by_role("button", name="更多操作").evaluate("element => element === document.activeElement")

    page.get_by_role("button", name="更多操作").click()
    page.get_by_role("button", name="设置与同步 端口、权限与 WebDAV").click()
    page.get_by_role("heading", name="设置与同步").wait_for()
    page.get_by_role("button", name="关闭").click()

    page.get_by_role("button", name="更多操作").click()
    page.get_by_role("button", name="停止接收服务 暂停局域网连接").click()
    page.get_by_text("接收服务已停止", exact=True).wait_for()
    page.get_by_role("button", name="更多操作").click()
    page.get_by_role("button", name="启动接收服务 恢复局域网连接").click()
    page.get_by_text("192.168.1.23:32125 · 仅此设备可见", exact=True).wait_for()

    page.get_by_role("button", name="连接新设备").click()
    page.get_by_role("heading", name="连接一台新设备").wait_for()
    page.wait_for_timeout(250)
    assert page.get_by_text("834921", exact=False).count() >= 1
    page.screenshot(path=str(ARTIFACTS / "desktop-pairing.png"), full_page=True)
    page.set_viewport_size({"width": 800, "height": 542})
    compact_dialog = page.locator(".pairing-dialog")
    compact_box = compact_dialog.bounding_box()
    assert compact_box
    assert compact_box["y"] >= 0
    assert compact_box["y"] + compact_box["height"] <= 542
    assert page.get_by_role("button", name="刷新配对信息").is_visible()
    assert page.get_by_role("button", name="完成").is_visible()
    page.screenshot(path=str(ARTIFACTS / "desktop-pairing-compact.png"), full_page=True)
    page.set_viewport_size({"width": 1280, "height": 820})
    page.get_by_role("button", name="关闭").click()

    page.get_by_role("button", name="设置与同步").click()
    page.get_by_role("heading", name="设置与同步").wait_for()
    page.wait_for_timeout(250)
    assert page.get_by_text("加密 WebDAV", exact=True).count() == 1
    page.screenshot(path=str(ARTIFACTS / "desktop-settings.png"), full_page=True)
    page.get_by_role("button", name="关闭").click()

    page.get_by_role("button", name="更多操作").click()
    page.get_by_role("button", name="清理全部历史 删除所有会话消息与本地附件").click()
    page.get_by_role("heading", name="清理历史消息？").wait_for()
    assert page.get_by_role("button", name="取消").evaluate("element => element === document.activeElement")
    assert page.get_by_text("4 条消息", exact=False).count() == 1
    page.wait_for_timeout(250)
    page.screenshot(path=str(ARTIFACTS / "desktop-clear-history.png"), full_page=True)
    page.get_by_role("button", name="取消").click()
    assert page.get_by_text("drag-demo.zip", exact=True).count() == 1

    page.get_by_role("button", name="更多操作").click()
    page.get_by_role("button", name="清理全部历史 删除所有会话消息与本地附件").click()
    page.get_by_role("button", name="清理历史", exact=True).click()
    page.get_by_role("heading", name="把内容放进这段私人会话").wait_for()
    page.get_by_text("已清理 4 条历史消息", exact=True).wait_for()
    assert page.get_by_text("Harris 的 iPhone", exact=True).count() >= 1
    page.get_by_role("button", name="更多操作").click()
    assert page.get_by_role("button", name="清理全部历史 删除所有会话消息与本地附件").is_disabled()
    assert not errors, errors
    browser.close()
