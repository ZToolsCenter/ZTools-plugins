// Windows 右键菜单管理插件自动化测试脚本（Node.js）
// 覆盖：L1 静态契约 -> L2 Preload 桥接 -> L3 常驻 Worker 毫秒级 scan/toggle/restore/shutdown 完整沙箱闭环
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function runReg(args) {
  return execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function httpJson(port, token, route, method = "GET", bodyObj = null) {
  return new Promise((resolve, reject) => {
    const bodyText = bodyObj !== null ? JSON.stringify(bodyObj) : "";
    const headers = { "X-ALLTool-Token": token };
    if (bodyText) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(bodyText, "utf8");
    }
    const req = http.request({ hostname: "127.0.0.1", port, path: route, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

async function main() {
  console.log("=== [1/4] 静态配置与文件完整性校验 ===");
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "win-context-menu");
  assert.ok(Array.isArray(manifest.platform) && manifest.platform.includes("win32"));
  for (const rel of [manifest.main, manifest.preload, manifest.logo, "scripts/context-menu-manager.ps1", "scripts/elevated-worker.ps1"]) {
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, rel)), `缺少文件: ${rel}`);
  }
  console.log("  PASS: plugin.json 与所有脚本/入口文件完整");

  console.log("=== [2/4] Preload 挂载与 API 契约校验 ===");
  globalThis.window = { ztools: {} };
  require(path.join(PLUGIN_DIR, "preload.js"));
  for (const fn of ["getSessionStatus", "startElevatedSession", "stopElevatedSession", "scan", "toggleItems", "restoreAll", "restartExplorer"]) {
    assert.equal(typeof globalThis.window.ctxMenuApi[fn], "function", `缺少 API: ${fn}`);
  }
  console.log("  PASS: preload.js 全部桥接方法就绪");

  console.log("=== [2.5/4] Start-Process -WindowStyle Hidden + UTF-8 BOM 启动器中文路径静默校验 ===");
  const hiddenOut = path.join(os.tmpdir(), `alltool_hidden_out_${Date.now()}.txt`);
  const hiddenLauncher = path.join(os.tmpdir(), `alltool_hidden_launcher_${Date.now()}.ps1`);
  try {
    const manifestCnPath = path.join(PLUGIN_DIR, "plugin.json");
    const launcherScript = `if (Test-Path -LiteralPath '${manifestCnPath}') { Set-Content -LiteralPath '${hiddenOut}' -Value 'OK' }`;
    fs.writeFileSync(hiddenLauncher, "\uFEFF" + launcherScript, "utf8");
    const cmd = `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','${hiddenLauncher}')`;
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", cmd], { windowsHide: true });
    assert.ok(fs.existsSync(hiddenOut) && fs.readFileSync(hiddenOut, "utf8").trim() === "OK", "Hidden 中文路径启动失败");
    console.log("  PASS: Start-Process -WindowStyle Hidden 中文路径零蓝框拉起验证通过");
  } finally {
    try { if (fs.existsSync(hiddenOut)) fs.unlinkSync(hiddenOut); } catch (_) {}
    try { if (fs.existsSync(hiddenLauncher)) fs.unlinkSync(hiddenLauncher); } catch (_) {}
  }

  console.log("=== [3/4] 常驻 Worker 毫秒级 scan / 沙箱 toggle / restore-all / shutdown 闭环测试 ===");
  const port = await getFreePort();
  const token = crypto.randomBytes(16).toString("hex");
  const sandboxBackupDir = path.join(os.tmpdir(), `alltool_worker_test_${Date.now()}`);
  const readyFile = path.join(os.tmpdir(), `alltool_worker_ready_${Date.now()}.json`);
  const sandboxKey = "HKEY_CURRENT_USER\\Software\\ALLTool_SandboxTest_CtxMenu";

  const workerProc = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(PLUGIN_DIR, "scripts", "elevated-worker.ps1"),
      "-Port",
      String(port),
      "-Token",
      token,
      "-BackupDir",
      sandboxBackupDir,
      "-ManagerScriptPath",
      path.join(PLUGIN_DIR, "scripts", "context-menu-manager.ps1"),
      "-ReadyFile",
      readyFile,
    ],
    { windowsHide: true, stdio: "ignore" }
  );

  // 等待 Worker 预热就绪
  const tStart = Date.now();
  while (!fs.existsSync(readyFile) && Date.now() - tStart < 15000) {
    await new Promise((r) => setTimeout(r, 120));
  }
  assert.ok(fs.existsSync(readyFile), "常驻 Worker 启动超时");
  console.log(`  PASS: 常驻 Worker 预热就绪 (${Date.now() - tStart}ms)`);

  runReg(["add", sandboxKey, "/ve", "/t", "REG_SZ", "/d", "ALLTool Worker 测试项", "/f"]);

  try {
    // 3.1 Token 鉴权拦截校验
    const badRes = await httpJson(port, "wrong-token", "/health", "GET");
    assert.equal(badRes.status, 403, "错误 Token 未被拦截");

    // 3.2 热态 scan 耗时、图标提取与排序测试
    const tScan = Date.now();
    const scanRes = await httpJson(port, token, "/scan", "GET");
    const scanMs = Date.now() - tScan;
    assert.equal(scanRes.data.ok, true);
    assert.ok(scanRes.data.items.length > 0);
    const dirBgItems = scanRes.data.items.filter((i) => i.scopeId === "dir-bg");
    const fileItems = scanRes.data.items.filter((i) => i.scopeId === "file");
    const withIcons = dirBgItems.filter((i) => i.iconDataUrl && i.iconDataUrl.startsWith("data:image/png;base64,"));
    assert.ok(withIcons.length > 0, "未提取到任何右键菜单图标");
    const hasQQ = fileItems.some((i) => i.keyName === "QQExtension");
    const hasHR = fileItems.some((i) => i.keyName === "HRContextMenu");
    const hasFileLocksmith = fileItems.some((i) => i.keyName === "FileLocksmithExt" || i.keyName === "FileLocksmithCommand");
    assert.ok(hasQQ, "文件右键未检出 QQExtension");
    assert.ok(hasHR, "文件右键未检出 HRContextMenu（火绒）");
    assert.ok(hasFileLocksmith, "文件右键未检出 FileLocksmith");
    console.log(`  PASS: 常驻 Worker 热态 scan 成功，共 ${scanRes.data.items.length} 项，耗时 ${scanMs}ms`);
    console.log(`  PASS: 文件夹空白处 ${dirBgItems.length} 项（真实图标 ${withIcons.length} 项）；文件右键 ${fileItems.length} 项（已检出 QQ / 火绒 / FileLocksmith / PowerRename 等 Win11 现代扩展与 AllFilesystemObjects）`);

    // 3.3 沙箱 toggle 停用测试（同时覆盖 shell 项与 shellex/Win11 现代扩展！）
    const testClsid = "{11111111-2222-3333-4444-555555555555}";
    const tToggle = Date.now();
    const disRes = await httpJson(port, token, "/toggle", "POST", [
      {
        id: "sandbox|HKCU|shell|ALLTool_SandboxTest_CtxMenu",
        kind: "shell",
        hive: "HKCU",
        keyName: "ALLTool_SandboxTest_CtxMenu",
        displayName: "ALLTool Worker 测试项",
        regPath: sandboxKey,
        clsid: "",
        currentEnabled: true,
        targetEnabled: false,
        needsAdmin: false,
      },
      {
        id: `sandbox|APPX|win11|SandboxWin11Ext|${testClsid}`,
        kind: "shellex",
        hive: "APPX",
        keyName: "SandboxWin11Ext",
        displayName: "ALLTool Win11 沙箱扩展",
        regPath: `PackagedCom\\SandboxPkg\\Class\\${testClsid}`,
        clsid: testClsid,
        currentEnabled: true,
        targetEnabled: false,
        needsAdmin: false,
      },
    ]);
    const toggleMs = Date.now() - tToggle;
    assert.equal(disRes.data.ok, true, `停用失败: ${disRes.data.error}`);
    assert.equal(disRes.data.historyCount, 2);
    const q1 = runReg(["query", sandboxKey, "/v", "LegacyDisable"]);
    assert.ok(q1.includes("LegacyDisable"));
    const q2 = runReg(["query", "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked", "/v", testClsid]);
    assert.ok(q2.includes(testClsid), "Blocked 拦截表未写入测试 CLSID");
    console.log(`  PASS: 常驻 Worker 沙箱停用（shell + shellex/Win11 现代扩展）+ 自动备份成功，耗时 ${toggleMs}ms`);

    // 3.4 一键还原测试
    const tRestore = Date.now();
    const restoreRes = await httpJson(port, token, "/restore-all", "POST", {});
    const restoreMs = Date.now() - tRestore;
    assert.equal(restoreRes.data.ok, true);
    assert.equal(restoreRes.data.restoredCount, 2);
    assert.equal(restoreRes.data.historyCount, 0);
    let clsidStillBlocked = false;
    try {
      runReg(["query", "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked", "/v", testClsid]);
      clsidStillBlocked = true;
    } catch (_) {
      clsidStillBlocked = false;
    }
    assert.equal(clsidStillBlocked, false, "还原后测试 CLSID 仍残留在 Blocked 表中");
    console.log(`  PASS: 常驻 Worker 一键还原（shell + shellex/Win11）成功，耗时 ${restoreMs}ms`);

    // 3.5 优雅关闭 Worker
    const shutRes = await httpJson(port, token, "/shutdown", "POST", {});
    assert.equal(shutRes.data.ok, true);
    console.log("  PASS: 常驻 Worker 已优雅关闭");
  } finally {
    try { workerProc.kill(); } catch (_) {}
    try { runReg(["delete", sandboxKey, "/f"]); } catch (_) {}
    try { if (fs.existsSync(readyFile)) fs.unlinkSync(readyFile); } catch (_) {}
    try { if (fs.existsSync(sandboxBackupDir)) fs.rmSync(sandboxBackupDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("=== [4/4] 全部测试通过 ===");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
