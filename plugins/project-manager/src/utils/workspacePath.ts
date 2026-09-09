/** 规范化工作区相对路径，禁止绝对路径与 `..` 逃逸。 */
export function normalizeWorkspaceRelativePath(value: string, allowEmpty = true): string {
  const replaced = value.replace(/\\/g, '/');
  if (replaced.includes('\0') || replaced.startsWith('/') || /^[A-Za-z]:/.test(replaced)) {
    throw new Error(`Invalid workspace-relative path: ${value}`);
  }
  const parts: string[] = [];
  for (const part of replaced.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error(`Path escapes workspace root: ${value}`);
    parts.push(part);
  }
  if (!allowEmpty && parts.length === 0) throw new Error(`Workspace-relative path is required: ${value}`);
  return parts.join('/');
}

export function joinWorkspacePath(...parts: string[]): string {
  return normalizeWorkspaceRelativePath(parts.filter(Boolean).join('/'));
}

export function parentWorkspacePath(value: string): string {
  const normalized = normalizeWorkspaceRelativePath(value);
  const parts = normalized ? normalized.split('/') : [];
  parts.pop();
  return parts.join('/');
}

export function joinAbsolutePath(root: string, relative = ''): string {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  const normalized = normalizeWorkspaceRelativePath(relative);
  if (!normalized) return normalizedRoot;
  const separator = normalizedRoot.includes('\\') ? '\\' : '/';
  return `${normalizedRoot}${separator}${normalized.replace(/\//g, separator)}`;
}

/** 物理路径比较模式：Windows 忽略大小写；Linux/macOS 默认区分大小写。 */
export type PathCompareMode = 'sensitive' | 'insensitive';

/** 从 UA / process.platform 推断当前平台，供路径比较使用。 */
export function detectPathPlatform(platformHint?: string): string {
  if (platformHint) return platformHint.toLowerCase();
  const proc = (globalThis as { process?: { platform?: string } }).process;
  if (proc && typeof proc.platform === 'string') {
    return proc.platform.toLowerCase();
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/Windows/i.test(ua)) return 'win32';
    if (/Mac OS|Macintosh/i.test(ua)) return 'darwin';
  }
  return 'linux';
}

/**
 * Windows 可按大小写不敏感比较；Linux 必须区分大小写。
 * macOS 可能是 APFS case-sensitive，不能假设永远 insensitive。
 */
export function pathCompareModeForPlatform(platformHint?: string): PathCompareMode {
  const platform = detectPathPlatform(platformHint);
  if (platform === 'win32' || platform === 'windows') return 'insensitive';
  return 'sensitive';
}

/** 统一分隔符并去掉尾部斜杠；仅在 insensitive 模式下转小写。 */
export function normalizeComparablePath(value: string, mode?: PathCompareMode): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const compareMode = mode ?? pathCompareModeForPlatform();
  return compareMode === 'insensitive' ? normalized.toLowerCase() : normalized;
}

export function pathsEqual(a: string, b: string, mode?: PathCompareMode): boolean {
  return normalizeComparablePath(a, mode) === normalizeComparablePath(b, mode);
}

export function isPathInside(root: string, candidate: string, mode?: PathCompareMode): boolean {
  const normalizedRoot = normalizeComparablePath(root, mode);
  const normalizedCandidate = normalizeComparablePath(candidate, mode);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

/** 子路径位于父路径文件系统子树内（不含自身）。不发后端请求。 */
export function isFilesystemDescendant(parentPath: string, childPath: string, mode?: PathCompareMode): boolean {
  const compareMode = mode ?? pathCompareModeForPlatform();
  const parent = normalizeComparablePath(parentPath, compareMode);
  const child = normalizeComparablePath(childPath, compareMode);
  return child !== parent && child.startsWith(`${parent}/`);
}

/**
 * Explorer 只对「路径不在父项目文件系统子树内」的注册子项目追加 logical child。
 * 位于子树内的由实际目录节点渲染，避免 nested registered child 重复。
 */
export function shouldAppendLogicalExplorerChild(
  parentPath: string,
  childPath: string,
  mode?: PathCompareMode,
): boolean {
  return !isFilesystemDescendant(parentPath, childPath, mode);
}

/** Editor document key：统一 `/`、保留大小写、拒绝 `..`，不做全局 toLowerCase。 */
export function editorDocumentKey(relativePath: string): string {
  return normalizeWorkspaceRelativePath(relativePath, false);
}

/** 文件/目录 rename 后，把打开文档的相对路径映射到新位置。 */
export function remapWorkspaceRelativePath(from: string, to: string, relativePath: string): string | null {
  const fromPath = normalizeWorkspaceRelativePath(from, false);
  const toPath = normalizeWorkspaceRelativePath(to, false);
  const current = normalizeWorkspaceRelativePath(relativePath, false);
  if (current === fromPath) return toPath;
  if (current.startsWith(`${fromPath}/`)) return `${toPath}/${current.slice(fromPath.length + 1)}`;
  return null;
}
