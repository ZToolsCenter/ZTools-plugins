const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createEverythingManager } = require("./everything-manager");

/** @typedef {import("../../addon").AddonModule} AddonModule */

/** @returns {AddonModule | null} */
function loadAddon() {
  const manifestAddon = readAddonManifestFile();
  const candidates = [
    manifestAddon ? path.resolve(__dirname, "..", manifestAddon) : undefined,
    path.resolve(__dirname, "..", "addon.node"),
    path.resolve(__dirname, "..", "..", "addon", "index.node"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return require(candidate);
      }
    } catch (error) {
      console.warn("[local-search-neo] Everything addon 加载失败:", candidate, error);
    }
  }

  return null;
}

const addon = loadAddon();
const everythingAddon = addon?.everything ?? null;
const everythingManager = createEverythingManager(everythingAddon);

function readAddonManifestFile() {
  try {
    const manifestPath = path.resolve(__dirname, "..", "addon-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return typeof manifest.addon === "string" ? manifest.addon : "";
  } catch {
    return "";
  }
}

function getFallbackFileInfo(file) {
  return {
    fullPath: file,
    name: path.basename(file),
    path: path.dirname(file),
    exists: false,
    isDirectory: false,
  };
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  everything: {
    isAvailable() {
      return !!everythingAddon;
    },
    isRunning() {
      return everythingAddon?.isRunning() ?? false;
    },
    isDbLoaded() {
      return everythingAddon?.isDbLoaded() ?? false;
    },
    getStartupStatus() {
      return everythingManager.getStartupStatus();
    },
    ensureReady(options) {
      return everythingManager.ensureReady(options);
    },
    handlePluginOut(isKill) {
      return everythingManager.handlePluginOut(isKill);
    },
    getVersion() {
      if (!everythingAddon) throw new Error("Everything addon is not available");
      return everythingAddon.getVersion();
    },
    query(search, maxResults = 100, sortMode = "modified-desc", matchPath = false) {
      if (!everythingAddon) throw new Error("Everything addon is not available");
      const startupStatus = everythingManager.getStartupStatus();
      if (startupStatus.state !== "ready") throw new Error(startupStatus.message);
      return everythingAddon.query(search, maxResults, sortMode, matchPath);
    },
  },
  async getFileInfo(file) {
    try {
      const stat = await fs.promises.stat(file);
      return {
        fullPath: file,
        name: path.basename(file),
        path: path.dirname(file),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        exists: true,
      };
    } catch {
      return getFallbackFileInfo(file);
    }
  },

  getFileUrl(file) {
    return pathToFileURL(file).href;
  },
  readBinaryFile(file) {
    return fs.readFileSync(file);
  },
  isTextFile(file) {
    if (!addon) throw new Error("Addon is not available");
    return addon.inspectTextFile(file).isText;
  },
  inspectTextFile(file, maxBytes) {
    if (!addon) throw new Error("Addon is not available");
    return addon.inspectTextFile(file, maxBytes);
  },
  readTextPreview(file, maxBytes = 20 * 1024, direction = "start") {
    if (!addon) throw new Error("Addon is not available");
    return addon.readTextPreview(file, maxBytes, direction);
  },
  printDirectoryTree(directory, options) {
    if (!addon) throw new Error("Addon is not available");
    return addon.printDirectoryTree(directory, options);
  },
  printArchiveTree(file, options) {
    if (!addon) throw new Error("Addon is not available");
    return addon.printArchiveTree(file, options);
  },
};

everythingManager.ensureReady().catch((error) => {
  console.warn("[local-search-neo] Everything 初始化失败:", error);
});
