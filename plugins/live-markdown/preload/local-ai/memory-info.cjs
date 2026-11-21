"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

function parseLinuxMemAvailable(contents) {
  const match = String(contents).match(/^MemAvailable:\s*(\d+)\s+kB\s*$/m);
  if (!match) return null;
  const bytes = Number(match[1]) * 1024;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function parseMacVmStat(contents) {
  const text = String(contents);
  const pageSizeMatch = text.match(/page size of ([\d,]+) bytes/i);
  if (!pageSizeMatch) return null;
  const pageSize = Number(pageSizeMatch[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null;
  const pageCount = (name) => {
    const match = text.match(new RegExp(`^Pages ${name}:\\s*([\\d,]+)\\.?\\s*$`, "im"));
    if (!match) return name === "speculative" ? 0 : null;
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const free = pageCount("free");
  const inactive = pageCount("inactive");
  const speculative = pageCount("speculative");
  if (free === null || inactive === null || speculative === null) return null;
  // Purgeable pages overlap other vm_stat buckets; do not add them again.
  const bytes = (free + inactive + speculative) * pageSize;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function getAvailableMemory(options = {}) {
  const platform = options.platform || process.platform;
  const osApi = options.os || os;
  let measured = null;
  try {
    if (platform === "linux") {
      const readFileSync = options.readFileSync || fs.readFileSync;
      measured = parseLinuxMemAvailable(readFileSync(options.meminfoPath || "/proc/meminfo", "utf8"));
    } else if (platform === "darwin") {
      const run = options.execFileSync || execFileSync;
      const output = run(options.vmStatPath || "/usr/bin/vm_stat", [], {
        encoding: "utf8", timeout: 1_200, stdio: ["ignore", "pipe", "ignore"]
      });
      measured = parseMacVmStat(output);
    }
  } catch {
    measured = null;
  }
  if (measured === null) {
    try { measured = Math.max(0, Number(osApi.freemem())); }
    catch { measured = 0; }
  }
  try {
    const total = Number(osApi.totalmem());
    if (Number.isFinite(total) && total > 0) return Math.max(0, Math.min(measured, total));
  } catch {}
  return Math.max(0, measured);
}

module.exports = { parseLinuxMemAvailable, parseMacVmStat, getAvailableMemory };
