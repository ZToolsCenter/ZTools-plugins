/** 规范化 Node 版本提示（.nvmrc / .node-version / Project.nodeVersion）。 */
export function normalizeNodeVersion(rawVersion?: string | null): string | null {
  if (!rawVersion) return null;
  const trimmed = rawVersion.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase().startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+){0,2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

/** @deprecated 使用 normalizeNodeVersion */
export const normalizeNvmVersion = normalizeNodeVersion;

export function findInstalledNodeVersion(nodeVersionList: string[], targetVersion: string): string | undefined {
  return nodeVersionList.find((item) => {
    const normalizedItem = item.toLowerCase().startsWith('v') ? item.slice(1) : item;
    return normalizedItem === targetVersion || normalizedItem.startsWith(`${targetVersion}.`);
  });
}

export function projectNodeVersionHint(info: { nodeVersionHint?: string | null; nvmVersion?: string | null } | null | undefined): string | undefined {
  return info?.nodeVersionHint || info?.nvmVersion || undefined;
}
