"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function parseDfAvailable(output) {
  const lines = String(output).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const columns = lines[lines.length - 1].trim().split(/\s+/);
  if (columns.length < 4 || !/^\d+$/.test(columns[3])) return null;
  const bytes = Number(columns[3]) * 1024;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function parseWindowsFreeBytes(output) {
  const match = String(output).trim().match(/^(\d+)\s*$/m);
  if (!match) return null;
  const bytes = Number(match[1]);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function getDiskFreeBytes(directory, options = {}) {
  const fsApi = options.fs || fs;
  try {
    if (typeof fsApi.statfsSync === "function") {
      let current = path.resolve(directory);
      while (true) {
        try {
          const info = fsApi.statfsSync(current);
          const bytes = Number(info.bavail ?? info.bfree) * Number(info.bsize);
          return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
        } catch {
          const parent = path.dirname(current);
          if (parent === current) break;
          current = parent;
        }
      }
    }
  } catch {}
  const platform = options.platform || process.platform;
  const run = options.execFileSync || execFileSync;
  try {
    if (platform === "darwin" || platform === "linux") {
      let target = path.resolve(directory);
      while (true) {
        try {
          if (fsApi.statSync(target).isDirectory()) break;
        } catch {}
        const parent = path.dirname(target);
        if (parent === target) return null;
        target = parent;
      }
      return parseDfAvailable(run(options.dfPath || "/bin/df", ["-Pk", target], {
        encoding: "utf8", timeout: 1_500, stdio: ["ignore", "pipe", "ignore"]
      }));
    }
    if (platform === "win32") {
      const drive = path.parse(path.resolve(directory)).root.replace(/[\\/]+$/, "");
      const script = "$root=[IO.Path]::GetPathRoot($args[0]); $drive=$root.TrimEnd('\\'); (Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$drive'\").FreeSpace";
      return parseWindowsFreeBytes(run(options.powershellPath || "powershell.exe", [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, path.resolve(directory)
      ], { encoding: "utf8", timeout: 2_500, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
    }
  } catch {}
  return null;
}

module.exports = { parseDfAvailable, parseWindowsFreeBytes, getDiskFreeBytes };
