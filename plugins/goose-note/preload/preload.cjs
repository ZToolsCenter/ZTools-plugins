// preload 运行在 CJS，避免与主项目 ESM 冲突
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn, spawnSync } = require("child_process");
const { URL: NodeURL } = require("url");
const {
  buildLocalPageId,
  createSnippet,
  extractMarkdownTitle,
  extractTextFromPageContent,
  extractTitleFromPageContent,
  getNextOffset,
  parsePersistedNotebooks,
  searchNoteItems,
  sortNoteItems,
  stripMarkdownSyntax,
} = require("./mcp-tools.cjs");
const { fetchPublicText } = require("./web-fetch.cjs");

if (typeof window !== "undefined" && typeof utools !== "undefined") {
  window.utools = utools;
  const PENDING_OPEN_FOLDER_KEY = "__gooseNotePendingOpenFolder";
  const SETTINGS_STORAGE_KEY = "goose-note-settings";
  const NOTEBOOK_STORAGE_KEY = "goose-note-notebooks";
  const INTERNAL_PAGE_DOC_PREFIX = "gn:page:";
  const STORAGE_FALLBACK_DOC_PREFIX = "gn:storage:";
  const UTOOLS_WINDOW_HEIGHT_MIN = 600;
  const UTOOLS_WINDOW_HEIGHT_MAX = 1200;
  const LOCAL_NOTE_SCAN_CACHE_TTL_MS = 3000;
  const LOCAL_IGNORED_FOLDERS = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    ".vscode",
    ".idea",
    "target",
    "__pycache__",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
  ]);
  const localNotebookScanCache = new Map();

  const clampWindowHeight = (height) => {
    const normalized = Number(height);
    if (!Number.isFinite(normalized)) return UTOOLS_WINDOW_HEIGHT_MIN;
    return Math.min(
      UTOOLS_WINDOW_HEIGHT_MAX,
      Math.max(UTOOLS_WINDOW_HEIGHT_MIN, Math.round(normalized)),
    );
  };

  const getStorageDocId = (storageKey) => `${STORAGE_FALLBACK_DOC_PREFIX}${storageKey}`;

  const readStoredDocString = (storageKey) => {
    try {
      if (utools?.db?.get) {
        const doc = utools.db.get(getStorageDocId(storageKey));
        if (typeof doc?.data === "string") {
          return doc.data;
        }
        if (typeof doc?.data?.value === "string") {
          return doc.data.value;
        }
      }
    } catch (error) {
      console.error("[goose-note] read storage doc failed:", error);
    }
    return null;
  };

  const writeStoredDocString = (storageKey, value) => {
    try {
      if (utools?.db?.put && utools?.db?.get) {
        const docId = getStorageDocId(storageKey);
        const current = utools.db.get(docId);
        let result = utools.db.put({
          _id: docId,
          _rev: current?._rev,
          data: {
            value,
            updatedAt: Date.now(),
          },
        });
        if (result?.ok !== false) return true;

        const latest = utools.db.get(docId);
        result = utools.db.put({
          _id: docId,
          _rev: latest?._rev,
          data: {
            value,
            updatedAt: Date.now(),
          },
        });
        if (result?.ok !== false) return true;
      }
    } catch (error) {
      console.error("[goose-note] write storage doc failed:", error);
    }
    return false;
  };

  const removeDbStorageString = (storageKey) => {
    try {
      if (typeof utools?.dbStorage?.removeItem === "function") {
        utools.dbStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error("[goose-note] remove dbStorage failed:", error);
    }
  };

  const readStoredString = (storageKey) => {
    const storedValue = readStoredDocString(storageKey);
    if (storedValue !== null) return storedValue;

    try {
      if (typeof utools?.dbStorage?.getItem === "function") {
        const value = utools.dbStorage.getItem(storageKey);
        if (typeof value === "string") {
          if (writeStoredDocString(storageKey, value)) {
            removeDbStorageString(storageKey);
          }
          return value;
        }
      }
    } catch (error) {
      console.error("[goose-note] read dbStorage failed:", error);
    }

    return null;
  };

  const writeStoredString = (storageKey, value) => {
    if (writeStoredDocString(storageKey, value)) {
      removeDbStorageString(storageKey);
    }
  };

  const readStoredSettingsWindowHeight = () => {
    const parseWindowHeight = (rawValue) => {
      if (typeof rawValue !== "string" || !rawValue) return null;
      try {
        const parsed = JSON.parse(rawValue);
        return clampWindowHeight(parsed?.state?.utools?.windowHeight);
      } catch (error) {
        console.error("[goose-note] parse persisted settings failed:", error);
        return null;
      }
    };

    const storedValue = readStoredString(SETTINGS_STORAGE_KEY);
    const parsedHeight = parseWindowHeight(storedValue);
    if (parsedHeight !== null) return parsedHeight;

    return null;
  };

  const applyStoredWindowHeightBeforeRender = () => {
    try {
      const storedHeight = readStoredSettingsWindowHeight();
      const initialHeight = storedHeight ?? UTOOLS_WINDOW_HEIGHT_MIN;
      if (typeof utools?.setExpendHeight === "function") {
        utools.setExpendHeight(initialHeight);
      }
    } catch (error) {
      console.error("[goose-note] apply initial window height failed:", error);
    }
  };

  applyStoredWindowHeightBeforeRender();

  const invalidateLocalNotebookCache = () => {
    localNotebookScanCache.clear();
  };

  const clampLimit = (value, fallback) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return fallback;
    return Math.min(500, Math.max(1, Math.floor(normalized)));
  };

  const clampOffset = (value, fallback = 0) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return fallback;
    return Math.max(0, Math.floor(normalized));
  };

  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  };

  const listPersistedNotebooks = () => {
    const notebooks = parsePersistedNotebooks(readStoredString(NOTEBOOK_STORAGE_KEY));
    return notebooks.length > 0
      ? notebooks
      : [
          {
            id: "default-notebook",
            name: "Note",
            source: "default",
          },
        ];
  };

  // 本地文件变更监听映射
  const watchers = new Map();
  // 最近写入的文件标记，用于避免自己写入触发重载提示
  const recentWrites = new Map();

  const tryTrash = async (targetPath) => {
    try {
      if (utools?.shellTrashItem) {
        await utools.shellTrashItem(targetPath);
        return true;
      }
    } catch (err) {
      console.error("[gooseFs] shellTrashItem failed:", err);
    }

    return false;
  };

  const resolveWriteEncoding = (encoding) =>
    encoding === "base64" || encoding === "binary" ? "base64" : "utf-8";

  const resolveTempTargetPath = (relativePath) => {
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error("relativePath is required");
    }

    const normalized = path
      .normalize(relativePath)
      .replace(/^(\.\.(\/|\\|$))+/, "")
      .replace(/^[/\\]+/, "");
    const targetPath = path.join(os.tmpdir(), normalized);

    if (!targetPath.startsWith(os.tmpdir())) {
      throw new Error("invalid temp path");
    }

    return targetPath;
  };

  const getBase64ByteLength = (contentBase64) => {
    const sanitized = String(contentBase64 || "").replace(/\s+/g, "");
    if (!sanitized) return 0;
    const padding = sanitized.endsWith("==") ? 2 : sanitized.endsWith("=") ? 1 : 0;
    return Math.floor((sanitized.length * 3) / 4) - padding;
  };

  const removeExpiredEntries = async (targetPath, cutoff) => {
    let stat;
    try {
      stat = await fs.promises.stat(targetPath);
    } catch {
      return;
    }

    if (stat.isDirectory()) {
      let children = [];
      try {
        children = await fs.promises.readdir(targetPath);
      } catch {
        return;
      }

      await Promise.all(
        children.map((child) => removeExpiredEntries(path.join(targetPath, child), cutoff)),
      );

      try {
        const remaining = await fs.promises.readdir(targetPath);
        if (remaining.length === 0) {
          await fs.promises.rmdir(targetPath);
        }
      } catch {}
      return;
    }

    if (stat.mtimeMs >= cutoff) return;

    try {
      await fs.promises.unlink(targetPath);
    } catch (err) {
      console.error("[gooseFs] cleanup temp file failed:", err);
    }
  };

  const revealItemInFolder = (targetPath) => {
    try {
      if (typeof utools?.shellShowItemInFolder === "function") {
        return !!utools.shellShowItemInFolder(targetPath);
      }
    } catch (err) {
      console.error("[gooseFs] utools shellShowItemInFolder failed:", err);
    }

    try {
      if (typeof utools?.shellOpenPath === "function") {
        return !!utools.shellOpenPath(path.dirname(targetPath));
      }
    } catch (err) {
      console.error("[gooseFs] utools shellOpenPath failed:", err);
    }

    return false;
  };

  const quoteShellArg = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

  const getCandidateNames = (candidate) => {
    const names = [candidate?.appName, ...(candidate?.aliases || [])]
      .filter((item) => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().replace(/\.app$/i, ""));
    return Array.from(new Set(names));
  };

  const macApplicationRoots = () => [
    "/Applications",
    "/System/Applications",
    "/System/Applications/Utilities",
    "/System/Library/CoreServices",
    path.join(os.homedir(), "Applications"),
  ];

  const commandExistsCache = new Map(); // command -> boolean
  const macAppExistsCache = new Map(); // bundle path -> boolean
  const listAvailableOpenAppsCache = new Map(); // signature -> resolved candidates

  const getCandidatesSignature = (candidates) =>
    candidates
      .map((c) =>
        [
          c?.id,
          c?.appName,
          (Array.isArray(c?.aliases) ? c.aliases : []).join("|"),
          (Array.isArray(c?.commands) ? c.commands : []).join("|"),
          c?.kind,
        ].join("~"),
      )
      .join(";;");

  const macAppExists = (bundlePath) => {
    if (macAppExistsCache.has(bundlePath)) {
      return macAppExistsCache.get(bundlePath);
    }
    let exists = false;
    try {
      exists = fs.existsSync(bundlePath);
    } catch {
      exists = false;
    }
    macAppExistsCache.set(bundlePath, exists);
    return exists;
  };

  const resolveMacAppName = (candidate) => {
    for (const name of getCandidateNames(candidate)) {
      const bundleName = `${name}.app`;
      for (const root of macApplicationRoots()) {
        if (macAppExists(path.join(root, bundleName))) {
          return name;
        }
      }
    }
    return null;
  };

  const commandExists = (command) => {
    if (typeof command !== "string" || !command.trim()) return false;
    const normalized = command.trim();
    if (commandExistsCache.has(normalized)) {
      return commandExistsCache.get(normalized);
    }
    try {
      const result = spawnSync("/bin/zsh", ["-lc", `command -v ${quoteShellArg(normalized)}`], {
        timeout: 1000,
        stdio: "ignore",
      });
      const exists = result.status === 0;
      commandExistsCache.set(normalized, exists);
      return exists;
    } catch {
      commandExistsCache.set(normalized, false);
      return false;
    }
  };

  const resolveOpenAppCandidate = (candidate) => {
    if (!candidate || typeof candidate !== "object") return null;
    if (process.platform === "darwin") {
      const appName = resolveMacAppName(candidate);
      if (appName) return { ...candidate, appName };
    }

    const commands = Array.isArray(candidate.commands) ? candidate.commands : [];
    const command = commands.find(commandExists);
    if (command) return { ...candidate, appName: command };

    if (process.platform !== "darwin") {
      const firstName = getCandidateNames(candidate)[0];
      if (firstName && commandExists(firstName)) return { ...candidate, appName: firstName };
    }

    return null;
  };

  const yieldToEventLoop = () =>
    new Promise((resolve) => {
      if (typeof setImmediate === "function") {
        setImmediate(resolve);
        return;
      }
      setTimeout(resolve, 0);
    });

  const listAvailableOpenApps = async (candidates) => {
    if (!Array.isArray(candidates)) return [];
    const key = `${process.platform}::${getCandidatesSignature(candidates)}`;
    if (listAvailableOpenAppsCache.has(key)) {
      return listAvailableOpenAppsCache.get(key);
    }
    const resolved = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const item = resolveOpenAppCandidate(candidates[i]);
      if (item) resolved.push(item);
      // 分片让出事件循环，避免首次探测整段同步卡死 UI。
      if (i < candidates.length - 1 && (i + 1) % 3 === 0) {
        await yieldToEventLoop();
      }
    }
    listAvailableOpenAppsCache.set(key, resolved);
    return resolved;
  };

  const finishChildLaunch = (child, resolve, fallback) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timeout = setTimeout(() => done(true), 3000);
    child.on("error", () => {
      clearTimeout(timeout);
      if (fallback) {
        void fallback().then(done);
        return;
      }
      done(false);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        done(true);
        return;
      }
      if (fallback) {
        void fallback().then(done);
        return;
      }
      done(false);
    });
    child.on("spawn", () => {
      if (process.platform !== "darwin") {
        clearTimeout(timeout);
        done(true);
      }
    });
    child.unref();
  };

  const runDetachedCommand = (commandLine, args = []) => {
    return new Promise((resolve) => {
      try {
        const child = spawn(commandLine, args, {
          detached: true,
          stdio: "ignore",
          shell: true,
        });
        finishChildLaunch(child, resolve);
      } catch (err) {
        console.error("[gooseFs] runDetachedCommand failed:", err);
        resolve(false);
      }
    });
  };

  const openWithApp = (targetPath, appCommand) => {
    return new Promise((resolve) => {
      const command = typeof appCommand === "string" ? appCommand.trim() : "";
      if (!command) {
        resolve(false);
        return;
      }

      try {
        if (process.platform === "darwin") {
          const child = spawn("open", ["-a", command, targetPath], {
            detached: true,
            stdio: "ignore",
          });
          finishChildLaunch(child, resolve, () => runDetachedCommand(command, [targetPath]));
          return;
        }

        void runDetachedCommand(command, [targetPath]).then(resolve);
      } catch (err) {
        console.error("[gooseFs] openWithApp failed:", err);
        resolve(false);
      }
    });
  };

  const resolveDirectoryTarget = (targetPath) => {
    try {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) return targetPath;
      return path.dirname(targetPath);
    } catch {
      return targetPath;
    }
  };

  const isKeroApp = (appName) =>
    path.basename(appName).replace(/\.app$/i, "").toLowerCase() === "kero";

  // Kero does not register folders as documents. Its supported external entry
  // point is the Finder service advertised in Kero's Info.plist, so `open -a`
  // would launch the app without creating a project for the requested folder.
  const openKeroAtPath = (dirPath) =>
    new Promise((resolve) => {
      const script = `
        ObjC.import("AppKit");
        function run(argv) {
          const pasteboard = $.NSPasteboard.pasteboardWithUniqueName;
          pasteboard.clearContents;
          pasteboard.declareTypesOwner(
            $(["NSFilenamesPboardType"]),
            null
          );
          pasteboard.setPropertyListForType(
            $(argv),
            "NSFilenamesPboardType"
          );
          if (!$.NSPerformService("New Kero Project Here", pasteboard)) {
            throw new Error("Kero Finder service is unavailable");
          }
        }
      `;
      try {
        const child = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, dirPath], {
          detached: true,
          stdio: "ignore",
        });
        finishChildLaunch(child, resolve);
      } catch (err) {
        console.error("[gooseFs] openKeroAtPath failed:", err);
        resolve(false);
      }
    });

  const openTerminalAtPath = (targetPath, terminalCommand) => {
    return new Promise((resolve) => {
      const dirPath = resolveDirectoryTarget(targetPath);
      const command = typeof terminalCommand === "string" ? terminalCommand.trim() : "";

      try {
        if (process.platform === "darwin") {
          const appName = command || "Terminal";
          if (command && isKeroApp(command)) {
            void openKeroAtPath(dirPath).then(resolve);
            return;
          }
          const child = spawn("open", ["-a", appName, dirPath], {
            detached: true,
            stdio: "ignore",
          });
          finishChildLaunch(
            child,
            resolve,
            command ? () => runDetachedCommand(command, [dirPath]) : undefined,
          );
          return;
        }

        if (process.platform === "win32") {
          if (command) {
            void runDetachedCommand(command, [dirPath]).then(resolve);
            return;
          }
          const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/K", "cd", "/d", dirPath], {
            detached: true,
            stdio: "ignore",
          });
          finishChildLaunch(child, resolve);
          return;
        }

        void runDetachedCommand(command || "x-terminal-emulator", [dirPath]).then(resolve);
      } catch (err) {
        console.error("[gooseFs] openTerminalAtPath failed:", err);
        resolve(false);
      }
    });
  };

  const getNotebookAvailability = (notebook) => {
    if (notebook?.source !== "local-folder") return "ready";
    if (!notebook.localPath) return "path_missing";
    if (!fs.existsSync(notebook.localPath)) return "path_missing";
    try {
      fs.accessSync(notebook.localPath, fs.constants.R_OK);
      return "ready";
    } catch {
      return "unreadable";
    }
  };

  const buildNotebookSummary = (notebook, options = {}) => {
    const includeLocalPaths = options.includeLocalPaths === true;
    const summary = {
      id: notebook.id,
      name: notebook.name,
      source: notebook.source === "local-folder" ? "local-folder" : "default",
      availability: getNotebookAvailability(notebook),
    };

    if (
      includeLocalPaths &&
      notebook.source === "local-folder" &&
      typeof notebook.localPath === "string"
    ) {
      summary.localPath = notebook.localPath;
    }

    return summary;
  };

  const createInternalNoteRecord = (page, notebooksMap) => {
    const notebook = notebooksMap.get(page.workspaceId);
    const title = extractTitleFromPageContent(page.content);
    const contentText = extractTextFromPageContent(page.content);
    return {
      id: page.id,
      title,
      notebookId: page.workspaceId,
      notebookName: notebook?.name || "未知记事本",
      sourceType: "app-page",
      parentId: typeof page.parentId === "string" ? page.parentId : undefined,
      createdAt: Number(page.createdAt || 0),
      updatedAt: Number(page.updatedAt || 0),
      isFolder: page.isFolder === true,
      trashedAt: typeof page.trashedAt === "number" ? page.trashedAt : undefined,
      snippet: createSnippet(contentText),
      contentText,
      rawContentFormat: "blocknote_json",
      rawContent: page.content,
    };
  };

  const listInternalNotes = (notebooksMap) => {
    if (typeof utools?.db?.allDocs !== "function") return [];

    try {
      return utools.db
        .allDocs(INTERNAL_PAGE_DOC_PREFIX)
        .map((doc) => doc?.data)
        .filter((page) => page && typeof page.id === "string")
        .map((page) => createInternalNoteRecord(page, notebooksMap));
    } catch (error) {
      console.error("[goose-note] list internal notes failed:", error);
      return [];
    }
  };

  const shouldIgnoreLocalEntry = (name) =>
    typeof name === "string" &&
    (name.startsWith(".") || LOCAL_IGNORED_FOLDERS.has(name));

  const scanLocalNotebookNotes = async (notebook) => {
    const cacheKey = notebook.id;
    const cached = localNotebookScanCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const availability = getNotebookAvailability(notebook);
    if (availability !== "ready") {
      const result = { availability, items: [] };
      localNotebookScanCache.set(cacheKey, {
        expiresAt: now + LOCAL_NOTE_SCAN_CACHE_TTL_MS,
        value: result,
      });
      return result;
    }

    const scanDirectory = async (dirPath, parentId) => {
      let entries;
      try {
        entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch (error) {
        throw error;
      }

      const sortedEntries = [...entries].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
      );
      const items = [];

      for (const entry of sortedEntries) {
        if (shouldIgnoreLocalEntry(entry.name)) continue;
        const entryPath = path.join(dirPath, entry.name);

        let stats;
        try {
          stats = await fs.promises.stat(entryPath);
        } catch {
          continue;
        }

        if (entry.isDirectory()) {
          const folderId = buildLocalPageId(notebook.id, notebook.localPath, entryPath);
          items.push({
            id: folderId,
            title: entry.name,
            notebookId: notebook.id,
            notebookName: notebook.name,
            sourceType: "local-file",
            parentId,
            createdAt: Number(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs || now),
            updatedAt: Number(stats.mtimeMs || now),
            isFolder: true,
            localFilePath: entryPath,
            snippet: "",
            contentText: "",
            rawContentFormat: "markdown",
            rawContent: "",
          });
          const childItems = await scanDirectory(entryPath, folderId);
          items.push(...childItems);
          continue;
        }

        if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;

        let markdown = "";
        try {
          markdown = await fs.promises.readFile(entryPath, "utf-8");
        } catch {
          continue;
        }

        const fallbackTitle = entry.name.replace(/\.(md|markdown)$/i, "").trim() || "无标题";
        const contentText = stripMarkdownSyntax(markdown);
        items.push({
          id: buildLocalPageId(notebook.id, notebook.localPath, entryPath),
          title: extractMarkdownTitle(markdown, fallbackTitle),
          notebookId: notebook.id,
          notebookName: notebook.name,
          sourceType: "local-file",
          parentId,
          createdAt: Number(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs || now),
          updatedAt: Number(stats.mtimeMs || now),
          isFolder: false,
          localFilePath: entryPath,
          snippet: createSnippet(contentText),
          contentText,
          rawContentFormat: "markdown",
          rawContent: markdown,
        });
      }

      return items;
    };

    try {
      const items = await scanDirectory(notebook.localPath, undefined);
      const result = { availability: "ready", items };
      localNotebookScanCache.set(cacheKey, {
        expiresAt: now + LOCAL_NOTE_SCAN_CACHE_TTL_MS,
        value: result,
      });
      return result;
    } catch (error) {
      console.error("[goose-note] scan local notebook failed:", error);
      const result = { availability: "unreadable", items: [] };
      localNotebookScanCache.set(cacheKey, {
        expiresAt: now + LOCAL_NOTE_SCAN_CACHE_TTL_MS,
        value: result,
      });
      return result;
    }
  };

  const listAllNotes = async () => {
    const notebooks = listPersistedNotebooks();
    const notebooksMap = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
    const internalNotes = listInternalNotes(notebooksMap);
    const localNotebooks = notebooks.filter((notebook) => notebook.source === "local-folder");
    const localResults = await Promise.all(localNotebooks.map(scanLocalNotebookNotes));
    const localNotes = localResults.flatMap((result) => result.items);

    return {
      notebooks,
      notebookSummaries: notebooks.map((notebook) => buildNotebookSummary(notebook)),
      notes: [...internalNotes, ...localNotes],
    };
  };

  const filterNotes = (notes, params = {}) => {
    const notebookIds = normalizeStringArray(params.notebook_ids);
    const sourceTypes = normalizeStringArray(params.source_types);
    const includeTrashed = params.include_trashed === true;
    const includeFolders = params.include_folders === true;

    return notes.filter((note) => {
      if (notebookIds.length > 0 && !notebookIds.includes(note.notebookId)) return false;
      if (sourceTypes.length > 0 && !sourceTypes.includes(note.sourceType)) return false;
      if (!includeTrashed && typeof note.trashedAt === "number") return false;
      if (!includeFolders && note.isFolder) return false;
      return true;
    });
  };

  const paginateItems = (items, params = {}, fallbackLimit = 100) => {
    const offset = clampOffset(params.offset, 0);
    const limit = clampLimit(params.limit, fallbackLimit);
    return {
      total: items.length,
      items: items.slice(offset, offset + limit),
    };
  };

  const buildListItem = (note) => {
    const item = {
      id: note.id,
      title: note.title,
      notebookId: note.notebookId,
      notebookName: note.notebookName,
      sourceType: note.sourceType,
      parentId: note.parentId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      isFolder: note.isFolder === true,
      snippet: note.snippet || "",
    };

    if (typeof note.localFilePath === "string") {
      item.localFilePath = note.localFilePath;
    }

    return item;
  };

  const buildGetNoteItem = (note) => {
    if (note.isFolder) {
      throw new Error("目录节点不支持 get_note，请改用 list_notes 查看目录结构。");
    }

    const item = {
      id: note.id,
      title: note.title,
      notebookId: note.notebookId,
      notebookName: note.notebookName,
      sourceType: note.sourceType,
      parentId: note.parentId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      contentText: note.contentText || "",
      rawContentFormat: note.rawContentFormat,
      rawContent: note.rawContent,
    };

    if (typeof note.trashedAt === "number") {
      item.trashedAt = note.trashedAt;
    }
    if (typeof note.localFilePath === "string") {
      item.localFilePath = note.localFilePath;
    }

    return item;
  };

  const registerMcpTools = () => {
    if (typeof utools?.registerTool !== "function") return;

    utools.registerTool("list_notebooks", async (params = {}) => {
      const notebooks = listPersistedNotebooks();
      const items = notebooks.map((notebook) =>
        buildNotebookSummary(notebook, {
          includeLocalPaths: params.include_local_paths === true,
        }),
      );

      return { items };
    });

    utools.registerTool("list_notes", async (params = {}) => {
      const { notes } = await listAllNotes();
      const filtered = filterNotes(notes, params);
      const sorted = sortNoteItems(filtered, params.sort_by || "updated_at_desc");
      const paged = paginateItems(sorted, params, 100);
      const items = paged.items.map(buildListItem);

      return {
        total: paged.total,
        items,
        nextOffset: getNextOffset(
          paged.total,
          clampOffset(params.offset, 0),
          paged.items.length,
        ),
      };
    });

    utools.registerTool("search_notes", async (params = {}) => {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) {
        throw new Error("query 不能为空");
      }

      const { notes } = await listAllNotes();
      const filtered = filterNotes(notes, {
        ...params,
        include_folders: false,
      });
      const searched = searchNoteItems(filtered, query);
      const paged = paginateItems(searched, params, 50);
      const items = paged.items.map((note) => ({
        ...buildListItem(note),
        score: note.score,
        matchedFields: note.matchedFields,
      }));

      return {
        total: paged.total,
        items,
        nextOffset: getNextOffset(
          paged.total,
          clampOffset(params.offset, 0),
          paged.items.length,
        ),
      };
    });

    utools.registerTool("get_note", async (params = {}) => {
      const noteId = typeof params.note_id === "string" ? params.note_id.trim() : "";
      if (!noteId) {
        throw new Error("note_id 不能为空");
      }

      const { notebooks, notes } = await listAllNotes();
      const note = notes.find((item) => item.id === noteId);
      if (!note) {
        const localNotebook = notebooks.find(
          (item) => item.source === "local-folder" && noteId.startsWith(`local-${item.id}-`),
        );
        if (localNotebook) {
          const availability = getNotebookAvailability(localNotebook);
          if (availability !== "ready") {
            throw new Error(
              availability === "path_missing"
                ? "对应的本地记事本路径不存在"
                : "对应的本地记事本当前不可读取",
            );
          }
        }
        throw new Error("未找到对应笔记");
      }

      return buildGetNoteItem(note);
    });
  };

  // Node 端下载远程图片，绕开渲染端 CORS。用于图片导出场景。
  // 返回 data URL（带 mime），失败返回 null。
  const fetchRemoteImage = (url, timeoutMs = 8000) => {
    const MAX_BYTES = 20 * 1024 * 1024;
    const MAX_REDIRECTS = 5;

    return new Promise((resolve) => {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        resolve(null);
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const visit = (currentUrl, redirectsLeft) => {
        let parsed;
        try {
          parsed = new NodeURL(currentUrl);
        } catch {
          finish(null);
          return;
        }
        const lib = parsed.protocol === "http:" ? http : https;
        const req = lib.get(
          currentUrl,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (GooseNote)",
              Accept: "image/*,*/*;q=0.8",
            },
          },
          (res) => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
              if (redirectsLeft <= 0) {
                res.resume();
                finish(null);
                return;
              }
              let next;
              try {
                next = new NodeURL(res.headers.location, currentUrl).toString();
              } catch {
                res.resume();
                finish(null);
                return;
              }
              res.resume();
              visit(next, redirectsLeft - 1);
              return;
            }
            if (status < 200 || status >= 400) {
              res.resume();
              finish(null);
              return;
            }

            const chunks = [];
            let total = 0;
            res.on("data", (chunk) => {
              total += chunk.length;
              if (total > MAX_BYTES) {
                req.destroy();
                finish(null);
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              try {
                const buf = Buffer.concat(chunks);
                const rawType = res.headers["content-type"] || "image/png";
                const mime = String(rawType).split(";")[0].trim() || "image/png";
                finish(`data:${mime};base64,${buf.toString("base64")}`);
              } catch {
                finish(null);
              }
            });
            res.on("error", () => finish(null));
          },
        );
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          finish(null);
        });
        req.on("error", () => finish(null));
      };

      visit(url, MAX_REDIRECTS);
    });
  };

  const MAX_AI_CONTEXT_FILE_BYTES = 256 * 1024;
  const MAX_LOCAL_SKILLS = 100;
  const readLocalSkillFiles = () => {
    const root = path.join(os.homedir(), ".agents", "skills");
    const results = [];
    const visit = (dir, depth = 0) => {
      if (depth > 8) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_LOCAL_SKILLS) return;
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath, depth + 1);
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          try {
            if (fs.statSync(entryPath).size > MAX_AI_CONTEXT_FILE_BYTES) continue;
            results.push({ path: entryPath, content: fs.readFileSync(entryPath, "utf-8") });
          } catch {}
        }
      }
    };
    visit(root);
    return results;
  };

  // 只暴露固定的全局提示词与 Skill 根目录，不接受前端传入任意路径。
  window.gooseAiContext = {
    readGlobalPrompt: () => {
      try {
        const agentsPath = path.join(os.homedir(), "AGENTS.md");
        if (fs.statSync(agentsPath).size > MAX_AI_CONTEXT_FILE_BYTES) return null;
        return fs.readFileSync(agentsPath, "utf-8");
      } catch {
        return null;
      }
    },
    listLocalSkills: readLocalSkillFiles,
  };

  // 本地文件系统 API 桥接（仅用于本地文件夹模式）
  window.gooseFs = {
    fetchRemoteImage,
    readDir: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          path: path.join(dir, entry.name),
        }));
      } catch (err) {
        console.error("[gooseFs] readDir failed:", err);
        return [];
      }
    },

    readDirAsync: async (dir) => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          path: path.join(dir, entry.name),
        }));
      } catch (err) {
        console.error("[gooseFs] readDirAsync failed:", err);
        return [];
      }
    },

    readFile: (filePath) => {
      try {
        return fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        console.error("[gooseFs] readFile failed:", err);
        return null;
      }
    },

    readFileAsync: async (filePath) => {
      try {
        return await fs.promises.readFile(filePath, "utf-8");
      } catch (err) {
        console.error("[gooseFs] readFileAsync failed:", err);
        return null;
      }
    },

    readFileStatAsync: async (filePath) => {
      try {
        const content = await fs.promises.readFile(filePath, "utf-8");
        return { ok: true, content };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error("[gooseFs] readFileStatAsync failed:", err);
        return { ok: false, error, content: null };
      }
    },

    readFileBase64: (filePath) => {
      try {
        return fs.readFileSync(filePath).toString("base64");
      } catch (err) {
        console.error("[gooseFs] readFileBase64 failed:", err);
        return null;
      }
    },

    writeFile: (filePath, content, encoding = "utf-8") => {
      // 必须在写入前登记：fs.watch 的回调可能在 writeFile/writeFileAsync 尚未返回时
      // 先触发。若等写完再标记，前端会把自己的自动保存误判成外部修改并重载编辑器。
      const normalizedFilePath = path.resolve(filePath);
      const markedAt = Date.now();
      recentWrites.set(normalizedFilePath, markedAt);
      try {
        fs.writeFileSync(filePath, content, resolveWriteEncoding(encoding));
        // 写入结束后续期，覆盖文件系统延迟派发 watch 事件的情况。
        recentWrites.set(normalizedFilePath, Date.now());
        invalidateLocalNotebookCache();
        return true;
      } catch (err) {
        if (recentWrites.get(normalizedFilePath) === markedAt) {
          recentWrites.delete(normalizedFilePath);
        }
        console.error("[gooseFs] writeFile failed:", err);
        return false;
      }
    },

    writeFileAsync: async (filePath, content, encoding = "utf-8") => {
      const normalizedFilePath = path.resolve(filePath);
      const markedAt = Date.now();
      recentWrites.set(normalizedFilePath, markedAt);
      try {
        await fs.promises.writeFile(
          filePath,
          content,
          resolveWriteEncoding(encoding),
        );
        recentWrites.set(normalizedFilePath, Date.now());
        invalidateLocalNotebookCache();
        return true;
      } catch (err) {
        if (recentWrites.get(normalizedFilePath) === markedAt) {
          recentWrites.delete(normalizedFilePath);
        }
        console.error("[gooseFs] writeFileAsync failed:", err);
        return false;
      }
    },

    exists: (filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (err) {
        console.error("[gooseFs] exists failed:", err);
        return false;
      }
    },

    existsAsync: async (filePath) => {
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    realpathAsync: async (filePath) => {
      try {
        return await fs.promises.realpath(filePath);
      } catch {
        return null;
      }
    },

    watch: (dirPath, callback) => {
      try {
        // 如果已经存在监听器，先停止
        if (watchers.has(dirPath)) {
          watchers.get(dirPath).close();
        }

        const watcher = fs.watch(
          dirPath,
          { recursive: true },
          (eventType, filename) => {
            if (filename) {
              const fullPath = path.resolve(dirPath, String(filename));
              // 检查是否为最近写入的文件，避免误触发重载提示
              const now = Date.now();
              let skip = false;
              for (const [key, time] of recentWrites) {
                if (now - time >= 1000) {
                  recentWrites.delete(key);
                  continue;
                }
                const normalizedKey = path.resolve(key);
                if (
                  fullPath === normalizedKey ||
                  fullPath.startsWith(`${normalizedKey}${path.sep}`)
                ) {
                  skip = true;
                  break;
                }
              }
              if (skip) return; // 跳过自己写入/删除的文件

              // 通知前端有文件变更
              window.dispatchEvent(
                new CustomEvent("goose-note:file-changed", {
                  detail: { eventType, filename, dirPath },
                }),
              );
            }
          },
        );

        watchers.set(dirPath, watcher);
        return watcher;
      } catch (err) {
        console.error("[gooseFs] watch failed:", err);
        return null;
      }
    },

    unwatch: (dirPath) => {
      const watcher = watchers.get(dirPath);
      if (watcher) {
        watcher.close();
        watchers.delete(dirPath);
      }
    },

    mkdir: (dirPath) => {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        recentWrites.set(`${dirPath}${path.sep}`, Date.now());
        invalidateLocalNotebookCache();
        return true;
      } catch (err) {
        console.error("[gooseFs] mkdir failed:", err);
        return false;
      }
    },

    deleteFile: async (filePath) => {
      try {
        const ok = await tryTrash(filePath);
        if (ok) {
          recentWrites.set(filePath, Date.now());
          invalidateLocalNotebookCache();
        }
        return ok;
      } catch (err) {
        console.error("[gooseFs] deleteFile failed:", err);
        return false;
      }
    },

    deleteDir: async (dirPath) => {
      try {
        const ok = await tryTrash(dirPath);
        if (ok) {
          recentWrites.set(`${dirPath}${path.sep}`, Date.now());
          invalidateLocalNotebookCache();
        }
        return ok;
      } catch (err) {
        console.error("[gooseFs] deleteDir failed:", err);
        return false;
      }
    },

    rename: (oldPath, newPath) => {
      try {
        fs.renameSync(oldPath, newPath);
        recentWrites.set(oldPath, Date.now());
        recentWrites.set(newPath, Date.now());
        invalidateLocalNotebookCache();
        return true;
      } catch (err) {
        console.error("[gooseFs] rename failed:", err);
        return false;
      }
    },

    writeTempFile: async (relativePath, contentBase64) => {
      try {
        const targetPath = resolveTempTargetPath(relativePath);
        const targetDir = path.dirname(targetPath);
        await fs.promises.mkdir(targetDir, { recursive: true });

        const expectedSize = getBase64ByteLength(contentBase64);
        try {
          const existingStat = await fs.promises.stat(targetPath);
          if (existingStat.isFile() && existingStat.size === expectedSize) {
            const now = new Date();
            await fs.promises.utimes(targetPath, now, now);
            return targetPath;
          }
        } catch {}

        await fs.promises.writeFile(targetPath, contentBase64, "base64");
        return targetPath;
      } catch (err) {
        console.error("[gooseFs] writeTempFile failed:", err);
        return null;
      }
    },

    cleanupTempFiles: async (prefix, maxAgeMs) => {
      try {
        const basePath = resolveTempTargetPath(prefix);
        const cutoff = Date.now() - Number(maxAgeMs || 0);
        if (!Number.isFinite(cutoff)) return;
        await removeExpiredEntries(basePath, cutoff);
      } catch (err) {
        console.error("[gooseFs] cleanupTempFiles failed:", err);
      }
    },

    revealItemInFolder,
    listAvailableOpenApps,

    openWithApp,
    openTerminalAtPath,
  };

  window.gooseWeb = {
    fetchText: (url) => fetchPublicText(url),
  };


  const MCP_TOOL_REQUEST_EVENT = "goose-note:mcp-tool-request";
  const MCP_TOOL_RESPONSE_EVENT = "goose-note:mcp-tool-response";
  const MCP_TOOL_READY_EVENT = "goose-note:mcp-tool-ready";
  const MCP_TOOL_READY_TIMEOUT_MS = 15000;
  const MCP_TOOL_EXEC_TIMEOUT_MS = 30000;
  const MCP_WRITE_TOOL_NAMES = [
    "create_note",
    "append_note",
    "update_note",
    "rename_note",
    "delete_note",
    "restore_note",
    "create_notebook",
    "update_notebook",
    "delete_notebook",
  ];
  const MCP_TOOL_CAPABILITIES = {
    protocol: "utools-mcp-tools",
    version: "1.0",
    transport: "uTools plugin.json.tools + utools.registerTool",
    tools: [
      "list_notebooks",
      "list_notes",
      "search_notes",
      "get_note",
      "get_mcp_capabilities",
      ...MCP_WRITE_TOOL_NAMES,
    ],
    writeSafety:
      "写入工具直接修改本地笔记库；调用方应在执行前取得用户确认。删除进入回收站，不是永久删除。",
  };

  window.__gooseNoteMcpReady = false;
  const pendingMcpRequests = new Map();
  const buildMcpRequestId = () =>
    `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const normalizeToolParams = (params) => {
    const sanitize = (value, depth = 0) => {
      if (depth > 6 || value == null) return null;
      if (typeof value === "string") return value.slice(0, 10000);
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
      if (typeof value !== "object") return null;

      const safe = {};
      for (const [key, item] of Object.entries(value).slice(0, 100)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        safe[key] = sanitize(item, depth + 1);
      }
      return safe;
    };

    if (!params || typeof params !== "object" || Array.isArray(params)) return {};
    return sanitize(params);
  };

  const waitForMcpBridgeReady = (timeoutMs = MCP_TOOL_READY_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      if (window.__gooseNoteMcpReady) {
        resolve();
        return;
      }

      let settled = false;
      const cleanup = () => {
        window.removeEventListener(MCP_TOOL_READY_EVENT, handleReady);
        clearTimeout(timer);
      };
      const handleReady = () => {
        if (settled) return;
        settled = true;
        window.__gooseNoteMcpReady = true;
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("笔记 MCP 桥接尚未就绪，请先打开插件页面完成初始化"));
      }, timeoutMs);
      window.addEventListener(MCP_TOOL_READY_EVENT, handleReady, { once: true });
    });

  const invokeRendererMcpTool = async (
    toolName,
    params,
    timeoutMs = MCP_TOOL_EXEC_TIMEOUT_MS,
  ) => {
    await waitForMcpBridgeReady();
    return new Promise((resolve, reject) => {
      const requestId = buildMcpRequestId();
      const timer = setTimeout(() => {
        pendingMcpRequests.delete(requestId);
        reject(new Error(`工具 ${toolName} 执行超时`));
      }, timeoutMs);
      pendingMcpRequests.set(requestId, { resolve, reject, timer });
      window.dispatchEvent(
        new CustomEvent(MCP_TOOL_REQUEST_EVENT, {
          detail: {
            requestId,
            tool: toolName,
            params: normalizeToolParams(params),
          },
        }),
      );
    });
  };

  window.addEventListener(MCP_TOOL_READY_EVENT, () => {
    window.__gooseNoteMcpReady = true;
  });

  window.addEventListener(MCP_TOOL_RESPONSE_EVENT, (event) => {
    const detail = event.detail || {};
    const requestId = detail.requestId;
    if (!requestId || !pendingMcpRequests.has(requestId)) return;
    const pending = pendingMcpRequests.get(requestId);
    pendingMcpRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (detail.ok) {
      pending.resolve(detail.result);
      return;
    }
    pending.reject(new Error(detail.error || "工具执行失败"));
  });

  const registerMcpWriteTools = () => {
    if (typeof utools?.registerTool !== "function") return;

    utools.registerTool("get_mcp_capabilities", async () => MCP_TOOL_CAPABILITIES);

    MCP_WRITE_TOOL_NAMES.forEach((toolName) => {
      utools.registerTool(toolName, async (params, context) => {
        const reportProgress = (progress, message) => {
          try {
            const reported = context?.sendProgress?.({ progress, total: 1, message });
            if (reported && typeof reported.catch === "function") reported.catch(() => {});
          } catch {}
        };
        reportProgress(0, `正在执行 ${toolName}`);
        const result = await invokeRendererMcpTool(toolName, params);
        reportProgress(1, `${toolName} 执行完成`);
        return result;
      });
    });
  };

  registerMcpTools();
  registerMcpWriteTools();


  // 处理 uTools 全局搜索（sublist）点击
  // 注意：sublist API 可能不是所有 uTools 版本都支持
  if (typeof utools.onSublistEnter === "function") {
    utools.onSublistEnter((item) => {
      const pageId = item.url.replace("goose-note://page/", "");

      // 通知应用切换页面
      window.dispatchEvent(
        new CustomEvent("goose-note:navigate", {
          detail: { pageId },
        }),
      );
    });
  }

  const dispatchOpenFolder = (folderPath) => {
    window[PENDING_OPEN_FOLDER_KEY] = folderPath;
    window.dispatchEvent(
      new CustomEvent("goose-note:open-folder", {
        detail: { path: folderPath },
      }),
    );
  };

  const clearSubInput = () => {
    if (typeof utools.removeSubInput === "function") {
      utools.removeSubInput();
    }
  };

  // 主插件指令处理。速记小窗已拆为独立插件「鹅的小窗」（quicknote-plugin.json），
  // 主插件不再开内置浮窗，故此处不再有 quicknote_new/quicknote_last 分支。
  utools.onPluginEnter(({ code, type, payload, optional }) => {
    // 普通进入插件时不要挂 uTools 宿主输入框。应用内已有 CommandPalette；
    // 宿主 subInput 会抢走编辑器焦点，导致正文输入跑到窗口左侧。
    clearSubInput();

    window.dispatchEvent(
      new CustomEvent("goose-note:plugin-enter", {
        detail: { code, type, payload, optional },
      }),
    );

    if (code === "open_folder") {
      if ((type === "files" || type === "file") && payload && payload.length > 0) {
        const folderPath = payload[0]?.path;
        if (folderPath) {
          try {
            const stat = fs.statSync(folderPath);
            if (stat.isDirectory()) {
              dispatchOpenFolder(folderPath);
            }
          } catch (err) {
            console.error("[gooseFs] stat failed:", err);
          }
        }
      }
      return;
    }

    if (code === "new_page") {
      // over 类型：payload 通常为选中纯文本字符串；做 string/array 双兜底。
      const selectedText =
        typeof payload === "string"
          ? payload
          : (Array.isArray(payload) &&
              (payload[0]?.data || payload[0]?.text)) ||
            "";
      window.dispatchEvent(
        new CustomEvent("goose-note:new-page", {
          detail: { text: selectedText },
        }),
      );
      return;
    }

    if (code === "quicknote_save") {
      // B 插件 redirect 回传速记内容（blocks JSON 字符串），落库后退出后台。
      // type==="text" 时 payload 即 redirect 第二参数原文。
      const blocksJson = type === "text" && typeof payload === "string" ? payload : null;
      if (blocksJson) {
        // 暂存到全局收件箱，支持冷启动（React 未 mount）时不丢数据。
        if (!Array.isArray(window.__gooseQuickNoteInbox)) {
          window.__gooseQuickNoteInbox = [];
        }
        window.__gooseQuickNoteInbox.push(blocksJson);
        // 标记本次是被 redirect 唤起（用于 React 侧判断是否 outPlugin）。
        window.__gooseQuickNoteRedirectWoke = true;
        // 通知已 mount 的 React 立即消费。
        window.dispatchEvent(new CustomEvent("goose-note:quicknote-inbox"));
      }
      return;
    }
  });

  if (typeof utools.onPluginOut === "function") {
    utools.onPluginOut((isKill) => {
      clearSubInput();
      window.dispatchEvent(
        new CustomEvent("goose-note:plugin-out", {
          detail: {
            // isKill=true 表示插件进程被销毁，false 表示仅隐藏到后台。
            isKill: isKill === true,
          },
        }),
      );
    });
  }

}
