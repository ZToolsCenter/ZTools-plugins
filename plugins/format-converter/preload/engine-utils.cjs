"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const publishQueues = new Map();

function engineError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function safeStem(filename) {
  const stem = path.basename(filename, path.extname(filename)).normalize("NFKC");
  const sanitized = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
  return sanitized || "converted";
}

async function runProcess(binary, args, options = {}) {
  if (typeof binary !== "string" || !path.isAbsolute(binary)) throw engineError("INVALID_ENGINE", "转换引擎路径无效。");
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.length > 16384) || args.length > 256) throw engineError("INVALID_ENGINE_ARGS", "转换引擎参数无效。");
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 120000, 1000), 30 * 60 * 1000);
  const maxOutputBytes = Math.min(Math.max(options.maxOutputBytes || 4 * 1024 ** 2, 1024), 16 * 1024 ** 2);
  return new Promise((resolve, reject) => {
    let settled = false, stdoutBytes = 0, stderrBytes = 0;
    const stdout = [], stderr = [];
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: [options.stdin == null ? "ignore" : "pipe", "pipe", "pipe"]
    });
    const terminate = () => {
      if (child.exitCode != null) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { try { child.kill(); } catch {} }
    };
    const timer = setTimeout(() => {
      terminate();
      if (!settled) { settled = true; reject(engineError("ENGINE_TIMEOUT", `转换引擎超过 ${Math.round(timeoutMs / 1000)} 秒未完成。`)); }
    }, timeoutMs);
    const onAbort = () => {
      terminate();
      if (!settled) { settled = true; reject(engineError("JOB_CANCELLED", "转换已取消。")); }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", error => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      if (!settled) { settled = true; reject(engineError("ENGINE_START_FAILED", error.message)); }
    });
    const collect = (target, chunk, kind) => {
      const bytes = Buffer.byteLength(chunk);
      if (kind === "stdout") stdoutBytes += bytes; else stderrBytes += bytes;
      if (stdoutBytes + stderrBytes > maxOutputBytes) {
        terminate();
        if (!settled) { settled = true; reject(engineError("ENGINE_OUTPUT_LIMIT", "转换引擎输出超过安全限制。")); }
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on("data", chunk => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", chunk => collect(stderr, chunk, "stderr"));
    child.on("close", code => {
      clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      const result = { exitCode: code ?? -1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      if (code === 0 || options.allowNonZero) resolve(result);
      else reject(engineError("ENGINE_FAILED", result.stderr.trim() || result.stdout.trim() || `转换引擎退出码 ${code}`, { exitCode: code }));
    });
    if (options.stdin != null) { child.stdin.end(options.stdin); }
  });
}

async function uniqueOutputPath(desired, collision) {
  const exists = await fs.access(desired).then(() => true, () => false);
  if (!exists) return desired;
  if (collision === "skip") return null;
  if (collision === "overwrite") return desired;
  const extension = path.extname(desired);
  const stem = path.basename(desired, extension);
  const directory = path.dirname(desired);
  for (let index = 2; index <= 9999; index += 1) {
    const candidate = path.join(directory, `${stem}-${index}${extension}`);
    if (!(await fs.access(candidate).then(() => true, () => false))) return candidate;
  }
  throw engineError("OUTPUT_NAME_EXHAUSTED", `无法为 ${path.basename(desired)} 生成唯一文件名。`);
}

async function stagedPath(finalPath) {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  return path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${crypto.randomUUID()}.partial`);
}

async function verifyFile(filePath, target) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size < 1) throw engineError("OUTPUT_INVALID", `输出文件无效：${path.basename(filePath)}`);
  const handle = await fs.open(filePath, "r");
  let head;
  try { const buffer = Buffer.alloc(Math.min(16, stat.size)); const read = await handle.read(buffer, 0, buffer.length, 0); head = buffer.subarray(0, read.bytesRead); }
  finally { await handle.close(); }
  const ascii = head.toString("ascii");
  if (target === "pdf" && !ascii.startsWith("%PDF")) throw engineError("OUTPUT_MAGIC_MISMATCH", "生成的 PDF 文件头无效。");
  if (target === "png" && !head.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) throw engineError("OUTPUT_MAGIC_MISMATCH", "生成的 PNG 文件头无效。");
  if (target === "jpeg" && !(head[0] === 0xff && head[1] === 0xd8)) throw engineError("OUTPUT_MAGIC_MISMATCH", "生成的 JPEG 文件头无效。");
  if (["docx","xlsx","pptx"].includes(target) && head.subarray(0,4).toString("hex") !== "504b0304") throw engineError("OUTPUT_MAGIC_MISMATCH", "生成的 Office 文件不是有效 OOXML 容器。");
  return stat;
}

async function publishStaged(staged, desired, target, collision) {
  const directory = path.dirname(desired);
  const previous = publishQueues.get(directory) || Promise.resolve();
  let release;
  const turn = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => turn);
  publishQueues.set(directory, tail);
  await previous;
  try {
    await verifyFile(staged, target);
    const finalPath = await uniqueOutputPath(desired, collision);
    if (!finalPath) { await fs.rm(staged, { force: true }); return null; }
    if (collision === "overwrite" && fssync.existsSync(finalPath)) {
      const backup = `${finalPath}.${crypto.randomUUID()}.backup`;
      await fs.rename(finalPath, backup);
      try { await fs.rename(staged, finalPath); await fs.rm(backup, { force: true }); }
      catch (error) { await fs.rename(backup, finalPath).catch(() => undefined); throw error; }
    } else await fs.rename(staged, finalPath);
    return finalPath;
  } finally {
    release();
    if (publishQueues.get(directory) === tail) publishQueues.delete(directory);
  }
}

function fileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return encodeURI(`file://${process.platform === "win32" ? "/" : ""}${normalized}`);
}

module.exports = { engineError, safeStem, runProcess, uniqueOutputPath, stagedPath, verifyFile, publishStaged, fileUrl };
