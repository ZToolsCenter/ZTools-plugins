"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const workspaceApi = require("./fs-workspace.cjs");
const exporterApi = require("./exporter.cjs");
const webdavApi = require("./webdav-sync.cjs");
const { createLocalAiService } = require("./local-ai/service.cjs");
const { createMcpService } = require("./mcp/service.cjs");
const { loadMcpConfig, saveMcpConfig } = require("./mcp/config-storage.cjs");
const { createAsyncDocumentWriter } = require("./async-document-writer.cjs");
const { installDevelopmentNavigationDiagnostics } = require("./editor-navigation-diagnostics.cjs");
const asyncDocumentWriter = createAsyncDocumentWriter(fs, path);

const STORAGE_KEY_STATE = "typora_markdown_persisted_state_v1";

function getZTools() {
  if (typeof window !== "undefined" && window.ztools) {
    return window.ztools;
  }
  return null;
}

function getDefaultNotesDir() {
  const home = os.homedir();
  const docsCandidate = path.join(home, "Documents");
  if (fs.existsSync(docsCandidate)) {
    return docsCandidate;
  }
  return home;
}

const CREDENTIAL_PREFIX = "enc:v1:";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function encodeCredential(plain) {
  if (typeof plain !== "string" || !plain) return "";
  if (plain.startsWith(CREDENTIAL_PREFIX)) return plain;
  const reversed = Buffer.from(plain, "utf8").toString("base64").split("").reverse().join("");
  return `${CREDENTIAL_PREFIX}${reversed}`;
}

function decodeCredential(stored) {
  if (typeof stored !== "string" || !stored) return "";
  if (!stored.startsWith(CREDENTIAL_PREFIX)) return stored;
  try {
    const payload = stored.slice(CREDENTIAL_PREFIX.length).split("").reverse().join("");
    return Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function hydratePersistedState(stateObj) {
  if (!stateObj || typeof stateObj !== "object") return null;
  const cloned = { ...stateObj };
  if (cloned.webdavConfig && typeof cloned.webdavConfig === "object") {
    cloned.webdavConfig = {
      ...cloned.webdavConfig,
      password: decodeCredential(cloned.webdavConfig.password)
    };
  }
  return cloned;
}

function dehydratePersistedState(stateObj) {
  if (!stateObj || typeof stateObj !== "object") return {};
  const cloned = { ...stateObj };
  if (cloned.webdavConfig && typeof cloned.webdavConfig === "object") {
    cloned.webdavConfig = {
      ...cloned.webdavConfig,
      password: encodeCredential(cloned.webdavConfig.password)
    };
  }
  return cloned;
}

function loadPersistedState() {
  const ztools = getZTools();
  try {
    if (ztools && ztools.dbStorage && typeof ztools.dbStorage.getItem === "function") {
      const raw = ztools.dbStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return null;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return hydratePersistedState(parsed);
    }
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      return raw ? hydratePersistedState(JSON.parse(raw)) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function savePersistedState(statePatch) {
  const current = loadPersistedState() || {};
  const merged = { ...current, ...statePatch, updatedAt: Date.now() };
  const serialized = JSON.stringify(dehydratePersistedState(merged));
  const ztools = getZTools();
  try {
    if (ztools && ztools.dbStorage && typeof ztools.dbStorage.setItem === "function") {
      ztools.dbStorage.setItem(STORAGE_KEY_STATE, serialized);
      return merged;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_STATE, serialized);
    }
  } catch {
    // Ignore storage quota errors
  }
  return merged;
}

function selectOpenFile(options = {}) {
  const ztools = getZTools();
  if (ztools && typeof ztools.showOpenDialog === "function") {
    const result = ztools.showOpenDialog({
      title: options.title || "打开 Markdown 文档",
      defaultPath: options.defaultPath || getDefaultNotesDir(),
      filters: options.filters || [
        {
          name: "Markdown Documents",
          extensions: ["md", "markdown", "mdown", "mkdn", "mkd", "mdtxt", "txt"]
        }
      ],
      properties: ["openFile"]
    });
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
  }
  return null;
}

function selectOpenFolder(options = {}) {
  const ztools = getZTools();
  if (ztools && typeof ztools.showOpenDialog === "function") {
    const result = ztools.showOpenDialog({
      title: options.title || "打开文件夹作为本地工作区",
      defaultPath: options.defaultPath || getDefaultNotesDir(),
      properties: ["openDirectory", "createDirectory"]
    });
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
  }
  return null;
}

function selectOpenFolders(options = {}) {
  const ztools = getZTools();
  if (ztools && typeof ztools.showOpenDialog === "function") {
    const result = ztools.showOpenDialog({
      title: options.title || "添加文件夹到工作区",
      defaultPath: options.defaultPath || getDefaultNotesDir(),
      properties: ["openDirectory", "createDirectory", "multiSelections"]
    });
    if (Array.isArray(result) && result.length > 0) {
      return result.filter((item) => typeof item === "string" && item.trim());
    }
  }
  return [];
}

function selectSaveFile(options = {}) {
  const ztools = getZTools();
  if (ztools && typeof ztools.showSaveDialog === "function") {
    const result = ztools.showSaveDialog({
      title: options.title || "保存文件",
      defaultPath: options.defaultPath || path.join(getDefaultNotesDir(), "Untitled.md"),
      filters: options.filters || [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "HTML", extensions: ["html"] }
      ]
    });
    if (typeof result === "string" && result.trim()) {
      return result.trim();
    }
  }
  return null;
}

function selectImageFile(options = {}) {
  const ztools = getZTools();
  if (ztools && typeof ztools.showOpenDialog === "function") {
    const result = ztools.showOpenDialog({
      title: options.title || "选择本地图片",
      defaultPath: options.defaultPath || getDefaultNotesDir(),
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]
        }
      ],
      properties: ["openFile"]
    });
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
  }
  return null;
}

function copyTextToClipboard(text) {
  const ztools = getZTools();
  if (ztools && typeof ztools.copyText === "function") {
    ztools.copyText(String(text ?? ""));
    return true;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(String(text ?? "")).catch(() => {});
    return true;
  }
  return false;
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl ?? "").trim());
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  const safeUrl = String(url ?? "").trim();
  if (!safeUrl || !isAllowedExternalUrl(safeUrl)) return false;
  const ztools = getZTools();
  if (ztools && typeof ztools.shellOpenExternal === "function") {
    ztools.shellOpenExternal(safeUrl);
    return true;
  }
  if (typeof window !== "undefined" && typeof window.open === "function") {
    window.open(safeUrl, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}

function revealInFinder(targetPath) {
  const resolved = workspaceApi.assertNonEmptyPath(targetPath, "targetPath");
  const ztools = getZTools();
  if (ztools && typeof ztools.shellShowItemInFolder === "function") {
    ztools.shellShowItemInFolder(resolved);
    return true;
  }
  if (ztools && typeof ztools.shellOpenPath === "function") {
    ztools.shellOpenPath(path.dirname(resolved));
    return true;
  }
  return false;
}

function isDirectory(targetPath) {
  try {
    if (!targetPath || typeof targetPath !== "string") return false;
    return fs.statSync(path.resolve(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function ensurePluginWindowExpanded() {
  const ztools = getZTools();
  if (ztools && typeof ztools.setExpendHeight === "function") {
    try {
      ztools.setExpendHeight(820);
    } catch {
      // Ignore height adjustment errors
    }
  }
}

function recoverFromDeadDevServerIfNeeded() {
  if (typeof window === "undefined" || !window.location) return;
  try {
    const href = String(window.location.href || "");
    const isErrorPage =
      href.startsWith("chrome-error://") ||
      (href.startsWith("http://127.0.0.1") &&
        typeof document !== "undefined" &&
        !document.getElementById("root"));
    if (!isErrorPage) return;

    const { pathToFileURL } = require("node:url");
    const candidates = [
      path.resolve(__dirname, "..", "dist", "index.html"),
      path.resolve(__dirname, "..", "index.html")
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        window.location.replace(pathToFileURL(candidate).href);
        break;
      }
    }
  } catch {
    // Ignore recovery error
  }
}

const enterListeners = new Set();
let lastEnterAction = null;

function subscribePluginEnter(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  enterListeners.add(listener);
  if (lastEnterAction) {
    try {
      listener(lastEnterAction);
    } catch {
      // Ignore listener error
    }
  }
  return () => {
    enterListeners.delete(listener);
  };
}

function bindZToolsLifecycle() {
  ensurePluginWindowExpanded();
  const ztools = getZTools();
  if (!ztools || typeof ztools.onPluginEnter !== "function") {
    return;
  }
  ztools.onPluginEnter((action) => {
    ensurePluginWindowExpanded();
    recoverFromDeadDevServerIfNeeded();
    lastEnterAction = action;
    for (const listener of enterListeners) {
      try {
        listener(action);
      } catch {
        // Ignore listener error
      }
    }
  });
}

function searchAcrossWorkspaces(roots, query, options = {}) {
  const seenPaths = new Set();
  const mergedResults = [];
  let totalMatches = 0;
  let succeededRoots = 0;
  let lastError = null;

  for (const rootDir of roots) {
    try {
      const response = workspaceApi.searchInWorkspace(rootDir, query, options);
      succeededRoots += 1;
      for (const fileResult of response.results || []) {
        if (seenPaths.has(fileResult.path)) continue;
        seenPaths.add(fileResult.path);
        mergedResults.push(fileResult);
        totalMatches += Array.isArray(fileResult.matches) ? fileResult.matches.length : 0;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (succeededRoots === 0 && lastError) {
    throw lastError;
  }

  return {
    totalMatches,
    fileCount: mergedResults.length,
    results: mergedResults
  };
}

function createBridgeApi() {
  let activeWorkspaceRoots = [];
  let explicitRootsManaged = false;
  const recordImplicitRoot = (rootDir) => {
    if (explicitRootsManaged || !rootDir) return;
    if (!activeWorkspaceRoots.includes(rootDir)) {
      activeWorkspaceRoots = [...activeWorkspaceRoots, rootDir];
    }
  };
  const mcp = createMcpService({
    loadConfig: loadMcpConfig,
    saveConfig: saveMcpConfig,
    workspaceSearch: (query) => {
      if (activeWorkspaceRoots.length === 0) throw new Error("请先打开工作区再进行搜索");
      return searchAcrossWorkspaces(activeWorkspaceRoots, query, { maxDepth: 8, maxFiles: 500 });
    }
  });
  return {
    // The factory is side-effect free until an explicit deploy() call.
    localAi: createLocalAiService(),
    mcp,
    getDefaultNotesDir,
    loadPersistedState,
    savePersistedState,
    selectOpenFile,
    selectOpenFolder,
    selectOpenFolders,
    selectSaveFile,
    selectImageFile,
    copyTextToClipboard,
    openExternalUrl,
    revealInFinder,
    isDirectory,
    subscribePluginEnter,
    setWorkspaceRoots: (roots) => {
      explicitRootsManaged = true;
      const unique = [];
      for (const item of Array.isArray(roots) ? roots : []) {
        if (typeof item === "string" && item.trim()) {
          const resolved = workspaceApi.assertNonEmptyPath(item, "rootDir");
          if (!unique.includes(resolved)) unique.push(resolved);
        }
      }
      activeWorkspaceRoots = unique;
    },
    readDocument: workspaceApi.readDocument,
    writeDocument: workspaceApi.writeDocument,
    writeDocumentAsync: asyncDocumentWriter.writeDocumentAsync,
    createDocument: workspaceApi.createDocument,
    createFolder: workspaceApi.createFolder,
    renameEntry: workspaceApi.renameEntry,
    duplicateDocument: workspaceApi.duplicateDocument,
    deleteEntry: workspaceApi.deleteEntry,
    listDirectoryChildren: workspaceApi.listDirectoryChildren,
    scanWorkspace: (rootDir, options) => {
      const workspace = workspaceApi.scanWorkspace(rootDir, options);
      recordImplicitRoot(workspace.rootDir);
      return workspace;
    },
    searchInWorkspace: (rootDir, query, options) => {
      const response = workspaceApi.searchInWorkspace(rootDir, query, options);
      recordImplicitRoot(rootDir);
      return response;
    },
    copyImageToAssets: workspaceApi.copyImageToAssets,
    resolveImageUrl: workspaceApi.resolveImageUrl,
    buildStandaloneHtml: exporterApi.buildStandaloneHtml,
    exportHtmlFile: exporterApi.exportHtmlFile,
    testWebdavConnection: webdavApi.testWebdavConnection,
    listWebdavFiles: webdavApi.listWebdavFiles,
    pushWebdavDocument: webdavApi.pushWebdavDocument,
    pullWebdavDocument: webdavApi.pullWebdavDocument,
    deleteWebdavDocument: webdavApi.deleteWebdavDocument,
    syncWorkspaceWithWebdav: webdavApi.syncWorkspaceWithWebdav
  };
}

const bridgeApi = createBridgeApi();

if (typeof window !== "undefined") {
  bridgeApi.dispose = () => { bridgeApi.mcp.dispose(); return bridgeApi.localAi.dispose(); };
  window.typoraBridge = bridgeApi;
  window.services = bridgeApi;
  bindZToolsLifecycle();
  if (typeof window.addEventListener === "function") {
    const disposeLocalAi = () => {
      bridgeApi.dispose();
      void bridgeApi.localAi.release().catch(() => {});
    };
    window.addEventListener("beforeunload", disposeLocalAi);
    window.addEventListener("pagehide", disposeLocalAi);
    window.addEventListener("DOMContentLoaded", () => {
      ensurePluginWindowExpanded();
      recoverFromDeadDevServerIfNeeded();
      const navigationDiagnostics = installDevelopmentNavigationDiagnostics({ preloadDirectory: __dirname, windowRef: window });
      window.addEventListener("pagehide", () => navigationDiagnostics.uninstall(), { once: true });
    });
  }
}

module.exports = bridgeApi;
