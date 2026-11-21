"use strict";

const PROFILE_ORDER = ["light", "balanced", "quality"];
const PROFILE_MODELS = {
  light: { modelId: "Qwen3-0.6B-Q4_K_M.gguf", label: "省资源 · Qwen3 0.6B" },
  balanced: { modelId: "Qwen3-1.7B-Q4_K_M.gguf", label: "均衡 · Qwen3 1.7B" },
  quality: { modelId: "Qwen3-4B-Q4_K_M.gguf", label: "更高质量 · Qwen3 4B" }
};
const DEFAULT_MANIFEST = require("./manifest-data.json");

const SUPPORTED_PLATFORMS = [
  ["darwin", "arm64"], ["darwin", "x64"],
  ["win32", "x64"], ["win32", "arm64"], ["linux", "x64"], ["linux", "arm64"]
];

function isSupportedPlatform(platform, arch) {
  return SUPPORTED_PLATFORMS.some(([supportedPlatform, supportedArch]) =>
    platform === supportedPlatform && arch === supportedArch
  );
}

function isValidResource(resource) {
  if (!resource || typeof resource !== "object" || typeof resource.id !== "string" ||
      !/^https:\/\//i.test(resource.url || "") || !/^[a-f\d]{64}$/i.test(resource.sha256 || "") ||
      !Number.isSafeInteger(resource.size) || resource.size <= 0 ||
      typeof resource.version !== "string" || !resource.version.trim() ||
      !["file", "zip", "tar.gz"].includes(resource.archive) ||
      !["cpu", "metal", "vulkan", "cuda"].includes(resource.backend) ||
      typeof resource.entryPoint !== "string" || !resource.entryPoint ||
      !Array.isArray(resource.files) || resource.files.length === 0) return false;
  const paths = new Set();
  for (const file of resource.files) {
    if (!file || typeof file.path !== "string" || !file.path || file.path.includes("\\") ||
        file.path.startsWith("/") || /^[a-zA-Z]:/.test(file.path) ||
        file.path.split("/").some((part) => !part || part === "." || part === "..") ||
        !Number.isSafeInteger(file.size) || file.size <= 0 || !/^[a-f\d]{64}$/i.test(file.sha256 || "") ||
        paths.has(file.path) || (file.executable !== undefined && typeof file.executable !== "boolean") ||
        (file.linkTarget !== undefined && (typeof file.linkTarget !== "string" || !file.linkTarget))) return false;
    paths.add(file.path);
  }
  if (!paths.has(resource.entryPoint)) return false;
  if (resource.archive === "file" && resource.files.length !== 1) return false;
  if (resource.allowedHosts !== undefined && (!Array.isArray(resource.allowedHosts) || resource.allowedHosts.some((host) =>
    typeof host !== "string" || !/^[a-z\d.-]+$/i.test(host)))) return false;
  return true;
}

/**
 * The checked-in manifest pins the published archive and model revisions,
 * including HTTPS URLs and SHA-256 digests. Invalid or incomplete resources
 * are excluded; callers must never invent replacement integrity metadata.
 */
function createManifestCatalog(manifest, platform = process.platform, arch = process.arch) {
  const resources = Array.isArray(manifest?.resources) ? manifest.resources : [];
  const byId = new Map();
  for (const resource of resources) {
    if (!resource || typeof resource !== "object" || typeof resource.id !== "string") continue;
    if (byId.has(resource.id)) throw new Error(`Duplicate local AI resource id: ${resource.id}`);
    if (!isValidResource(resource)) continue;
    byId.set(resource.id, Object.freeze({ ...resource }));
  }

  return Object.freeze({
    version: typeof manifest?.version === "string" ? manifest.version : "",
    profiles: Object.freeze(Object.fromEntries(PROFILE_ORDER.map((id) => {
      const model = PROFILE_MODELS[id];
      const runtimeId = manifest?.runtimeByPlatform?.[`${platform}-${arch}`] || null;
      const runtime = runtimeId ? byId.get(runtimeId) : null;
      const modelResource = byId.get(manifest?.modelByProfile?.[id]);
      return [id, Object.freeze({
        id,
        modelId: modelResource?.modelId || model.modelId,
        label: model.label,
        runtime,
        model: modelResource || null,
        available: Boolean(runtime && modelResource)
      })];
    })))
  });
}

module.exports = {
  PROFILE_ORDER,
  PROFILE_MODELS,
  DEFAULT_MANIFEST,
  SUPPORTED_PLATFORMS,
  isSupportedPlatform,
  isValidResource,
  createManifestCatalog
};
