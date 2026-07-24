import * as path from 'path';
import type { RawEntry, RecentItem } from './types';
import { fileUriToPath, prettyPath, normalizeId } from './url-utils';

/**
 * 把 VSCode 形态的 RawEntry[] 转为 UI 形态的 RecentItem[]。
 * 单文件历史 (fileUri) 被丢弃；解析失败的条目静默丢弃。
 */
export function mapEntries(entries: RawEntry[]): RecentItem[] {
  const out: RecentItem[] = [];
  for (const e of entries) {
    try {
      const item = mapOne(e);
      if (item) out.push(item);
    } catch {
      // 单条解析异常，丢弃
    }
  }
  return out;
}

function mapOne(e: RawEntry): RecentItem | null {
  if (e.fileUri) return null;

  if (e.workspace?.configPath) {
    const uri = e.workspace.configPath;
    if (uri.startsWith('file:')) {
      const p = fileUriToPath(uri);
      const title = e.label ?? path.basename(p).replace(/\.code-workspace$/, '');
      return {
        id: normalizeId(p),
        kind: 'workspace',
        title,
        subtitle: prettyPath(p),
        rawPath: p,
        exists: false, // 由 loader 阶段填充
      };
    }
    return null;
  }

  if (e.folderUri) {
    const uri = e.folderUri;
    if (uri.startsWith('file:')) {
      const p = fileUriToPath(uri);
      return {
        id: normalizeId(p),
        kind: 'folder',
        title: e.label ?? path.basename(p),
        subtitle: prettyPath(p),
        rawPath: p,
        exists: false,
      };
    }
    // remote: vscode-remote://, vscode-vfs://, etc.
    const m = uri.match(/^[^:]+:\/\/([^/]+)(\/.*)?$/);
    const host = m?.[1] ?? uri;
    return {
      id: normalizeId(uri, { isRemote: true }),
      kind: 'remote',
      title: e.label ?? host,
      subtitle: uri,
      rawPath: uri,
      exists: true,
    };
  }

  return null;
}
