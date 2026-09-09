import type { AppDefaultNode, NodeRuntimeSource, NodeVersion, Project } from '../types';
import { findInstalledNodeVersion, normalizeNodeVersion } from './nvm';

const DEFAULT_NODE_VERSION_LABELS = new Set([
  'default',
  'system default',
  '默认',
]);

const SOURCE_PRIORITY: Record<NodeRuntimeSource, number> = {
  managed: 0,
  nvm: 1,
  custom: 2,
  system: 3,
};

export interface ResolvedNodeRuntime {
  runtime: NodeVersion | null;
  unavailable: boolean;
  reason?: string;
}

function normalizeNodeVersionLabel(value?: string) {
  return (value || '').trim().toLowerCase();
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.includes('\\');
}

/** 用于 runtimeId 的平台感知路径规范化。 */
export function normalizeRuntimePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized;
}

export function normalizeRuntimeVersion(version: string): string {
  const normalized = normalizeNodeVersion(version);
  if (normalized) return `v${normalized}`;
  const trimmed = version.trim();
  return trimmed.toLowerCase().startsWith('v') ? `v${trimmed.slice(1)}` : `v${trimmed}`;
}

export function buildNodeRuntimeId(source: NodeRuntimeSource, version: string, path: string): string {
  if (source === 'managed') return `managed:${normalizeRuntimeVersion(version)}`;
  return `${source}:${normalizeRuntimePath(path)}`;
}

export function getNodeRuntimeId(runtime: NodeVersion): string {
  return runtime.runtimeId || buildNodeRuntimeId(runtime.source, runtime.version, runtime.path);
}

export function ensureNodeRuntime(runtime: NodeVersion): NodeVersion {
  return { ...runtime, runtimeId: getNodeRuntimeId(runtime) };
}

export function isUsableNodeRuntime(runtime: NodeVersion | null | undefined): runtime is NodeVersion {
  return !!runtime
    && !!runtime.path
    && runtime.path !== 'System Default'
    && runtime.status !== 'broken'
    && runtime.status !== 'unavailable';
}

function shouldUseDefaultNode(projectNodeVersion?: string) {
  const normalizedVersion = normalizeNodeVersionLabel(projectNodeVersion);
  if (!normalizedVersion) return true;
  if (DEFAULT_NODE_VERSION_LABELS.has(normalizedVersion)) return true;
  return !/\d/.test(normalizedVersion);
}

export function isExplicitNodeVersion(nodeVersion?: string): boolean {
  if (!nodeVersion) return false;
  if (shouldUseDefaultNode(nodeVersion)) return false;
  return normalizeNodeVersion(nodeVersion) !== null;
}

function versionMatches(runtime: NodeVersion, target: string): boolean {
  const normalizedTarget = normalizeNodeVersion(target);
  if (!normalizedTarget) return false;
  const normalizedRuntime = normalizeNodeVersion(runtime.version);
  return normalizedRuntime === normalizedTarget || normalizedRuntime?.startsWith(`${normalizedTarget}.`) === true;
}

function compareRuntime(a: NodeVersion, b: NodeVersion): number {
  const source = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
  if (source !== 0) return source;
  return normalizeRuntimePath(a.path).localeCompare(normalizeRuntimePath(b.path));
}

function findVersionByPriority(versions: NodeVersion[], predicate: (runtime: NodeVersion) => boolean): NodeVersion | undefined {
  return versions
    .map(ensureNodeRuntime)
    .filter(predicate)
    .sort(compareRuntime)[0];
}

function findRuntimeById(versions: NodeVersion[], runtimeId: string): NodeVersion | undefined {
  return versions.map(ensureNodeRuntime).find(runtime => getNodeRuntimeId(runtime) === runtimeId);
}

export function getRuntimesByVersion(versions: NodeVersion[], version: string): NodeVersion[] {
  return versions
    .map(ensureNodeRuntime)
    .filter(runtime => isUsableNodeRuntime(runtime) && versionMatches(runtime, version))
    .sort(compareRuntime);
}

export function getRuntimeById(versions: NodeVersion[], runtimeId: string): NodeVersion | undefined {
  return findRuntimeById(versions, runtimeId);
}

function findRuntimeForDefault(
  appDefault: AppDefaultNode | null | undefined,
  versions: NodeVersion[],
): NodeVersion | undefined {
  if (!appDefault) return undefined;
  if (appDefault.runtimeId) {
    const exact = findRuntimeById(versions, appDefault.runtimeId);
    if (exact) return exact;
  }

  const bySource = findVersionByPriority(versions, runtime =>
    runtime.source === appDefault.source && (
      normalizeRuntimePath(runtime.path) === normalizeRuntimePath(appDefault.path)
    ),
  );
  if (bySource) return bySource;

  // Exact binding 缺失时按版本恢复，但保留 persisted appDefault 不被静默改写。
  if (appDefault.version) {
    return findVersionByPriority(versions, runtime =>
      isUsableNodeRuntime(runtime) && versionMatches(runtime, appDefault.version!),
    );
  }
  return undefined;
}

export function resolveAppDefaultRuntime(
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): ResolvedNodeRuntime {
  if (appDefault) {
    const runtime = findRuntimeForDefault(appDefault, versions);
    return runtime && isUsableNodeRuntime(runtime)
      ? { runtime, unavailable: false }
      : { runtime: null, unavailable: true, reason: 'app_default_runtime_unavailable' };
  }

  const system = systemRuntime && isUsableNodeRuntime(systemRuntime)
    ? systemRuntime
    : findVersionByPriority(versions, runtime => runtime.source === 'system');
  return system && isUsableNodeRuntime(system)
    ? { runtime: system, unavailable: false }
    : { runtime: null, unavailable: true, reason: 'system_node_unavailable' };
}

export function resolveProjectRuntime(
  project: Project,
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): ResolvedNodeRuntime {
  if (project.nodeRuntimeId) {
    const runtime = findRuntimeById(versions, project.nodeRuntimeId);
    if (runtime && isUsableNodeRuntime(runtime)) return { runtime, unavailable: false };
    if (!project.nodeVersion) return { runtime: null, unavailable: true, reason: 'project_runtime_unavailable' };

    const fallback = findVersionByPriority(versions, candidate =>
      isUsableNodeRuntime(candidate) && versionMatches(candidate, project.nodeVersion!),
    );
    return fallback
      ? { runtime: fallback, unavailable: false, reason: 'project_runtime_binding_fallback' }
      : { runtime: null, unavailable: true, reason: 'project_runtime_unavailable' };
  }

  if (!project.nodeVersion || shouldUseDefaultNode(project.nodeVersion)) {
    return resolveAppDefaultRuntime(versions, appDefault, systemRuntime);
  }

  const runtime = findVersionByPriority(versions, candidate =>
    isUsableNodeRuntime(candidate) && versionMatches(candidate, project.nodeVersion!),
  );
  if (runtime) return { runtime, unavailable: false };

  const normalizedTarget = normalizeNodeVersion(project.nodeVersion);
  if (normalizedTarget) {
    const matchedVersion = findInstalledNodeVersion(
      versions.map(version => version.version),
      normalizedTarget,
    );
    if (matchedVersion) {
      const matched = findVersionByPriority(versions, candidate => candidate.version === matchedVersion);
      if (matched && isUsableNodeRuntime(matched)) return { runtime: matched, unavailable: false };
    }
  }

  return { runtime: null, unavailable: true, reason: 'project_node_version_unavailable' };
}

export function resolveProjectNodePath(
  project: Project,
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): string {
  return resolveProjectRuntime(project, versions, appDefault, systemRuntime).runtime?.path || '';
}

export function resolveNodePathFromVersion(
  versionLabel: string | null | undefined,
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): string {
  if (!versionLabel || shouldUseDefaultNode(versionLabel)) {
    return resolveAppDefaultRuntime(versions, appDefault, systemRuntime).runtime?.path || '';
  }
  return findVersionByPriority(versions, runtime =>
    isUsableNodeRuntime(runtime) && versionMatches(runtime, versionLabel),
  )?.path || '';
}

export function resolveAppDefaultNodePath(
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): string {
  return resolveAppDefaultRuntime(versions, appDefault, systemRuntime).runtime?.path || '';
}

export function shouldInjectTerminalNode(project: Project): boolean {
  return project.type === 'node' && project.terminalInjectNode !== false;
}
