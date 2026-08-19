import type { EditorPlatform } from "@/components/editor/platform/types";

const TEMP_RESOURCE_PREFIX = "goose-note/opened-resources";
const TEMP_RESOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_MATERIALIZED_RESOURCE_SIZE = 100 * 1024 * 1024;

export type OpenExternalResourceResult = {
  ok: boolean;
  error?: string;
  path?: string;
};

type OpenExternalResourceOptions = {
  source: string;
  fileName?: string;
  mimeType?: string;
  pageLocalFilePath?: string | null;
  platform: EditorPlatform;
  loadInternalResource?: (source: string) => Promise<Blob | null>;
};

const pendingOpens = new Map<string, Promise<OpenExternalResourceResult>>();
const cleanedPlatforms = new WeakSet<EditorPlatform>();

function sanitizeFileName(value: string): string {
  const trimmed = value.trim() || "resource";
  // eslint-disable-next-line no-control-regex -- 临时文件名必须剔除控制字符和跨平台非法字符。
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "image/avif": "avif",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return known[normalized] ?? normalized.split("/")[1]?.split("+")[0] ?? "bin";
}

function ensureExtension(fileName: string, mimeType: string): string {
  const safe = sanitizeFileName(fileName);
  if (/\.[a-z0-9]{1,12}$/i.test(safe)) return safe;
  return `${safe}.${extensionForMime(mimeType)}`;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function fileUrlToPath(value: string): string | null {
  if (!/^file:/i.test(value)) return null;
  try {
    const url = new URL(value);
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:[\\/]/.test(pathname)) pathname = pathname.slice(1);
    return url.host ? `//${url.host}${pathname}` : pathname;
  } catch {
    return null;
  }
}

function resolveRelativePath(pagePath: string, reference: string): string {
  const separator = pagePath.includes("\\") ? "\\" : "/";
  const base = pagePath.replace(/[\\/][^\\/]+$/, "");
  const prefix = base.startsWith("/") ? "/" : "";
  const parts = `${base}${separator}${reference}`.split(/[\\/]/);
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return prefix + resolved.join(separator);
}

export function resolvePhysicalResourcePath(
  source: string,
  pageLocalFilePath?: string | null,
): string | null {
  const filePath = fileUrlToPath(source);
  if (filePath) return filePath;
  if (isAbsolutePath(source)) return source;
  if (
    pageLocalFilePath &&
    !/^[a-z][a-z0-9+.-]*:/i.test(source) &&
    !source.startsWith("//")
  ) {
    return resolveRelativePath(pageLocalFilePath, source);
  }
  return null;
}

async function blobToBase64Payload(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readResourceBlob(
  options: OpenExternalResourceOptions,
): Promise<Blob> {
  const { source, loadInternalResource } = options;
  if (/^(?:https?|data|blob):/i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`资源读取失败（${response.status}）`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_MATERIALIZED_RESOURCE_SIZE) {
      throw new Error("文件超过 100MB，未交给系统打开");
    }
    const blob = await response.blob();
    if (blob.size > MAX_MATERIALIZED_RESOURCE_SIZE) {
      throw new Error("文件超过 100MB，未交给系统打开");
    }
    return blob;
  }

  const blob = await loadInternalResource?.(source);
  if (!blob) throw new Error("资源不存在或尚未同步完成");
  if (blob.size > MAX_MATERIALIZED_RESOURCE_SIZE) {
    throw new Error("文件超过 100MB，未交给系统打开");
  }
  return blob;
}

async function openResourceOnce(
  options: OpenExternalResourceOptions,
): Promise<OpenExternalResourceResult> {
  const { source, platform, pageLocalFilePath } = options;
  const trimmedSource = source.trim();
  if (!trimmedSource) return { ok: false, error: "资源地址为空" };

  const physicalPath = resolvePhysicalResourcePath(
    trimmedSource,
    pageLocalFilePath,
  );
  if (physicalPath) {
    if (platform.fs.isAvailable()) {
      const exists = await platform.fs.existsAsync(physicalPath);
      if (!exists) return { ok: false, error: "本地文件不存在" };
    }
    const opened = await platform.shell.openPath(physicalPath);
    return opened
      ? { ok: true, path: physicalPath }
      : { ok: false, error: "系统默认应用打开失败" };
  }

  if (!platform.fs.isAvailable()) {
    return { ok: false, error: "当前环境不支持调用系统应用" };
  }

  if (!cleanedPlatforms.has(platform)) {
    cleanedPlatforms.add(platform);
    try {
      await platform.fs.cleanupTempFiles(
        TEMP_RESOURCE_PREFIX,
        TEMP_RESOURCE_MAX_AGE_MS,
      );
    } catch {
      // 清理失败不阻断本次打开；下次启动仍会重试。
    }
  }

  let blob: Blob;
  try {
    blob = await readResourceBlob({ ...options, source: trimmedSource });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "资源读取失败",
    };
  }

  const mimeType = blob.type || options.mimeType || "application/octet-stream";
  const defaultName = mimeType.startsWith("image/") ? "image" : "resource";
  const fileName = ensureExtension(options.fileName || defaultName, mimeType);
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const relativePath = `${TEMP_RESOURCE_PREFIX}/${token}/${fileName}`;
  const targetPath = await platform.fs.writeTempFile(
    relativePath,
    await blobToBase64Payload(blob),
  );
  if (!targetPath) return { ok: false, error: "临时文件写入失败" };

  const opened = await platform.shell.openPath(targetPath);
  return opened
    ? { ok: true, path: targetPath }
    : { ok: false, error: "系统默认应用打开失败" };
}

export function openResourceExternally(
  options: OpenExternalResourceOptions,
): Promise<OpenExternalResourceResult> {
  const key = `${options.source}\n${options.fileName ?? ""}`;
  const pending = pendingOpens.get(key);
  if (pending) return pending;

  const operation = openResourceOnce(options).finally(() => {
    pendingOpens.delete(key);
  });
  pendingOpens.set(key, operation);
  return operation;
}
