/**
 * ZTools Mise 控制台 - preload.js
 * 通过 Node.js 桥接 mise 命令行能力到前端
 * 所有数据层优先使用 mise --json 结构化输出，失败时降级文本解析
 */
const { execSync, exec, spawn } = require("child_process");
const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");

const isWin = process.platform === "win32";

// 持久化目录：插件以 .asar 包运行时，__dirname 指向只读归档，写入会静默失败。
// 因此收藏项目数据改存到 ZTools 用户数据目录下（可写、可跨重启持久）。
let _projectsFile = null;
function getProjectsFile() {
  if (_projectsFile) return _projectsFile;
  let base = null;
  try {
    if (window.ztools && typeof window.ztools.getPath === "function") {
      const u = window.ztools.getPath("userData");
      if (u && typeof u === "string" && u.trim()) base = u.trim();
    }
  } catch (e) { /* 忽略 */ }
  if (!base) {
    // 兜底：使用系统 APPDATA/ZTools（与 ZTools userData 一致）
    base = path.join(process.env.APPDATA || process.env.HOME || ".", "ZTools");
  }
  const dataDir = path.join(base, "ztools-mise-manager");
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) { /* 忽略 */ }
  _projectsFile = path.join(dataDir, "projects.json");
  return _projectsFile;
}

// 辅助函数：解码输出（mise 为 Rust 程序默认 UTF-8，Windows 下兜底 GBK）
// Node v22 exec 回调默认返回 string，需兼容 Buffer 与 string 两种输入
function decodeOutput(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf-8");
  const utf8 = buffer.toString("utf-8");
  if (!utf8.includes("\uFFFD")) return utf8;
  if (isWin) return iconv.decode(buffer, "gbk");
  return utf8;
}

// 辅助函数：异步执行命令，返回 stdout 解码文本
function runCommand(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { shell: true, timeout: 30000, ...opts }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, stdout: "", stderr: decodeOutput(error.stderr || Buffer.from("")) });
        return;
      }
      resolve({ ok: true, stdout: decodeOutput(stdout), stderr: "" });
    });
  });
}

// 辅助函数：执行命令并尝试 JSON 解析
async function runJson(cmd, opts) {
  const res = await runCommand(cmd, opts);
  if (!res.ok) return { ok: false, error: res.stderr || "命令执行失败", data: null };
  try {
    return { ok: true, error: "", data: JSON.parse(res.stdout) };
  } catch (e) {
    return { ok: false, error: "输出无法解析为 JSON", data: null };
  }
}

// 辅助函数：spawn 执行长任务（安装/升级），流式回传日志与进度
function runLongTask(cmd, { onLog, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NO_COLOR: "1", CLICOLOR: "0", MISE_TERM_COLOR: "never" };
    const child = spawn(cmd, [], { shell: true, env });
    let stderrBuf = "";
    let autoConfirmed = false;

    const handleData = (data) => {
      const text = decodeOutput(data);
      stderrBuf += text;
      if (onLog) onLog(text);

      // 自动应答交互式确认提示（如 mise self-update 的 "Do you want to continue? [Y/n]"）
      // 这类提示在无终端环境下无法人工输入，检测到后自动向 stdin 写入 y
      if (!autoConfirmed && /continue\s*\?|\[Y\/n\]|\[y\/N\]|\[y\/n\]/i.test(text)) {
        autoConfirmed = true;
        try {
          if (child.stdin && child.stdin.writable) child.stdin.write("y\n");
        } catch (e) { /* ignore */ }
      }

      const matches = text.match(/\b(\d{1,3})\s*%/g);
      if (matches && onProgress) {
        matches.forEach((m) => {
          const p = parseInt(m.replace("%", "").trim(), 10);
          if (!isNaN(p)) onProgress(Math.min(100, p));
        });
      }
      // mise 阶段式进度: [1/3] install, [2/3] downloading ... 映射为百分比
      const step = text.match(/\[(\d+)\/(\d+)\]/);
      if (step && onProgress) {
        const total = parseInt(step[2], 10);
        const cur = parseInt(step[1], 10);
        if (total > 0) onProgress(Math.min(99, Math.round((cur / total) * 100)));
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("close", (code) => {
      if (code === 0) resolve(stderrBuf);
      else reject(new Error(stderrBuf.trim() || `命令失败 (Code: ${code})`));
    });
    child.on("error", (err) => reject(err));
  });
}

function loadProjects() {
  const file = getProjectsFile();
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.error("Failed to load projects.json", e);
  }
  return [];
}

function saveProjects(list) {
  const file = getProjectsFile();
  try {
    fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save projects.json", e);
  }
}

// 解析 mise ls --json
function parseInstalledTools(json) {
  const tools = [];
  for (const [name, versions] of Object.entries(json || {})) {
    if (!Array.isArray(versions)) continue;
    const items = versions.map((v) => ({
      version: v.version || "",
      requested: v.requested_version || null,
      installPath: v.install_path || null,
      source: v.source && v.source.path ? v.source.path : null,
      active: !!v.active,
    }));
    const active = items.find((i) => i.active);
    tools.push({
      name,
      versions: items,
      activeVersion: active ? active.version : null,
      installCount: items.length,
    });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return tools;
}

// 解析 mise outdated 文本
function parseOutdated(text) {
  if (!text || /all tools are up to date/i.test(text)) return [];
  const lines = text.split("\n").map((l) => l.replace(/\u001b\[\d+m/g, "").trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    if (line.toLowerCase().startsWith("mise")) continue;
    const m = line.match(/^([\w.-]+)\s+([\S]+)\s*->\s*([\S]+)/);
    if (m) result.push({ tool: m[1], current: m[2], latest: m[3] });
  }
  return result;
}

// 解析 mise config 文本: "路径  工具1, 工具2"
function parseConfigFiles(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const idx = line.indexOf("  ");
    if (idx === -1) return { path: line, tools: [] };
    return {
      path: line.slice(0, idx).trim(),
      tools: line.slice(idx).split(",").map((t) => t.trim()).filter(Boolean),
    };
  });
}

window.miseManager = {
  // 当前运行平台（win32 / darwin / linux），供前端做平台适配
  platform: process.platform,

  // --- 系统信息 ---
  getSystemInfo: async () => {
    const ver = await runCommand("mise --version");
    if (!ver.ok) return { missing: true, version: "", configPath: "", installDir: "" };
    let configPath = "";
    try {
      const nullDev = isWin ? "2>nul" : "2>/dev/null";
      configPath = execSync(`mise config ${nullDev}`, { shell: true, encoding: "utf-8" })
        .split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
      configPath = configPath.split(/\s{2,}/)[0] || configPath;
    } catch (e) { /* ignore */ }
    // Windows 下安装目录在 LOCALAPPDATA，macOS/Linux 在 ~/.local/share
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const installDir = isWin
      ? path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "mise", "installs")
      : path.join(home, ".local", "share", "mise", "installs");
    // settingsText 直接读取全局配置内容（比 mise settings 更完整）
    let settingsText = "";
    if (configPath && fs.existsSync(configPath)) {
      try { settingsText = fs.readFileSync(configPath, "utf-8"); } catch (e) { /* ignore */ }
    }
    return {
      missing: false,
      version: ver.stdout.trim(),
      configPath,
      installDir,
      settingsText,
    };
  },

  // --- 已安装工具 ---
  getInstalledTools: async () => {
    const res = await runJson("mise ls --json");
    if (!res.ok) return { ok: false, error: res.error, tools: [] };
    return { ok: true, error: "", tools: parseInstalledTools(res.data) };
  },

  // --- 工具详情 ---
  getToolInfo: async (tool) => {
    const res = await runCommand(`mise tool ${tool}`);
    return { ok: res.ok, text: res.ok ? res.stdout : res.stderr };
  },

  // --- 远程可装版本 ---
  getRemoteVersions: async (tool) => {
    const res = await runJson(`mise ls-remote --json ${tool}`);
    if (!res.ok) return { ok: false, error: res.error, versions: [] };
    const versions = (res.data || [])
      .map((v) => v.version)
      .filter((v) => typeof v === "string" && v.length > 0);
    // 去重并保持版本序（旧→新）
    return { ok: true, error: "", versions: Array.from(new Set(versions)) };
  },

  // --- 安装（带进度） ---
  install: (tool, version, { onLog, onProgress } = {}) => {
    const ver = version ? `@${version}` : "";
    return runLongTask(`mise install ${tool}${ver}`, { onLog, onProgress });
  },

  // --- 卸载 ---
  uninstall: async (tool, version) => {
    const res = await runCommand(`mise uninstall ${tool}@${version}`);
    if (!res.ok) throw new Error(res.stderr || "卸载失败");
    return res.stdout;
  },

  // --- 切换全局版本 (mise use -g) ---
  setGlobal: async (tool, version) => {
    const res = await runCommand(`mise use -g ${tool}@${version}`);
    if (!res.ok) throw new Error(res.stderr || "切换失败");
    return res.stdout;
  },

  // --- 写入项目 .mise.toml (mise use, cwd 指定项目) ---
  setProject: async (tool, version, projectPath) => {
    const opts = projectPath ? { cwd: projectPath } : {};
    const res = await runCommand(`mise use ${tool}@${version}`, opts);
    if (!res.ok) throw new Error(res.stderr || "写入项目配置失败");
    return res.stdout;
  },

  // --- 过时检测 ---
  getOutdated: async () => {
    const res = await runCommand("mise outdated");
    return { ok: res.ok, list: parseOutdated(res.stdout), raw: res.stdout };
  },

  // --- 升级 ---
  upgrade: (tool, { onLog, onProgress } = {}) => {
    const cmd = tool ? `mise upgrade ${tool}` : "mise upgrade";
    return runLongTask(cmd, { onLog, onProgress });
  },

  // --- 更新 mise 本体 (mise self-update) ---
  // --yes: 无终端环境下无法交互确认，直接跳过 "Do you want to continue? [Y/n]" 提示
  selfUpdate: ({ onLog, onProgress } = {}) => {
    return runLongTask("mise self-update --yes", { onLog, onProgress });
  },

  // --- 工具市场 ---
  getRegistry: async () => {
    const res = await runJson("mise registry --json");
    if (!res.ok) return { ok: false, error: res.error, tools: [] };
    const tools = (res.data || []).map((t) => ({
      name: t.short || "",
      description: t.description || "",
      backends: t.backends || [],
      aliases: t.aliases || [],
    }));
    return { ok: true, error: "", tools };
  },

  // --- 配置文件 ---
  getConfigFiles: async () => {
    const res = await runCommand("mise config");
    return { ok: res.ok, files: parseConfigFiles(res.stdout), raw: res.stdout };
  },

  readConfigFile: (filePath) => {
    try {
      return { ok: true, content: fs.readFileSync(filePath, "utf-8") };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  saveConfigFile: (filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, "utf-8");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // --- 项目管理 ---
  // 兼容 ztools.showOpenDialog 的多种返回形态：
  //   1) string[]（路径数组）  2) 单个 string（路径）  3) Electron 风格 { canceled, filePaths: string[] }
  selectFolder: async () => {
    if (!(window.ztools && window.ztools.showOpenDialog)) return null;
    const res = await window.ztools.showOpenDialog({ properties: ["openDirectory"] });
    let path = null;
    if (typeof res === "string") {
      path = res;
    } else if (Array.isArray(res)) {
      path = res[0] || null;
    } else if (res && typeof res === "object") {
      // 优先取数组字段，其次取单个字符串字段
      for (const key of ["filePaths", "paths", "selectedPaths"]) {
        if (Array.isArray(res[key])) {
          path = res[key][0] || null;
          break;
        }
      }
      if (path == null) {
        for (const key of ["path", "filePath", "selectedPath"]) {
          if (typeof res[key] === "string") {
            path = res[key];
            break;
          }
        }
      }
    }
    return path && typeof path === "string" && path.trim() ? path.trim() : null;
  },

  projects: {
    load: () => loadProjects(),
    save: (list) => saveProjects(list),
    add: (proj) => {
      const list = loadProjects();
      if (!list.find((p) => p.path === proj.path)) list.push(proj);
      saveProjects(list);
      return list;
    },
    remove: (projPath) => {
      const list = loadProjects().filter((p) => p.path !== projPath);
      saveProjects(list);
      return list;
    },
  },

  // --- 其他 ---
  openInstallDir: (tool, version) => {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const dir = isWin
      ? path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "mise", "installs", tool, version)
      : path.join(home, ".local", "share", "mise", "installs", tool, version);
    if (fs.existsSync(dir)) {
      if (window.ztools && window.ztools.shellOpenPath) {
        return window.ztools.shellOpenPath(dir);
      }
      // 平台对应的资源管理器打开方式
      const opener = isWin
        ? `start "" "${dir}"`
        : process.platform === "darwin"
          ? `open "${dir}"`
          : `xdg-open "${dir}"`;
      exec(opener, { shell: true });
      return true;
    }
    return false;
  },

  notify: (title, body) => {
    if (window.ztools) window.ztools.showNotification(body, title);
    else alert(`${title}: ${body}`);
  },

  openExternal: (url) => {
    if (window.ztools && window.ztools.shellOpenExternal) window.ztools.shellOpenExternal(url);
    else window.open(url, "_blank");
  },
};

// --- 快速指令处理 ---
ztools.onPluginEnter((action) => {
  const { code, payload } = action;
  if (code === "mise-quick-install" || code === "mise-quick-switch") {
    const m = String(payload).match(/^mise\s*(?:装|安装|install|切|切换|use|全局)?\s*([a-z0-9-]+)(?:@(.+))?/i);
    if (!m) return;
    const tool = m[1];
    const version = m[2];
    const isInstall = code === "mise-quick-install";
    const title = isInstall ? "mise 安装中" : "mise 切换中";

    window.miseManager.notify(title, `${tool}@${version || "latest"} 开始${isInstall ? "安装" : "切换"}...`);

    const actionFn = isInstall
      ? window.miseManager.install(tool, version || "latest")
      : window.miseManager.setGlobal(tool, version || "latest");

    actionFn
      .then(() => {
        window.miseManager.notify(isInstall ? "mise 安装成功" : "mise 切换成功", `${tool}@${version || "latest"}`);
        if (ztools && ztools.hideMainWindow) ztools.hideMainWindow();
      })
      .catch((err) => {
        window.miseManager.notify(isInstall ? "mise 安装失败" : "mise 切换失败", String(err).slice(0, 200));
      });
  }
});
