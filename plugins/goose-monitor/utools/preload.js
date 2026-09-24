if (window.ztools) {
  window.utools = window.ztools
}

/* ProcKill uTools preload —— 在 Node 环境实现进程枚举 / 合并 / kill。
   暴露 window.gooseMonitor 给前端 bridge 调用。源码保持可读（uTools 审核要求，不混淆）。 */
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const path = require("node:path");
const { inferRole, linuxExecutableFromCommand, findExecutableTreeRootPid, serviceDisplayName, macProcessFields, inheritBundleExecutables } = require("./process-role.cjs");
const {
  QUERY_PREF_KEY,
  QUERY_LEFT_AT_PREF_KEY,
  resolveEntryQuery,
  resolvePersistedQuery,
} = require("./plugin-state.cjs");
const { getVisibleWindowPids } = require("./window-provider.cjs");
const { collectNettop, probeNettop, aggregateNetworkUsage } = require("./network-provider.cjs");
const { collectListenPorts, attachListenPorts } = require("./port-provider.cjs");

const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// uTools 启动的 Node 进程常继承空 locale（LANG/LC_ALL 为空）。此时 BSD `ps` 会对进程名/路径里
// 的非 ASCII 字节做 vis(3) 转义，把「企业微信」(UTF-8 E4 BC 81…) 字面输出成 `M-dM-<M^A…`，
// 前端直接显示这串乱码。强制一个 UTF-8 locale 即可让 ps 原样透传 UTF-8 字节。
// mac 用一定存在的 en_US.UTF-8；Linux 用更通用的 C.UTF-8。Windows 走 PowerShell，不受影响。
const UNIX_ENV = IS_WIN ? process.env : {
  ...process.env,
  LC_ALL: IS_MAC ? "en_US.UTF-8" : "C.UTF-8",
  LANG: IS_MAC ? "en_US.UTF-8" : "C.UTF-8",
};

// 异步跑 shell 命令（不阻塞事件循环）。失败抛错由调用方兜底。
function shAsync(cmd, args, maxBuffer) {
  return execFileAsync(cmd, args, {
    encoding: "utf8",
    maxBuffer: maxBuffer || 32 * 1024 * 1024,
    env: UNIX_ENV,
  }).then((r) => r.stdout);
}

function monogramFor(name) {
  const cleaned = name.replace(/\.(app|exe)$/i, "").trim();
  const words = cleaned.split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || cleaned;
  return w.slice(0, w.length >= 2 ? 2 : 1);
}
function appBundle(exe) {
  if (!exe) return null;
  const idx = exe.indexOf(".app/");
  if (idx >= 0) {
    const bundle = exe.slice(0, idx + 4);
    return { bundle, name: path.basename(bundle, ".app") };
  }
  if (exe.endsWith(".app")) return { bundle: exe, name: path.basename(exe, ".app") };
  return null;
}
function isSystemPath(exe, name) {
  if (!exe) return true;
  if (name === "kernel_task") return true;
  if (IS_WIN) return /\\windows\\/i.test(exe) || /\\system32\\/i.test(exe);
  // mac / linux 系统守护进程目录
  return exe.startsWith("/usr/sbin/") || exe.startsWith("/usr/libexec/") ||
    exe.startsWith("/sbin/") || exe.startsWith("/System/") ||
    exe.startsWith("/Library/") || exe.startsWith("/lib/") || exe.startsWith("/bin/");
}

// 判断进程路径是否属于图形应用。
// 关键：macOS 大量系统守护进程也住在 .app bundle 内（如 XProtect、liquiddetectiond、
// com.apple.* 的 XPC/扩展服务），但它们装在 /System/、/Library/、/usr/ 下，并非用户应用。
// 仅凭 .app 子串匹配会把系统服务误判为用户应用，故系统/库目录下的 .app 不参与前台应用判定。
function isGraphicalApp(exe) {
  if (!exe) return false;
  if (exe.includes(".app/") || exe.endsWith(".app")) {
    const inSystemDir = exe.startsWith("/System/") ||
      exe.startsWith("/Library/") || exe.startsWith("/usr/");
    return !inSystemDir;
  }
  if (IS_WIN) {
    const low = exe.toLowerCase();
    return low.includes("\\program files") ||
      (low.endsWith(".exe") && (low.includes("\\users\\") || low.includes("\\appdata\\")));
  }
  // Linux 图形应用常见安装位置，排除工具链/CLI 常驻的 .../bin/ 目录。
  const isToolchain = exe.includes("/bin/") &&
    (exe.includes("homebrew") || exe.includes("/rh/") || exe.includes("/node") ||
     exe.includes("python") || exe.includes("ruby"));
  if (isToolchain) return false;
  return exe.includes("/snap/") || exe.includes("/opt/") ||
    exe.includes("/.local/share/applications") || exe.includes("/usr/share/applications");
}

/* ---- 真实应用图标抓取 ----
   macOS：定位 .app bundle → 读 Info.plist 的 CFBundleIconFile（PlistBuddy）→ sips 转
          64×64 PNG → base64 data URL，交前端 <img> 显示真实图标；失败缓存 null 降级字形方块。
   Windows / Linux：暂未实现真实抓取，缓存 null 降级。
   缓存按 bundle/exe 路径去重，含「已失败」负缓存，避免每次刷新重复跑 sips（开销大）。 */
const fs = require("node:fs");
const ICON_CACHE = new Map(); // path -> data URL | null（null=已尝试且失败）

function bundleRootMac(p) {
  if (!p) return null;
  const idx = p.indexOf(".app/");
  if (idx >= 0) return p.slice(0, idx + 4);
  if (p.endsWith(".app")) return p;
  return null;
}

// 在 bundle 内定位主图标 .icns：① 读 Info.plist 的 CFBundleIconFile；② 退化为 Resources 下第一个 .icns。
async function locateIcns(bundle) {
  const resources = path.join(bundle, "Contents/Resources");
  const plist = path.join(bundle, "Contents/Info.plist");
  if (fs.existsSync(plist)) {
    try {
      const name = (await shAsync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", plist], 1 << 20)).trim();
      if (name) {
        const fname = /\.icns$/i.test(name) ? name : name + ".icns";
        const candidate = path.join(resources, fname);
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch (_) { /* 无该键或解析失败，走退化 */ }
  }
  try {
    for (const f of fs.readdirSync(resources)) {
      if (/\.icns$/i.test(f)) return path.join(resources, f);
    }
  } catch (_) { /* Resources 不存在 */ }
  return null;
}

// 临时文件名唯一序号：缓存检查与抓取之间存在窗口，同一 icns 可能被并发抓取两次，
// 唯一序号保证各写各的临时文件，避免并发 sips 写同一文件互相污染读到半截 PNG。
let TMP_SEQ = 0;

// 用系统 sips 把 .icns 转 64×64 PNG 临时文件，读回 base64（sips 不支持写 stdout）。
async function icnsToDataUrl(icns) {
  const tmp = path.join(os.tmpdir(), "prockill-icon-" + simpleHash(icns) + "-" + (TMP_SEQ++) + ".png");
  try {
    await shAsync("sips", ["-s", "format", "png", "-z", "64", "64", icns, "--out", tmp], 1 << 20);
    const buf = fs.readFileSync(tmp);
    return "data:image/png;base64," + buf.toString("base64");
  } catch (_) {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// 取一个应用路径的真实图标 data URL，命中缓存（含负缓存）即返回。失败返回 null。
async function iconDataUrl(appPath) {
  if (!appPath) return null;
  if (ICON_CACHE.has(appPath)) return ICON_CACHE.get(appPath);
  let result = null;
  if (IS_MAC) {
    const bundle = bundleRootMac(appPath);
    if (bundle) {
      const icns = await locateIcns(bundle);
      if (icns) result = await icnsToDataUrl(icns);
    }
  }
  // Windows 可用 win-icon-extractor，Linux 解析 .desktop + 主题图标（后续）。
  ICON_CACHE.set(appPath, result);
  return result;
}

// 给一批行并发补充真实图标（仅 GUI/非 sys 行；sys 行用字形方块即可）。
// 已带缓存，重复刷新基本零开销；首轮并发抓取，单个失败不影响其它行。
async function attachIcons(rows) {
  if (!IS_MAC) return rows; // 目前仅 macOS 抓真实图标
  await Promise.all(rows.map(async (r) => {
    if (r.sys) return;
    const url = await iconDataUrl(r.path);
    if (url) r.iconUrl = url;
  }));
  return rows;
}

/* ---- 采集原始进程（异步，不阻塞事件循环）---- */
async function rawProcsUnix() {
  // mac comm= 可能是带空格的完整 .app 路径，不能和 args= 写在同一行用 \S+ 切开。
  // 分两次采：comm 作 exe/name，args 作 commandLine（搜端口 / 认 -jar）。
  if (IS_MAC) {
    const [commOut, argsOut] = await Promise.all([
      shAsync("ps", ["-axwwo", "pid=,ppid=,pcpu=,rss=,lstart=,comm="], 32 * 1024 * 1024),
      shAsync("ps", ["-axwwo", "pid=,args="], 32 * 1024 * 1024),
    ]);
    const argsByPid = new Map();
    for (const line of argsOut.split("\n")) {
      const am = line.match(/^\s*(\d+)\s+(.*)$/);
      if (am) argsByPid.set(+am[1], (am[2] || "").trim());
    }
    const list = [];
    for (const line of commOut.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
      if (!m) continue;
      const fields = macProcessFields((m[6] || "").trim(), argsByPid.get(+m[1]) || "");
      list.push({
        pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3]) || 0,
        memMb: (+m[4]) / 1024, startedAt: m[5],
        exe: fields.exe, name: fields.name, commandLine: fields.commandLine,
      });
    }
    inheritBundleExecutables(list);
    return list;
  }
  // Linux：comm 在前（无空格短名），args 在后（含路径的完整命令行）
  const out = await shAsync("ps", ["-axwwo", "pid=,ppid=,pcpu=,rss=,lstart=,comm=,args="], 32 * 1024 * 1024);
  const list = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const name = m[6].trim();           // comm，稳定短名
    const commandLine = (m[7] || "").trim();
    const exe = linuxExecutableFromCommand(name, commandLine);
    list.push({
      pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3]) || 0,
      memMb: (+m[4]) / 1024, startedAt: m[5], exe, name,
      commandLine,
    });
  }
  return list;
}
async function rawProcsWin() {
  // 进程基础信息（路径/父子/内存）来自 Win32_Process；
  // CPU% 来自 Win32_PerfFormattedData_PerfProc_Process 的 PercentProcessorTime（已格式化，
  // 无需两次采样），按 IDProcess 关联。再除以逻辑核数归一到 0-100。
  const ps = [
    // 强制 stdout 为 UTF-8：否则 Win PowerShell 默认用控制台代码页（如 GBK/936）输出，
    // 中文进程名（如「企业微信」）的 UTF-8 字节会被 Node 的 utf8 解码读成乱码
    // （表现为 M-dM-<M-^A… 这类 latin1 风格高位字节）。与下方 shAsync 的 encoding:"utf8" 对齐。
    // try/catch：stdout 被重定向到管道（execFile 即如此）时，PS 5.x 设 OutputEncoding 可能抛
    // 「handle is invalid」，吞掉即可，不让采集整体失败。
    "try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {};",
    "$OutputEncoding = [Text.UTF8Encoding]::new($false);",
    "$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;",
    "if (-not $cores) { $cores = 1 }",
    "$perf = @{};",
    // 排除 _Total / Idle 伪实例（IDProcess=0，值为 ~100*cores），避免污染真实进程
    "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -gt 0 } | ForEach-Object { $perf[[int]$_.IDProcess] = [double]$_.PercentProcessorTime };",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $c = $perf[[int]$_.ProcessId]; if (-not $c) { $c = 0 }",
    "  [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; startedAt=$_.CreationDate; mem=$_.WorkingSetSize; exe=$_.ExecutablePath; name=$_.Name; commandLine=$_.CommandLine; cpu=[math]::Round($c / $cores, 1) }",
    "} | ConvertTo-Json -Compress",
  ].join(" ");
  const out = await shAsync("powershell", ["-NoProfile", "-Command", ps], 64 * 1024 * 1024);
  let arr = JSON.parse(out);
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((p) => ({
    pid: p.pid, ppid: p.ppid || 0, cpu: p.cpu || 0,
    startedAt: String(p.startedAt || ""),
    memMb: (p.mem || 0) / 1024 / 1024,
    exe: p.exe || "", name: p.name || "", commandLine: p.commandLine || "",
  }));
}
async function rawProcs() {
  try {
    return IS_WIN ? await rawProcsWin() : await rawProcsUnix();
  } catch (e) {
    console.error("[ProcKill] rawProcs failed", e);
    throw e;
  }
}

/* ---- 合并 ---- */
function merge(raw) {
  const groups = new Map();
  const byPid = new Map(raw.map((p) => [p.pid, p]));
  for (const p of raw) {
    const ab = appBundle(p.exe);
    // gui：分组键命中 app bundle 即视为界面进程候选（与后端 collect_raw 一致，
    // 系统目录下 .app 的最终排除交由 listByCategory 的 isGui 把关）；否则按 exe 路径判定。
    let key, identity, display, bundle, graphical;
    if (ab) {
      identity = "app:" + ab.bundle;
      key = identity;
      display = ab.name;
      bundle = ab.bundle;
      graphical = true;
    } else if (p.exe) {
      // 非 bundle 程序只归并同一 exe 的同一棵进程树，避免把两个独立的
      // node/python 实例或同目录的不同程序一起结束。
      const rootPid = findExecutableTreeRootPid(p, byPid);
      identity = "exe:" + p.exe;
      key = identity + "#" + rootPid;
      display = serviceDisplayName(p.name, p.commandLine);
      bundle = p.exe;
      graphical = isGraphicalApp(p.exe);
    } else {
      identity = "name:" + p.name;
      key = identity + "#" + p.pid;
      display = serviceDisplayName(p.name, p.commandLine);
      bundle = "";
      graphical = false;
    }
    // systemOwned 独立于后台分类：Finder 等图形系统应用不是后台进程，
    // 但真实图标缺失时仍应显示系统图标，而不是普通应用占位图标。
    const systemOwned = isSystemPath(p.exe, p.name);
    const sys = systemOwned && !graphical;
    if (!groups.has(key)) groups.set(key, { key, identity, display, bundle, members: [], sys, systemOwned });
    const group = groups.get(key);
    group.sys = group.sys || sys;
    group.systemOwned = group.systemOwned || systemOwned;
    group.members.push(p);
  }
  const rows = [];
  for (const g of groups.values()) {
    if (!g.members.length) continue;
    g.members.sort((a, b) => b.memMb - a.memMb);
    const main = g.members[0];
    const totalCpu = g.members.reduce((a, m) => a + m.cpu, 0);
    const totalMem = g.members.reduce((a, m) => a + m.memMb, 0);
    const allPids = g.members.map((m) => m.pid);
    const helpers = g.members.length > 1
      ? g.members.map((m, i) => ({
          name: m.name, role: inferRole(m.name, m.commandLine, i === 0),
          cpu: Math.round(m.cpu * 10) / 10, mem: m.memMb, pid: m.pid,
        }))
      : [];
    const snapshotToken = simpleHash(g.members
      .map((p) => `${p.pid}:${p.startedAt || "unknown"}`)
      .sort()
      .join(","));
    rows.push({
      id: "g" + simpleHash(g.key), identity: g.identity, name: g.display,
      snapshotToken,
      monogram: monogramFor(g.display),
      procs: g.members.length,
      cpu: Math.round(totalCpu * 10) / 10, mem: totalMem,
      pid: main.pid, path: g.bundle || main.exe,
      commandLine: main.commandLine || "",
      helpers, sys: g.sys || undefined, systemOwned: g.systemOwned || undefined, allPids,
    });
  }
  return rows;
}

async function listByCategory(category) {
  const [raw, portsByPid] = await Promise.all([
    rawProcs(),
    collectListenPorts().catch((error) => {
      console.error("[ProcKill] collectListenPorts failed", error);
      return new Map();
    }),
  ]);
  let rows = merge(raw);
  attachListenPorts(rows, portsByPid);

  if (category === "bg") {
    rows = rows.filter((r) => r.sys);
  } else if (category === "cpu") {
    rows.sort((a, b) => b.cpu - a.cpu);
    return await attachIcons(rows);
  }
  rows.sort((a, b) => b.mem - a.mem);
  return await attachIcons(rows);
}

let guiCapabilityPromise = null;
let networkCapabilityPromise = null;

function capabilityError(error) {
  return String((error && error.message) || error || "未知错误");
}

function getGuiCapability() {
  if (process.platform !== "darwin" && process.platform !== "win32") return Promise.resolve({ status: "unsupported" });
  if (!guiCapabilityPromise) {
    guiCapabilityPromise = getVisibleWindowPids().then(() => ({ status: "supported" }))
      .catch((error) => ({ status: "unavailable", error: capabilityError(error) }));
  }
  return guiCapabilityPromise;
}

async function getGuiSnapshot() {
  try {
    const pids = await getVisibleWindowPids();
    return { status: "supported", sampledAt: Date.now(), pids };
  } catch (error) {
    return { status: "error", sampledAt: Date.now(), pids: [], error: capabilityError(error) };
  }
}

function getNetworkCapability() {
  if (!IS_MAC) return Promise.resolve({ status: "unsupported" });
  if (!networkCapabilityPromise) {
    networkCapabilityPromise = probeNettop().then(() => ({ status: "supported" }))
      .catch((error) => ({ status: "unavailable", error: capabilityError(error) }));
  }
  return networkCapabilityPromise;
}

async function getNetworkSnapshot() {
  const sampledAt = Date.now();
  try {
    const [before, portsByPid] = await Promise.all([
      rawProcs(),
      collectListenPorts().catch((error) => {
        console.error("[ProcKill] collectListenPorts failed", error);
        return new Map();
      }),
    ]);
    const rates = await collectNettop();
    const after = await rawProcs();
    const rows = merge(after);
    attachListenPorts(rows, portsByPid);
    const apps = aggregateNetworkUsage(rows, rates, before, after);
    await attachIcons(apps.map((item) => item.app));
    return { status: "supported", sampledAt, windowMs: 1000, apps };
  } catch (error) {
    return { status: "error", sampledAt, apps: [], error: capabilityError(error) };
  }
}

// 递归收集 pid 的所有后代（Unix；用本次 killProcess 已拿到的 raw 建父子表，不再 execSync）。
function descendantsUnix(rootPids, raw) {
  const childMap = new Map();
  for (const p of raw) {
    if (!childMap.has(p.ppid)) childMap.set(p.ppid, []);
    childMap.get(p.ppid).push(p.pid);
  }
  const result = new Set();
  const stack = [...rootPids];
  while (stack.length) {
    const p = stack.pop();
    if (result.has(p)) continue;
    result.add(p);
    for (const c of childMap.get(p) || []) if (!result.has(c)) stack.push(c);
  }
  return [...result];
}

async function killProcess(id, snapshotToken, pids) {
  const SELF = process.pid;
  const raw = await rawProcs();
  const current = merge(raw).find((row) => row.id === id && row.snapshotToken === snapshotToken);
  const expected = new Set(Array.isArray(pids) ? pids : []);

  // 保护 uTools/Codex 宿主链：结束任一祖先都可能连带关闭当前插件。
  const byPid = new Map(raw.map((p) => [p.pid, p]));
  const protectedPids = new Set([SELF, 0, 1]);
  let ancestor = byPid.get(SELF)?.ppid;
  while (ancestor && !protectedPids.has(ancestor)) {
    protectedPids.add(ancestor);
    ancestor = byPid.get(ancestor)?.ppid;
  }

  // 只接受仍属于同一分组、且用户确认时就存在的 PID。PID 已复用到别组会被拒绝。
  let targets = current
    ? current.allPids.filter((p) => expected.has(p) && !protectedPids.has(p))
    : [];
  if (!targets.length) {
    return { ok: false, killed: [], error: "目标已变化、已退出或属于受保护进程，请刷新后重试" };
  }

  const killed = [];
  const errors = [];

  if (IS_WIN) {
    // taskkill /T 会递归处理子进程，因此只提交组内没有目标祖先的根，避免重复终止被误报失败。
    const targetSet = new Set(targets);
    const roots = targets.filter((pid) => {
      let parent = byPid.get(pid)?.ppid;
      const seen = new Set();
      while (parent && !seen.has(parent)) {
        if (targetSet.has(parent)) return false;
        seen.add(parent);
        parent = byPid.get(parent)?.ppid;
      }
      return true;
    });
    for (const p of roots) {
      try {
        // taskkill /T 递归杀进程树（异步，不阻塞事件循环）
        await execFileAsync("taskkill", ["/T", "/F", "/PID", String(p)], { stdio: "ignore" });
        killed.push(p);
      } catch (e) {
        errors.push(`PID ${p}: ${String((e && e.message) || e)}`);
      }
    }
  } else {
    // 先递归展开整棵树，再统一 SIGKILL。
    const all = descendantsUnix(targets, raw).filter((p) => p !== SELF && p > 1);
    // 先杀子后杀父，减少重新派生
    all.sort((a, b) => b - a);
    for (const p of all) {
      try {
        process.kill(p, "SIGKILL");
        killed.push(p);
      } catch (e) {
        // ESRCH（已退出）也算目标不在
        if (e && e.code === "ESRCH") killed.push(p);
        else errors.push(`PID ${p}: ${String((e && e.message) || e)}`);
      }
    }
  }

  if (errors.length) return { ok: false, killed, error: errors.join("；") };
  if (!killed.length) return { ok: false, killed, error: "没有进程被结束（目标可能已变化）" };
  return { ok: true, killed };
}

window.gooseMonitor = {
  getRuntimePlatform: () => IS_MAC ? "mac" : IS_WIN ? "win" : "linux",
  getGuiCapability,
  getGuiSnapshot,
  getNetworkCapability,
  getNetworkSnapshot,
  listProcesses: (category) => Promise.resolve(listByCategory(category)),
  killProcess: (id, snapshotToken, pids) => killProcess(id, snapshotToken, pids),
};

/* ============================================================
   uTools 接入层（仅在 uTools 环境生效，开发态/普通浏览器自动跳过）
   - 监听插件进入：把主输入框带进来的关键词交给前端过滤
   - 接管 uTools 子输入框：用户在 uTools 顶部输入框打字 → 实时过滤前端列表
   前端契约（main.ts 实现，挂在 window 上）：
     · window.__prockillEnter(keyword: string)   —— 进入时调用一次，keyword 为初始搜索词（无词时传 ""）
     · window.__prockillSubInput(text: string)    —— uTools 子输入框每次变化时调用并实时过滤
   注意：preload 与插件页面共享同一个 window，故可直接读写 window.__prockill*。
   ============================================================ */
(function setupUtoolsBridge() {
  // 非 uTools 环境（开发态）utools 不存在，直接返回，不报错
  if (typeof utools === "undefined" || !utools) return;

  // 把初始关键词交给前端过滤。前端钩子可能晚于 preload 注册，
  // 故做一次轮询重试，命中即停（最多约 3 秒），避免进入瞬间钩子尚未挂载而丢词。
  // 用单一 timer + pending 关键词：多次快速进入只保留最后一次，避免并存的多个 timer
  // 让旧关键词在新关键词之后触发、反写出错误状态。
  var enterTimer = null;
  var pendingKeyword = "";
  function pushEnterKeyword(keyword) {
    pendingKeyword = keyword;
    // 钩子已就绪（多数情况：插件已打开后再次带词进入）→ 立即同步调用，无 100ms 延迟
    if (typeof window.__prockillEnter === "function") {
      if (enterTimer !== null) { clearInterval(enterTimer); enterTimer = null; }
      try { window.__prockillEnter(pendingKeyword); } catch (e) { console.error("[ProcKill] __prockillEnter 调用失败", e); }
      return;
    }
    if (enterTimer !== null) return; // 已有 timer 在跑，它会消费最新的 pendingKeyword
    let tries = 0;
    enterTimer = setInterval(() => {
      tries += 1;
      if (typeof window.__prockillEnter === "function") {
        try { window.__prockillEnter(pendingKeyword); } catch (e) { console.error("[ProcKill] __prockillEnter 调用失败", e); }
        clearInterval(enterTimer); enterTimer = null;
      } else if (tries >= 30) {
        clearInterval(enterTimer); enterTimer = null;
      }
    }, 100);
  }

  // 接管 uTools 顶部子输入框为我们的搜索框：顶部输入 → 实时过滤前端列表。
  // 关键：setSubInput 必须在 onPluginEnter 回调内调用、且每次进入都重新设置——
  // uTools 的机制是"进入插件后主输入框才变子输入框"，在 IIFE 顶层提前注册不可靠，
  // 会导致子输入框不显示（参考 goose-note preload.cjs 的实现）。第三参 true=聚焦。
  function installSubInput() {
    if (typeof utools.setSubInput !== "function") return;
    try {
      utools.setSubInput(({ text }) => {
        if (typeof utools.dbStorage?.setItem === "function") {
          utools.dbStorage.setItem(QUERY_PREF_KEY, String(text || "").slice(0, 200));
        }
        if (typeof window.__prockillSubInput === "function") {
          try { window.__prockillSubInput(text || ""); } catch (e) { console.error("[ProcKill] __prockillSubInput 调用失败", e); }
        }
      }, "过滤应用或进程…", true);
    } catch (e) {
      console.error("[ProcKill] setSubInput 失败", e);
    }
  }

  // 监听插件进入：text 表示无搜索词；regex/over 会带入搜索词。
  // 关闭超过 5 分钟再进入时清空历史筛选，subInput 与列表都显示全部。
  if (typeof utools.onPluginEnter === "function") {
    utools.onPluginEnter((entry) => {
      // 必须在 setSubInput 前读取；部分宿主会在安装回调时先发送空文本。
      let savedQuery = "";
      if (typeof utools.dbStorage?.getItem === "function") {
        const rawQuery = utools.dbStorage.getItem(QUERY_PREF_KEY);
        const leftAt = utools.dbStorage.getItem(QUERY_LEFT_AT_PREF_KEY);
        savedQuery = resolvePersistedQuery(rawQuery, leftAt);
        // 过期则写回空串，避免前端 init / 下次进入仍读到旧词。
        if (savedQuery !== String(rawQuery || "").slice(0, 200)) {
          try { utools.dbStorage.setItem(QUERY_PREF_KEY, ""); } catch (e) { /* 忽略 */ }
        }
      }
      // 每次进入都重新接管子输入框（uTools 退出/再进会清掉上次的 subInput）
      installSubInput();
      const keyword = resolveEntryQuery(entry, savedQuery);
      pushEnterKeyword(keyword);
      // 进入时把显式关键词或历史筛选同步回宿主输入框。
      if (typeof utools.setSubInputValue === "function") {
        try { utools.setSubInputValue(keyword); } catch (e) { /* 子输入框可能尚未就绪，忽略 */ }
      }
    });
  } else {
    // 极少数无 onPluginEnter 的环境，退化为顶层注册一次
    installSubInput();
  }

  // 插件退出：记离开时间 + 移除子输入框接管，避免残留到其它插件/主界面
  if (typeof utools.onPluginOut === "function") {
    utools.onPluginOut(() => {
      if (typeof utools.dbStorage?.setItem === "function") {
        try { utools.dbStorage.setItem(QUERY_LEFT_AT_PREF_KEY, String(Date.now())); } catch (e) { /* 忽略 */ }
      }
      if (typeof utools.removeSubInput === "function") {
        try { utools.removeSubInput(); } catch (e) { /* 忽略 */ }
      }
    });
  }
})();
