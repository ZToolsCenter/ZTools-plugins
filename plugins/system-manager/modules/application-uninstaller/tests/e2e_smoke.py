from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "screenshots" / "main.png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL = os.environ.get("E2E_URL", "http://127.0.0.1:5173").rstrip("/")

MOCK = r"""
let executionAttempts = 0;
window.applicationUninstaller = {
  async scanApps() { return { platform: 'darwin', scannedAt: new Date().toISOString(), warnings: ['一个可选应用目录不可访问'], apps: [
    { id:'app_acme', platform:'darwin', name:'Acme Editor', version:'2.4.1', publisher:'Acme', install:{kind:'bundle',path:'/Users/test/Applications/Acme Editor.app',scope:'user'}, uninstall:{mode:'trash',requiresElevation:false,supported:true}, protected:false },
    { id:'app_system', platform:'darwin', name:'System Utility', version:'1.0', publisher:null, install:{kind:'bundle',path:'/System/Applications/System Utility.app',scope:'system'}, uninstall:{mode:'manual',requiresElevation:true,supported:false}, protected:true }
  ]}; },
  async inspectApp() { return { id:'plan_opaque', app:{ id:'app_acme',platform:'darwin',name:'Acme Editor',version:'2.4.1',publisher:'Acme',install:{kind:'bundle',path:'/Users/test/Applications/Acme Editor.app',scope:'user'},uninstall:{mode:'trash',requiresElevation:false,supported:true},protected:false }, createdAt:new Date().toISOString(), expiresAt:new Date(Date.now()+120000).toISOString(), warnings:[], candidates:[
    { id:'item_app',path:'/Users/test/Applications/Acme Editor.app',category:'application',sizeBytes:null,exists:true,ownership:'user',confidence:'exact',reason:'用户应用目录中的应用包',selectedByDefault:true,deletable:true },
    { id:'item_cache',path:'/Users/test/Library/Caches/io.acme.Editor',category:'cache',sizeBytes:null,exists:true,ownership:'user',confidence:'exact',reason:'由应用声明的 Bundle ID 关联',selectedByDefault:false,deletable:true },
    { id:'item_name',path:'/Users/test/Library/Application Support/Acme Editor',category:'support',sizeBytes:null,exists:true,ownership:'user',confidence:'strong',reason:'仅按显示名称推断，可能与同名应用共享',selectedByDefault:false,deletable:true }
  ]}; },
  async executePlan(request) { executionAttempts += 1; if (executionAttempts === 1) throw new Error('测试执行失败'); if (request.confirmation !== 'Acme Editor') throw new Error('bad confirmation'); return { planId:request.planId,completedAt:new Date().toISOString(),results:request.selectedIds.map(candidateId => ({candidateId,status:'trashed'}))}; },
  revealPath() { return true; }
};
"""

def exercise(page, screenshot=False):
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.add_init_script(MOCK)
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    assert page.get_by_text("一个可选应用目录不可访问").is_visible()
    page.get_by_text("Acme Editor", exact=True).first.click()
    page.get_by_text("关联项目").wait_for()
    assert page.get_by_text("声明标识 · 默认不选").is_visible()
    assert page.get_by_text("名称推断 · 默认不选").is_visible()
    confirm = page.get_by_label("输入 Acme Editor 确认", exact=True)
    action = page.get_by_role("button", name="移到废纸篓 1 项")
    checkbox_box = page.get_by_role("checkbox").first.bounding_box()
    assert checkbox_box and checkbox_box["width"] >= 44 and checkbox_box["height"] >= 44
    assert action.is_disabled()
    confirm.fill("Acme Editor")
    assert action.is_enabled()
    if screenshot:
        page.evaluate("window.scrollTo(0, 0)")
        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
    action.click()
    failure = page.get_by_role("alert")
    failure.wait_for()
    assert "测试执行失败" in failure.inner_text()
    assert failure.get_attribute("aria-atomic") == "true"
    assert failure.evaluate("node => document.activeElement === node")
    action.click()
    page.get_by_text("处理完成").wait_for()
    assert page.get_by_text("移入废纸篓 1 项").is_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert not errors, errors

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME)
    desktop = browser.new_page(viewport={"width": 720, "height": 600})
    exercise(desktop, screenshot=True)
    mobile = browser.new_page(viewport={"width": 360, "height": 600})
    exercise(mobile)
    browser.close()

print("E2E passed at 720x600 and 360x600")
