/**
 * 共享的图片 ref → 可用 URL 解析函数
 *
 * 缓存 ObjectURL：同一 ref 全局复用同一个 ObjectURL，避免 BlockNote 每次渲染
 * 调用 resolveFileUrl 时无限创建新 ObjectURL 导致内存泄漏。
 *
 * 缓存键为原始 ref（att:/uuid:/本地路径），缓存生命周期与页面一致（不主动 revoke）。
 * 网络 URL / data: / blob: 不经过 createObjectURL，原样返回，不缓存。
 */

const MAX_OBJECT_URL_CACHE_SIZE = 256;

// 模块级缓存：ref → ObjectURL
const objectUrlCache = new Map<string, string>();

function revokeObjectUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore browser/runtime revoke differences
  }
}

function rememberObjectUrl(cacheKey: string, objectUrl: string) {
  objectUrlCache.set(cacheKey, objectUrl);

  while (objectUrlCache.size > MAX_OBJECT_URL_CACHE_SIZE) {
    const oldest = objectUrlCache.entries().next().value as
      [string, string] | undefined;
    if (!oldest) return;
    objectUrlCache.delete(oldest[0]);
    revokeObjectUrl(oldest[1]);
  }
}

export function clearResolvedImageObjectUrlCache() {
  for (const objectUrl of objectUrlCache.values()) {
    revokeObjectUrl(objectUrl);
  }
  objectUrlCache.clear();
}

/**
 * 将图片引用解析为可在 <img src> 中使用的 URL。
 *
 * @param url     图片引用（att:/uuid:/./assets/... 或网络/data:/blob:）
 * @param pageLocalFilePath  当前页面的本地文件路径（用于解析 ./assets/ 相对路径）
 */
export async function resolveImageRefToUrl(
  url: string,
  pageLocalFilePath?: string | null,
): Promise<string> {
  // 网络 URL / data: / blob: 原样返回，不缓存
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }

  // 本地文件路径（./assets/ 等）
  const { isLocalFilePath, resolveToAbsolute, readLocalFileAsBlobAsync } =
    await import("./strategies/file-system");
  if (isLocalFilePath(url)) {
    const isAbsolutePath = url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url);
    const fullPath = isAbsolutePath
      ? url
      : pageLocalFilePath
        ? resolveToAbsolute(pageLocalFilePath.replace(/[\\/][^\\/]+$/, ""), url)
        : null;

    if (fullPath) {
      const cacheKey = `local:${fullPath}`;
      const cached = objectUrlCache.get(cacheKey);
      if (cached) return cached;

      const blob = await readLocalFileAsBlobAsync(fullPath);
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        rememberObjectUrl(cacheKey, objectUrl);
        return objectUrl;
      }
    }
    return url;
  }

  // 命中缓存：复用已有 ObjectURL
  const cached = objectUrlCache.get(url);
  if (cached) return cached;

  // 视频附件优先走 videoStorage，其他内部引用再走 imageStorage。
  const { videoStorage } = await import("@/lib/videoStorage");
  const blob = videoStorage.canHandle(url)
    ? await videoStorage.load(url, pageLocalFilePath)
    : await (await import("./index")).imageStorage.load(url);
  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    rememberObjectUrl(url, objectUrl);
    return objectUrl;
  }

  return url;
}
