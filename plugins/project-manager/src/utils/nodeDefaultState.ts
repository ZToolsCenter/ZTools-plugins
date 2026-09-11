import type { NodeVersion, NodeRuntimeSource } from '../types';
import { buildNodeRuntimeId, normalizeRuntimePath } from './nodeRuntime';

export function migrateLegacyNodeSource(source: string | undefined): NodeRuntimeSource {
  // 旧版 localStorage 的 nvm 标记实际对应手工添加的 Node，真实 NVM Runtime 由发现 API 单独写入。
  if (source === 'managed' || source === 'system' || source === 'custom') return source;
  if (source === 'nvm') return 'custom';
  return 'custom';
}

/***********************Node 版本排序*********************/

function parseVersion(version: string): number[] {
  return version.replace(/^v/i, '').split('.').map(Number);
}

const SOURCE_ORDER: Record<NodeRuntimeSource, number> = {
  system: 0,
  managed: 1,
  nvm: 2,
  custom: 3,
};

export function sortNodeVersions(versions: NodeVersion[]): NodeVersion[] {
  return [...versions].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;

    const sourceA = SOURCE_ORDER[a.source] ?? 9;
    const sourceB = SOURCE_ORDER[b.source] ?? 9;
    if (sourceA !== sourceB) return sourceA - sourceB;

    const versionA = parseVersion(a.version);
    const versionB = parseVersion(b.version);

    for (let index = 0; index < 3; index += 1) {
      if (versionA[index] !== versionB[index]) {
        return (versionB[index] || 0) - (versionA[index] || 0);
      }
    }

    return normalizeRuntimePath(a.path).localeCompare(normalizeRuntimePath(b.path));
  });
}

/***********************系统 Node 行更新*********************/

export function upsertSystemNodeVersion(
  versions: NodeVersion[],
  _systemNode: Pick<NodeVersion, 'version' | 'path' | 'status'>,
): NodeVersion[] {
  // System Node is ephemeral detector state, never a registry row.
  return sortNodeVersions(versions.filter(item => item.source !== 'system'));
}

export function mergeNodeRuntimes(parts: {
  system?: NodeVersion | null;
  managed?: NodeVersion[];
  nvm?: NodeVersion[];
  custom?: NodeVersion[];
}): NodeVersion[] {
  const seen = new Set<string>();
  const result: NodeVersion[] = [];

  const push = (node: NodeVersion | null | undefined) => {
    if (!node) return;
    const normalized = {
      ...node,
      runtimeId: node.runtimeId || buildNodeRuntimeId(node.source, node.version, node.path),
    };
    const key = normalized.runtimeId;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  };

  for (const node of parts.managed || []) push(node);
  for (const node of parts.nvm || []) push(node);
  for (const node of parts.custom || []) push({ ...node, source: 'custom' });

  return sortNodeVersions(result);
}
