import * as url from 'url';
import * as os from 'os';
import * as path from 'path';

/**
 * 把 file:///c%3A/x 解码为系统路径；非 file: 协议原样返回。
 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file:')) return uri;
  try {
    return url.fileURLToPath(uri);
  } catch {
    // On Windows, fileURLToPath throws for POSIX-style paths like file:///home/x.
    // Extract the path portion manually and convert slashes to backslashes.
    try {
      const parsed = new URL(uri);
      const decoded = decodeURIComponent(parsed.pathname);
      return decoded.replace(/\//g, path.sep);
    } catch {
      return uri;
    }
  }
}

/**
 * home 目录前缀替换为 ~。Windows 下保留反斜杠原样。
 */
export function prettyPath(p: string): string {
  const home = os.homedir();
  if (p.toLowerCase().startsWith(home.toLowerCase())) {
    return '~' + p.slice(home.length);
  }
  return p;
}

/**
 * 生成去重 ID。
 * 本地路径：path.normalize + 全小写（Windows 大小写不敏感且 / \ 等价）。
 * Remote URI：原样（区分大小写）。
 */
export function normalizeId(p: string, opts: { isRemote?: boolean } = {}): string {
  if (opts.isRemote) return p;
  const normalized = path.normalize(p);
  // Windows + macOS 默认大小写不敏感；POSIX (Linux) 大小写敏感，不能 lowercase 否则会 collide
  // /home/Alice/x 与 /home/alice/x 这样的不同文件。
  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}
