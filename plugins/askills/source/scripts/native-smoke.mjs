// Windows WebView2 smoke against the built debug executable. No IPC mocks.
import assert from "node:assert/strict";
import { checkSystemFonts } from "./system-font-smoke.mjs";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";

assert.equal(process.platform, "win32", "This smoke uses Windows WebView2.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "test-results", "native");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "askills-native-"));
const data = path.join(temporary, "data");
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const executable = process.env.ASKILLS_SMOKE_EXE
  ? path.resolve(root, process.env.ASKILLS_SMOKE_EXE)
  : path.join(root, "src-tauri/target/debug/askills.exe");
let processLog = "";
let launchError;
function launch() {
  launchError = undefined;
  const process = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...globalThis.process.env,
      ASKILLS_TEST_DATA_DIR: data,
      WEBVIEW2_USER_DATA_FOLDER: path.join(temporary, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
  });
  process.stdout.on("data", (bytes) => (processLog += bytes));
  process.stderr.on("data", (bytes) => (processLog += bytes));
  process.on("error", (error) => (launchError = error));
  return process;
}
let child = launch();
let browser;
let page;
const errors = [];
const useGit = process.argv.includes("--git");
const report = {
  native: true,
  github: false,
  transport: useGit ? "git" : "api",
  checks: [],
};
console.log("Starting isolated native window smoke…");
async function connectWindow() {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null)
      throw new Error(`App exited: ${child.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/json/list`);
      if (response.ok && (await response.json()).length) {
        ready = true;
        break;
      }
    } catch {
      /* WebView2 starts asynchronously. */
    }
    await delay(500);
  }
  assert(ready, "Native WebView2 debugging endpoint did not start.");
  browser = await chromium.connectOverCDP(endpoint);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
}
const configuration = JSON.parse(
  await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
).app.windows[0];
const packageManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
async function expectStartupSize() {
  await expect
    .poll(() => page.evaluate(() => window.innerWidth))
    .toBe(configuration.width);
  await expect
    .poll(() => page.evaluate(() => window.innerHeight))
    .toBe(configuration.height);
}
async function nativeWindowAction(action) {
  // Only manipulate this test's child window, never other Askills processes.
  const actions = {
    title: "$nativeProcess.MainWindowTitle",
    resize:
      "[AskillsWindowSmoke]::SetWindowPos($handle,[IntPtr]::Zero,0,0,900,600,6) | Out-Null",
    maximize: "[AskillsWindowSmoke]::ShowWindowAsync($handle,3) | Out-Null",
    close:
      "[AskillsWindowSmoke]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null",
    icons: String.raw`
      Add-Type -AssemblyName System.Drawing
      function Measure-BrandIcon([System.Drawing.Icon]$icon, [string]$name) {
        $actual = $icon.ToBitmap()
        # Use the Windows decoder: .NET Framework's Icon(file).ToBitmap()
        # misreads PNG-compressed ICO frames under Windows PowerShell 5.
        $expectedHandle = [AskillsWindowSmoke]::LoadImage([IntPtr]::Zero,$env:ASKILLS_NATIVE_EXPECTED_ICON,1,$actual.Width,$actual.Height,0x10)
        if ($expectedHandle -eq [IntPtr]::Zero) { $actual.Dispose(); throw 'Cannot decode the expected application icon' }
        $expectedIcon = [System.Drawing.Icon]::FromHandle($expectedHandle)
        $expected = $expectedIcon.ToBitmap()
        try {
          $actual.Save((Join-Path $env:ASKILLS_NATIVE_ICON_OUTPUT ($name + '.png')),[System.Drawing.Imaging.ImageFormat]::Png)
          $expected.Save((Join-Path $env:ASKILLS_NATIVE_ICON_OUTPUT ($name + '-expected.png')),[System.Drawing.Imaging.ImageFormat]::Png)
          if ($actual.Width -ne $expected.Width -or $actual.Height -ne $expected.Height) {
            throw ('{0} icon size differs: actual {1}x{2}, expected {3}x{4}' -f $name,$actual.Width,$actual.Height,$expected.Width,$expected.Height)
          }
          $different = 0
          $compared = 0
          for ($y = 0; $y -lt $actual.Height; $y++) {
            for ($x = 0; $x -lt $actual.Width; $x++) {
              $wanted = $expected.GetPixel($x,$y)
              $pixel = $actual.GetPixel($x,$y)
              # Ignore partially transparent boundary pixels, whose RGB can be
              # rounded during Windows alpha premultiplication.
              if ($wanted.A -eq 255) {
                $compared++
                if ($pixel.ToArgb() -ne $wanted.ToArgb()) { $different++ }
              } elseif ($wanted.A -eq 0) {
                $compared++
                if ($pixel.A -ne 0) { $different++ }
              }
            }
          }
          if ($compared -lt ($actual.Width * $actual.Height / 2)) {
            throw ('{0}: only {1} comparable pixels in {2}x{3} icon' -f $name,$compared,$actual.Width,$actual.Height)
          }
          if ($different -ne 0) { throw ('{0} differs from the generated application icon in {1} pixels' -f $name,$different) }
          [PSCustomObject]@{ name=$name; width=$actual.Width; height=$actual.Height; comparedPixels=$compared; differentPixels=$different }
        } finally {
          $actual.Dispose(); $expected.Dispose(); $expectedIcon.Dispose()
          [AskillsWindowSmoke]::DestroyIcon($expectedHandle) | Out-Null
        }
      }
      $iconChecks = @()
      $fileIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($nativeProcess.Path)
      try { $iconChecks += Measure-BrandIcon $fileIcon 'executable-icon' } finally { $fileIcon.Dispose() }
      foreach ($kind in @(0,1)) {
        $iconHandle = [AskillsWindowSmoke]::GetWindowIcon($handle,$kind)
        if ($iconHandle -eq [IntPtr]::Zero) { throw 'The test window has no icon' }
        $borrowedIcon = [System.Drawing.Icon]::FromHandle($iconHandle)
        $ownedIcon = $borrowedIcon.Clone()
        try { $iconChecks += Measure-BrandIcon $ownedIcon ('window-icon-' + $kind) }
        finally { $ownedIcon.Dispose(); $borrowedIcon.Dispose() }
      }
      ConvertTo-Json -InputObject $iconChecks -Compress
    `,
  };
  assert(Object.hasOwn(actions, action));
  assert(Number.isSafeInteger(child.pid));
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AskillsWindowSmoke {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] private static extern IntPtr GetClassLongPtr(IntPtr h, int index);
  [DllImport("user32.dll", EntryPoint="GetClassLongW")] private static extern uint GetClassLong(IntPtr h, int index);
  public static IntPtr GetWindowIcon(IntPtr h, int kind) {
    var icon = SendMessage(h,0x007F,new IntPtr(kind),IntPtr.Zero);
    if (icon != IntPtr.Zero) return icon;
    var index = kind == 1 ? -14 : -34;
    return IntPtr.Size == 8 ? GetClassLongPtr(h,index) : new IntPtr(GetClassLong(h,index));
  }
}
'@
    $nativeProcess = Get-Process -Id ${child.pid} -ErrorAction Stop
    $handle = $nativeProcess.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { throw 'Test window handle missing' }
    ${actions[action]}
  `,
    ],
    {
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        ASKILLS_NATIVE_EXPECTED_ICON: path.join(
          root,
          "src-tauri/icons/icon.ico",
        ),
        ASKILLS_NATIVE_ICON_OUTPUT: output,
      },
    },
  );
  return stdout.trim();
}
try {
  await connectWindow();
  await expectStartupSize();
  assert.equal(await nativeWindowAction("title"), "Askills · skills 管理");
  const nativeIcons = JSON.parse(await nativeWindowAction("icons"));
  assert.equal(nativeIcons.length, 3);
  assert(nativeIcons.every((icon) => icon.differentPixels === 0));
  report.icons = nativeIcons;
  report.checks.push(
    "executable and live window/taskbar icons match generated branding",
  );
  await expect(
    page.getByRole("button", { name: "导入本地 skill" }),
  ).toBeEnabled();
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  report.fonts = await checkSystemFonts(page, invoke);
  report.checks.push(
    "installed fonts enumerate through native IPC; Microsoft YaHei renders locally without font assets",
  );
  const snapshot = await invoke("get_snapshot");
  const appInfo = await invoke("get_app_info");
  assert.equal(appInfo.version, packageManifest.version);
  await expect(page.locator(".sidebar-bottom .version")).toHaveText(
    `当前版本: V${packageManifest.version}`,
  );
  await expect(page.locator(".sidebar-bottom a")).toHaveAttribute(
    "href",
    "https://github.com/Candquarzy/Askills",
  );
  report.checks.push(
    "native application and sidebar release versions match package metadata",
  );
  assert.equal(snapshot.skills.length, 0);
  assert.equal(snapshot.projects.length, 0);
  assert.deepEqual(snapshot.repositoryHistory, []);
  assert.equal(
    path.toNamespacedPath(snapshot.libraryRoot),
    path.toNamespacedPath(path.join(data, "library")),
  );
  report.checks.push("native startup, real IPC, isolated empty SQLite/library");
  const denied = await page.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke("register_project", {
        selectionId: "untrusted-path",
      });
      return null;
    } catch (error) {
      return error;
    }
  });
  assert.equal(denied?.code, "SelectionExpired");
  await assert.rejects(
    invoke("plugin:fs|read_text_file", { path: "SKILL.md" }),
  );
  await assert.rejects(
    invoke("plugin:opener|open_url", {
      url: "https://example.invalid",
      with: null,
    }),
  );
  report.checks.push(
    "expired directory grant and ungranted fs plugin rejected",
  );
  for (const command of ["preview_library_migration", "set_library_root"]) {
    const rejected = await page.evaluate(async (command) => {
      try {
        await window.__TAURI_INTERNALS__.invoke(command, {
          selectionId: "untrusted-migration-target",
        });
        return null;
      } catch (error) {
        return error;
      }
    }, command);
    assert.equal(rejected?.code, "SelectionExpired");
  }
  await invoke("discard_selections", { selectionIds: [] });
  report.checks.push(
    "library migration IPC registered; ungranted target rejected",
  );
  await assert.rejects(
    invoke("translate_preview", { importId: "removed-feature" }),
  );
  report.checks.push("removed translation IPC is unavailable");
  for (const [command, args] of [
    ["remove_library_skills", { skillIds: [] }],
    ["remove_projects", { projectIds: [] }],
    [
      "set_project_display_name",
      { projectId: "../invalid", displayName: "name" },
    ],
  ]) {
    const rejected = await page.evaluate(
      async ({ command, args }) => {
        try {
          await window.__TAURI_INTERNALS__.invoke(command, args);
          return null;
        } catch (error) {
          return error;
        }
      },
      { command, args },
    );
    assert.equal(
      rejected?.code,
      command === "set_project_display_name"
        ? "InvalidIdentifier"
        : "InvalidSelection",
    );
  }
  assert(
    await page
      .locator("main")
      .evaluate(
        (node) =>
          !node.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
      ),
  );
  report.checks.push(
    "management IPC reaches Rust validation; empty batches and invalid IDs rejected; default WebView context menu prevented",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("自定义颜色", { exact: true }).fill("#b060d0");
  await page.getByRole("button", { name: "应用自定义颜色" }).click();
  await expect(page.getByLabel("自定义颜色", { exact: true })).toBeEnabled();
  await page.getByLabel("界面字体", { exact: true }).selectOption("Arial");
  await expect(page.getByLabel("界面字体", { exact: true })).toBeEnabled();
  const savedAppearance = {
    mode: "dark",
    accentColor: "#b060d0",
    fontFamily: "Arial",
  };
  assert.deepEqual((await invoke("get_snapshot")).appearance, savedAppearance);
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue(
    "dark",
  );
  await expect(page.getByLabel("自定义颜色", { exact: true })).toHaveValue(
    "#b060d0",
  );
  assert.equal(
    await page
      .locator("html")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--accent").trim(),
      ),
    "#b060d0",
  );
  await expect(page.getByLabel("界面字体", { exact: true })).toHaveValue(
    "Arial",
  );
  report.checks.push(
    "font and appearance saved through native IPC/SQLite; dark mode and custom accent survive reload",
  );
  await page.screenshot({
    path: path.join(output, "appearance-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue(
    "system",
  );
  await expect(page.getByLabel("自定义颜色", { exact: true })).toHaveValue(
    "#005fb8",
  );
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  assert.equal((await invoke("get_snapshot")).locale, "en");
  assert.equal(await nativeWindowAction("title"), "Askills · Skill Manager");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByLabel("Interface language", { exact: true }),
  ).toHaveValue("en");
  await page.screenshot({
    path: path.join(output, "settings-english.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Interface language", { exact: true })
    .selectOption("zh-CN");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  report.checks.push(
    "English interface saved through native SQLite/IPC, restored after reload, native window title updated, switching back to Chinese works",
  );
  if (process.argv.includes("--github") || useGit) {
    console.log(
      "Testing public GitHub preview and import through the native UI…",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "来源", exact: true })
      .click();
    if (useGit) {
      await page.getByRole("button", { name: "本地 Git", exact: true }).click();
      await page.getByRole("button", { name: "检查 Git 安装" }).click();
      await expect(page.getByText(/^git version /)).toBeVisible();
    }
    await page
      .getByLabel("仓库地址")
      .fill("https://github.com/Candquarzy/Askills");
    await page.getByLabel("分支、标签或 commit（可选）").fill("main");
    await page.getByRole("button", { name: "查找 skills" }).click();
    const candidate = page
      .locator(".candidate-row")
      .filter({ hasText: ".agents/skills/tauri-setup" });
    await expect(candidate).toBeVisible({ timeout: 150_000 });
    if (process.argv.includes("--download")) {
      await candidate
        .getByRole("button", { name: "下载", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText("正在下载");
      await expect(
        page.getByRole("progressbar", { name: "操作进度" }),
      ).toBeVisible();
      await expect(
        candidate.getByRole("button", { name: "已下载", exact: true }),
      ).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      report.checks.push(
        "direct download saves to library without preview; fixed toast and progress are visible",
      );
    } else {
      await candidate
        .getByRole("button", { name: "预览", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "预览 skill" });
      await expect(dialog).toBeVisible({ timeout: 90_000 });
      assert.equal((await invoke("get_snapshot")).skills.length, 0);
      await dialog
        .getByRole("button", { name: "下载到 skills 库", exact: true })
        .click();
      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    }
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^skills 库/ })
      .click();
    await page.getByRole("button", { name: /^tauri-setup Create/ }).click();
    await expect(
      page.getByRole("heading", { name: "Tauri setup", exact: true }),
    ).toBeVisible();
    const imported = await invoke("get_snapshot");
    const expectedHistory = ["https://github.com/candquarzy/askills"];
    assert.deepEqual(imported.repositoryHistory, expectedHistory);
    assert.equal(imported.skills.length, 1);
    assert.equal(imported.projects.length, 0);
    assert.match(imported.skills[0].source.commit, /^[0-9a-f]{40}$/);
    report.commit = imported.skills[0].source.commit;
    report.github = true;
    report.checks.push(
      `public GitHub ${report.transport} lookup/download, confirm-only import, native Markdown reading`,
    );
    await page.getByRole("button", { name: "编辑显示名称" }).click();
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill("我的 Tauri 工具");
    await page.getByRole("button", { name: "保存名称" }).click();
    await expect(
      page.getByRole("heading", { name: "我的 Tauri 工具", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^我的 Tauri 工具/ }).click();
    await expect(
      page.getByRole("button", { name: "编辑显示名称" }),
    ).toBeEnabled();
    const reloaded = await invoke("get_snapshot");
    assert.deepEqual(reloaded.repositoryHistory, expectedHistory);
    const renamed = reloaded.skills[0];
    assert.equal(renamed.displayName, "我的 Tauri 工具");
    assert.equal(renamed.name, imported.skills[0].name);
    assert.equal(renamed.latestRevisionId, imported.skills[0].latestRevisionId);
    report.checks.push(
      "display name persisted through real SQLite IPC and frontend reload; original name and revision preserved",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "来源", exact: true })
      .click();
    await page.getByLabel("分支、标签或 commit（可选）").fill("old-branch");
    await page
      .getByRole("region", { name: "历史记录（最近10条）" })
      .getByRole("button", {
        name: expectedHistory[0].replace("https://github.com/", ""),
        exact: true,
      })
      .click();
    await expect(page.getByLabel("仓库地址")).toHaveValue(expectedHistory[0]);
    await expect(page.getByLabel("分支、标签或 commit（可选）")).toHaveValue(
      "",
    );
    await expect(page.locator(".candidate-row")).toHaveCount(0);
    report.checks.push(
      "repository history persisted through SQLite and reload; selecting history fills address without starting a fetch",
    );
  }
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(output, "window.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByLabel("界面语言", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  for (const action of ["resize", "maximize"]) {
    await nativeWindowAction(action);
    await expect
      .poll(() => page.evaluate(() => window.innerWidth))
      .not.toBe(configuration.width);
    const exited = once(child, "exit");
    await nativeWindowAction("close");
    await Promise.race([
      exited,
      delay(15000, undefined, { ref: false }).then(() => {
        throw new Error("Test window did not close");
      }),
    ]);
    await browser.close().catch(() => {});
    child = launch();
    await connectWindow();
    await expectStartupSize();
    await expect(
      page.getByRole("button", { name: "Import local skill", exact: true }),
    ).toBeEnabled();
    assert.equal((await invoke("get_snapshot")).locale, "en");
    assert.equal(await nativeWindowAction("title"), "Askills · Skill Manager");
  }
  report.checks.push(
    "startup size is always 1080×720 logical pixels after closing a resized or maximized native window",
  );
  report.checks.push(
    "English language and native title persist across full process restarts",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(
      path.join(output, "failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify({ ...report, errors, processLog }, null, 2),
  );
  await browser?.close().catch(() => {});
  if (child.exitCode === null && !launchError) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  // Verify the exact unique temporary root before recursive cleanup; never use
  // arbitrary user input or a project/library path as the deletion target.
  const target = await realpath(temporary);
  const tempRoot = await realpath(tmpdir());
  assert.equal(path.dirname(target).toLowerCase(), tempRoot.toLowerCase());
  assert(path.basename(target).startsWith("askills-native-"));
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 500,
  });
}
