if (window.ztools) {
  window.utools = window.ztools
}

// preload 运行在 CJS（uTools 注入），避免与主项目 ESM 冲突
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { installUtoolsHost } = require("./utools.js");

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  // 宿主：window.utools、进出事件、主题、窗口高度 API
  const windowMethods = installUtoolsHost() ?? {};

  const PREFIX = "ga:";

  // AI 上下文：固定路径只读/可写，不接受前端任意路径（与 goose-note 安全模型一致）
  const MAX_AI_CONTEXT_FILE_BYTES = 256 * 1024;
  const MAX_LOCAL_SKILLS = 100;
  const MAX_SKILL_DEPTH = 8;

  const readJson = (key, label) => {
    try {
      if (typeof utools?.dbStorage?.getItem === "function") {
        const raw = utools.dbStorage.getItem(key);
        if (typeof raw === "string") {
          return JSON.parse(raw);
        }
        if (raw != null) return raw;
      }
    } catch (err) {
      console.error(`[goose-agent] read ${label} failed:`, err);
    }
    return null;
  };

  const writeJson = (key, value, label) => {
    try {
      if (typeof utools?.dbStorage?.setItem === "function") {
        utools.dbStorage.setItem(key, JSON.stringify(value));
        return true;
      }
    } catch (err) {
      console.error(`[goose-agent] write ${label} failed:`, err);
    }
    return false;
  };

  const safeCall = (fn, ...args) => {
    try {
      if (typeof fn === "function") return fn(...args);
    } catch (err) {
      console.error("[goose-agent] utools api failed:", err);
    }
    return undefined;
  };

  const resolveWriteEncoding = (encoding) =>
    encoding === "base64" || encoding === "binary" ? "base64" : "utf-8";

  const tryTrash = async (targetPath) => {
    try {
      if (typeof utools?.shellTrashItem === "function") {
        await utools.shellTrashItem(targetPath);
        return true;
      }
    } catch (err) {
      console.error("[gooseFs] shellTrashItem failed:", err);
    }
    return false;
  };

  const removePath = async (targetPath, { recursive = false } = {}) => {
    const trashed = await tryTrash(targetPath);
    if (trashed) return true;
    try {
      await fs.promises.rm(targetPath, { recursive, force: true });
      return true;
    } catch (err) {
      console.error("[gooseFs] remove failed:", err);
      return false;
    }
  };

  // ── 存储桥（独立前缀 ga:，禁止 gn: / goose-note-*）+ 宿主窗口 API ──
  window.gooseAgent = {
    storageGet: (key) => readJson(`${PREFIX}${key}`, key),
    storageSet: (key, value) => writeJson(`${PREFIX}${key}`, value, key),
    storageRemove: (key) => {
      try {
        if (typeof utools?.dbStorage?.removeItem === "function") {
          utools.dbStorage.removeItem(`${PREFIX}${key}`);
          return true;
        }
      } catch (err) {
        console.error("[goose-agent] remove storage failed:", err);
      }
      return false;
    },
    copyText: (text) => {
      safeCall(utools?.copyText, text);
    },
    showNotification: (text) => {
      safeCall(utools?.showNotification, text);
    },
    ...windowMethods,
  };

  // ── AI 上下文桥：全局/项目 AGENTS、skills、MCP 配置（固定路径）────
  /** 读取不超过上限的文本文件；超限或不存在返回 null */
  const readTextFileCapped = (filePath) => {
    try {
      if (fs.statSync(filePath).size > MAX_AI_CONTEXT_FILE_BYTES) return null;
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  };

  /**
   * 校验 workspaceRoot：必须是已存在的绝对目录；
   * path.resolve + realpath 规范化，拒绝相对路径与含 NUL 的输入。
   */
  const resolveSafeWorkspaceRoot = (workspaceRoot) => {
    if (typeof workspaceRoot !== "string") return null;
    const raw = workspaceRoot.trim();
    if (!raw || !path.isAbsolute(raw)) return null;
    if (raw.includes("\0")) return null;
    try {
      const resolved = path.resolve(raw);
      if (!path.isAbsolute(resolved) || resolved.includes("\0")) return null;
      if (!fs.existsSync(resolved)) return null;
      const real = fs.realpathSync(resolved);
      if (!fs.statSync(real).isDirectory()) return null;
      return real;
    } catch {
      return null;
    }
  };

  /** 目标路径必须落在 rootReal 之内（含 root 本身） */
  const isInsideRoot = (rootReal, targetPath) => {
    try {
      const resolved = path.resolve(targetPath);
      if (resolved.includes("\0")) return false;
      let candidate = resolved;
      if (fs.existsSync(resolved)) {
        candidate = fs.realpathSync(resolved);
      }
      const rootPrefix = rootReal.endsWith(path.sep)
        ? rootReal
        : rootReal + path.sep;
      return candidate === rootReal || candidate.startsWith(rootPrefix);
    } catch {
      return false;
    }
  };

  /** 扫描 skills 根目录：仅收集各层 SKILL.md，深度≤8，最多 100 个 */
  const collectSkillFiles = (skillsRoot) => {
    const results = [];
    const visit = (dir, depth) => {
      if (depth > MAX_SKILL_DEPTH) return;
      if (results.length >= MAX_LOCAL_SKILLS) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_LOCAL_SKILLS) return;
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath, depth + 1);
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          try {
            if (fs.statSync(entryPath).size > MAX_AI_CONTEXT_FILE_BYTES) continue;
            results.push({
              path: entryPath,
              content: fs.readFileSync(entryPath, "utf-8"),
            });
          } catch {
            // 单文件失败跳过
          }
        }
      }
    };
    visit(skillsRoot, 0);
    return results;
  };

  /** 尝试读取若干固定候选路径，返回存在且未超限的 path+content */
  const readFixedConfigFiles = (candidates) => {
    const out = [];
    for (const filePath of candidates) {
      if (typeof filePath !== "string" || !filePath) continue;
      const content = readTextFileCapped(filePath);
      if (content != null) {
        out.push({ path: filePath, content });
      }
    }
    return out;
  };

  window.gooseAiContext = {
    /** 读 ~/AGENTS.md */
    readGlobalPrompt: () => {
      const agentsPath = path.join(os.homedir(), "AGENTS.md");
      return readTextFileCapped(agentsPath);
    },

    /** 写 ~/AGENTS.md（home 目录已存在） */
    writeGlobalPrompt: (content) => {
      if (typeof content !== "string") return false;
      if (Buffer.byteLength(content, "utf-8") > MAX_AI_CONTEXT_FILE_BYTES) {
        return false;
      }
      try {
        const agentsPath = path.join(os.homedir(), "AGENTS.md");
        fs.writeFileSync(agentsPath, content, "utf-8");
        return true;
      } catch (err) {
        console.error("[gooseAiContext] writeGlobalPrompt failed:", err);
        return false;
      }
    },

    /** 全局 skills 根：~/.agents/skills（只读路径，供技能编辑页） */
    getGlobalSkillsRoot: () => {
      return path.join(os.homedir(), ".agents", "skills");
    },

    /** 全局 skills：仅 ~/.agents/skills 下各层 SKILL.md */
    listLocalSkills: () => {
      const root = path.join(os.homedir(), ".agents", "skills");
      return collectSkillFiles(root);
    },

    /**
     * 项目 skills：仅当 workspaceRoot 为绝对且存在时，
     * 扫描 <root>/.agents/skills
     */
    listProjectSkills: (workspaceRoot) => {
      const root = resolveSafeWorkspaceRoot(workspaceRoot);
      if (!root) return [];
      const skillsRoot = path.join(root, ".agents", "skills");
      if (!isInsideRoot(root, skillsRoot)) return [];
      return collectSkillFiles(skillsRoot);
    },

    /** 读 <workspaceRoot>/AGENTS.md */
    readProjectPrompt: (workspaceRoot) => {
      const root = resolveSafeWorkspaceRoot(workspaceRoot);
      if (!root) return null;
      const agentsPath = path.join(root, "AGENTS.md");
      if (!isInsideRoot(root, agentsPath)) return null;
      return readTextFileCapped(agentsPath);
    },

    /** 写 <workspaceRoot>/AGENTS.md */
    writeProjectPrompt: (workspaceRoot, content) => {
      if (typeof content !== "string") return false;
      if (Buffer.byteLength(content, "utf-8") > MAX_AI_CONTEXT_FILE_BYTES) {
        return false;
      }
      const root = resolveSafeWorkspaceRoot(workspaceRoot);
      if (!root) return false;
      const agentsPath = path.join(root, "AGENTS.md");
      if (!isInsideRoot(root, agentsPath)) return false;
      try {
        fs.writeFileSync(agentsPath, content, "utf-8");
        return true;
      } catch (err) {
        console.error("[gooseAiContext] writeProjectPrompt failed:", err);
        return false;
      }
    },

    /**
     * 全局 MCP 配置只读（不 spawn 服务器）。
     * 单源：~/.agents/mcp.json。
     */
    listGlobalMcpConfigs: () => {
      const filePath = path.join(os.homedir(), ".agents", "mcp.json");
      return readFixedConfigFiles([filePath]);
    },

    /**
     * 项目 MCP 配置只读。
     * 单源：<root>/.agents/mcp.json。
     */
    listProjectMcpConfigs: (workspaceRoot) => {
      const root = resolveSafeWorkspaceRoot(workspaceRoot);
      if (!root) return [];
      const filePath = path.join(root, ".agents", "mcp.json");
      if (!isInsideRoot(root, filePath)) return [];
      return readFixedConfigFiles([filePath]);
    },
  };

  // ── 本机 FS 桥（文件 tools / 工作区最小集）────────────────────────
  /** 目录/文件尚不存在：调用方期望空列表或 null，不当作错误刷屏 */
  const isFsMissing = (err) =>
    Boolean(err && (err.code === "ENOENT" || err.code === "ENOTDIR"));

  const logFsError = (label, err) => {
    if (isFsMissing(err)) return;
    console.error(`[gooseFs] ${label} failed:`, err);
  };

  window.gooseFs = {
    readDir: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          path: path.join(dir, entry.name),
        }));
      } catch (err) {
        logFsError("readDir", err);
        return [];
      }
    },

    readDirAsync: async (dir) => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          path: path.join(dir, entry.name),
        }));
      } catch (err) {
        logFsError("readDirAsync", err);
        return [];
      }
    },

    readFile: (filePath) => {
      try {
        return fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        logFsError("readFile", err);
        return null;
      }
    },

    readFileAsync: async (filePath) => {
      try {
        return await fs.promises.readFile(filePath, "utf-8");
      } catch (err) {
        logFsError("readFileAsync", err);
        return null;
      }
    },

    readFileBase64: (filePath) => {
      try {
        return fs.readFileSync(filePath).toString("base64");
      } catch (err) {
        logFsError("readFileBase64", err);
        return null;
      }
    },

    readFileStat: (filePath) => {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return { ok: true, content };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { ok: false, error, content: null };
      }
    },

    readFileStatAsync: async (filePath) => {
      try {
        const content = await fs.promises.readFile(filePath, "utf-8");
        return { ok: true, content };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (!isFsMissing(err)) {
          console.error("[gooseFs] readFileStatAsync failed:", err);
        }
        return { ok: false, error, content: null };
      }
    },

    writeFile: (filePath, content, encoding = "utf-8") => {
      try {
        fs.writeFileSync(filePath, content, resolveWriteEncoding(encoding));
        return true;
      } catch (err) {
        console.error("[gooseFs] writeFile failed:", err);
        return false;
      }
    },

    writeFileAsync: async (filePath, content, encoding = "utf-8") => {
      try {
        await fs.promises.writeFile(
          filePath,
          content,
          resolveWriteEncoding(encoding),
        );
        return true;
      } catch (err) {
        console.error("[gooseFs] writeFileAsync failed:", err);
        return false;
      }
    },

    exists: (filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (err) {
        console.error("[gooseFs] exists failed:", err);
        return false;
      }
    },

    existsAsync: async (filePath) => {
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    realpathAsync: async (filePath) => {
      try {
        return await fs.promises.realpath(filePath);
      } catch {
        return null;
      }
    },

    mkdir: (dirPath) => {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        return true;
      } catch (err) {
        console.error("[gooseFs] mkdir failed:", err);
        return false;
      }
    },

    deleteFile: async (filePath) => removePath(filePath, { recursive: false }),

    deleteDir: async (dirPath) => removePath(dirPath, { recursive: true }),

    rename: (oldPath, newPath) => {
      try {
        fs.renameSync(oldPath, newPath);
        return true;
      } catch (err) {
        console.error("[gooseFs] rename failed:", err);
        return false;
      }
    },

    /**
     * 选目录：优先 uTools showOpenDialog；失败返回 null。
     * 供工作区挂载（PR8）使用。
     */
    selectDirectory: async () => {
      try {
        if (typeof utools?.showOpenDialog === "function") {
          const result = await utools.showOpenDialog({
            title: "选择工作区文件夹",
            properties: ["openDirectory"],
          });
          if (Array.isArray(result) && result.length > 0 && result[0]) {
            return String(result[0]);
          }
        }
      } catch (err) {
        console.error("[gooseFs] selectDirectory failed:", err);
      }
      return null;
    },

    /** 本机家目录（同步）；供本地 CLI auth 探测等使用 */
    getHomedir: () => os.homedir(),

    /**
     * 用系统文件管理器打开路径。
     * 目录：shellOpenPath；文件：优先 shellShowItemInFolder，退回 open 父目录。
     */
    openInFileManager: async (targetPath) => {
      const p = typeof targetPath === "string" ? targetPath.trim() : "";
      if (!p) return false;
      try {
        let isDir = false;
        try {
          isDir = fs.statSync(p).isDirectory();
        } catch {
          isDir = false;
        }
        if (isDir && typeof utools?.shellOpenPath === "function") {
          const result = await Promise.resolve(utools.shellOpenPath(p));
          if (typeof result === "string") return result.length === 0;
          return result !== false;
        }
        if (typeof utools?.shellShowItemInFolder === "function") {
          await Promise.resolve(utools.shellShowItemInFolder(p));
          return true;
        }
        if (typeof utools?.shellOpenPath === "function") {
          const dir = isDir ? p : path.dirname(p);
          const result = await Promise.resolve(utools.shellOpenPath(dir));
          if (typeof result === "string") return result.length === 0;
          return result !== false;
        }
      } catch (err) {
        console.error("[gooseFs] openInFileManager failed:", err);
      }
      return false;
    },

    /**
     * 本机 shell 命令（ADR 0023）。权限门控在渲染进程；此处只负责 spawn。
     * opts: { command, cwd?, timeoutMs? }
     */
    runCommand: (opts) => {
      const command =
        opts && typeof opts.command === "string" ? opts.command.trim() : "";
      if (!command) {
        return Promise.resolve({
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: "",
          error: "command 不能为空",
        });
      }
      const cwd =
        opts && typeof opts.cwd === "string" && opts.cwd.trim()
          ? opts.cwd.trim()
          : undefined;
      let timeoutMs = 60_000;
      if (opts && typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)) {
        timeoutMs = Math.min(300_000, Math.max(1_000, Math.floor(opts.timeoutMs)));
      }
      const MAX_OUT = 200_000;
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "/bin/sh";
      const args = isWin ? ["/d", "/s", "/c", command] : ["-c", command];

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const child = spawn(shell, args, {
          cwd,
          env: process.env,
          windowsHide: true,
        });

        const finish = (result) => {
          if (settled) return;
          settled = true;
          const clip = (s) =>
            s.length <= MAX_OUT
              ? s
              : `${s.slice(0, MAX_OUT)}\n…[truncated ${s.length - MAX_OUT} chars]`;
          resolve({
            ...result,
            stdout: clip(result.stdout || ""),
            stderr: clip(result.stderr || ""),
          });
        };

        const timer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }, 500);
        }, timeoutMs);

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          finish({
            ok: false,
            exitCode: null,
            stdout,
            stderr,
            error: err.message,
            timedOut: timedOut || undefined,
          });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          const exitCode = typeof code === "number" ? code : null;
          if (timedOut) {
            finish({
              ok: false,
              exitCode,
              stdout,
              stderr,
              timedOut: true,
              error: `命令超时（${timeoutMs}ms）`,
            });
            return;
          }
          finish({
            ok: exitCode === 0,
            exitCode,
            stdout,
            stderr,
          });
        });
      });
    },
  };
}
