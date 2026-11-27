// Windows 右键菜单管理插件 Preload（CommonJS，未压缩，遵循 ZTools 官方规范）
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const PLUGIN_DIR = __dirname;
const EMBEDDED_MANAGER_PATH = path.join(PLUGIN_DIR, "scripts", "context-menu-manager.ps1");
const EMBEDDED_WORKER_PATH = path.join(PLUGIN_DIR, "scripts", "elevated-worker.ps1");
const SESSION_FILE = path.join(os.tmpdir(), "alltool_ctx_worker_session.json");

function resolveBackupDir() {
  try {
    const repoRoot = path.resolve(PLUGIN_DIR, "..", "..");
    if (
      !PLUGIN_DIR.toLowerCase().includes(".asar") &&
      fs.existsSync(path.join(repoRoot, "AGENTS.md")) &&
      fs.existsSync(path.join(repoRoot, "plugins"))
    ) {
      return path.join(repoRoot, ".local", "backups", "win-context-menu");
    }
  } catch (_) {}
  return path.join(os.homedir(), ".ztools", "plugin-backups", "win-context-menu");
}

const BACKUP_DIR = resolveBackupDir();

// 内存中的常驻提权 Worker 会话信息 { port, token, pid, isAdmin }
let workerSession = null;
let elevatingPromise = null;

/**
 * 获取可供外部 powershell.exe 直接执行的真实磁盘脚本路径（兼容 .asar 打包安装）
 */
function ensureRunnableScripts() {
  const isInsideAsar = PLUGIN_DIR.toLowerCase().includes(".asar");
  if (!isInsideAsar && fs.existsSync(EMBEDDED_MANAGER_PATH) && fs.existsSync(EMBEDDED_WORKER_PATH)) {
    return {
      managerPath: EMBEDDED_MANAGER_PATH,
      workerPath: EMBEDDED_WORKER_PATH,
    };
  }
  const runtimeDir = path.join(os.tmpdir(), "alltool-win-context-menu");
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }
  const copyWithBom = (src, fileName) => {
    const dst = path.join(runtimeDir, fileName);
    const content = fs.readFileSync(src, "utf8");
    const bom = content.startsWith("\uFEFF") ? content : "\uFEFF" + content;
    fs.writeFileSync(dst, bom, "utf8");
    return dst;
  };
  return {
    managerPath: copyWithBom(EMBEDDED_MANAGER_PATH, "context-menu-manager.ps1"),
    workerPath: copyWithBom(EMBEDDED_WORKER_PATH, "elevated-worker.ps1"),
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function workerRequest(session, route, method = "GET", bodyObj = null, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!session || !session.port || !session.token) {
      resolve({ ok: false, error: "无有效 Worker 会话" });
      return;
    }
    const bodyText = bodyObj !== null ? JSON.stringify(bodyObj) : "";
    const headers = {
      "X-ALLTool-Token": session.token,
    };
    if (bodyText) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = Buffer.byteLength(bodyText, "utf8");
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: session.port,
        path: route,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8").trim();
          try {
            resolve(JSON.parse(raw));
          } catch (_) {
            resolve({ ok: false, error: `Worker 返回无效响应: ${raw.slice(0, 120)}` });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Worker 请求超时" });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err.message || String(err) });
    });

    if (bodyText) req.write(bodyText);
    req.end();
  });
}

const EXPECTED_WORKER_SCHEMA = 5;

/**
 * 尝试复用已有存活的常驻 Worker 会话（切出插件再切回时免重复 UAC；若检测到旧版 Worker 自动优雅关闭升级）
 */
async function tryReuseExistingSession() {
  const checkHealth = async (session) => {
    const h = await workerRequest(session, "/health", "GET", null, 1200);
    if (h && h.ok) {
      if (Number(h.schemaVersion || 1) !== EXPECTED_WORKER_SCHEMA) {
        await workerRequest(session, "/shutdown", "POST", {}, 1200);
        return null;
      }
      return { ...session, isAdmin: Boolean(h.isAdmin) };
    }
    return null;
  };

  if (workerSession) {
    const valid = await checkHealth(workerSession);
    if (valid) {
      workerSession = valid;
      return workerSession;
    }
    workerSession = null;
  }

  try {
    if (fs.existsSync(SESSION_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      if (saved && saved.port && saved.token) {
        const valid = await checkHealth(saved);
        if (valid) {
          workerSession = valid;
          return workerSession;
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * 一次性触发 UAC 启动常驻管理员 Worker（15 分钟空闲自动退出）
 */
async function startElevatedSession() {
  const existing = await tryReuseExistingSession();
  if (existing && existing.isAdmin) {
    return { ok: true, isAdmin: true, reused: true };
  }

  if (elevatingPromise) return elevatingPromise;

  elevatingPromise = (async () => {
    const { managerPath, workerPath } = ensureRunnableScripts();
    const port = await getFreePort();
    const token = crypto.randomBytes(24).toString("hex");
    const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const readyFile = path.join(os.tmpdir(), `alltool_ctx_ready_${stamp}.json`);
    const launcherPs1 = path.join(os.tmpdir(), `alltool_ctx_launcher_${stamp}.ps1`);

    // 写入纯 ASCII 路径的临时启动器（内容带 UTF-8 BOM），彻底避免中文/空格路径传参转义问题
    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const launcherBody = [
      `& ${psQuote(workerPath)} -Port ${port} -Token ${psQuote(token)} -BackupDir ${psQuote(BACKUP_DIR)} -ManagerScriptPath ${psQuote(managerPath)} -ReadyFile ${psQuote(readyFile)}`,
    ].join("\r\n");
    fs.writeFileSync(launcherPs1, "\uFEFF" + launcherBody, "utf8");

    // 把 -WindowStyle Hidden 直接传给 Start-Process 本身（ShellExecuteEx SW_HIDE），彻底消除蓝框闪烁
    const launchCmd = `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',${psQuote(launcherPs1)}) -Verb RunAs`;

    const launchRes = await new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", launchCmd],
        { encoding: "utf8", windowsHide: true },
        (error, _stdout, stderr) => {
          if (error) {
            resolve({ ok: false, error: (stderr && stderr.trim()) || error.message });
          } else {
            resolve({ ok: true });
          }
        }
      );
    });

    if (!launchRes.ok) {
      try { if (fs.existsSync(launcherPs1)) fs.unlinkSync(launcherPs1); } catch (_) {}
      return { ok: false, isAdmin: false, cancelled: true, error: launchRes.error || "已取消管理员授权" };
    }

    // 轮询等待 Worker 就绪（最长 12 秒）
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (fs.existsSync(readyFile)) {
        try {
          const info = JSON.parse(fs.readFileSync(readyFile, "utf8"));
          try { fs.unlinkSync(readyFile); } catch (_) {}
          try { if (fs.existsSync(launcherPs1)) fs.unlinkSync(launcherPs1); } catch (_) {}
          if (info && info.ok) {
            workerSession = { port, token, pid: info.pid, isAdmin: Boolean(info.isAdmin) };
            try {
              fs.writeFileSync(SESSION_FILE, JSON.stringify(workerSession), "utf8");
            } catch (_) {}
            return { ok: true, isAdmin: Boolean(info.isAdmin), reused: false };
          }
        } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    try { if (fs.existsSync(launcherPs1)) fs.unlinkSync(launcherPs1); } catch (_) {}
    return { ok: false, isAdmin: false, error: "等待管理员工作进程启动超时" };
  })();

  try {
    return await elevatingPromise;
  } finally {
    elevatingPromise = null;
  }
}

/**
 * 降级模式：单次直接调用 context-menu-manager.ps1（用于用户取消 UAC 时的只读扫描或 HKCU 免提权操作）
 */
function runFallbackEngine(action, extraArgs = []) {
  return new Promise((resolve) => {
    let managerPath;
    try {
      managerPath = ensureRunnableScripts().managerPath;
    } catch (err) {
      resolve({ ok: false, error: `释放脚本失败: ${err.message || String(err)}` });
      return;
    }

    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      managerPath,
      "-Action",
      action,
      "-BackupDir",
      BACKUP_DIR,
      ...extraArgs,
    ];

    execFile(
      "powershell.exe",
      args,
      { encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const rawOut = (stdout || "").trim();
        if (rawOut) {
          const lines = rawOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const lastLine = lines[lines.length - 1];
          try {
            resolve(JSON.parse(lastLine));
            return;
          } catch (_) {}
        }
        resolve({
          ok: false,
          error: (stderr && stderr.trim()) || (error && error.message) || "执行 PowerShell 脚本失败",
        });
      }
    );
  });
}

window.ctxMenuApi = {
  async getSessionStatus() {
    const s = await tryReuseExistingSession();
    return { ok: true, active: Boolean(s), isAdmin: Boolean(s && s.isAdmin) };
  },

  async startElevatedSession() {
    return startElevatedSession();
  },

  async stopElevatedSession() {
    const s = await tryReuseExistingSession();
    if (s) {
      await workerRequest(s, "/shutdown", "POST", {}, 2000);
    }
    workerSession = null;
    try {
      if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch (_) {}
    return { ok: true };
  },

  async scan() {
    const s = await tryReuseExistingSession();
    if (s) {
      // 首次扫描需加载 Win11 AppX 现代右键扩展清单，预留充足超时；后续走 Worker 内存缓存
      const res = await workerRequest(s, "/scan", "GET", null, 35000);
      if (res && res.ok) return res;
    }
    return runFallbackEngine("scan");
  },

  async toggleItems(operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { ok: false, error: "操作列表不能为空" };
    }

    // 若包含需管理员权限的项且尚未激活提权会话，先尝试一次性拉起常驻提权 Worker
    const needsAdmin = operations.some((op) => Boolean(op.needsAdmin));
    let s = await tryReuseExistingSession();
    if (needsAdmin && (!s || !s.isAdmin)) {
      const elev = await startElevatedSession();
      if (elev && elev.ok) {
        s = workerSession;
      }
    }

    if (s && (!needsAdmin || s.isAdmin)) {
      const res = await workerRequest(s, "/toggle", "POST", operations, 15000);
      if (res && res.ok) return res;
      if (res && res.error && !res.error.includes("ECONNREFUSED")) {
        return res;
      }
    }

    // 降级兜底
    const tempFile = path.join(
      os.tmpdir(),
      `alltool_ctx_payload_${Date.now()}_${Math.random().toString(16).slice(2)}.json`
    );
    try {
      fs.writeFileSync(tempFile, JSON.stringify(operations), "utf8");
      return await runFallbackEngine("toggle", ["-PayloadFile", tempFile]);
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch (_) {}
    }
  },

  async restoreAll() {
    let s = await tryReuseExistingSession();
    if (!s || !s.isAdmin) {
      const elev = await startElevatedSession();
      if (elev && elev.ok) s = workerSession;
    }
    if (s) {
      const res = await workerRequest(s, "/restore-all", "POST", {}, 20000);
      if (res && res.ok) return res;
    }
    return runFallbackEngine("restore-all");
  },

  async restartExplorer() {
    const s = await tryReuseExistingSession();
    if (s) {
      const res = await workerRequest(s, "/restart-explorer", "POST", {}, 10000);
      if (res && res.ok) return res;
    }
    return runFallbackEngine("restart-explorer");
  },

  getBackupDir() {
    return BACKUP_DIR;
  },

  openBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    if (window.ztools && typeof window.ztools.shellOpenPath === "function") {
      window.ztools.shellOpenPath(BACKUP_DIR);
      return true;
    }
    execFile("explorer.exe", [BACKUP_DIR], { windowsHide: true }, () => {});
    return true;
  },
};
