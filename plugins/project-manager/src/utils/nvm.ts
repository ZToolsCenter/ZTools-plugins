export function normalizeNvmVersion(rawVersion?: string | null): string | null {
  if (!rawVersion) return null;
  const trimmed = rawVersion.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase().startsWith('v') ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d+){0,2}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function findInstalledNodeVersion(nodeVersionList: string[], targetVersion: string): string | undefined {
  return nodeVersionList.find((item) => {
    const normalizedItem = item.toLowerCase().startsWith('v') ? item.slice(1) : item;
    return normalizedItem === targetVersion || normalizedItem.startsWith(`${targetVersion}.`);
  });
}
