"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { downloadResource } = require("./downloader.cjs");
const { extractResource } = require("./extractor.cjs");
const { ensurePrivateDirectory, resolveWithin, readManagedMetadata, writeManagedMetadata } = require("./resource-store.cjs");

function safeSegment(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${label} in the local AI resource manifest`);
  }
  return value;
}

async function hashFile(resourcePath, expected, options = {}) {
  const { hashFile: hash } = require("./downloader.cjs");
  const stat = fs.lstatSync(resourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) return false;
  return (await hash(resourcePath, options.signal)).toLowerCase() === expected.sha256.toLowerCase();
}

async function validateInstalled(resourceRoot, resource, options = {}) {
  try {
    const root = fs.realpathSync(resourceRoot);
    for (const file of resource.files) {
      const target = resolveWithin(root, file.path);
      if (!await hashFile(target, file, options)) return false;
    }
    return true;
  } catch { return false; }
}

function managedResourceLocation(root, resource) {
  return resolveWithin(root, "resources", safeSegment(resource.id, "resource id"), safeSegment(resource.version, "resource version"));
}

function cachePath(root, resource) {
  const extension = resource.archive === "tar.gz" ? ".tar.gz" : resource.archive === "zip" ? ".zip" : ".bin";
  return resolveWithin(root, "cache", `${safeSegment(resource.id, "resource id")}-${safeSegment(resource.version, "resource version")}${extension}`);
}

async function ensureResourceInstalled(root, resource, options = {}) {
  if (options.signal?.aborted) throw new Error("Installation cancelled");
  const relativePath = path.relative(root, managedResourceLocation(root, resource));
  const finalDirectory = managedResourceLocation(root, resource);
  if (await validateInstalled(finalDirectory, resource, options)) {
    return { id: resource.id, version: resource.version, relativePath };
  }
  ensurePrivateDirectory(path.dirname(finalDirectory));
  const archivePath = cachePath(root, resource);
  ensurePrivateDirectory(path.dirname(archivePath));
  await downloadResource(resource, archivePath, {
    cacheDirectory: path.dirname(archivePath),
    signal: options.signal,
    onProgress: (complete, total) => options.onProgress?.(complete, total)
  });
  if (options.signal?.aborted) throw new Error("Installation cancelled");
  options.onPhase?.("installing");
  const staging = resolveWithin(path.dirname(finalDirectory), `.${safeSegment(resource.id, "resource id")}-${process.pid}-${Date.now()}.partial`);
  fs.rmSync(staging, { recursive: true, force: true });
  ensurePrivateDirectory(staging);
  try {
    await extractResource(archivePath, staging, resource, { signal: options.signal });
    if (!await validateInstalled(staging, resource, options)) throw new Error("Installed runtime failed its file integrity check");
    if (options.signal?.aborted) throw new Error("Installation cancelled");
    fs.mkdirSync(path.dirname(finalDirectory), { recursive: true, mode: 0o700 });
    if (fs.existsSync(finalDirectory)) fs.rmSync(finalDirectory, { recursive: true, force: true });
    fs.renameSync(staging, finalDirectory);
    const metadata = readManagedMetadata(root);
    const entry = { id: resource.id, version: resource.version, relativePath };
    writeManagedMetadata(root, {
      resources: [...metadata.resources.filter((item) => item?.id !== resource.id), entry]
    });
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(`${archivePath}.part.json`, { force: true });
    return entry;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function getInstalledResource(root, resource, options = {}) {
  const metadata = readManagedMetadata(root);
  const entry = metadata.resources.find((item) => item?.id === resource.id && item?.version === resource.version);
  if (!entry || typeof entry.relativePath !== "string") return null;
  const directory = resolveWithin(root, entry.relativePath);
  return await validateInstalled(directory, resource, options) ? { ...entry, absolutePath: directory } : null;
}

module.exports = {
  safeSegment,
  hashFile,
  validateInstalled,
  managedResourceLocation,
  cachePath,
  ensureResourceInstalled,
  getInstalledResource
};
