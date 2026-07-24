const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { execFileSync, spawn } = require("node:child_process");

const MAX_EVENTS = 200;
const PLATFORM_URL = "http://39.106.140.106";
const CLIENT_REGISTRY_URL = "https://registry.npmmirror.com/zosenlink-core";
const CLIENT_PACKAGE_PREFIX = "package/";

let installPromise = null;

let child = null;
let killTimer = null;
let stdoutBuffer = "";
let stderrBuffer = "";
let listeners = [];
let state = {
  running: false,
  pid: null,
  status: "idle",
  statusText: "未启动",
  startedAt: null,
  exitedAt: null,
  exitCode: null,
  signal: null,
  lastError: "",
  clientId: "",
  kernelVersion: "",
  configVersion: 0,
  frpsServer: "",
  mappings: [],
  events: []
};

function platformKey() {
  const archMap = {
    x64: "x64",
    arm64: "arm64"
  };
  return `${process.platform}-${archMap[process.arch] || process.arch}`;
}

function executableName() {
  return process.platform === "win32" ? "zosenlink-core.exe" : "zosenlink-core";
}

function legacyExecutableName() {
  return process.platform === "win32" ? "zosenlink-node-client.exe" : "zosenlink-node-client";
}

function cacheRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ZTools", "zosenlink-tunnel");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "ZTools", "zosenlink-tunnel");
  }
  return path.join(os.homedir(), ".config", "ZTools", "zosenlink-tunnel");
}

function clientDir() {
  return path.join(cacheRoot(), "core");
}

function legacyClientDir() {
  return path.join(cacheRoot(), "node-client");
}

function executablePath() {
  return path.join(clientDir(), "bin", platformKey(), executableName());
}

function legacyExecutablePath() {
  return path.join(legacyClientDir(), "bin", platformKey(), legacyExecutableName());
}

function normalizeError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function assertActivationKey(key) {
  const value = String(key || "").trim();
  if (!value) {
    throw new Error("请输入激活密钥");
  }
  if (value.length > 256) {
    throw new Error("激活密钥长度异常");
  }
  return value;
}

function pushEvent(event) {
  const next = {
    time: new Date().toISOString(),
    ...event
  };
  state.events.push(next);
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  notify();
}

function notify() {
  const snapshot = getStatus();
  listeners = listeners.filter((listener) => {
    try {
      listener(snapshot);
      return true;
    } catch {
      return false;
    }
  });
}

function statusText(status) {
  switch (status) {
    case "activating":
      return "激活中";
    case "activated":
      return "已激活";
    case "connecting":
    case "reconnecting":
    case "server_switched":
      return "连接中";
    case "online":
    case "config_updated":
      return "在线";
    case "error":
      return "错误";
    case "stopped":
      return "已停止";
    case "dependency_checking":
      return "准备客户端";
    case "dependency_downloading":
      return "下载客户端";
    case "dependency_extracting":
      return "安装客户端";
    default:
      return state.running ? "运行中" : "未启动";
  }
}

function applyClientEvent(event) {
  if (!event || typeof event !== "object") return;
  const type = String(event.type || "event");
  state.status = type === "config_updated" ? "online" : type;
  state.statusText = statusText(type);
  state.lastError = event.error || "";
  state.clientId = event.clientId || state.clientId;
  state.kernelVersion = event.kernelVersion || state.kernelVersion;
  state.configVersion = event.configVersion || state.configVersion;
  state.frpsServer = event.frpsServer || state.frpsServer;
  if (Array.isArray(event.mappings)) {
    state.mappings = event.mappings;
  }
  pushEvent({ source: "client", ...event });
}

function appendRawOutput(source, text) {
  const value = String(text || "").trim();
  if (!value) return;
  pushEvent({ source, type: "log", message: value });
}

function consumeStdout(chunk) {
  stdoutBuffer += chunk.toString("utf8");
  let index = stdoutBuffer.indexOf("\n");
  while (index >= 0) {
    const line = stdoutBuffer.slice(0, index).trim();
    stdoutBuffer = stdoutBuffer.slice(index + 1);
    if (line) {
      try {
        applyClientEvent(JSON.parse(line));
      } catch {
        appendRawOutput("stdout", line);
      }
    }
    index = stdoutBuffer.indexOf("\n");
  }
}

function consumeStderr(chunk) {
  stderrBuffer += chunk.toString("utf8");
  let index = stderrBuffer.indexOf("\n");
  while (index >= 0) {
    const line = stderrBuffer.slice(0, index).trim();
    stderrBuffer = stderrBuffer.slice(index + 1);
    appendRawOutput("stderr", line);
    index = stderrBuffer.indexOf("\n");
  }
}

function emitInstallProgress(progress) {
  const phase = progress?.phase || "";
  if (phase === "download") {
    state.status = "dependency_downloading";
    state.statusText = "下载客户端";
  } else if (phase === "extract") {
    state.status = "dependency_extracting";
    state.statusText = "安装客户端";
  } else {
    state.status = "dependency_checking";
    state.statusText = "准备客户端";
  }
  state.lastError = "";
  pushEvent({ source: "plugin", type: state.status, message: installProgressMessage(progress), progress });
}

function installProgressMessage(progress) {
  const phase = progress?.phase || "";
  const percent = Number(progress?.percent || 0);
  if (phase === "download") {
    const total = Number(progress?.total || 0);
    return total ? `正在下载客户端 ${percent}%` : "正在下载客户端";
  }
  if (phase === "extract") return `正在安装客户端 ${percent}%`;
  return "正在准备客户端";
}

function getResponse(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "ZTools-ZosenLink-Tunnel/1.0.0",
        Accept: "application/json, application/octet-stream"
      }
    }, (res) => {
      const statusCode = res.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error("下载地址重定向次数过多"));
          return;
        }
        resolve(getResponse(new URL(res.headers.location, url).toString(), redirectCount + 1));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`请求失败: HTTP ${statusCode}`));
        return;
      }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error("网络请求超时")));
    req.on("error", reject);
  });
}

async function fetchJson(url) {
  const res = await getResponse(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function downloadFile(url, destination, version, onProgress) {
  const res = await getResponse(url);
  const total = Number(res.headers["content-length"] || 0);
  let downloaded = 0;
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    res.on("data", (chunk) => {
      downloaded += chunk.length;
      onProgress?.({
        phase: "download",
        version,
        downloaded,
        total,
        percent: total ? Math.round((downloaded / total) * 100) : 0
      });
    });
    res.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    res.pipe(output);
  });
}

async function fetchLatestClient() {
  const metadata = await fetchJson(CLIENT_REGISTRY_URL);
  const version = metadata?.["dist-tags"]?.latest;
  const latest = version && metadata.versions && metadata.versions[version];
  const tarball = latest?.dist?.tarball;
  if (!version || !tarball) {
    throw new Error("无法解析客户端最新版本");
  }
  return {
    version,
    tarball,
    shasum: latest.dist.shasum || ""
  };
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isSafeRelativePath(relativePath) {
  return Boolean(relativePath)
    && !path.isAbsolute(relativePath)
    && !relativePath.split(/[\\/]+/).includes("..");
}

function parseTarString(buffer, start, length) {
  const raw = buffer.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function parseTarOctal(buffer, start, length) {
  const value = parseTarString(buffer, start, length).trim();
  return value ? parseInt(value, 8) : 0;
}

function extractClientBinary(tgzPath, destination, onProgress) {
  onProgress?.({ phase: "extract", percent: 0 });
  const requiredBinary = `bin/${platformKey()}/${executableName()}`;
  const allowedFiles = new Set(["package.json", requiredBinary]);
  const tarBuffer = zlib.gunzipSync(fs.readFileSync(tgzPath));
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const name = parseTarString(tarBuffer, offset, 100);
    if (!name) break;
    const prefix = parseTarString(tarBuffer, offset + 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const mode = parseTarOctal(tarBuffer, offset + 100, 8);
    const size = parseTarOctal(tarBuffer, offset + 124, 12);
    const type = parseTarString(tarBuffer, offset + 156, 1) || "0";
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;

    if (entryName.startsWith(CLIENT_PACKAGE_PREFIX)) {
      const relativePath = entryName.slice(CLIENT_PACKAGE_PREFIX.length);
      if (type === "0" && allowedFiles.has(relativePath) && isSafeRelativePath(relativePath)) {
        const target = path.join(destination, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, tarBuffer.subarray(bodyStart, bodyEnd));
        if (mode) {
          try {
            fs.chmodSync(target, mode);
          } catch {
            // Ignore chmod failures on filesystems that do not support it.
          }
        }
      }
    }

    offset = bodyStart + Math.ceil(size / 512) * 512;
    onProgress?.({
      phase: "extract",
      percent: Math.min(100, Math.round((offset / tarBuffer.length) * 100))
    });
  }
}

function getLocalClientInfo(dir = clientDir()) {
  const file = path.join(dir, "bin", platformKey(), executableName());
  const meta = readJsonFile(path.join(dir, ".ztools-runtime.json"));
  const runtimePackage = readJsonFile(path.join(dir, "package.json"));
  return {
    installed: fs.existsSync(file),
    version: meta?.version || runtimePackage?.version || "",
    path: dir,
    executable: file
  };
}

function validateClientDir(dir) {
  const info = getLocalClientInfo(dir);
  if (!info.installed) {
    throw new Error(`客户端二进制文件不完整：bin/${platformKey()}/${executableName()}`);
  }
}

async function installClientRuntime(onProgress = emitInstallProgress) {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    fs.mkdirSync(cacheRoot(), { recursive: true });
    onProgress?.({ phase: "metadata", percent: 0 });
    const latest = await fetchLatestClient();
    const current = getLocalClientInfo();
    if (current.installed && current.version === latest.version) {
      ensureExecutable(current.executable);
      return current;
    }

    const tmpTgz = path.join(cacheRoot(), `zosenlink-core-${latest.version}-${Date.now()}.tgz`);
    const tmpClientDir = path.join(cacheRoot(), `.core-${process.pid}-${Date.now()}`);
    const backupDir = path.join(cacheRoot(), `.core-backup-${Date.now()}`);
    try {
      await downloadFile(latest.tarball, tmpTgz, latest.version, onProgress);
      if (latest.shasum) {
        const shasum = crypto.createHash("sha1").update(fs.readFileSync(tmpTgz)).digest("hex");
        if (shasum !== latest.shasum) {
          throw new Error("客户端下载校验失败");
        }
      }
      fs.rmSync(tmpClientDir, { recursive: true, force: true });
      fs.mkdirSync(tmpClientDir, { recursive: true });
      extractClientBinary(tmpTgz, tmpClientDir, onProgress);
      validateClientDir(tmpClientDir);
      fs.writeFileSync(path.join(tmpClientDir, ".ztools-runtime.json"), JSON.stringify({
        version: latest.version,
        tarball: latest.tarball,
        installedAt: new Date().toISOString()
      }, null, 2));

      if (fs.existsSync(clientDir())) {
        fs.renameSync(clientDir(), backupDir);
      }
      fs.renameSync(tmpClientDir, clientDir());
      fs.rmSync(backupDir, { recursive: true, force: true });
      const installed = getLocalClientInfo();
      ensureExecutable(installed.executable);
      onProgress?.({ phase: "done", version: latest.version, percent: 100 });
      return installed;
    } catch (error) {
      if (fs.existsSync(backupDir) && !fs.existsSync(clientDir())) {
        try {
          fs.renameSync(backupDir, clientDir());
        } catch {
          // Keep the original error.
        }
      }
      throw error;
    } finally {
      fs.rmSync(tmpTgz, { force: true });
      fs.rmSync(tmpClientDir, { recursive: true, force: true });
      fs.rmSync(backupDir, { recursive: true, force: true });
      installPromise = null;
    }
  })();
  return installPromise;
}

async function ensureClientRuntime() {
  const local = getLocalClientInfo();
  try {
    emitInstallProgress({ phase: "metadata", percent: 0 });
    const latest = await fetchLatestClient();
    if (local.installed && local.version === latest.version) {
      ensureExecutable(local.executable);
      return local;
    }
    return await installClientRuntime();
  } catch (error) {
    if (local.installed) {
      ensureExecutable(local.executable);
      pushEvent({
        source: "plugin",
        type: "dependency_update_warning",
        message: `客户端依赖更新检查失败，已使用本地版本：${normalizeError(error)}`
      });
      return local;
    }
    throw error;
  }
}

async function checkClientRuntime() {
  const local = getLocalClientInfo();
  try {
    const latest = await fetchLatestClient();
    const ready = local.installed && local.version === latest.version;
    return {
      ready,
      status: ready ? "ready" : (local.installed ? "outdated" : "missing"),
      version: local.version,
      latestVersion: latest.version,
      path: local.path,
      message: local.installed ? "客户端依赖有新版本可用" : "需要下载客户端依赖"
    };
  } catch (error) {
    return {
      ready: local.installed,
      status: local.installed ? "ready" : "error",
      version: local.version,
      latestVersion: "",
      path: local.path,
      offline: local.installed,
      message: local.installed ? "无法检查最新版本，已使用本地客户端" : normalizeError(error)
    };
  }
}

function hasMacQuarantine(file) {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", file], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch (error) {
    if (error && (error.status === 1 || error.code === 1)) return false;
    throw new Error(`检查客户端隔离属性失败：${normalizeError(error)}`);
  }
}

function removeMacQuarantine(file) {
  try {
    execFileSync("/usr/bin/xattr", ["-d", "com.apple.quarantine", file], {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    if (error && (error.status === 1 || error.code === 1)) return;
    throw new Error(`移除客户端隔离属性失败：${normalizeError(error)}`);
  }
}

function ensureExecutable(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`当前平台缺少客户端可执行文件：${platformKey()}，请先下载客户端依赖`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o755);
  }
  if (hasMacQuarantine(file)) {
    removeMacQuarantine(file);
  }
}

function commandMatchesExecutable(command, file) {
  const value = String(command || "").trim();
  if (!value.startsWith(file)) return false;
  const next = value.slice(file.length, file.length + 1);
  return next === "" || /\s/.test(next);
}

function normalizeWinPath(file) {
  return path.resolve(String(file || "")).toLowerCase();
}

function findDarwinClientPids(file) {
  const output = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const pids = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (child?.pid && pid === child.pid) continue;
    if (commandMatchesExecutable(match[2], file)) {
      pids.push(pid);
    }
  }
  return pids;
}

function findWin32ClientPids(file) {
  const processName = path.basename(file).replace(/'/g, "''");
  const command = [
    `$items = Get-CimInstance Win32_Process -Filter "Name='${processName}'"`,
    "| Select-Object ProcessId,ExecutablePath",
    "| ConvertTo-Json -Compress"
  ].join(" ");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const target = normalizeWinPath(file);
  return rows
    .filter((row) => row && normalizeWinPath(row.ExecutablePath) === target)
    .map((row) => Number(row.ProcessId))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && pid !== child?.pid);
}

function findExistingClientPids(file) {
  try {
    if (process.platform === "darwin") return findDarwinClientPids(file);
    if (process.platform === "win32") return findWin32ClientPids(file);
  } catch (error) {
    pushEvent({ source: "plugin", type: "cleanup_warning", message: `检查旧客户端进程失败：${normalizeError(error)}` });
  }
  return [];
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(80);
  }
  return !isProcessAlive(pid);
}

async function cleanupExistingClientProcesses(file) {
  if (child && !child.killed) {
    const trackedPid = child.pid;
    terminateChild("启动前停止旧客户端进程", true);
    if (trackedPid) {
      await waitForExit(trackedPid, 1200);
    }
  }

  const files = [...new Set([file, legacyExecutablePath()])];
  const pids = [...new Set(files.flatMap((item) => findExistingClientPids(item)))];
  if (!pids.length) return;
  pushEvent({ source: "plugin", type: "cleanup", message: `启动前清理旧客户端进程：${pids.join(", ")}` });
  for (const pid of pids) {
    killPid(pid, "SIGTERM");
  }
  for (const pid of pids) {
    if (!(await waitForExit(pid, 1200))) {
      killPid(pid, "SIGKILL");
    }
  }
}

function terminateChild(reason, detach) {
  const target = child;
  if (!target) {
    return false;
  }
  pushEvent({ source: "plugin", type: "stopping", message: reason || "正在停止客户端进程" });
  if (detach) {
    target.removeAllListeners("exit");
    target.stdout?.removeAllListeners("data");
    target.stderr?.removeAllListeners("data");
    target.removeAllListeners("error");
    child = null;
  }
  target.kill("SIGTERM");
  clearTimeout(killTimer);
  killTimer = setTimeout(() => {
    if (target.exitCode === null && target.signalCode === null) {
      target.kill("SIGKILL");
    }
  }, 1500);
  return true;
}

async function start(key) {
  const activationKey = assertActivationKey(key);
  let file = "";
  try {
    const runtime = await ensureClientRuntime();
    file = runtime.executable;
    await cleanupExistingClientProcesses(file);
  } catch (error) {
    state.status = "error";
    state.statusText = "错误";
    state.lastError = normalizeError(error);
    pushEvent({ source: "plugin", type: "error", error: state.lastError });
    throw error;
  }

  stdoutBuffer = "";
  stderrBuffer = "";
  clearTimeout(killTimer);
  killTimer = null;
  state = {
    ...state,
    running: true,
    pid: null,
    status: "starting",
    statusText: "启动中",
    startedAt: new Date().toISOString(),
    exitedAt: null,
    exitCode: null,
    signal: null,
    lastError: "",
    events: []
  };

  child = spawn(file, [activationKey], {
    cwd: path.dirname(file),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  state.pid = child.pid || null;
  pushEvent({ source: "plugin", type: "started", message: "客户端进程已启动" });

  child.stdout.on("data", consumeStdout);
  child.stderr.on("data", consumeStderr);
  child.on("error", (error) => {
    state.status = "error";
    state.statusText = "错误";
    state.lastError = normalizeError(error);
    pushEvent({ source: "plugin", type: "error", error: state.lastError });
  });
  child.on("exit", (code, signal) => {
    child = null;
    clearTimeout(killTimer);
    killTimer = null;
    state.running = false;
    state.pid = null;
    state.exitedAt = new Date().toISOString();
    state.exitCode = code;
    state.signal = signal;
    if (stdoutBuffer.trim()) {
      appendRawOutput("stdout", stdoutBuffer);
      stdoutBuffer = "";
    }
    if (stderrBuffer.trim()) {
      appendRawOutput("stderr", stderrBuffer);
      stderrBuffer = "";
    }
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
      state.status = "stopped";
      state.statusText = "已停止";
    } else {
      state.status = "error";
      state.statusText = "错误";
      state.lastError = state.lastError || `客户端异常退出：${code ?? signal}`;
    }
    pushEvent({ source: "plugin", type: "stopped", message: "客户端进程已退出", code, signal });
  });

  notify();
  return getStatus();
}

function stop() {
  terminateChild("正在停止客户端进程", false);
  return getStatus();
}

function getStatus() {
  const runtime = getLocalClientInfo();
  return {
    ...state,
    platform: process.platform,
    arch: process.arch,
    platformKey: platformKey(),
    platformURL: PLATFORM_URL,
    runtimeInstalled: runtime.installed,
    runtimeVersion: runtime.version,
    runtimePath: runtime.path,
    events: state.events.slice()
  };
}

function clearEvents() {
  state.events = [];
  notify();
  return getStatus();
}

function reset() {
  terminateChild("正在解绑并停止客户端进程", true);
  stdoutBuffer = "";
  stderrBuffer = "";
  state = {
    ...state,
    running: false,
    pid: null,
    status: "idle",
    statusText: "未绑定",
    startedAt: null,
    exitedAt: null,
    exitCode: null,
    signal: null,
    lastError: "",
    clientId: "",
    kernelVersion: "",
    configVersion: 0,
    frpsServer: "",
    mappings: []
  };
  notify();
  return getStatus();
}

function onStatusChange(listener) {
  if (typeof listener !== "function") return;
  listeners.push(listener);
  listener(getStatus());
}

window.zosenlinkTunnel = {
  start,
  stop,
  getStatus,
  checkClientRuntime,
  installClientRuntime,
  clearEvents,
  reset,
  onStatusChange
};

window.ztools.onPluginEnter((param) => {
  window.dispatchEvent(
    new CustomEvent("zosenlink-tunnel:plugin-enter", {
      detail: param
    })
  );
});

window.ztools.onPluginOut((isKill) => {
  if (isKill) {
    reset();
  }
});
