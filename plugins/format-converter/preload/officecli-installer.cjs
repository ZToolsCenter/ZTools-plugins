"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MIRROR_BASE = "https://d.officecli.ai";
const GITHUB_BASE = "https://github.com/iOfficeAI/OfficeCLI";
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

function installerError(code, message, details) {
  const error = new Error(message); error.code = code; error.details = details; return error;
}

function releaseAsset(platform, arch, isMusl = false) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) return `officecli-mac-${arch}`;
  if (platform === "win32" && ["arm64", "x64"].includes(arch)) return `officecli-win-${arch}.exe`;
  if (platform === "linux" && ["arm64", "x64"].includes(arch)) return `officecli-linux-${isMusl ? "alpine-" : ""}${arch}`;
  throw installerError("UNSUPPORTED_PLATFORM", `OfficeCLI 暂不支持 ${platform}/${arch} 一键安装。`);
}

function latestVersionFromUrl(value) {
  return String(value || "").match(/\/releases\/tag\/(v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1] || null;
}

function checksumForAsset(manifest, asset) {
  for (const line of String(manifest || "").split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  return null;
}

function requestBuffer(url, options = {}, redirects = 0) {
  if (redirects > 8) return Promise.reject(installerError("DOWNLOAD_REDIRECT_LIMIT", "下载重定向次数过多。"));
  const requestImpl = options.request || https.request;
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, { method: "GET", headers: { "User-Agent": "ZTools-Format-Converter/0.1", Accept: "application/octet-stream" } }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers?.location) {
        response.resume(); requestBuffer(new URL(response.headers.location, url).toString(), options, redirects + 1).then(resolve, reject); return;
      }
      if (status < 200 || status >= 300) { response.resume(); reject(installerError("DOWNLOAD_HTTP_ERROR", `下载返回 HTTP ${status}。`)); return; }
      const chunks = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > (options.maxBytes || MAX_DOWNLOAD_BYTES)) response.destroy(installerError("DOWNLOAD_TOO_LARGE", "下载内容超过安全限制。")); else chunks.push(chunk); });
      response.on("end", () => resolve({ body: Buffer.concat(chunks), finalUrl: response.url || url }));
      response.on("error", reject);
    });
    request.setTimeout(options.timeoutMs || 300000, () => request.destroy(installerError("DOWNLOAD_TIMEOUT", "下载超时。")));
    request.on("error", reject); request.end();
  });
}

async function fetchFallback(urls, options) {
  let lastError;
  for (const url of urls) { try { return await requestBuffer(url, options); } catch (error) { lastError = error; } }
  throw installerError("DOWNLOAD_FAILED", "无法从国内镜像或 GitHub 下载 OfficeCLI。", { cause: lastError?.message });
}

function verifyVersion(binary, env = process.env, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, ["--version"], { shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    let text = "", settled = false;
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} if (!settled) reject(installerError("INSTALL_VERIFY_TIMEOUT", "OfficeCLI 版本自检超时。")); settled = true; }, 15000);
    child.stdout.on("data", chunk => { text += chunk; }); child.stderr.on("data", chunk => { text += chunk; });
    child.on("error", error => { clearTimeout(timer); if (!settled) reject(installerError("INSTALL_VERIFY_FAILED", error.message)); settled = true; });
    child.on("close", code => {
      clearTimeout(timer); if (settled) return; settled = true;
      const version = text.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/)?.[1];
      if (code !== 0 || !version) reject(installerError("INSTALL_VERIFY_FAILED", "下载的 OfficeCLI 未通过版本自检。", { exitCode: code })); else resolve(version);
    });
  });
}

function createOfficeCliInstaller(dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const arch = dependencies.arch || process.arch;
  const environment = { ...(dependencies.env || process.env) };
  const homeDir = path.resolve(dependencies.homeDir || os.homedir());
  const isMusl = dependencies.isMusl ?? (platform === "linux" && !process.report?.getReport()?.header?.glibcVersionRuntime);
  let active = null;

  async function latestVersion() {
    for (const url of [`${MIRROR_BASE}/releases/latest`, `${GITHUB_BASE}/releases/latest`]) {
      try { const response = await requestBuffer(url, { request: dependencies.request, timeoutMs: 30000, maxBytes: 1024 }); const version = latestVersionFromUrl(response.finalUrl); if (version) return version; } catch {}
    }
    throw installerError("VERSION_RESOLUTION_FAILED", "无法获取 OfficeCLI 最新版本。");
  }

  function installPath() {
    if (platform === "win32") return path.join(environment.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "OfficeCLI", "officecli.exe");
    return path.join(homeDir, ".local", "bin", "officecli");
  }

  async function perform() {
    const asset = releaseAsset(platform, arch, isMusl);
    const version = await latestVersion();
    const mirror = `${MIRROR_BASE}/releases/download/${version}`;
    const github = `${GITHUB_BASE}/releases/download/${version}`;
    const [binary, checksums] = await Promise.all([
      fetchFallback([`${mirror}/${asset}`, `${github}/${asset}`], { request: dependencies.request }),
      fetchFallback([`${mirror}/SHA256SUMS`, `${github}/SHA256SUMS`], { request: dependencies.request, maxBytes: 2 * 1024 * 1024 })
    ]);
    const expected = checksumForAsset(checksums.body.toString("utf8"), asset);
    if (!expected) throw installerError("CHECKSUM_MISSING", `官方校验清单不包含 ${asset}。`);
    const actual = crypto.createHash("sha256").update(binary.body).digest("hex");
    if (actual !== expected) throw installerError("CHECKSUM_MISMATCH", "OfficeCLI 下载未通过 SHA-256 校验。");
    const destination = installPath();
    const staged = `${destination}.${crypto.randomUUID()}.new`;
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(staged, binary.body, { mode: platform === "win32" ? undefined : 0o755 });
    if (platform !== "win32") await fs.promises.chmod(staged, 0o755);
    try {
      const installedVersion = await verifyVersion(staged, environment, dependencies.spawn || spawn);
      if (platform === "win32" && fs.existsSync(destination)) {
        const backup = `${destination}.previous`; await fs.promises.rm(backup, { force: true }); await fs.promises.rename(destination, backup);
        try { await fs.promises.rename(staged, destination); await fs.promises.rm(backup, { force: true }); }
        catch (error) { await fs.promises.rename(backup, destination).catch(() => undefined); throw error; }
      } else { await fs.promises.rm(destination, { force: true }); await fs.promises.rename(staged, destination); }
      return { installed: true, binaryPath: destination, version: installedVersion, release: version, asset };
    } catch (error) { await fs.promises.rm(staged, { force: true }).catch(() => undefined); throw error; }
  }

  return Object.freeze({ install() { if (!active) active = perform().finally(() => { active = null; }); return active; } });
}

module.exports = { installerError, releaseAsset, latestVersionFromUrl, checksumForAsset, requestBuffer, verifyVersion, createOfficeCliInstaller };
