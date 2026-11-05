// Runs the installed ZTools in a separate profile. Never touches its normal DB.
import assert from "node:assert/strict";
import { checkSystemFonts } from "./system-font-smoke.mjs";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";

assert.equal(
  process.platform,
  "win32",
  "This smoke uses the installed Windows ZTools.",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable =
  process.env.ASKILLS_ZTOOLS_EXE || "D:/Software/ZTools/ZTools.exe";
const hostOnly = process.argv.includes("--host-only");
const archiveMode = process.argv.includes("--archive");
await mkdir(path.join(root, ".askills"), { recursive: true });
const output = await mkdtemp(
  path.join(
    process.argv.includes("--workspace-temp")
      ? path.join(root, ".askills")
      : tmpdir(),
    "ztools-smoke-",
  ),
);
const profile = path.join(output, "host-data");
const data = path.join(output, "askills-data");
const pluginSource = path.resolve(
  root,
  process.env.ASKILLS_ZTOOLS_PLUGIN_DIR || "artifacts/ztools/Askills",
);
const pluginPath = path.join(output, archiveMode ? "plugin.asar" : "plugin");
const report = {
  executable,
  output,
  profile,
  data,
  native: true,
  published: false,
  archiveMode,
  checks: [],
};
if (!hostOnly && !archiveMode) {
  await cp(pluginSource, pluginPath, {
    recursive: true,
  });
}
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
let outputLog = "";
let launchError;
const child = spawn(
  executable,
  [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ZTOOLS_DATA_ROOT: profile,
      ZTOOLS_LEGACY_USER_DATA_PATH: path.join(output, "absent-legacy"),
      ZTOOLS_E2E: "1",
      ASKILLS_ZTOOLS_TEST_DATA_DIR: data,
    },
  },
);
child.stdout.on("data", (value) => {
  outputLog += value;
});
child.stderr.on("data", (value) => {
  outputLog += value;
});
child.on("error", (error) => {
  launchError = error;
});
// Bound native modal/CDP waits as well as the individually bounded helper reads.
// This smoke only changes preferences and short-lived grants in its own profile.
const watchdog = setTimeout(() => {
  report.timedOut = true;
  if (child.exitCode === null) child.kill();
}, 120_000);
watchdog.unref();
let browser;
const errors = [];
const consoleErrors = [];
async function findPage(predicate, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const candidate of browser
      .contexts()
      .flatMap((context) => context.pages())) {
      if (await predicate(candidate).catch(() => false)) return candidate;
    }
    await delay(200);
  }
  throw new Error(`Could not find ${description}`);
}
async function chooseNativeDirectory(invoke, purpose) {
  const pending = invoke("pick_directory", { purpose });
  let pickerError;
  pending.catch((error) => {
    pickerError = error;
  });
  // Only confirm this child process's native chooser. The returned grant is
  // immediately discarded: never inspect or modify its default user directory.
  const script = String.raw`
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AskillsZToolsDialog {
  private delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder s, int size);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  public static IntPtr Find(int pid) {
    IntPtr result=IntPtr.Zero;
    EnumWindows((h,p) => { uint owner; GetWindowThreadProcessId(h,out owner); if(owner != pid) return true;
      var name=new StringBuilder(256); GetClassName(h,name,256);
      if(name.ToString()=="#32770") { result=h; return false; } return true;
    },IntPtr.Zero); return result;
  }
  public static bool Confirm(IntPtr dialog) {
    IntPtr button=IntPtr.Zero;
    EnumChildWindows(dialog,(h,p) => {
      int id=GetDlgCtrlID(h);
      if(id==1) button=h;
      return true;
    },IntPtr.Zero);
    if(button==IntPtr.Zero) return false;
    PostMessage(button,0x00F5,IntPtr.Zero,IntPtr.Zero);
    return true;
  }
}
'@
    $handle = [IntPtr]::Zero
    for ($i=0; $i -lt 100; $i++) {
      $handle = [AskillsZToolsDialog]::Find([int]$env:ASKILLS_SMOKE_HOST_PID)
      if ($handle -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 150
    }
    if ($handle -eq [IntPtr]::Zero) { throw 'No native folder picker owned by the smoke process' }
    $chosen = $false
    for ($i=0; $i -lt 50; $i++) {
      $chosen = [AskillsZToolsDialog]::Confirm($handle)
      if ($chosen) { break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $chosen) { throw 'Native folder picker controls were not found' }
  `;
  try {
    await promisify(execFile)(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: 25_000,
        env: {
          ...process.env,
          ASKILLS_SMOKE_HOST_PID: String(child.pid),
        },
      },
    );
  } catch (error) {
    if (pickerError) throw pickerError;
    if (error.stdout)
      error.message += "\nNative dialog controls: " + error.stdout;
    throw error;
  }
  const selection = await pending;
  assert(selection?.id, "Native picker did not grant a directory selection");
  assert(path.isAbsolute(selection.path));
  return selection;
}
async function verifyReleasedLibrary() {
  const helper = spawn(
    path.join(
      archiveMode ? `${pluginPath}.unpacked` : pluginPath,
      "helper/askills-ztools.exe",
    ),
    ["--data-dir", data],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let received;
  const frame = new Promise((resolve) => {
    received = resolve;
  });
  helper.stdout.on("data", (bytes) => {
    stdout += bytes;
    if (stdout.includes("\n")) received();
  });
  helper.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const exited = once(helper, "exit");
  helper.stdin.write(
    JSON.stringify({ id: 1, command: "get_snapshot", args: {} }) + "\n",
  );
  const ready = await Promise.race([
    frame.then(() => true),
    delay(10_000).then(() => false),
  ]);
  // Closing stdin is cancellation. Wait for the requested read before EOF.
  helper.stdin.end();
  assert(ready, "Independent helper did not reply");
  const exit = await Promise.race([exited, delay(10_000).then(() => null)]);
  assert(exit, "Independent helper did not exit after EOF");
  assert.equal(exit[0], 0, stderr);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(result.result.skills.length, 0);
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, "ZTools exited before debugger startup");
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        report.browser = await response.json();
        break;
      }
    } catch {
      /* Wait for the test process only. */
    }
    await delay(250);
  }
  assert(
    report.browser,
    "ZTools did not expose its isolated debugging endpoint",
  );
  browser = await chromium.connectOverCDP(endpoint);
  const main = await findPage(
    (page) =>
      page.evaluate(() => typeof window.ztools?.openSettings === "function"),
    "ZTools main window",
  );
  await main.evaluate(() => window.ztools.openSettings());
  const settings = await findPage(
    (page) =>
      page.evaluate(
        () => typeof window.ztools?.internal?.importDevPlugin === "function",
      ),
    "ZTools settings plugin",
  );
  report.host = await settings.evaluate(() => ({
    version: window.ztools.getAppVersion?.(),
    userData: window.ztools.getPath?.("userData"),
    developerApi: typeof window.ztools.internal.importDevPlugin,
  }));
  // These native host values must refer to this test's isolated profile.
  assert.equal(path.resolve(report.host.userData), path.resolve(profile));
  report.checks.push(
    "installed ZTools opened with an isolated data profile and native developer APIs",
  );
  await settings.screenshot({ path: path.join(output, "host-settings.png") });
  if (!hostOnly) {
    const manifest = JSON.parse(
      await readFile(path.join(pluginSource, "plugin.json"), "utf8"),
    );
    if (archiveMode) {
      const preview = await settings.evaluate(
        (archivePath) =>
          window.ztools.internal.readPluginInfoFromZpx(archivePath),
        `${pluginSource}.zpx`,
      );
      assert.equal(preview.success, true, JSON.stringify(preview));
      assert.equal(preview.pluginInfo.name, manifest.name);
      assert.equal(preview.pluginInfo.version, manifest.version);
      assert.equal(preview.pluginInfo.author, manifest.author);
      assert.equal(preview.pluginInfo.author, "Candquarzy");
      assert.match(preview.pluginInfo.logo, /^data:image\//);
      let installed = await settings.evaluate(
        (archivePath) =>
          window.ztools.internal.installPluginFromPath(archivePath),
        `${pluginSource}.zpx`,
      );
      if (
        !installed.success &&
        /EPERM.*rename.*asar\.unpacked/.test(installed.error || "")
      ) {
        report.installRetry = installed.error;
        await delay(1500);
        installed = await settings.evaluate(
          (archivePath) =>
            window.ztools.internal.installPluginFromPath(archivePath),
          `${pluginSource}.zpx`,
        );
      }
      assert.equal(installed.success, true, JSON.stringify(installed));
      assert(installed.plugin.path.endsWith(".asar"));
      assert(
        path
          .resolve(installed.plugin.path)
          .startsWith(path.resolve(profile) + path.sep),
      );
      await cp(installed.plugin.path, pluginPath);
      await cp(`${installed.plugin.path}.unpacked`, `${pluginPath}.unpacked`, {
        recursive: true,
      });
      await access(
        path.join(`${pluginPath}.unpacked`, "helper/askills-ztools.exe"),
      );
      // Register a byte-identical copy as development so the preload's explicit
      // test-data option is enabled without altering the production archive.
      report.archive = {
        path: installed.plugin.path,
        name: preview.pluginInfo.name,
        version: preview.pluginInfo.version,
        author: preview.pluginInfo.author,
      };
      report.checks.push(
        "native ZPX preview/install, ASAR repack and declared helper unpack succeeded",
      );
    }
    report.import = await settings.evaluate(
      (configPath) => window.ztools.internal.importDevPlugin(configPath),
      path.join(pluginPath, "plugin.json"),
    );
    assert.equal(report.import.success, true, JSON.stringify(report.import));
    report.install = await settings.evaluate(
      (name) => window.ztools.internal.installDevPlugin(name),
      manifest.name,
    );
    assert.equal(report.install.success, true, JSON.stringify(report.install));
    report.checks.push(
      "plugin registered and installed through the host developer API",
    );
    const launched = await main.evaluate(
      (options) => window.ztools.launch(options),
      {
        type: "plugin",
        path: pluginPath,
        name: manifest.title,
        featureCode: "settings",
      },
    );
    assert.notEqual(launched?.success, false, JSON.stringify(launched));
    const page = await findPage(
      (candidate) =>
        candidate.evaluate(() => window.askillsHost?.kind === "ztools"),
      "Askills plugin",
    );
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.setDefaultTimeout(30_000);
    const invoke = (command, args = {}) =>
      page.evaluate(
        ({ command, args }) => window.askillsHost.invoke(command, args),
        { command, args },
      );
    // The preload exists before ZTools completes assembly and dispatches Enter.
    await page.waitForLoadState("domcontentloaded");
    await expect
      .poll(async () => {
        try {
          return (await invoke("get_app_info")).protocolVersion;
        } catch {
          return null;
        }
      })
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "刷新", exact: true }),
    ).toBeEnabled();
    const snapshot = await invoke("get_snapshot");
    const appInfo = await invoke("get_app_info");
    assert.equal(
      appInfo.version,
      JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
        .version,
    );
    assert.equal(
      path.toNamespacedPath(snapshot.libraryRoot),
      path.toNamespacedPath(path.join(data, "library")),
    );
    assert.equal(snapshot.skills.length, 0);
    assert.equal(snapshot.projects.length, 0);
    report.appInfo = appInfo;
    report.checks.push(
      "real Rust IPC returned the release version and an isolated empty library",
    );
    await expect(page.locator(".sidebar-bottom .version")).toContainText(
      manifest.version,
    );
    report.fonts = await checkSystemFonts(page, invoke);
    report.checks.push(
      "installed fonts enumerate through Rust IPC; Microsoft YaHei renders locally without font assets",
    );
    assert(
      await page
        .locator(".brand img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    );
    await page.screenshot({
      path: path.join(output, "askills-light.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("界面字体", { exact: true }).selectOption("Arial");
    await expect(page.getByLabel("界面字体", { exact: true })).toBeEnabled();
    assert.equal((await invoke("get_snapshot")).appearance.fontFamily, "Arial");
    await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel("界面语言", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(output, "askills-dark-english.png"),
      fullPage: true,
    });
    await page
      .getByLabel("Interface language", { exact: true })
      .selectOption("zh-CN");
    await page.getByLabel("外观模式", { exact: true }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    report.checks.push(
      "Chinese/English UI and light/dark settings saved through real IPC",
    );
    const selection = await chooseNativeDirectory(invoke, "project");
    await invoke("discard_selections", { selectionIds: [selection.id] });
    await assert.rejects(
      invoke("register_project", { selectionId: selection.id }),
    );
    report.checks.push(
      "native folder picker returned a grant; discarding it prevented further use without reading or writing the selected directory",
    );
    report.limitations = [
      "The native Windows picker cannot be safely navigated to a fixture through this environment's foreground/UI Automation API. CRUD is covered by the separate real-helper fixture test; this host smoke only selects and immediately discards the default directory grant.",
    ];
    await assert.rejects(
      invoke("register_directory_selection", {
        path: output,
        purpose: "import",
      }),
    );
    await assert.rejects(
      invoke("plugin:fs|read_text_file", { path: "SKILL.md" }),
    );
    report.checks.push(
      "renderer cannot register arbitrary paths or access ungranted native commands",
    );
    await main.evaluate(() => window.ztools.hidePlugin());
    // A separate helper must acquire the data lock after leaving the plugin.
    await expect
      .poll(async () => {
        try {
          await verifyReleasedLibrary();
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    report.checks.push(
      "leaving the plugin released the library lock for an independent Rust helper",
    );
    await main.evaluate((options) => window.ztools.launch(options), {
      type: "plugin",
      path: pluginPath,
      name: manifest.title,
      featureCode: manifest.features[0].code,
    });
    await expect
      .poll(async () => {
        try {
          return (await invoke("get_snapshot")).skills.length;
        } catch {
          return null;
        }
      })
      .toBe(0);
    assert.equal((await invoke("get_snapshot")).appearance.fontFamily, "Arial");
    report.checks.push(
      "custom font survives theme/language changes and plugin re-entry",
    );
    report.checks.push(
      "exit/re-entry restarts the helper and reacquires the library successfully",
    );
    report.pages = browser
      .contexts()
      .flatMap((context) => context.pages())
      .map((page) => page.url());
  }
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  report.errors = errors;
  report.consoleErrors = consoleErrors;
  if (browser) await browser.close().catch(() => {});
  // Only terminate this script's child; the normal ZTools session is unrelated.
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, "exit"), delay(10_000)]);
  }
  await writeFile(path.join(output, "host-process.log"), outputLog);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
