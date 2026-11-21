"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MARKDOWN_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdown",
  ".mkdn",
  ".mkd",
  ".mdtxt",
  ".txt"
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".Trash",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  ".DS_Store",
  "Library",
  "Applications",
  "Parallels",
  "WeChat Files",
  "Tencent Files",
  "Creative Cloud Files",
  "CleanMyMac_5"
]);

function assertNonEmptyPath(inputPath, label = "path") {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error(`Invalid ${label}: expected a non-empty string.`);
  }
  if (inputPath.includes("\0")) {
    throw new Error(`Invalid ${label}: null byte is not allowed.`);
  }
  return path.resolve(inputPath.trim());
}

function assertSafeChildName(name, label = "name") {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`Invalid ${label}: expected a non-empty name.`);
  }
  const trimmed = name.trim();
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new Error(`Invalid ${label}: path separators are not allowed.`);
  }
  return trimmed;
}

function isMarkdownFile(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

function extractExcerptAndTitle(content, fallbackName) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  if (lines[0] && lines[0].trim() === "---") {
    index = 1;
    while (index < lines.length && lines[index].trim() !== "---" && lines[index].trim() !== "...") {
      index += 1;
    }
    index += 1;
  }

  let title = "";
  const excerptParts = [];

  for (; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine) continue;

    const headingMatch = rawLine.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch && !title) {
      title = headingMatch[1].replace(/[#*`~_]/g, "").trim();
      continue;
    }

    if (rawLine.startsWith("```") || rawLine.startsWith("$$")) {
      continue;
    }

    const cleaned = rawLine
      .replace(/^>\s*(\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])?\s*/i, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`=#]/g, "")
      .trim();

    if (cleaned) {
      excerptParts.push(cleaned);
      if (excerptParts.join(" ").length >= 140) {
        break;
      }
    }
  }

  const finalTitle = title || path.basename(fallbackName, path.extname(fallbackName));
  const excerpt = excerptParts.join(" ").slice(0, 140);
  return { title: finalTitle, excerpt };
}

function readDocument(filePath) {
  const resolved = assertNonEmptyPath(filePath, "filePath");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Target is not a file: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, "utf8");
  const { title, excerpt } = extractExcerptAndTitle(content, path.basename(resolved));
  return {
    path: resolved,
    name: path.basename(resolved),
    dir: path.dirname(resolved),
    ext: path.extname(resolved).toLowerCase(),
    content,
    title,
    excerpt,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    birthtimeMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs
  };
}

function writeDocument(filePath, content) {
  const resolved = assertNonEmptyPath(filePath, "filePath");
  const parentDir = path.dirname(resolved);
  fs.mkdirSync(parentDir, { recursive: true });
  const normalizedContent = typeof content === "string" ? content : String(content ?? "");
  fs.writeFileSync(resolved, normalizedContent, "utf8");
  return readDocument(resolved);
}

function ensureUniquePath(parentDir, desiredFileName) {
  const ext = path.extname(desiredFileName);
  const base = path.basename(desiredFileName, ext);
  let candidate = path.join(parentDir, desiredFileName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${base} ${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function createDocument(parentDir, fileName = "Untitled.md", initialContent = "") {
  const resolvedDir = assertNonEmptyPath(parentDir, "parentDir");
  fs.mkdirSync(resolvedDir, { recursive: true });
  let safeName = assertSafeChildName(fileName, "fileName");
  if (!path.extname(safeName)) {
    safeName = `${safeName}.md`;
  }
  const targetPath = ensureUniquePath(resolvedDir, safeName);
  fs.writeFileSync(targetPath, String(initialContent ?? ""), "utf8");
  return readDocument(targetPath);
}

function createFolder(parentDir, folderName = "New Folder") {
  const resolvedDir = assertNonEmptyPath(parentDir, "parentDir");
  const safeName = assertSafeChildName(folderName, "folderName");
  const targetPath = ensureUniquePath(resolvedDir, safeName);
  fs.mkdirSync(targetPath, { recursive: true });
  return {
    path: targetPath,
    name: path.basename(targetPath),
    type: "directory"
  };
}

function renameEntry(oldPath, newName) {
  const resolvedOld = assertNonEmptyPath(oldPath, "oldPath");
  if (!fs.existsSync(resolvedOld)) {
    throw new Error(`Entry does not exist: ${resolvedOld}`);
  }
  const stat = fs.statSync(resolvedOld);
  let safeName = assertSafeChildName(newName, "newName");
  if (stat.isFile() && !path.extname(safeName) && isMarkdownFile(resolvedOld)) {
    safeName = `${safeName}${path.extname(resolvedOld) || ".md"}`;
  }
  const targetPath = path.join(path.dirname(resolvedOld), safeName);
  if (targetPath !== resolvedOld && fs.existsSync(targetPath)) {
    throw new Error(`An item named "${safeName}" already exists.`);
  }
  fs.renameSync(resolvedOld, targetPath);
  return {
    oldPath: resolvedOld,
    newPath: targetPath,
    name: path.basename(targetPath),
    isDirectory: stat.isDirectory()
  };
}

function duplicateDocument(filePath) {
  const doc = readDocument(filePath);
  const ext = path.extname(doc.name) || ".md";
  const base = path.basename(doc.name, ext);
  const copyPath = ensureUniquePath(doc.dir, `${base} (copy)${ext}`);
  fs.writeFileSync(copyPath, doc.content, "utf8");
  return readDocument(copyPath);
}

function deleteEntry(targetPath) {
  const resolved = assertNonEmptyPath(targetPath, "targetPath");
  if (!fs.existsSync(resolved)) {
    return { deleted: false, path: resolved };
  }
  fs.rmSync(resolved, { recursive: true, force: false });
  return { deleted: true, path: resolved };
}

function listDirectoryChildren(dirPath, rootDir) {
  const resolvedDir = assertNonEmptyPath(dirPath, "dirPath");
  const resolvedRoot = rootDir ? assertNonEmptyPath(rootDir, "rootDir") : resolvedDir;
  let entries = [];
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });

  const children = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(resolvedDir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      children.push({
        type: "directory",
        name: entry.name,
        path: entryPath,
        relativePath: path.relative(resolvedRoot, entryPath) || ".",
        children: [],
        childrenLoaded: false
      });
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      try {
        const stat = fs.statSync(entryPath);
        const previewBytes = fs.readFileSync(entryPath, "utf8").slice(0, 1024);
        const { title, excerpt } = extractExcerptAndTitle(previewBytes, entry.name);
        const fileNode = {
          type: "file",
          name: entry.name,
          path: entryPath,
          relativePath: path.relative(resolvedRoot, entryPath),
          ext: path.extname(entry.name).toLowerCase(),
          title,
          excerpt,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          birthtimeMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs
        };
        children.push(fileNode);
        files.push(fileNode);
      } catch {
        // Skip unreadable files
      }
    }
  }

  return {
    dirPath: resolvedDir,
    children,
    files
  };
}

function scanWorkspace(rootDir, options = {}) {
  const resolvedRoot = assertNonEmptyPath(rootDir, "rootDir");
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Workspace folder does not exist: ${resolvedRoot}`);
  }
  const rootStat = fs.statSync(resolvedRoot);
  const workspaceDir = rootStat.isDirectory() ? resolvedRoot : path.dirname(resolvedRoot);

  // Lazy 1-level scan mode: only reads direct children of the workspace root
  if (options.shallow === true) {
    const listed = listDirectoryChildren(workspaceDir, workspaceDir);
    return {
      rootDir: workspaceDir,
      rootName: path.basename(workspaceDir),
      tree: {
        type: "directory",
        name: path.basename(workspaceDir),
        path: workspaceDir,
        relativePath: ".",
        children: listed.children,
        childrenLoaded: true
      },
      files: listed.files,
      isShallow: true
    };
  }

  const maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 6;
  const maxFiles = typeof options.maxFiles === "number" ? options.maxFiles : 800;

  const flatFiles = [];

  function walkDirectory(currentDir, depth) {
    const dirName = path.basename(currentDir);
    const children = [];

    if (depth > maxDepth || flatFiles.length >= maxFiles) {
      return {
        type: "directory",
        name: dirName,
        path: currentDir,
        relativePath: path.relative(workspaceDir, currentDir) || ".",
        children,
        childrenLoaded: false
      };
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });

    for (const entry of entries) {
      if (flatFiles.length >= maxFiles) break;
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const subTree = walkDirectory(entryPath, depth + 1);
        children.push(subTree);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        try {
          const stat = fs.statSync(entryPath);
          const previewBytes = fs.readFileSync(entryPath, "utf8").slice(0, 2048);
          const { title, excerpt } = extractExcerptAndTitle(previewBytes, entry.name);
          const fileNode = {
            type: "file",
            name: entry.name,
            path: entryPath,
            relativePath: path.relative(workspaceDir, entryPath),
            ext: path.extname(entry.name).toLowerCase(),
            title,
            excerpt,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            birthtimeMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs
          };
          children.push(fileNode);
          flatFiles.push(fileNode);
        } catch {
          // Skip unreadable files
        }
      }
    }

    return {
      type: "directory",
      name: dirName,
      path: currentDir,
      relativePath: path.relative(workspaceDir, currentDir) || ".",
      children,
      childrenLoaded: true
    };
  }

  const tree = walkDirectory(workspaceDir, 0);
  return {
    rootDir: workspaceDir,
    rootName: path.basename(workspaceDir),
    tree,
    files: flatFiles,
    isShallow: false
  };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSearchRegExp(query, options = {}) {
  const rawQuery = String(query ?? "");
  if (!rawQuery || rawQuery.length > 500) return null;
  const { caseSensitive = false, wholeWord = false, isRegex = false } = options;
  let pattern = isRegex ? rawQuery : escapeRegExp(rawQuery);
  if (wholeWord) {
    pattern = `\\b(?:${pattern})\\b`;
  }
  const flags = caseSensitive ? "g" : "gi";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SEARCH_LINE_CHARS = 4000;

function searchInWorkspace(rootDir, query, options = {}) {
  const regex = buildSearchRegExp(query, options);
  if (!regex) {
    return { totalMatches: 0, fileCount: 0, results: [] };
  }

  const workspace = scanWorkspace(rootDir, options);
  const results = [];
  let totalMatches = 0;

  for (const fileItem of workspace.files) {
    if (fileItem.size > MAX_SEARCH_FILE_BYTES) {
      continue;
    }
    let content = "";
    try {
      content = fs.readFileSync(fileItem.path, "utf8");
    } catch {
      continue;
    }

    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const fileMatches = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      const rawLine = lines[lineIdx];
      const lineText =
        rawLine.length > MAX_SEARCH_LINE_CHARS
          ? rawLine.slice(0, MAX_SEARCH_LINE_CHARS)
          : rawLine;
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        fileMatches.push({
          lineNumber: lineIdx + 1,
          lineText: lineText.slice(0, 240),
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
          matchText: match[0]
        });
        totalMatches += 1;
        if (fileMatches.length >= 100) break;
      }
      if (fileMatches.length >= 100) break;
    }

    if (fileMatches.length > 0) {
      results.push({
        path: fileItem.path,
        name: fileItem.name,
        relativePath: fileItem.relativePath,
        matches: fileMatches
      });
    }
  }

  return {
    totalMatches,
    fileCount: results.length,
    results
  };
}

function copyImageToAssets(docPath, sourceImageInput, options = {}) {
  const resolvedDoc = assertNonEmptyPath(docPath, "docPath");
  const docDir = path.dirname(resolvedDoc);
  const docBase = path.basename(resolvedDoc, path.extname(resolvedDoc));
  const usePerDocAssets = Boolean(options.usePerDocAssets);
  const assetsFolderName = usePerDocAssets ? `${docBase}.assets` : "assets";
  const assetsDir = path.join(docDir, assetsFolderName);
  fs.mkdirSync(assetsDir, { recursive: true });

  let targetPath = "";

  if (typeof sourceImageInput === "string" && sourceImageInput.startsWith("data:image/")) {
    const match = sourceImageInput.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid image data URL.");
    }
    const rawExt = match[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
    const buffer = Buffer.from(match[2], "base64");
    const desiredName = options.fileName
      ? assertSafeChildName(options.fileName, "fileName")
      : `image-${Date.now()}.${rawExt}`;
    targetPath = ensureUniquePath(assetsDir, desiredName);
    fs.writeFileSync(targetPath, buffer);
  } else {
    const resolvedSource = assertNonEmptyPath(sourceImageInput, "sourceImagePath");
    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`Source image does not exist: ${resolvedSource}`);
    }
    const desiredName = path.basename(resolvedSource);
    targetPath = ensureUniquePath(assetsDir, desiredName);
    fs.copyFileSync(resolvedSource, targetPath);
  }

  const relativeMarkdownPath = `./${path
    .relative(docDir, targetPath)
    .split(path.sep)
    .join("/")}`;

  return {
    savedAbsolutePath: targetPath,
    relativeMarkdownPath,
    fileUrl: pathToFileURL(targetPath).href
  };
}

function resolveImageUrl(docPath, rawSrc, rootUrlFromYaml = "") {
  const src = String(rawSrc || "").trim();
  if (!src) return "";
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("file://")
  ) {
    return src;
  }

  // If already an absolute path (POSIX / or Windows C:\), resolve directly via file:// URL
  if (path.isAbsolute(src)) {
    try {
      return pathToFileURL(src).href;
    } catch {
      return src;
    }
  }

  if (src.startsWith("/") && rootUrlFromYaml) {
    const baseDir = docPath
      ? path.resolve(path.dirname(docPath), rootUrlFromYaml)
      : path.resolve(rootUrlFromYaml);
    const candidate = path.join(baseDir, src.slice(1));
    return pathToFileURL(candidate).href;
  }

  if (docPath) {
    const candidate = path.resolve(path.dirname(docPath), src);
    return pathToFileURL(candidate).href;
  }

  return src;
}

module.exports = {
  MARKDOWN_EXTENSIONS,
  assertNonEmptyPath,
  assertSafeChildName,
  isMarkdownFile,
  extractExcerptAndTitle,
  readDocument,
  writeDocument,
  createDocument,
  createFolder,
  renameEntry,
  duplicateDocument,
  deleteEntry,
  listDirectoryChildren,
  scanWorkspace,
  buildSearchRegExp,
  searchInWorkspace,
  copyImageToAssets,
  resolveImageUrl
};
