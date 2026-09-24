const { execFile } = require("node:child_process");

const NETTOP_ARGS = ["-n", "-P", "-x", "-d", "-L", "2", "-s", "1", "-t", "external", "-J", "time,bytes_in,bytes_out"];

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const input = String(text || "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ""; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, "")); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function parseTimeSeconds(value) {
  const match = String(value).trim().match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction;
}

function parseUnsigned(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  try { return BigInt(text); } catch (_) { return null; }
}

function rateToNumber(bytes, seconds) {
  if (seconds <= 0 || bytes < 0n) return null;
  const whole = bytes / 1000n;
  const remainder = bytes % 1000n;
  const bounded = whole > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(whole);
  return Math.max(0, (bounded * 1000 + Number(remainder)) / seconds);
}

function parseNettop(text) {
  const csv = parseCsv(text);
  const frames = [];
  let frame = null;
  for (const row of csv) {
    if (String(row[0]).trim().toLowerCase() === "time") {
      frame = new Map(); frames.push(frame); continue;
    }
    if (!frame || row.length < 4) continue;
    const time = parseTimeSeconds(row[0]);
    const processName = String(row[1] || "");
    const match = processName.match(/\.(\d+)$/);
    const bytesIn = parseUnsigned(row[2]);
    const bytesOut = parseUnsigned(row[3]);
    if (time == null || !match || bytesIn == null || bytesOut == null) continue;
    frame.set(Number(match[1]), { time, bytesIn, bytesOut });
  }
  if (frames.length < 2) throw new Error("nettop did not return two frames");
  const first = frames[frames.length - 2], second = frames[frames.length - 1];
  const entries = [];
  for (const [pid, current] of second) {
    const previous = first.get(pid);
    if (!previous) continue;
    let seconds = current.time - previous.time;
    if (seconds < 0) seconds += 24 * 3600;
    const downloadBps = rateToNumber(current.bytesIn, seconds);
    const uploadBps = rateToNumber(current.bytesOut, seconds);
    if (downloadBps == null || uploadBps == null) continue;
    entries.push({ pid, downloadBps, uploadBps });
  }
  return entries;
}

function collectNettop(execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl("/usr/bin/nettop", NETTOP_ARGS, {
      encoding: "utf8", timeout: 2500, maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(error);
      else {
        try { resolve(parseNettop(stdout)); } catch (parseError) { reject(parseError); }
      }
    });
  });
}

function aggregateNetworkUsage(rows, rates, before, after) {
  const beforeByPid = new Map(before.map((proc) => [proc.pid, proc]));
  const afterByPid = new Map(after.map((proc) => [proc.pid, proc]));
  const safeRates = new Map();
  for (const rate of rates) {
    const first = beforeByPid.get(rate.pid), current = afterByPid.get(rate.pid);
    if (!first || !current || first.startedAt !== current.startedAt) continue;
    safeRates.set(rate.pid, rate);
  }
  const apps = [];
  for (const app of rows) {
    const activePids = (app.allPids || [app.pid]).filter((pid) => safeRates.has(pid));
    if (!activePids.length) continue;
    apps.push({
      app,
      activePids,
      downloadBps: activePids.reduce((sum, pid) => sum + safeRates.get(pid).downloadBps, 0),
      uploadBps: activePids.reduce((sum, pid) => sum + safeRates.get(pid).uploadBps, 0),
    });
  }
  return apps.sort((a, b) => (b.downloadBps + b.uploadBps) - (a.downloadBps + a.uploadBps));
}

function probeNettop(execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    const args = ["-n", "-P", "-x", "-d", "-L", "1", "-t", "external", "-J", "time,bytes_in,bytes_out"];
    execFileImpl("/usr/bin/nettop", args, { encoding: "utf8", timeout: 1200, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else if (!parseCsv(stdout).some((row) => String(row[0]).trim().toLowerCase() === "time")) reject(new Error("nettop probe returned no header"));
      else resolve(true);
    });
  });
}

module.exports = { NETTOP_ARGS, parseCsv, parseNettop, collectNettop, probeNettop, aggregateNetworkUsage };
