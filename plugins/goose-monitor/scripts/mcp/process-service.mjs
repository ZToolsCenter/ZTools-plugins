import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const UNIX_ENV = IS_WINDOWS ? process.env : {
  ...process.env,
  LC_ALL: IS_MAC ? "en_US.UTF-8" : "C.UTF-8",
  LANG: IS_MAC ? "en_US.UTF-8" : "C.UTF-8",
};

const PALETTE = ["#4488F4", "#2C8FE0", "#A259FF", "#1DB954", "#FA4D6A", "#F5B544"];

async function command(file, args, maxBuffer = 32 * 1024 * 1024) {
  const { stdout } = await execFile(file, args, { encoding: "utf8", maxBuffer, env: UNIX_ENV });
  return stdout;
}

function hash(value) {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result.toString(36);
}

function snapshotToken(members) {
  return createHash("sha256")
    .update(members.map((member) => `${member.pid}:${member.startedAt}`).sort().join(","))
    .digest("hex");
}

function monogram(name) {
  const words = name.replace(/\.(app|exe)$/i, "").trim().split(/[\s_-]+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : (words[0] || "?").slice(0, 2);
}

function appBundle(executable) {
  const index = executable.indexOf(".app/");
  if (index >= 0) {
    const bundle = executable.slice(0, index + 4);
    return { bundle, name: path.basename(bundle, ".app") };
  }
  return executable.endsWith(".app") ? { bundle: executable, name: path.basename(executable, ".app") } : null;
}

function isSystemPath(executable, name) {
  if (!executable || name === "kernel_task") return true;
  if (IS_WINDOWS) return /\\(?:windows|system32)\\/i.test(executable);
  return ["/usr/sbin/", "/usr/libexec/", "/sbin/", "/System/", "/Library/", "/lib/", "/bin/"].some((prefix) => executable.startsWith(prefix));
}

function isGui(executable) {
  if (!executable) return false;
  if (executable.includes(".app/") || executable.endsWith(".app")) return !["/System/", "/Library/", "/usr/"].some((prefix) => executable.startsWith(prefix));
  if (IS_WINDOWS) return /\\(?:program files|users|appdata)\\/i.test(executable) && /\.exe$/i.test(executable);
  return ["/snap/", "/opt/", "/.local/share/applications", "/usr/share/applications"].some((part) => executable.includes(part));
}

function role(name, isMain) {
  if (isMain) return "主进程";
  const lower = name.toLowerCase();
  if (lower.includes("gpu")) return "GPU";
  if (lower.includes("renderer")) return "渲染进程";
  if (lower.includes("network")) return "网络服务";
  if (lower.includes("helper")) return "辅助进程";
  return "子进程";
}

async function rawUnixProcesses() {
  const fields = IS_MAC
    ? ["-axwwo", "pid=,ppid=,pcpu=,rss=,lstart=,comm="]
    : ["-axwwo", "pid=,ppid=,pcpu=,rss=,lstart=,comm=,args="];
  const output = await command("ps", fields);
  const expression = IS_MAC
    ? /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/
    : /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(\S+)\s*(.*)$/;
  return output.split("\n").flatMap((line) => {
    const match = line.match(expression);
    if (!match) return [];
    const executable = (IS_MAC ? match[6] : match[7])?.trim() || match[6].trim();
    const name = IS_MAC ? path.basename(executable) || executable : match[6].trim();
    return [{ pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]) || 0, mem: Number(match[4]) / 1024, startedAt: match[5], executable, name }];
  });
}

async function rawWindowsProcesses() {
  const script = [
    "$OutputEncoding=[Text.UTF8Encoding]::new($false)",
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;ppid=$_.ParentProcessId;mem=$_.WorkingSetSize;exe=$_.ExecutablePath;name=$_.Name;startedAt=$_.CreationDate} } | ConvertTo-Json -Compress",
  ].join("; ");
  const output = await command("powershell", ["-NoProfile", "-Command", script], 64 * 1024 * 1024);
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
    pid: Number(item.pid), ppid: Number(item.ppid) || 0, cpu: 0, mem: Number(item.mem || 0) / 1024 / 1024,
    executable: item.exe || "", name: item.name || "", startedAt: String(item.startedAt || ""),
  }));
}

export async function rawProcesses() {
  return IS_WINDOWS ? rawWindowsProcesses() : rawUnixProcesses();
}

export function mergeProcesses(raw) {
  const byPid = new Map(raw.map((process) => [process.pid, process]));
  const groups = new Map();
  for (const process of raw) {
    const bundle = appBundle(process.executable);
    let key; let identity; let display; let appPath; let gui;
    if (bundle) {
      identity = `app:${bundle.bundle}`; key = identity; display = bundle.name; appPath = bundle.bundle; gui = true;
    } else {
      let root = process;
      const seen = new Set();
      while (root.ppid > 1 && !seen.has(root.ppid)) {
        seen.add(root.ppid);
        const parent = byPid.get(root.ppid);
        if (!parent || parent.executable !== process.executable) break;
        root = parent;
      }
      identity = process.executable ? `exe:${process.executable}` : `name:${process.name}`;
      key = `${identity}#${root.pid}`; display = process.name; appPath = process.executable; gui = isGui(appPath);
    }
    const group = groups.get(key) || { key, identity, display, appPath, gui, members: [] };
    group.members.push(process);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const members = group.members.sort((left, right) => right.mem - left.mem);
    const main = members[0];
    const allPids = members.map((member) => member.pid);
    return {
      id: `g${hash(group.key)}`, identity: group.identity, name: group.display, path: group.appPath,
      pid: main.pid, allPids, procs: members.length,
      cpu: Math.round(members.reduce((total, member) => total + member.cpu, 0) * 10) / 10,
      mem: Math.round(members.reduce((total, member) => total + member.mem, 0) * 10) / 10,
      sys: isSystemPath(group.appPath, group.display) && !group.gui,
      gui: group.gui, monogram: monogram(group.display), color: PALETTE[Number.parseInt(hash(group.display), 36) % PALETTE.length],
      snapshotToken: snapshotToken(members),
      helpers: members.length > 1 ? members.map((member, index) => ({ name: member.name, role: role(member.name, index === 0), pid: member.pid, cpu: Math.round(member.cpu * 10) / 10, mem: Math.round(member.mem * 10) / 10 })) : [],
    };
  });
}

export async function listProcesses(category = "all", limit = 100) {
  let rows = mergeProcesses(await rawProcesses());
  if (category === "gui") rows = rows.filter((row) => row.gui && !row.sys);
  if (category === "bg") rows = rows.filter((row) => row.sys);
  const sortKey = category === "cpu" ? "cpu" : "mem";
  rows.sort((left, right) => right[sortKey] - left[sortKey]);
  return rows.slice(0, limit).map(({ gui, ...row }) => row);
}

export async function systemStats() {
  const total = os.totalmem() / 1024 / 1024;
  const cpu = IS_WINDOWS ? 0 : Math.min(100, (os.loadavg()[0] / Math.max(os.cpus().length, 1)) * 100);
  return { cpuPercent: Math.round(cpu * 10) / 10, memUsedMb: Math.round((total - os.freemem() / 1024 / 1024) * 10) / 10, memTotalMb: Math.round(total * 10) / 10 };
}

function protectedPids(raw) {
  const byPid = new Map(raw.map((process) => [process.pid, process]));
  const protectedSet = new Set([0, 1, process.pid]);
  let parent = byPid.get(process.pid)?.ppid;
  while (parent && !protectedSet.has(parent)) {
    protectedSet.add(parent);
    parent = byPid.get(parent)?.ppid;
  }
  return protectedSet;
}

function descendants(raw, roots) {
  const children = new Map();
  for (const process of raw) children.set(process.ppid, [...(children.get(process.ppid) || []), process.pid]);
  const result = new Set(); const pending = [...roots];
  while (pending.length) {
    const pid = pending.pop();
    if (result.has(pid)) continue;
    result.add(pid); pending.push(...(children.get(pid) || []));
  }
  return [...result];
}

export function verifiedKillTargets(raw, { id, snapshotToken, allPids }) {
  const current = mergeProcesses(raw).find((row) => row.id === id && row.snapshotToken === snapshotToken);
  const requested = new Set(allPids);
  const blocked = protectedPids(raw);
  const exactSnapshot = current
    && requested.size === current.allPids.length
    && current.allPids.every((pid) => requested.has(pid));
  return exactSnapshot && !current.allPids.some((pid) => blocked.has(pid)) ? current.allPids : null;
}

export async function killProcess({ id, snapshotToken, allPids }) {
  const raw = await rawProcesses();
  const targets = verifiedKillTargets(raw, { id, snapshotToken, allPids });
  if (!targets) return { ok: false, killed: [], error: "目标已变化、PID 清单不匹配或属于受保护进程，请刷新后重试" };
  const killed = []; const errors = [];
  if (IS_WINDOWS) {
    const targetSet = new Set(targets);
    const byPid = new Map(raw.map((process) => [process.pid, process]));
    const roots = targets.filter((pid) => !targetSet.has(byPid.get(pid)?.ppid));
    for (const pid of roots) {
      try { await command("taskkill", ["/T", "/F", "/PID", String(pid)]); killed.push(pid); } catch (error) { errors.push(`PID ${pid}: ${error.message}`); }
    }
  } else {
    for (const pid of descendants(raw, targets).filter((pid) => !blocked.has(pid) && pid > 1).sort((left, right) => right - left)) {
      try { process.kill(pid, "SIGKILL"); killed.push(pid); } catch (error) { if (error.code === "ESRCH") killed.push(pid); else errors.push(`PID ${pid}: ${error.message}`); }
    }
  }
  return errors.length ? { ok: false, killed, error: errors.join("；") } : { ok: killed.length > 0, killed, ...(killed.length ? {} : { error: "没有进程被结束（目标可能已变化）" }) };
}
