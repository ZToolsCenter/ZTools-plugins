import type {
  AppDefaultNode,
  CanonicalNodeRuntime,
  CanonicalNodeRuntimeSource,
  NodeVersion,
  NodeVersionEntry,
  SystemNodeState,
} from '../types';
import { ensureNodeRuntime, getNodeRuntimeId, normalizeRuntimePath, normalizeRuntimeVersion } from './nodeRuntime';

const SOURCE_ORDER: Record<CanonicalNodeRuntime['preferredSource'], number> = {
  managed: 0,
  nvm: 1,
  custom: 2,
  external: 3,
};

type PhysicalNodeRuntime = NodeVersion & { source: 'managed' | 'nvm' | 'custom' };

export interface NodeRuntimeGroup {
  key: string;
  version: string;
  /** 仍保留 raw Runtime 形状，供旧项目绑定、终端和删除操作使用。 */
  runtimes: NodeVersion[];
  sources: CanonicalNodeRuntimeSource[];
  canonicalRuntimes: CanonicalNodeRuntime[];
  effectiveRuntime: NodeVersion;
  isSystemCurrent: boolean;
  isProjectManagerDefault: boolean;
}

export interface RuntimeSourceSummary {
  source: CanonicalNodeRuntimeSource;
  count: number;
}

export interface RuntimeEntryContext {
  systemNodeState?: SystemNodeState | null;
  appDefault?: AppDefaultNode | null;
}

function isExecutablePath(path: string): boolean {
  return /(?:^|[\\/])node(?:\.exe)?$/i.test(path.trim());
}

function runtimeRootPath(runtime: NodeVersion): string {
  const value = (runtime.canonicalPath || runtime.path || '').trim();
  if (!isExecutablePath(value)) return value.replace(/[\\/]+$/, '');
  return value.replace(/[\\/]+node(?:\.exe)?$/i, '').replace(/[\\/]+$/, '');
}

function runtimeExecutablePath(runtime: NodeVersion, root = runtimeRootPath(runtime)): string {
  const value = (runtime.canonicalPath || runtime.path || '').trim();
  if (isExecutablePath(value)) return value;
  const separator = value.includes('\\') ? '\\' : '/';
  return `${root}${separator}${separator === '\\' ? 'node.exe' : 'node'}`;
}

function canonicalRuntimeKey(runtime: NodeVersion): string {
  return `${normalizeRuntimeVersion(runtime.version).toLowerCase()}::${normalizeRuntimePath(runtimeRootPath(runtime))}`;
}

function aliasForRuntime(runtime: NodeVersion) {
  return {
    source: runtime.source,
    path: runtime.path,
    runtimeId: getNodeRuntimeId(runtime),
  };
}

function compareCanonicalRuntimes(left: CanonicalNodeRuntime, right: CanonicalNodeRuntime): number {
  const source = SOURCE_ORDER[left.preferredSource] - SOURCE_ORDER[right.preferredSource];
  if (source !== 0) return source;
  return normalizeRuntimePath(left.runtimePath).localeCompare(normalizeRuntimePath(right.runtimePath));
}

function stateMatchesRuntime(state: SystemNodeState | null | undefined, runtime: NodeVersion): boolean {
  if (!state?.available) return false;
  if (state.runtimeId && state.runtimeId === getNodeRuntimeId(runtime)) return true;
  const statePaths = [
    state.canonicalNodePath,
    state.nodePath,
    state.nvmTargetPath,
    state.candidates[0]?.canonicalPath,
    state.candidates[0]?.path,
  ].filter((path): path is string => !!path);
  const runtimePaths = [
    runtime.canonicalPath,
    runtime.path,
    runtimeRootPath(runtime),
    runtimeExecutablePath(runtime),
  ].filter((path): path is string => Boolean(path));
  return statePaths.some(statePath => runtimePaths.some(runtimePath => {
    const left = normalizeRuntimePath(statePath);
    const right = normalizeRuntimePath(runtimePath);
    return left === right || left.replace(/[\\/]node(?:\.exe)?$/i, '') === right.replace(/[\\/]node(?:\.exe)?$/i, '');
  }));
}

function defaultMatchesRuntime(defaultNode: AppDefaultNode | null | undefined, runtime: NodeVersion): boolean {
  if (!defaultNode) return false;
  if (defaultNode.runtimeId && defaultNode.runtimeId === getNodeRuntimeId(runtime)) return true;
  return defaultNode.source === runtime.source
    && normalizeRuntimePath(defaultNode.path) === normalizeRuntimePath(runtime.path)
    && normalizeRuntimeVersion(defaultNode.version) === normalizeRuntimeVersion(runtime.version);
}

function defaultMatchesCanonical(
  defaultNode: AppDefaultNode | null | undefined,
  runtime: CanonicalNodeRuntime,
): boolean {
  if (!defaultNode) return false;
  if (defaultMatchesRuntime(defaultNode, runtime.runtime)) return true;
  return runtime.aliases.some(alias =>
    alias.runtimeId === defaultNode.runtimeId
      || (alias.source === defaultNode.source
        && normalizeRuntimePath(alias.path) === normalizeRuntimePath(defaultNode.path)),
  );
}

function isPhysicalRuntime(runtime: NodeVersion): runtime is PhysicalNodeRuntime {
  return runtime.source === 'managed' || runtime.source === 'nvm' || runtime.source === 'custom';
}

function systemVariantPriority(
  state: SystemNodeState | null | undefined,
  runtime: PhysicalNodeRuntime,
): number {
  if (!state?.available || !stateMatchesRuntime(state, runtime)) return Number.POSITIVE_INFINITY;
  if (state.runtimeId && state.runtimeId === getNodeRuntimeId(runtime)) return 0;
  if (state.source === runtime.source) return 1;
  if (state.pathScope === 'nvm' && runtime.source === 'nvm') return 1;
  return 2 + SOURCE_ORDER[runtime.source];
}

function selectRuntimeVariant(
  variants: NodeVersion[],
  context: RuntimeEntryContext,
): PhysicalNodeRuntime {
  const physicalVariants = variants.filter(isPhysicalRuntime);
  return [...physicalVariants].sort((left, right) => {
    const leftSystemPriority = systemVariantPriority(context.systemNodeState, left);
    const rightSystemPriority = systemVariantPriority(context.systemNodeState, right);
    const leftPriority = defaultMatchesRuntime(context.appDefault, left)
      ? 0
      : Number.isFinite(leftSystemPriority)
        ? 1 + leftSystemPriority
        : 10 + SOURCE_ORDER[left.source];
    const rightPriority = defaultMatchesRuntime(context.appDefault, right)
      ? 0
      : Number.isFinite(rightSystemPriority)
        ? 1 + rightSystemPriority
        : 10 + SOURCE_ORDER[right.source];
    return leftPriority - rightPriority
      || normalizeRuntimePath(left.path).localeCompare(normalizeRuntimePath(right.path));
  })[0];
}

function preferredRuntime(canonicalRuntimes: CanonicalNodeRuntime[]): CanonicalNodeRuntime {
  const appDefault = canonicalRuntimes.find(runtime => runtime.isProjectManagerDefault);
  if (appDefault) return appDefault;

  const systemCurrent = canonicalRuntimes.find(runtime => runtime.isSystemCurrent);
  if (systemCurrent) return systemCurrent;

  return [...canonicalRuntimes].sort(compareCanonicalRuntimes)[0];
}

/**
 * 将扫描结果收敛为 physical Runtime。System raw candidate 只作为 alias，
 * 不会单独产生一条主列表 Runtime。
 */
export function canonicalizeNodeRuntimes(
  runtimes: NodeVersion[],
  context: RuntimeEntryContext = {},
): CanonicalNodeRuntime[] {
  const byPath = new Map<string, CanonicalNodeRuntime>();

  const orderedRuntimes = [...runtimes].sort((left, right) => {
    const leftIsSystem = left.source === 'system';
    const rightIsSystem = right.source === 'system';
    return Number(leftIsSystem) - Number(rightIsSystem);
  });

  for (const sourceRuntime of orderedRuntimes) {
    if (!sourceRuntime.version || (!sourceRuntime.path && sourceRuntime.status !== 'installing')) continue;
    const runtime = ensureNodeRuntime(sourceRuntime);
    const key = canonicalRuntimeKey(runtime);
    const existing = byPath.get(key);

    if (runtime.source === 'system') {
      if (existing) {
        existing.aliases.push(aliasForRuntime(runtime));
        existing.isSystemCurrent ||= stateMatchesRuntime(context.systemNodeState, existing.runtime);
      }
      continue;
    }
    if (!['managed', 'nvm', 'custom'].includes(runtime.source)) continue;

    if (existing) {
      existing.aliases.push(aliasForRuntime(runtime));
      existing.variants.push(runtime);
      continue;
    }

    const runtimePath = runtimeRootPath(runtime);
    byPath.set(key, {
      canonicalId: `node:${normalizeRuntimeVersion(runtime.version).toLowerCase()}:${normalizeRuntimePath(runtimePath)}`,
      version: normalizeRuntimeVersion(runtime.version),
      preferredSource: runtime.source,
      runtimePath,
      executablePath: runtimeExecutablePath(runtime, runtimePath),
      variants: [runtime],
      aliases: [aliasForRuntime(runtime)],
      runtime,
      isSystemCurrent: false,
      isProjectManagerDefault: false,
    });
  }

  for (const canonical of byPath.values()) {
    const physicalVariants = canonical.variants.filter(isPhysicalRuntime);
    const selected = selectRuntimeVariant(canonical.variants, context);
    canonical.runtime = selected;
    canonical.preferredSource = selected.source;
    canonical.runtimePath = runtimeRootPath(selected);
    canonical.executablePath = runtimeExecutablePath(selected, canonical.runtimePath);
    canonical.isSystemCurrent = physicalVariants.some(runtime =>
      stateMatchesRuntime(context.systemNodeState, runtime),
    );
    canonical.isProjectManagerDefault = defaultMatchesCanonical(context.appDefault, canonical);
  }

  return [...byPath.values()].sort((left, right) => {
    const version = right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' });
    return version || compareCanonicalRuntimes(left, right);
  });
}

/** 构建 Runtime Center 的 canonical Version Entry，一行对应一个精确版本。 */
export function buildNodeVersionEntries(
  runtimes: NodeVersion[],
  context: RuntimeEntryContext = {},
): NodeVersionEntry[] {
  const entries = new Map<string, NodeVersionEntry>();
  for (const runtime of canonicalizeNodeRuntimes(runtimes, context)) {
    const key = runtime.version.toLowerCase();
    const entry = entries.get(key) || {
      key,
      version: runtime.version,
      runtimes: [],
      effectiveRuntime: runtime.runtime,
      isSystemCurrent: false,
      isProjectManagerDefault: false,
    };
    entry.runtimes.push(runtime);
    entry.isSystemCurrent ||= runtime.isSystemCurrent;
    entry.isProjectManagerDefault ||= runtime.isProjectManagerDefault;
    entries.set(key, entry);
  }

  return [...entries.values()]
    .map(entry => {
      const effective = preferredRuntime(entry.runtimes);
      entry.effectiveRuntime = effective.runtime;
      entry.isSystemCurrent ||= effective.isSystemCurrent;
      entry.isProjectManagerDefault ||= effective.isProjectManagerDefault;
      return entry;
    })
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' }));
}

/** 兼容旧 UI 的 group 形状，但底层已由 canonical Version Entry 驱动。 */
export function groupNodeRuntimesByVersion(
  runtimes: NodeVersion[],
  context: RuntimeEntryContext = {},
): NodeRuntimeGroup[] {
  return buildNodeVersionEntries(runtimes, context).map(entry => {
    const sources = [...new Set(entry.runtimes.map(runtime => runtime.preferredSource))]
      .filter(source => source !== 'external');
    return {
      ...entry,
      runtimes: entry.runtimes.map(runtime => runtime.runtime),
      canonicalRuntimes: entry.runtimes,
      sources,
    };
  });
}

export function summarizeRuntimeSources(runtimes: NodeVersion[]): RuntimeSourceSummary[] {
  const counts = new Map<CanonicalNodeRuntimeSource, number>();
  for (const runtime of canonicalizeNodeRuntimes(runtimes).filter(item => item.preferredSource !== 'external')) {
    const source = runtime.preferredSource;
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return (['managed', 'nvm', 'custom'] as const)
    .filter(source => counts.has(source))
    .map(source => ({ source, count: counts.get(source) || 0 }));
}
