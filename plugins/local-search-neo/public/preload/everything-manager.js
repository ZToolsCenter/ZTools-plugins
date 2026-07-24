const fs = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const EVERYTHING_READY_TIMEOUT_MS = 30_000;
const EVERYTHING_POLL_INTERVAL_MS = 300;

/**
 * 将 ASAR 虚拟路径转换为 unpack 目录中的实体路径。
 * @param {string} filePath 插件文件路径
 * @returns {string} 可交给外部进程使用的实体路径
 */
function resolveUnpackedPath(filePath) {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

function createEverythingManager(everythingAddon) {
  let managedProcess = null;
  let ensureReadyPromise = null;
  let status = makeStatus(
    everythingAddon ? "idle" : "error",
    everythingAddon
      ? "等待检查 Everything 状态"
      : "Everything addon 不可用，无法检查或启动 Everything",
  );

  function getStartupStatus() {
    return { ...status };
  }

  function ensureReady(options = {}) {
    if (isEverythingReady()) {
      setStatus("ready", "Everything 已就绪", { managed: isManagedProcessAlive() });
      return Promise.resolve(getStartupStatus());
    }

    if (ensureReadyPromise) return ensureReadyPromise;

    ensureReadyPromise = ensureReadyInternal(options).finally(() => {
      ensureReadyPromise = null;
    });
    return ensureReadyPromise;
  }

  async function ensureReadyInternal({ timeoutMs = EVERYTHING_READY_TIMEOUT_MS } = {}) {
    if (!everythingAddon) {
      setStatus("error", "Everything addon 不可用，无法检查或启动 Everything");
      throw new Error(status.message);
    }

    setStatus("checking", "正在检查 Everything 状态...");

    if (safeIsRunning()) {
      setStatus("waiting", "检测到 Everything 正在运行，正在等待索引服务就绪...");
      return waitUntilReady(timeoutMs);
    }

    startBundledEverything();
    setStatus("waiting", "正在等待内置 Everything 完成初始化...", {
      managed: true,
      pid: managedProcess?.pid,
    });
    return waitUntilReady(timeoutMs);
  }

  function startBundledEverything() {
    const executable = getBundledEverythingExecutable();
    if (!fs.existsSync(executable)) {
      setStatus("error", `未找到内置 Everything：${executable}`);
      throw new Error(status.message);
    }

    try {
      const configFile = getBundledEverythingConfigFile();
      managedProcess = spawn(executable, ["-startup", "-config", configFile], {
        cwd: path.dirname(executable),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      managedProcess.once("exit", () => {
        managedProcess = null;
      });
      managedProcess.unref();
      setStatus("starting", "未检测到 Everything，正在启动内置 Everything...", {
        managed: true,
        pid: managedProcess.pid,
      });
    } catch (error) {
      setStatus("error", `启动内置 Everything 失败：${formatError(error)}`);
      throw error;
    }
  }

  function waitUntilReady(timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const poll = () => {
        if (isEverythingReady()) {
          setStatus("ready", "Everything 已就绪", {
            managed: isManagedProcessAlive(),
            pid: managedProcess?.pid,
          });
          resolve(getStartupStatus());
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          setStatus("error", "Everything 初始化超时，请确认 Everything 可正常启动");
          reject(new Error(status.message));
          return;
        }

        window.setTimeout(poll, EVERYTHING_POLL_INTERVAL_MS);
      };

      poll();
    });
  }

  function terminateManagedEverything() {
    if (!managedProcess?.pid) return false;

    const pid = managedProcess.pid;
    if (requestEverythingExit()) return true;

    forceKillManagedEverything(pid);
    return true;
  }

  function requestEverythingExit() {
    try {
      return everythingAddon?.exit?.() ?? false;
    } catch (error) {
      console.warn("[local-search-neo] 请求内置 Everything 退出失败:", error);
      return false;
    }
  }

  function forceKillManagedEverything(pid) {
    withWindowsProcessInfo(pid, (error, processInfo) => {
      if (error) {
        console.warn("[local-search-neo] 查询内置 Everything 进程失败:", error);
        return;
      }

      if (!isBundledEverythingProcess(processInfo)) {
        console.warn("[local-search-neo] 跳过终止非内置 Everything 进程:", processInfo);
        return;
      }

      execFile(
        "taskkill",
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        (killError) => {
          if (killError) {
            console.warn("[local-search-neo] taskkill 内置 Everything 失败:", killError);
          }
        },
      );
      managedProcess = null;
    });
  }

  function withWindowsProcessInfo(pid, callback) {
    const processId = Number(pid);
    if (!Number.isInteger(processId) || processId <= 0) {
      callback(new Error(`Invalid process id: ${pid}`));
      return;
    }

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${processId}" -ErrorAction SilentlyContinue | Select-Object Name, ExecutablePath | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          callback(error);
          return;
        }

        try {
          callback(undefined, JSON.parse(stdout.trim() || "{}"));
        } catch (parseError) {
          callback(parseError);
        }
      },
    );
  }

  function isBundledEverythingProcess(processInfo) {
    return (
      processInfo?.Name?.toLowerCase() === "everything.exe" &&
      normalizePath(processInfo.ExecutablePath) === normalizePath(getBundledEverythingExecutable())
    );
  }

  function normalizePath(filePath) {
    return path.resolve(filePath || "").toLowerCase();
  }

  function handlePluginOut(isKill) {
    if (isKill) return terminateManagedEverything();
    return false;
  }

  function isEverythingReady() {
    return safeIsRunning() && safeIsDbLoaded();
  }

  function safeIsRunning() {
    try {
      return everythingAddon?.isRunning() ?? false;
    } catch {
      return false;
    }
  }

  function safeIsDbLoaded() {
    try {
      return everythingAddon?.isDbLoaded() ?? false;
    } catch {
      return false;
    }
  }

  function isManagedProcessAlive() {
    return !!managedProcess?.pid;
  }

  function setStatus(state, message, details = {}) {
    status = makeStatus(state, message, {
      managed: details.managed ?? isManagedProcessAlive(),
      pid: details.pid ?? managedProcess?.pid,
      error: state === "error" ? message : undefined,
    });
  }

  /**
   * 获取 Everything 可执行文件的实体路径。
   * @returns {string} Everything.exe 实体路径
   */
  function getBundledEverythingExecutable() {
    return resolveUnpackedPath(path.resolve(__dirname, "..", "everything", "Everything.exe"));
  }

  /**
   * 获取 Everything 配置文件的实体路径。
   * @returns {string} Everything.ini 实体路径
   */
  function getBundledEverythingConfigFile() {
    return resolveUnpackedPath(path.resolve(__dirname, "..", "everything", "Everything.ini"));
  }

  return {
    ensureReady,
    getStartupStatus,
    handlePluginOut,
    terminateManagedEverything,
  };
}

function makeStatus(state, message, details = {}) {
  return {
    state,
    message,
    managed: details.managed ?? false,
    pid: details.pid,
    error: details.error,
  };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { createEverythingManager };
