"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { runtimePackageVersion } = require("./runtime-loader.cjs");

function pathCandidates(names, env = process.env) {
  const values = [];
  for (const directory of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) values.push(path.join(directory, name));
  }
  return values;
}

function existingExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.realpathSync(candidate);
      }
    } catch {}
  }
  return null;
}

function officeCliCandidates(platform = process.platform, env = process.env) {
  const executable = platform === "win32" ? "officecli.exe" : "officecli";
  const candidates = [];
  if (env.OFFICECLI_PATH) candidates.push(env.OFFICECLI_PATH);
  candidates.push(...pathCandidates([executable], env));
  if (platform === "win32") {
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "OfficeCLI", executable));
    if (env.USERPROFILE) candidates.push(path.join(env.USERPROFILE, "scoop", "shims", executable));
  } else {
    const home = env.HOME || "";
    candidates.push(path.join(home, ".local", "bin", executable), "/opt/homebrew/bin/officecli", "/usr/local/bin/officecli", "/usr/bin/officecli");
  }
  return candidates;
}

function browserCandidates(platform = process.platform, env = process.env) {
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    path.join(env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ];
  if (platform === "win32") {
    return [
      path.join(env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      ...pathCandidates(["chrome.exe", "msedge.exe", "chromium.exe"], env)
    ];
  }
  return pathCandidates(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"], env);
}

function libreOfficeCandidates(platform = process.platform, env = process.env) {
  if (platform === "darwin") return ["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  if (platform === "win32") return [
    path.join(env.PROGRAMFILES || "", "LibreOffice", "program", "soffice.exe"),
    path.join(env["PROGRAMFILES(X86)"] || "", "LibreOffice", "program", "soffice.exe"),
    ...pathCandidates(["soffice.exe"], env)
  ];
  return pathCandidates(["libreoffice", "soffice"], env);
}

function runVersion(binary, args, timeoutMs = 5000) {
  return new Promise(resolve => {
    execFile(binary, args, { windowsHide: true, timeout: timeoutMs, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) return resolve(undefined);
      const text = `${stdout || ""}\n${stderr || ""}`.trim().split(/\r?\n/)[0];
      resolve(text || undefined);
    });
  });
}

function moduleVersion(moduleName) {
  return runtimePackageVersion(moduleName);
}

async function probeRuntimes(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const officecli = existingExecutable(officeCliCandidates(platform, env));
  const browser = existingExecutable(browserCandidates(platform, env));
  const libreoffice = existingExecutable(libreOfficeCandidates(platform, env));
  const [officeVersion, browserVersion, libreVersion] = await Promise.all([
    officecli ? runVersion(officecli, ["--version"]) : undefined,
    browser ? runVersion(browser, ["--version"]) : undefined,
    libreoffice ? runVersion(libreoffice, ["--version"]) : undefined
  ]);
  const sharpVersion = moduleVersion("sharp");
  const pdfVersion = moduleVersion("pdfjs-dist");
  const ocrVersion = moduleVersion("tesseract.js");
  const excelVersion = moduleVersion("exceljs");
  return [
    { id: "officecli", label: "OfficeCLI", available: Boolean(officecli && officeVersion), version: officeVersion, path: officecli || undefined, bundled: false, note: "处理 Word、Excel 和 PowerPoint" },
    { id: "browser", label: "浏览器渲染", available: Boolean(browser), version: browserVersion, path: browser || undefined, bundled: false, note: "Office 分页图片和 HTML 打印" },
    { id: "libreoffice", label: "LibreOffice", available: Boolean(libreoffice), version: libreVersion, path: libreoffice || undefined, bundled: false, note: "可选 Office → PDF 兼容后端" },
    { id: "sharp", label: "图片引擎", available: Boolean(sharpVersion), version: sharpVersion, installable: true, bundled: false, note: "按需安装常见图片格式转换引擎" },
    { id: "pdf", label: "PDF 引擎", available: Boolean(pdfVersion), version: pdfVersion, installable: true, bundled: false, note: "按需安装 PDF 解析、渲染和封装引擎" },
    { id: "ocr", label: "OCR", available: Boolean(ocrVersion), version: ocrVersion, installable: true, bundled: false, note: "按需安装图片与扫描 PDF 识别引擎" },
    { id: "excel", label: "Excel 引擎", available: Boolean(excelVersion), version: excelVersion, installable: true, bundled: false, note: "按需安装 Excel 工作簿生成引擎" }
  ];
}

module.exports = { pathCandidates, existingExecutable, officeCliCandidates, browserCandidates, libreOfficeCandidates, runVersion, probeRuntimes };
