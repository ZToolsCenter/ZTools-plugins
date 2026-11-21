"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { once } = require("node:events");

const REDIRECT_LIMIT = 5;
const IDLE_TIMEOUT_MS = 30_000;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024 * 1024;
const BUILTIN_DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "huggingface.co", "cdn-lfs.huggingface.co"]);

function validateResource(resource) {
  if (!resource || !/^https:\/\//i.test(resource.url || "")) throw new Error("Resource URL must use HTTPS");
  const parsed = new URL(resource.url);
  if (parsed.username || parsed.password || parsed.hash || (parsed.port && parsed.port !== "443")) {
    throw new Error("Resource URL contains unsupported credentials, port, or fragment data");
  }
  const host = parsed.hostname.toLowerCase();
  const permitted = new Set([...BUILTIN_DOWNLOAD_HOSTS, ...(resource.allowedHosts || []).map((x) => String(x).toLowerCase())]);
  if (!permitted.has(host)) throw new Error(`Unapproved model download host: ${host}`);
  if (!/^[a-f\d]{64}$/i.test(resource.sha256 || "")) throw new Error("Resource has no verified SHA-256 digest");
  if (!Number.isSafeInteger(resource.size) || resource.size <= 0 || resource.size > MAX_RESOURCE_BYTES) {
    throw new Error("Resource size is invalid or exceeds the configured limit");
  }
}

function requestOnce(url, headers, options) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.get(target, { headers, signal: options.signal }, (response) => {
      resolve({ request, response });
    });
    request.setTimeout(options.idleTimeoutMs || IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error("Download timed out while waiting for data"));
    });
    request.once("error", reject);
  });
}

async function openResponse(initialUrl, headers, options) {
  let url = initialUrl;
  for (let redirects = 0; ; redirects++) {
    const { request, response } = await requestOnce(url, headers, options);
    if (![301, 302, 303, 307, 308].includes(response.statusCode)) return { response, request };
    response.resume();
    if (redirects >= REDIRECT_LIMIT || !response.headers.location) throw new Error("Too many or invalid download redirects");
    const next = new URL(response.headers.location, url);
    if (next.protocol !== "https:") throw new Error("Download redirected outside HTTPS");
    const host = next.hostname.toLowerCase();
    const permitted = new Set([...BUILTIN_DOWNLOAD_HOSTS, ...(options.allowedHosts || []).map((x) => String(x).toLowerCase())]);
    if (!permitted.has(host)) throw new Error(`Download redirected to an unapproved host: ${host}`);
    url = next.href;
  }
}

function getResumeInfo(partialPath, metadataPath, expectedResource) {
  try {
    const partialStat = fs.lstatSync(partialPath);
    const metadataStat = fs.lstatSync(metadataPath);
    if (!partialStat.isFile() || partialStat.isSymbolicLink() || !metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 4096) return null;
    const size = partialStat.size;
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (metadata.version !== expectedResource.version || metadata.size !== expectedResource.size ||
        typeof metadata.etag !== "string" || !metadata.etag || size >= expectedResource.size) return null;
    return { offset: size, etag: metadata.etag };
  } catch {
    return null;
  }
}

function saveResumeInfo(metadataPath, resource, etag) {
  if (!etag || etag.length > 1024) return false;
  const temp = `${metadataPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: resource.version, size: resource.size, etag }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, metadataPath);
  return true;
}

async function hashFile(filePath, signal) {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);
  const abort = () => input.destroy(new Error("Download cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of input) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function downloadResource(resource, destinationPath, options = {}) {
  validateResource(resource);
  const root = path.resolve(options.cacheDirectory || path.dirname(destinationPath));
  const target = path.resolve(destinationPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Download destination escapes the resource cache");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const partialPath = `${target}.part`;
  const metadataPath = `${partialPath}.json`;
  const resume = options.forceFresh ? null : getResumeInfo(partialPath, metadataPath, resource);
  const offset = resume?.offset || 0;
  const headers = { "user-agent": "ZTools-Live-Markdown", "accept-encoding": "identity" };
  if (resume) {
    headers.Range = `bytes=${resume.offset}-`;
    headers["If-Range"] = resume.etag;
  } else {
    fs.rmSync(partialPath, { force: true });
    fs.rmSync(metadataPath, { force: true });
  }

  const { response } = await (options.openResponse || openResponse)(resource.url, headers, {
    signal: options.signal,
    idleTimeoutMs: options.idleTimeoutMs,
    allowedHosts: resource.allowedHosts
  });
  response.once("error", () => {});
  const contentRange = String(response.headers["content-range"] || "").match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  const rangeStart = contentRange ? Number(contentRange[1]) : -1;
  const rangeEnd = contentRange ? Number(contentRange[2]) : -1;
  const rangeTotal = contentRange ? Number(contentRange[3]) : -1;
  const validRange = Boolean(resume && response.statusCode === 206 && contentRange &&
    rangeStart === offset && rangeEnd >= rangeStart && rangeTotal === resource.size && rangeEnd < rangeTotal &&
    response.headers.etag === resume.etag);
  const resumed = validRange;
  if (resume && !resumed) {
    response.destroy();
    fs.rmSync(partialPath, { force: true });
    fs.rmSync(metadataPath, { force: true });
    return downloadResource(resource, destinationPath, { ...options, forceFresh: true });
  }
  if (!resumed && response.statusCode !== 200) {
    response.resume();
    throw new Error(`Unexpected download response: ${response.statusCode}`);
  }

  const etag = response.headers.etag;
  if (!resumed) saveResumeInfo(metadataPath, resource, etag);
  const startingOffset = resumed ? offset : 0;
  const expectedResponseBytes = resumed ? rangeEnd - rangeStart + 1 : resource.size;
  const declaredSize = Number(response.headers["content-length"]);
  if (Number.isFinite(declaredSize) && declaredSize !== expectedResponseBytes) {
    response.destroy();
    throw new Error("Download length does not match the signed resource manifest");
  }
  const stream = (options.createWriteStream || fs.createWriteStream)(partialPath, { flags: resumed ? "a" : "w", mode: 0o600 });
  let streamError = null;
  stream.on("error", (error) => { streamError = error; });
  let received = 0;
  const report = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const abort = () => {
    response.destroy(new Error("Download cancelled"));
    stream.destroy(new Error("Download cancelled"));
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of response) {
      received += chunk.length;
      if (received > expectedResponseBytes || streamError) throw streamError || new Error("Download exceeded its declared size");
      if (!stream.write(chunk)) await once(stream, "drain");
      report(startingOffset + received, resource.size);
    }
    stream.end();
    await once(stream, "finish");
    if (received !== expectedResponseBytes || startingOffset + received !== resource.size) {
      throw new Error("Download ended before the expected size; the verified range can resume later");
    }
    const actualDigest = await hashFile(partialPath, options.signal);
    if (actualDigest.toLowerCase() !== resource.sha256.toLowerCase()) {
      fs.rmSync(partialPath, { force: true });
      fs.rmSync(metadataPath, { force: true });
      throw new Error("Downloaded resource failed SHA-256 verification");
    }
    fs.renameSync(partialPath, target);
    fs.rmSync(metadataPath, { force: true });
    return { path: target, size: resource.size, sha256: actualDigest };
  } catch (error) {
    response.destroy();
    stream.destroy();
    if (options.signal?.aborted) throw new Error("Download cancelled");
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

module.exports = { validateResource, downloadResource, hashFile };
