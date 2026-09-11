import type { NodeVersion, SystemNodeState } from '../types';
import { getNodeRuntimeId, normalizeRuntimePath } from './nodeRuntime';

function isExecutablePath(path: string): boolean {
  return /(?:^|[\\/])node(?:\.exe)?$/i.test(path.trim());
}

function withoutExecutable(path: string): string {
  return path.replace(/[\\/]node(?:\.exe)?$/i, '').replace(/[\\/]+$/, '');
}

function samePath(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return normalizeRuntimePath(left) === normalizeRuntimePath(right);
}

export function runtimeExecutableCandidates(runtime: NodeVersion): string[] {
  const path = (runtime.path || '').trim();
  const canonicalPath = (runtime.canonicalPath || '').trim();
  if (!path && !canonicalPath) return [];
  const values = [path, canonicalPath].filter(Boolean);
  const result: string[] = [];
  for (const value of values) {
    if (isExecutablePath(value)) {
      result.push(value);
      continue;
    }
    const root = value.replace(/[\\/]+$/, '');
    result.push(`${root}/node.exe`, `${root}/bin/node.exe`, `${root}/node`, `${root}/bin/node`);
  }
  return [...new Set(result)];
}

export function runtimeExecutablePath(runtime: NodeVersion): string {
  return runtimeExecutableCandidates(runtime)[0] || '';
}

function runtimeRoots(runtime: NodeVersion): string[] {
  return [runtime.path, runtime.canonicalPath, ...runtimeExecutableCandidates(runtime)]
    .filter((path): path is string => !!path)
    .map(withoutExecutable);
}

function statePaths(state: SystemNodeState): string[] {
  return [
    state.canonicalNodePath,
    state.nodePath,
    state.nvmTargetPath,
    state.candidates[0]?.canonicalPath,
    state.candidates[0]?.path,
  ].filter((path): path is string => !!path);
}

function runtimeMatchesState(runtime: NodeVersion, state: SystemNodeState): boolean {
  if (!state.available) return false;
  if (state.runtimeId && getNodeRuntimeId(runtime) === state.runtimeId) return true;

  const currentExecutables = statePaths(state);
  const runtimeExecutables = runtimeExecutableCandidates(runtime);
  if (currentExecutables.some(current => runtimeExecutables.some(candidate => samePath(current, candidate)))) return true;

  const currentRoots = currentExecutables.map(withoutExecutable);
  const candidateRoots = runtimeRoots(runtime);
  return currentRoots.some(current => candidateRoots.some(candidate => samePath(current, candidate)));
}

function systemRuntimePriority(state: SystemNodeState, runtime: NodeVersion): number {
  if (!runtimeMatchesState(runtime, state)) return Number.POSITIVE_INFINITY;
  if (state.runtimeId && getNodeRuntimeId(runtime) === state.runtimeId) return 0;
  if (state.source === runtime.source) return 1;
  if (state.pathScope === 'nvm' && runtime.source === 'nvm') return 1;
  const sourcePriority: Record<NodeVersion['source'], number> = {
    managed: 0,
    nvm: 1,
    custom: 2,
    system: 3,
  };
  return 2 + sourcePriority[runtime.source];
}

/** 找到与 OS 实际解析路径相同的已有 Runtime，不依赖版本号猜测。 */
export function findSystemRuntime(state: SystemNodeState, runtimes: NodeVersion[]): NodeVersion | undefined {
  if (!state.available) return undefined;
  return runtimes
    .filter(runtime => runtime.source !== 'system')
    .map(runtime => ({ runtime, priority: systemRuntimePriority(state, runtime) }))
    .filter(item => Number.isFinite(item.priority))
    .sort((left, right) => left.priority - right.priority
      || normalizeRuntimePath(left.runtime.path).localeCompare(normalizeRuntimePath(right.runtime.path)))
    .map(item => item.runtime)[0];
}

/** 将 OS detector 的第一条 where 结果映射到已有 physical Runtime。 */
export function mapSystemNodeStateToRuntime(
  state: SystemNodeState,
  runtimes: NodeVersion[],
): SystemNodeState {
  if (!state.available || !state.nodePath) {
    return { ...state, runtimeId: undefined, source: state.source || 'unknown' };
  }

  const runtime = findSystemRuntime(state, runtimes);
  if (!runtime) {
    return {
      ...state,
      runtimeId: undefined,
      source: 'external',
    };
  }

  return {
    ...state,
    runtimeId: getNodeRuntimeId(runtime),
    source: runtime.source,
  };
}

export function isRuntimeSystemCurrent(runtime: NodeVersion, state: SystemNodeState | null | undefined): boolean {
  return !!state && runtimeMatchesState(runtime, state);
}
