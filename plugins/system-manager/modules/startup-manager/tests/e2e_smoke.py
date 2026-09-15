from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("E2E_URL", "http://127.0.0.1:5173")

BRIDGE = r"""
(() => {
  const user = { id:'user-1', name:'Cloud Sync', scope:'user', kind:'desktop-autostart', source:{label:'用户 XDG Autostart',location:'~/.config/autostart/sync.desktop'}, trigger:'登录时', commandSummary:'~/Applications/sync --background', enabled:true, running:true, status:'running', impact:{level:'low',basis:'heuristic',reasons:['按登录触发后台任务']}, action:{canToggle:true,requiresElevation:false,reason:'可撤销'}, metadata:{} };
  const system = { id:'system-1', name:'System Audio Service With A Very Long Name', scope:'system', kind:'service', source:{label:'系统服务',location:'AudioService'}, trigger:'系统启动', commandSummary:'/usr/libexec/audio-service --daemon', enabled:true, running:true, status:'running', impact:{level:'high',basis:'heuristic',reasons:['系统级常驻后台组件']}, action:{canToggle:false,requiresElevation:true,reason:'系统服务仅支持查看'}, metadata:{} };
  window.startupManager = {
    async scan(){ return {ok:true,value:{snapshotId:'snapshot-1',platform:'linux',generatedAt:new Date().toISOString(),items:[user,system],warnings:[]}} },
    async setEnabled(request){ user.enabled=request.enabled; user.running=request.enabled; user.status=request.enabled?'running':'disabled'; return {ok:true,value:{changed:true,operationId:'operation-1',item:{...user}}} },
    async undo(){ user.enabled=true; user.running=true; user.status='running'; return {ok:true,value:{restored:true,item:{...user}}} }
  };
})();
"""

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
    for width, height in [(720, 480), (360, 480)]:
        page = browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(BRIDGE)
        page.goto(URL, wait_until="networkidle")
        page.get_by_role("heading", name="开机启动管理").wait_for()
        assert page.locator(".item-card").count() == 2
        page.get_by_label("范围").select_option("system")
        assert page.locator(".item-card").count() == 1
        page.get_by_label("范围").select_option("all")
        page.once("dialog", lambda dialog: dialog.accept())
        page.get_by_role("switch", name="停用 Cloud Sync").click()
        page.get_by_text("已更新 Cloud Sync").wait_for()
        assert page.get_by_role("switch", name="启用 Cloud Sync").get_attribute("aria-checked") == "false"
        page.get_by_role("button", name="撤销").click()
        page.get_by_role("switch", name="停用 Cloud Sync").wait_for()
        switch_box = page.get_by_role("switch", name="停用 Cloud Sync").bounding_box()
        assert switch_box and switch_box["width"] >= 44 and switch_box["height"] >= 44
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not overflow, f"horizontal overflow at {width}x{height}"
        assert not errors, errors
        if width == 720:
            page.evaluate("window.scrollTo(0, 0)")
            (ROOT / "screenshots").mkdir(exist_ok=True)
            page.screenshot(path=str(ROOT / "screenshots" / "main.png"), full_page=True)
        page.close()
    browser.close()

print("E2E passed at 720x480 and 360x480")
