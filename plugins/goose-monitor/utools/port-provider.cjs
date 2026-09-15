/* 采集进程正在监听的 TCP 端口。
   怎么跑：由 preload 在列进程时并行调用 collectListenPorts。
   需要：mac 的 lsof；Linux 的 ss（缺了再试 lsof）；Windows 的 netstat。 */
const { execFile } = require("node:child_process");

function addPort(byPid, pid, port) {
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) return;
  let ports = byPid.get(pid);
  if (!ports) {
    ports = new Set();
    byPid.set(pid, ports);
  }
  ports.add(port);
}

function toSortedMap(byPid) {
  const result = new Map();
  for (const [pid, ports] of byPid) {
    result.set(pid, [...ports].sort((a, b) => a - b));
  }
  return result;
}

function parseLsof(text) {
  const byPid = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!/\(LISTEN\)/.test(line)) continue;
    const pidMatch = line.match(/^\S+\s+(\d+)\s+/);
    const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!pidMatch || !portMatch) continue;
    addPort(byPid, Number(pidMatch[1]), Number(portMatch[1]));
  }
  return toSortedMap(byPid);
}

function parseNetstatWin(text) {
  const byPid = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!match) continue;
    addPort(byPid, Number(match[2]), Number(match[1]));
  }
  return toSortedMap(byPid);
}

function parseSsLinux(text) {
  const byPid = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!/LISTEN/i.test(line)) continue;
    const pidMatch = line.match(/pid=(\d+)/);
    const portMatch = line.match(/:(\d+)\s+/);
    if (!pidMatch || !portMatch) continue;
    addPort(byPid, Number(pidMatch[1]), Number(portMatch[1]));
  }
  return toSortedMap(byPid);
}

function run(execFileImpl, cmd, args, parse, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFileImpl(cmd, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(error);
      else {
        try { resolve(parse(stdout)); } catch (parseError) { reject(parseError); }
      }
    });
  });
}

function collectListenPorts(execFileImpl = execFile) {
  if (process.platform === "win32") {
    return run(execFileImpl, "netstat", ["-ano"], parseNetstatWin);
  }
  if (process.platform === "linux") {
    return run(execFileImpl, "ss", ["-lntp"], parseSsLinux)
      .catch(() => run(execFileImpl, "lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], parseLsof));
  }
  return run(execFileImpl, "lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], parseLsof);
}

const SERVICE_NAME = /^(java|javaw|jsvc|node|nodejs|bun|deno|python(\d+)?|pythonw|pypy(\d+)?|ruby|php(-fpm)?|perl|go|vite|webpack|next-server|nuxt|uvicorn|gunicorn|hypercorn|caddy|nginx|httpd|apache2|redis-server|mongod|postgres|mysqld|mariadbd)(\.exe)?$/i;

function processBaseName(value) {
  return String(value || "").split(/[/\\]/).pop().replace(/\.(exe|bin)$/i, "").trim();
}

function isServiceRuntime(name, path) {
  const names = [processBaseName(name), processBaseName(path)];
  if (names.some((item) => SERVICE_NAME.test(item))) return true;
  const hay = `${name || ""} ${path || ""}`;
  return /(^|[/\\])(vite|next|webpack)(\.js)?$/i.test(hay) ||
    /node_modules[/\\]\.bin[/\\](vite|next|webpack)/i.test(hay) ||
    /\b(java|node|bun|deno|python\d*|vite)\b/i.test(name || "");
}

function commandLineLooksLikeService(row) {
  const text = String(row.commandLine || "").trim();
  if (!text) return false;
  const head = processBaseName(text.match(/^\S+/)?.[0] || "").replace(/\.exe$/i, "");
  if (SERVICE_NAME.test(head)) return true;
  if (/(?:^|\s)(-jar|--server\.port=|-Dserver\.port=)\b/.test(text)) {
    return SERVICE_NAME.test(processBaseName(row.name)) ||
      SERVICE_NAME.test(processBaseName(row.path)) ||
      /\.jar\b/i.test(`${row.name || ""} ${row.path || ""}`);
  }
  return false;
}

function rowLooksLikeService(row) {
  if (isServiceRuntime(row.name, row.path)) return true;
  if (commandLineLooksLikeService(row)) return true;
  return (row.helpers || []).some((helper) => isServiceRuntime(helper.name, helper.path || row.path));
}

function attachListenPorts(rows, portsByPid) {
  const table = portsByPid || new Map();
  for (const row of rows) {
    if (!rowLooksLikeService(row)) {
      row.ports = [];
      for (const helper of row.helpers || []) helper.ports = [];
      continue;
    }
    const ports = new Set();
    for (const pid of row.allPids || [row.pid]) {
      for (const port of table.get(pid) || []) ports.add(port);
    }
    row.ports = [...ports].sort((a, b) => a - b);
    for (const helper of row.helpers || []) {
      helper.ports = [...(table.get(helper.pid) || [])].sort((a, b) => a - b);
    }
  }
  return rows;
}

module.exports = {
  parseLsof,
  parseNetstatWin,
  parseSsLinux,
  collectListenPorts,
  attachListenPorts,
  isServiceRuntime,
};
