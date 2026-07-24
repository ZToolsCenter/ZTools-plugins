import type { FinderResult } from "./finderLogic";

interface IconCacheEntry {
  hash: string;
  url: string;
  dataUrl?: string;
}

type IconFile = Pick<FinderResult, "name" | "extension" | "fullPath" | "isDirectory">;

const FOLDER_CACHE_KEY = "folder";
const UNKNOWN_CACHE_KEY = "unknown";
const WINDOWS_FOLDER_ICON_PATH = "C:\\Windows";
const UNKNOWN_FILE_ICON_PATH = "C:\\__local_search_neo_unknown_icon__";
const EXTENSION_ICON_PATH_PREFIX = "C:\\__local_search_neo_icon__.";

// 这些类型的图标通常取决于文件本身、快捷方式目标或可执行资源，不能只按后缀共享。
const PATH_DEPENDENT_EXTENSIONS = new Set([
  "ani",
  "appref-ms",
  "cpl",
  "cur",
  "exe",
  "ico",
  "lnk",
  "msc",
  "scr",
  "url",
]);

const sharedIconCache = new Map<string, IconCacheEntry>();
const iconUrlByHash = new Map<string, string>();

export function warmUpFileIconCache() {
  loadSharedIcon(UNKNOWN_CACHE_KEY, UNKNOWN_FILE_ICON_PATH);
  loadSharedIcon(FOLDER_CACHE_KEY, WINDOWS_FOLDER_ICON_PATH);
}

export function getUnknownFileIconUrl(): string {
  return loadSharedIcon(UNKNOWN_CACHE_KEY, UNKNOWN_FILE_ICON_PATH)?.url ?? "";
}

export function getFolderFileIconUrl(): string {
  return loadSharedIcon(FOLDER_CACHE_KEY, WINDOWS_FOLDER_ICON_PATH)?.url ?? getUnknownFileIconUrl();
}

export function getCachedFileIconUrl(file: IconFile): string {
  return getCachedFileIconEntry(file)?.url ?? "";
}

export function getDisplayFileIconUrl(file: IconFile): string {
  if (file.isDirectory) return getFolderFileIconUrl();

  const cachedUrl = getCachedFileIconUrl(file);
  return cachedUrl || getUnknownFileIconUrl();
}

export function loadFileIconUrl(file: IconFile): string {
  return getFileIconEntry(file)?.url ?? getUnknownFileIconUrl();
}

export function getFileIconDataUrl(file: IconFile): string {
  return getFileIconEntry(file)?.dataUrl ?? getSharedIconDataUrl(UNKNOWN_CACHE_KEY);
}

export function shouldLoadFileIcon(file: IconFile): boolean {
  if (file.isDirectory) return !sharedIconCache.has(FOLDER_CACHE_KEY);

  const extension = getResultExtension(file);
  if (!extension) return false;
  if (PATH_DEPENDENT_EXTENSIONS.has(extension)) return !!file.fullPath;

  return !sharedIconCache.has(getExtensionCacheKey(extension));
}

function getFileIconEntry(file: IconFile): IconCacheEntry | null {
  if (file.isDirectory) return loadSharedIcon(FOLDER_CACHE_KEY, WINDOWS_FOLDER_ICON_PATH);

  const extension = getResultExtension(file);
  if (!extension) return loadSharedIcon(UNKNOWN_CACHE_KEY, UNKNOWN_FILE_ICON_PATH);

  if (PATH_DEPENDENT_EXTENSIONS.has(extension)) {
    return file.fullPath ? readIcon(file.fullPath) : null;
  }

  return loadSharedIcon(getExtensionCacheKey(extension), getExtensionIconPath(extension));
}

function getCachedFileIconEntry(file: IconFile): IconCacheEntry | null {
  if (file.isDirectory) return sharedIconCache.get(FOLDER_CACHE_KEY) ?? null;

  const extension = getResultExtension(file);
  if (!extension) return sharedIconCache.get(UNKNOWN_CACHE_KEY) ?? null;
  if (PATH_DEPENDENT_EXTENSIONS.has(extension)) return null;

  return sharedIconCache.get(getExtensionCacheKey(extension)) ?? null;
}

function loadSharedIcon(cacheKey: string, iconPath: string): IconCacheEntry | null {
  const cached = sharedIconCache.get(cacheKey);
  if (cached) return cached;

  const entry = readIcon(iconPath);
  if (entry) {
    sharedIconCache.set(cacheKey, entry);
    return entry;
  }

  if (cacheKey === UNKNOWN_CACHE_KEY) return null;

  const fallback = loadSharedIcon(UNKNOWN_CACHE_KEY, UNKNOWN_FILE_ICON_PATH);
  if (fallback) sharedIconCache.set(cacheKey, fallback);
  return fallback;
}

function getSharedIconDataUrl(cacheKey: string): string {
  return sharedIconCache.get(cacheKey)?.dataUrl ?? "";
}

function readIcon(fullPath: string): IconCacheEntry | null {
  try {
    const icon = window.ztools.getFileIcon(fullPath);
    if (!icon) return null;

    const hash = hashIcon(icon);
    const dataUrl = icon.startsWith("data:") ? icon : undefined;
    const existedUrl = iconUrlByHash.get(hash);
    if (existedUrl) return { hash, url: existedUrl, dataUrl };

    const url = dataUrl ? dataUrlToObjectUrl(dataUrl) : icon;
    iconUrlByHash.set(hash, url);

    return { hash, url, dataUrl };
  } catch {
    return null;
  }
}

function getExtensionCacheKey(extension: string): string {
  return `ext:${extension}`;
}

function getExtensionIconPath(extension: string): string {
  return `${EXTENSION_ICON_PATH_PREFIX}${extension}`;
}

function dataUrlToObjectUrl(dataUrl: string): string {
  const match = /^data:([^,]*),(.*)$/s.exec(dataUrl);
  if (!match) return dataUrl;

  const metadata = match[1];
  const payload = match[2];
  const [mimeType = "application/octet-stream", ...parameters] = metadata.split(";");
  const isBase64 = parameters.some((parameter) => parameter.toLowerCase() === "base64");
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/octet-stream" }));
}

function hashIcon(icon: string): string {
  // FNV-1a 32-bit：足够用于本地进程内图标去重，前缀长度可以降低碰撞风险。
  let hash = 0x811c9dc5;

  for (let index = 0; index < icon.length; index += 1) {
    hash ^= icon.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${icon.length}:${(hash >>> 0).toString(16)}`;
}

function getResultExtension(file: Pick<FinderResult, "name" | "extension" | "fullPath">): string {
  return (file.extension || getExtension(file.name || file.fullPath || "")).toLowerCase();
}

function getExtension(name: string): string {
  const fileName = name.split(/[\\/]/).pop() ?? name;
  const index = fileName.lastIndexOf(".");

  return index > 0 ? fileName.slice(index + 1).toLowerCase() : "";
}
