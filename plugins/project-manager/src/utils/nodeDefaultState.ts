import type { NodeVersion } from '../types';

/***********************Node 版本排序*********************/

function parseVersion(version: string): number[] {
  return version.replace(/^v/i, '').split('.').map(Number);
}

export function sortNodeVersions(versions: NodeVersion[]): NodeVersion[] {
  return [...versions].sort((a, b) => {
    if (a.source === 'system') return -1;
    if (b.source === 'system') return 1;

    const versionA = parseVersion(a.version);
    const versionB = parseVersion(b.version);

    for (let index = 0; index < 3; index += 1) {
      if (versionA[index] !== versionB[index]) {
        return (versionB[index] || 0) - (versionA[index] || 0);
      }
    }

    return a.path.localeCompare(b.path);
  });
}

/***********************默认 Node 行更新*********************/

export function upsertSystemNodeVersion(
  versions: NodeVersion[],
  systemNode: Pick<NodeVersion, 'version' | 'path'>,
): NodeVersion[] {
  const nextVersions = versions.filter(item => item.source !== 'system');
  nextVersions.unshift({
    version: systemNode.version,
    path: systemNode.path,
    source: 'system',
  });

  return sortNodeVersions(nextVersions);
}
