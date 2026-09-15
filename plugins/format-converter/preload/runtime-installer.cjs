"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { requestBuffer } = require("./officecli-installer.cjs");
const { configureRuntimeRoot, localPackageVersion, runtimePackageVersion, runtimeRequire } = require("./runtime-loader.cjs");

function runtimeError(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }
function octal(buffer, start, length) { return Number.parseInt(buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8); }
function text(buffer, start, length) { return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/, ""); }

function parsePax(value) {
  const output = {};
  let offset = 0;
  while (offset < value.length) {
    const space = value.indexOf(" ", offset);
    if (space < 0) break;
    const length = Number(value.slice(offset, space));
    const record = value.slice(space + 1, offset + length - 1);
    const equals = record.indexOf("=");
    if (equals > 0) output[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return output;
}

async function extractNpmTarball(archive, destination, options = {}) {
  const tar = zlib.gunzipSync(archive, { maxOutputLength: options.maxUnpackedBytes || 256 * 1024 ** 2 });
  let offset = 0, nextPath = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    let name = `${text(header, 345, 155)}${text(header, 345, 155) ? "/" : ""}${text(header, 0, 100)}`;
    const bodyStart = offset + 512;
    const body = tar.subarray(bodyStart, bodyStart + size);
    if (type === "x") { nextPath = parsePax(body.toString("utf8")).path || nextPath; }
    else if (type === "L") nextPath = body.toString("utf8").replace(/\0.*$/, "");
    else {
      name = nextPath || name; nextPath = null;
      const relative = name.replace(/^package\//, "").replace(/^\.\//, "");
      if (relative && relative !== "package") {
        const normalized = path.normalize(relative);
        if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw runtimeError("RUNTIME_ARCHIVE_UNSAFE", "运行时压缩包包含越界路径。");
        const target = path.join(destination, normalized);
        if (type === "5") await fs.mkdir(target, { recursive: true, mode: 0o700 });
        else if (["0", "\0", "7"].includes(type)) {
          await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await fs.writeFile(target, body, { mode: 0o600 });
        } else if (!["g"].includes(type)) throw runtimeError("RUNTIME_ARCHIVE_UNSAFE", "运行时压缩包包含不允许的链接或设备文件。", { type });
      }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
}

function currentLibc(platform = process.platform) {
  if (platform !== "linux") return undefined;
  return process.report?.getReport?.().header?.glibcVersionRuntime ? "glibc" : "musl";
}
function matches(value, current) {
  if (!Array.isArray(value) || !value.length) return true;
  const positives = value.filter(item => !item.startsWith("!"));
  if (value.includes(`!${current}`)) return false;
  return !positives.length || positives.includes(current);
}
function supportsCurrentPlatform(entry, platform, arch, libc) {
  return matches(entry.os, platform) && matches(entry.cpu, arch) && matches(entry.libc, libc);
}
function verifyIntegrity(body, integrity) {
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (!expected || !["sha512", "sha256"].includes(algorithm)) return false;
  const actual = crypto.createHash(algorithm).update(body).digest("base64");
  const actualBytes = Buffer.from(actual), expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function createRuntimeInstaller(options = {}) {
  const manifest = options.manifest || require("./runtime-manifest.json");
  const root = configureRuntimeRoot(options.runtimeRoot);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const libc = options.libc || currentLibc(platform);
  const request = options.requestBuffer || requestBuffer;
  let queue = Promise.resolve();

  async function installPackage(key, entry) {
    const packageName = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const destination = path.join(root, ...key.split("/"));
    const installed = await fs.readFile(path.join(destination, "package.json"), "utf8").then(value => JSON.parse(value).version, () => undefined).catch(() => undefined);
    if (installed === entry.version) return { key, skipped: true };
    let response, lastError;
    for (const url of entry.urls) {
      try { response = await request(url, { maxBytes: 80 * 1024 ** 2, timeoutMs: 300000 }); break; }
      catch (error) { lastError = error; }
    }
    if (!response) throw runtimeError("RUNTIME_DOWNLOAD_FAILED", `无法下载运行时依赖：${packageName}`, { cause: lastError?.message });
    if (!verifyIntegrity(response.body, entry.integrity)) throw runtimeError("RUNTIME_INTEGRITY_FAILED", `运行时依赖校验失败：${packageName}`);
    const staged = `${destination}.${crypto.randomUUID()}.new`;
    const backup = `${destination}.${crypto.randomUUID()}.previous`;
    await fs.rm(staged, { recursive: true, force: true });
    await fs.mkdir(staged, { recursive: true, mode: 0o700 });
    try {
      await extractNpmTarball(response.body, staged);
      const metadata = JSON.parse(await fs.readFile(path.join(staged, "package.json"), "utf8"));
      if (metadata.version !== entry.version) throw runtimeError("RUNTIME_VERSION_MISMATCH", `运行时依赖版本不匹配：${packageName}`);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const exists = await fs.lstat(destination).then(() => true, () => false);
      if (exists) await fs.rename(destination, backup);
      try { await fs.rename(staged, destination); await fs.rm(backup, { recursive: true, force: true }); }
      catch (error) { if (exists) await fs.rename(backup, destination).catch(() => undefined); throw error; }
      return { key, skipped: false };
    } finally { await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined); }
  }

  function status(groupId) {
    const group = manifest.groups[groupId];
    if (!group) throw runtimeError("RUNTIME_GROUP_UNKNOWN", "未知转换运行时。", { groupId });
    const versions = Object.fromEntries(group.roots.map(name => [name, runtimePackageVersion(name)]));
    const local = group.roots.every(name => localPackageVersion(name));
    let marked = false;
    try {
      const marker = JSON.parse(fssync.readFileSync(path.join(root, ".groups", `${groupId}.json`), "utf8"));
      marked = marker.runtimeVersion === manifest.runtimeVersion && group.roots.every(name => marker.versions?.[name] === manifest.packages[`node_modules/${name}`]?.version);
    } catch {}
    let loadable = false;
    try {
      if (groupId === "sharp") loadable = typeof runtimeRequire("sharp") === "function";
      else if (groupId === "pdf") loadable = typeof runtimeRequire("pdfjs-dist/legacy/build/pdf.js").getDocument === "function" && typeof runtimeRequire("pdf-lib").PDFDocument === "function";
      else if (groupId === "ocr") loadable = typeof runtimeRequire("tesseract.js").createWorker === "function" && ["eng", "chi_sim"].every(language => fssync.existsSync(path.join(root, "tessdata", "4.0.0", `${language}.traineddata.gz`)));
      else if (groupId === "excel") loadable = typeof runtimeRequire("exceljs").Workbook === "function";
      else loadable = group.roots.every(name => Boolean(runtimeRequire(name)));
    } catch {}
    return { id: groupId, label: group.label, available: (local || (marked && group.roots.every(name => versions[name]))) && loadable, versions, estimateMb: group.estimateMb };
  }

  function install(groupId) {
    const task = queue.then(async () => {
      const group = manifest.groups[groupId];
      if (!group) throw runtimeError("RUNTIME_GROUP_UNKNOWN", "未知转换运行时。", { groupId });
      const selected = group.packages.filter(key => supportsCurrentPlatform(manifest.packages[key], platform, arch, libc));
      for (const key of selected) await installPackage(key, manifest.packages[key]);
      if (groupId === "ocr") {
        const tessdata = path.join(root, "tessdata", "4.0.0");
        const stagedTessdata = `${tessdata}.${crypto.randomUUID()}.new`;
        const previousTessdata = `${tessdata}.${crypto.randomUUID()}.previous`;
        await fs.mkdir(stagedTessdata, { recursive: true, mode: 0o700 });
        try {
          for (const language of ["eng", "chi_sim"]) {
            const source = path.join(root, "node_modules", "@tesseract.js-data", language, "4.0.0", `${language}.traineddata.gz`);
            await fs.copyFile(source, path.join(stagedTessdata, `${language}.traineddata.gz`));
          }
          const exists = await fs.lstat(tessdata).then(() => true, () => false);
          if (exists) await fs.rename(tessdata, previousTessdata);
          try { await fs.rename(stagedTessdata, tessdata); await fs.rm(previousTessdata, { recursive: true, force: true }); }
          catch (error) { if (exists) await fs.rename(previousTessdata, tessdata).catch(() => undefined); throw error; }
        } finally {
          await fs.rm(stagedTessdata, { recursive: true, force: true }).catch(() => undefined);
          await fs.rm(previousTessdata, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      const versions = Object.fromEntries(group.roots.map(name => [name, runtimePackageVersion(name)]));
      const markerDirectory = path.join(root, ".groups");
      await fs.mkdir(markerDirectory, { recursive: true, mode: 0o700 });
      const marker = path.join(markerDirectory, `${groupId}.json`);
      const stagedMarker = `${marker}.${crypto.randomUUID()}.new`;
      const previousMarker = `${marker}.${crypto.randomUUID()}.previous`;
      await fs.writeFile(stagedMarker, JSON.stringify({ runtimeVersion: manifest.runtimeVersion, versions }), { mode: 0o600 });
      const markerExists = await fs.lstat(marker).then(() => true, () => false);
      if (markerExists) await fs.rename(marker, previousMarker);
      try { await fs.rename(stagedMarker, marker); await fs.rm(previousMarker, { force: true }); }
      catch (error) { if (markerExists) await fs.rename(previousMarker, marker).catch(() => undefined); throw error; }
      const next = status(groupId);
      if (!next.available) throw runtimeError("RUNTIME_INSTALL_INCOMPLETE", `${group.label}安装不完整。`);
      return next;
    });
    queue = task.catch(() => undefined);
    return task;
  }

  return { root, manifest, status, install };
}

module.exports = { runtimeError, parsePax, extractNpmTarball, currentLibc, supportsCurrentPlatform, verifyIntegrity, createRuntimeInstaller };
