from pathlib import Path
import json
import os
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "tests" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TMPDIR", str(ARTIFACTS / "tmp"))
os.environ.setdefault("TMP", str(ARTIFACTS / "tmp"))
os.environ.setdefault("TEMP", str(ARTIFACTS / "tmp"))
Path(os.environ["TMPDIR"]).mkdir(parents=True, exist_ok=True)

from playwright.sync_api import sync_playwright


def find_chromium(playwright):
    candidates = [Path(playwright.chromium.executable_path)]
    if sys.platform == "darwin":
        candidates.extend([
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ])
    elif sys.platform == "win32":
        for base_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(base_name)
            if base:
                candidates.extend([
                    Path(base) / "Google/Chrome/Application/chrome.exe",
                    Path(base) / "Microsoft/Edge/Application/msedge.exe",
                ])
    else:
        for command in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
            executable = shutil.which(command)
            if executable:
                candidates.append(Path(executable))
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError("未找到 Chromium、Chrome 或 Edge；请安装浏览器后重试")


def verify_desktop(browser):
    page = browser.new_page(viewport={"width": 1365, "height": 900}, accept_downloads=True)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")

    assert page.title() == "收货地址智能解析"
    assert page.locator("#export-button").is_disabled()

    source = (
        "张三 13800138000 广东省深圳市南山区粤海街道科技园科苑路 15 号\n"
        "李四 13900139000 广东省深圳市科技园 2 号"
    )
    page.locator("#source-input").fill(source)
    page.get_by_role("button", name="开始解析").click()
    assert page.locator("#total-count").inner_text() == "2"
    assert page.locator("#complete-count").inner_text() == "1"
    assert page.locator("#missing-count").inner_text() == "1"
    assert page.locator("#result-body tr").count() == 2

    page.get_by_role("tab", name="待补充").click()
    assert page.locator("#result-body tr[data-status='missing']").count() == 1
    district = page.locator("#result-body input[data-field='district']")
    district.fill("南山区")
    district.press("Tab")
    assert page.locator("#missing-count").inner_text() == "0"

    page.get_by_role("tab", name="全部").click()
    assert page.locator("#result-body tr[data-status='complete']").count() == 2
    assert page.locator("#export-button").is_enabled()

    with page.expect_download() as download_info:
        page.get_by_role("button", name="导出全部 CSV").click()
    download = download_info.value
    csv_path = ARTIFACTS / "address-parser-ui-export.csv"
    download.save_as(csv_path)
    csv_bytes = csv_path.read_bytes()
    assert csv_bytes.startswith(b"\xef\xbb\xbf")
    assert "张三" in csv_bytes.decode("utf-8-sig")
    assert "南山区" in csv_bytes.decode("utf-8-sig")

    page.screenshot(path=ARTIFACTS / "desktop.png", full_page=True)
    assert not console_errors, console_errors
    page.close()
    return {"records": 2, "corrected": 1, "csv_bytes": len(csv_bytes)}


def verify_mobile(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
    page.get_by_role("button", name="填入示例").click()
    page.get_by_role("button", name="开始解析").click()
    assert page.locator("#total-count").inner_text() == "5"
    body_overflows = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert not body_overflows
    page.screenshot(path=ARTIFACTS / "mobile.png", full_page=True)
    page.close()
    return {"viewport": "390x844", "records": 5, "body_overflow": body_overflows}


def verify_pagination_and_limit(browser):
    page = browser.new_page(viewport={"width": 1365, "height": 900})
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
    line = "张三 13800138000 广东省深圳市南山区科技园1号"
    page.locator("#source-input").fill("\n".join([line] * 101))
    page.get_by_role("button", name="开始解析").click()
    assert page.locator("#total-count").inner_text() == "101"
    assert page.locator("#result-body tr").count() == 100
    assert page.locator("#page-indicator").inner_text() == "第 1 / 2 页"
    page.get_by_role("button", name="下一页").click()
    assert page.locator("#result-body tr").count() == 1
    assert page.locator("#page-indicator").inner_text() == "第 2 / 2 页"

    page.locator("#source-input").fill("\n".join([line] * 1001))
    page.get_by_role("button", name="开始解析").click()
    assert page.locator("#total-count").inner_text() == "101"
    assert "单次最多解析 1000 条" in page.locator("#toast").inner_text()
    page.close()
    return {"page_size": 100, "pages": 2, "limit": 1000}


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True, executable_path=find_chromium(playwright))
    result = {
        "desktop": verify_desktop(chromium),
        "mobile": verify_mobile(chromium),
        "pagination": verify_pagination_and_limit(chromium),
    }
    chromium.close()
    print(json.dumps(result, ensure_ascii=False))
