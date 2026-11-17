"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

// Floors inspected from the pinned b11793 Mach-O/ELF artifacts, not a claim
// that every distribution or processor has passed device acceptance.
const FLOORS = Object.freeze({
  darwin: "13.3", win32: "10.0",
  linux: { x64: { glibc: "2.34", glibcxx: "3.4.30" }, arm64: { glibc: "2.38", glibcxx: "3.4.32" } }
});

function atLeast(actual, minimum) {
  if (!/^\d+(\.\d+)*$/.test(String(actual || ""))) return false;
  const left = actual.split(".").map(Number), right = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0);
  }
  return true;
}

function findLibstdcppVersion(report, arch, fsApi) {
  const candidates = [...(report?.sharedObjects || []).filter(name => /[/\\]libstdc\+\+\.so\.6(?:\.|$)/.test(name)),
    `/usr/lib/${arch === "arm64" ? "aarch64" : "x86_64"}-linux-gnu/libstdc++.so.6`,
    `/lib/${arch === "arm64" ? "aarch64" : "x86_64"}-linux-gnu/libstdc++.so.6`,
    "/usr/lib64/libstdc++.so.6"];
  for (const file of candidates) {
    try {
      if (fsApi.statSync(file).size > 16 * 1024 * 1024) continue;
      const versions = [...fsApi.readFileSync(file).toString("latin1").matchAll(/GLIBCXX_(\d+\.\d+\.\d+)/g)].map(match => match[1]);
      if (versions.length) return versions.reduce((max, version) => atLeast(version, max) ? version : max);
    } catch { /* Try a standard library location next. */ }
  }
  return null;
}

function checkRuntimeCompatibility(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const decline = reason => ({ compatible: false, reason: `${reason}；仍可连接已有 Ollama 或选择供应商模型` });
  if (!["arm64", "x64"].includes(arch)) return decline("暂不支持此处理器架构的自动部署");
  if (platform === "darwin") {
    let version = options.osVersion;
    if (!version) {
      try { version = (options.execFileSync || execFileSync)("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 }).trim(); }
      catch { return decline("无法确认 macOS 版本"); }
    }
    return atLeast(version, FLOORS.darwin) ? { compatible: true } : decline("自动部署需要 macOS 13.3 或更新版本");
  }
  if (platform === "win32") {
    return atLeast(options.osVersion || (options.os || os).release(), FLOORS.win32)
      ? { compatible: true } : decline("自动部署需要 Windows 10 或更新版本");
  }
  if (platform === "linux") {
    let report;
    try { report = options.report || process.report?.getReport(); } catch {}
    const floor = FLOORS.linux[arch];
    if (!atLeast(report?.header?.glibcVersionRuntime, floor.glibc)) return decline(`此运行包需要 glibc ${floor.glibc} 或更新版本（不支持 musl）`);
    const cxx = options.glibcxxVersion || findLibstdcppVersion(report, arch, options.fs || fs);
    if (!atLeast(cxx, floor.glibcxx)) return decline(`此运行包需要 libstdc++ 提供 GLIBCXX_${floor.glibcxx}`);
    return { compatible: true };
  }
  return decline("此操作系统暂无自动部署运行包");
}

module.exports = { FLOORS, atLeast, findLibstdcppVersion, checkRuntimeCompatibility };
