import type { NodeVersion, Project } from '../types';
import { findInstalledNodeVersion, normalizeNvmVersion } from './nvm';

const DEFAULT_NODE_VERSION_LABELS = new Set([
  'default',
  'system default',
  '\u9ed8\u8ba4',
]);

function normalizeNodeVersionLabel(value?: string) {
  return (value || '').trim().toLowerCase();
}

function shouldUseSystemNode(projectNodeVersion?: string) {
  const normalizedVersion = normalizeNodeVersionLabel(projectNodeVersion);
  if (!normalizedVersion) return false;
  if (DEFAULT_NODE_VERSION_LABELS.has(normalizedVersion)) return true;

  // Older data may contain mojibake labels instead of a real semantic version.
  return !/\d/.test(normalizedVersion);
}

/**
 * Returns true when the project has a specific (non-default) node version configured.
 */
export function isExplicitNodeVersion(nodeVersion?: string): boolean {
  if (!nodeVersion) return false;
  if (shouldUseSystemNode(nodeVersion)) return false;
  return normalizeNvmVersion(nodeVersion) !== null;
}

/**
 * Find a version entry preferring nvm/custom sources over system.
 * The system node path is typically an NVM symlink that changes when switching
 * global versions, so we prefer the pinned NVM directory path.
 */
function findVersionPreferNvm(versions: NodeVersion[], predicate: (v: NodeVersion) => boolean): NodeVersion | undefined {
  let systemFallback: NodeVersion | undefined;
  for (const v of versions) {
    if (!predicate(v)) continue;
    if (v.source !== 'system') return v;
    if (!systemFallback) systemFallback = v;
  }
  return systemFallback;
}

export function resolveProjectNodePath(project: Project, versions: NodeVersion[]) {
  if (!project.nodeVersion) return '';

  if (shouldUseSystemNode(project.nodeVersion)) {
    const systemNode = versions.find((version) => version.source === 'system');
    if (!systemNode || systemNode.path === 'System Default') return '';
    return systemNode.path;
  }

  const exactMatch = findVersionPreferNvm(versions, (v) => v.version === project.nodeVersion);
  if (exactMatch) {
    return exactMatch.path === 'System Default' ? '' : exactMatch.path;
  }

  const normalizedTargetVersion = normalizeNvmVersion(project.nodeVersion);
  if (normalizedTargetVersion) {
    const matchedVersion = findInstalledNodeVersion(
      versions.map((version) => version.version),
      normalizedTargetVersion
    );
    if (matchedVersion) {
      const normalizedMatch = findVersionPreferNvm(versions, (v) => v.version === matchedVersion);
      if (normalizedMatch) {
        return normalizedMatch.path === 'System Default' ? '' : normalizedMatch.path;
      }
    }
  }

  return '';
}

export function resolveNodePathFromVersion(versionLabel: string | null | undefined, versions: NodeVersion[]) {
  if (!versionLabel) return '';

  if (shouldUseSystemNode(versionLabel)) {
    const systemNode = versions.find((version) => version.source === 'system');
    if (!systemNode || systemNode.path === 'System Default') return '';
    return systemNode.path;
  }

  const exactMatch = findVersionPreferNvm(versions, (v) => v.version === versionLabel);
  if (exactMatch) {
    return exactMatch.path === 'System Default' ? '' : exactMatch.path;
  }

  const normalizedTargetVersion = normalizeNvmVersion(versionLabel);
  if (normalizedTargetVersion) {
    const matchedVersion = findInstalledNodeVersion(
      versions.map((version) => version.version),
      normalizedTargetVersion
    );
    if (matchedVersion) {
      const normalizedMatch = findVersionPreferNvm(versions, (v) => v.version === matchedVersion);
      if (normalizedMatch) {
        return normalizedMatch.path === 'System Default' ? '' : normalizedMatch.path;
      }
    }
  }

  return '';
}
