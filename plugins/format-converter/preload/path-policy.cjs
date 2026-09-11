"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const { detectFormatByPath, formatById, sniffMagic } = require("./format-registry.cjs");

const LIMITS = Object.freeze({
  maxUiFiles: 200,
  maxMcpFiles: 50,
  maxTotalBytes: 5 * 1024 ** 3,
  maxMcpTotalBytes: 1024 ** 3,
  maxFileBytes: 512 * 1024 ** 2,
  maxPdfBytes: 128 * 1024 ** 2,
  maxImagePixels: 100_000_000,
  maxPdfPages: 1000,
  grantTtlMs: 12 * 60 * 60 * 1000
});

function policyError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function inspectInput(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) || filePath.length > 4096) throw policyError("INVALID_INPUT_PATH", "输入文件必须使用有效的绝对路径。", { filePath });
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat) throw policyError("INPUT_NOT_FOUND", `输入文件不存在：${path.basename(filePath)}`);
  if (stat.isSymbolicLink()) throw policyError("SYMLINK_NOT_ALLOWED", `不处理符号链接：${path.basename(filePath)}`);
  if (!stat.isFile()) throw policyError("INPUT_NOT_FOUND", `输入文件不存在：${path.basename(filePath)}`);
  if (stat.size <= 0 || stat.size > LIMITS.maxFileBytes) throw policyError("FILE_SIZE_LIMIT", `文件大小不在允许范围内：${path.basename(filePath)}`);
  const realPath = await fs.realpath(filePath);
  const expected = detectFormatByPath(realPath);
  if (!expected) throw policyError("FORMAT_NOT_SUPPORTED", `暂不支持该扩展名：${path.extname(realPath) || "无扩展名"}`);
  if (expected === "pdf" && stat.size > LIMITS.maxPdfBytes) throw policyError("PDF_SIZE_LIMIT", `PDF 大小不能超过 ${Math.round(LIMITS.maxPdfBytes / 1024 ** 2)} MB。`);
  const handle = await fs.open(realPath, "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(Math.min(8192, stat.size));
    const result = await handle.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, result.bytesRead);
  } finally { await handle.close(); }
  const detected = sniffMagic(bytes, expected);
  if (!detected) throw policyError("MAGIC_MISMATCH", `文件内容与扩展名不匹配：${path.basename(realPath)}`);
  const definition = formatById(expected);
  return { name: path.basename(realPath), path: realPath, extension: path.extname(realPath).slice(1).toLowerCase(), format: expected, family: definition.family, size: stat.size };
}

function grantId() { return crypto.randomUUID(); }

function createPathPolicy(options = {}) {
  const inputGrants = new Map();
  const outputGrants = new Map();
  const storage = options.storage;
  const approvedKey = options.approvedKey || "format-converter-approved-roots";

  function prune() {
    const now = Date.now();
    for (const [id, grant] of inputGrants) if (grant.expiresAt < now) inputGrants.delete(id);
    for (const [id, grant] of outputGrants) if (grant.expiresAt < now) outputGrants.delete(id);
  }

  async function createInputGrant(paths, mode = "ui") {
    prune();
    const max = mode === "mcp" ? LIMITS.maxMcpFiles : LIMITS.maxUiFiles;
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > max) throw policyError("INPUT_COUNT_LIMIT", `单次最多处理 ${max} 个文件。`);
    const unique = [...new Set(paths)];
    const files = [];
    let totalBytes = 0;
    for (const filePath of unique) {
      const file = await inspectInput(filePath);
      totalBytes += file.size;
      const limit = mode === "mcp" ? LIMITS.maxMcpTotalBytes : LIMITS.maxTotalBytes;
      if (totalBytes > limit) throw policyError("BATCH_SIZE_LIMIT", `批次总大小超过 ${Math.round(limit / 1024 ** 3)} GB。`);
      files.push(file);
    }
    const grant = { id: grantId(), files, totalBytes, expiresAt: Date.now() + LIMITS.grantTtlMs };
    inputGrants.set(grant.id, grant);
    return grant;
  }

  async function approvedRoots() {
    const raw = storage?.getItem?.(approvedKey);
    const roots = Array.isArray(raw) ? raw : [];
    const valid = [];
    for (const root of roots) {
      if (typeof root !== "string" || !path.isAbsolute(root)) continue;
      try { if ((await fs.stat(root)).isDirectory()) valid.push(await fs.realpath(root)); } catch {}
    }
    return [...new Set(valid)];
  }

  async function rememberRoot(root) {
    if (!storage?.setItem) return;
    const roots = await approvedRoots();
    if (!roots.includes(root)) roots.push(root);
    storage.setItem(approvedKey, roots.slice(-20));
  }

  async function removeApprovedRoot(root) {
    const realRoot = path.isAbsolute(root) ? await fs.realpath(root).catch(() => root) : root;
    const roots = (await approvedRoots()).filter(item => item !== realRoot);
    storage?.setItem?.(approvedKey, roots);
    return roots;
  }

  async function createOutputGrant(directory, persist = true) {
    prune();
    if (typeof directory !== "string" || !path.isAbsolute(directory) || directory.length > 4096) throw policyError("INVALID_OUTPUT_PATH", "输出目录必须使用有效的绝对路径。", { directory });
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat || !stat.isDirectory()) throw policyError("OUTPUT_NOT_FOUND", "输出目录不存在。");
    if (stat.isSymbolicLink()) throw policyError("SYMLINK_NOT_ALLOWED", "输出目录不能是符号链接。");
    const realDirectory = await fs.realpath(directory);
    await fs.access(realDirectory, fssync.constants.W_OK);
    const grant = { id: grantId(), directory: realDirectory, expiresAt: Date.now() + LIMITS.grantTtlMs };
    outputGrants.set(grant.id, grant);
    if (persist) await rememberRoot(realDirectory);
    return grant;
  }

  async function assertInputFile(file) {
    if (!file || typeof file.path !== "string") throw policyError("INPUT_GRANT_INVALID", "输入文件授权数据无效。");
    const current = await inspectInput(file.path);
    if (current.path !== file.path || current.format !== file.format) throw policyError("INPUT_CHANGED", `输入文件在授权后发生变化：${file.name || path.basename(file.path)}`);
    return current;
  }

  async function assertOutputDirectory(directory) {
    if (typeof directory !== "string" || !path.isAbsolute(directory)) throw policyError("OUTPUT_GRANT_INVALID", "输出目录授权数据无效。");
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw policyError("OUTPUT_CHANGED", "输出目录在授权后发生变化，请重新授权。");
    const realDirectory = await fs.realpath(directory);
    if (realDirectory !== directory) throw policyError("OUTPUT_CHANGED", "输出目录在授权后发生变化，请重新授权。");
    await fs.access(realDirectory, fssync.constants.W_OK);
    return realDirectory;
  }

  function requireInputGrant(id) {
    prune();
    const grant = inputGrants.get(id);
    if (!grant) throw policyError("INPUT_GRANT_EXPIRED", "输入文件授权已过期，请重新选择文件。");
    return grant;
  }

  function requireOutputGrant(id) {
    prune();
    const grant = outputGrants.get(id);
    if (!grant) throw policyError("OUTPUT_GRANT_EXPIRED", "输出目录授权已过期，请重新选择目录。");
    return grant;
  }

  async function grantsForMcp(inputs, outputDirectory, write) {
    const roots = await approvedRoots();
    if (!roots.length) throw policyError("WORKSPACE_APPROVAL_REQUIRED", "请先在插件中选择并授权一个转换工作区。");
    const resolvedInputs = await Promise.all(inputs.map(item => fs.realpath(item).catch(() => item)));
    if (resolvedInputs.some(candidate => !roots.some(root => isWithin(root, candidate)))) throw policyError("PATH_NOT_APPROVED", "MCP 输入路径不在已授权工作区内。");
    const inputGrant = await createInputGrant(resolvedInputs, "mcp");
    if (!write) return { inputGrant };
    const resolvedOutput = await fs.realpath(outputDirectory).catch(() => outputDirectory);
    if (!roots.some(root => isWithin(root, resolvedOutput))) throw policyError("PATH_NOT_APPROVED", "MCP 输出目录不在已授权工作区内。");
    const outputGrant = await createOutputGrant(resolvedOutput, false);
    return { inputGrant, outputGrant };
  }

  return { limits: LIMITS, createInputGrant, createOutputGrant, assertInputFile, assertOutputDirectory, requireInputGrant, requireOutputGrant, approvedRoots, removeApprovedRoot, grantsForMcp };
}

module.exports = { LIMITS, policyError, isWithin, inspectInput, createPathPolicy };
