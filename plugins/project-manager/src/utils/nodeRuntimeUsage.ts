import type { AppDefaultNode, NodeVersion, Project } from '../types';
import { getNodeRuntimeId, isExplicitNodeVersion, resolveProjectRuntime } from './nodeRuntime';

export type RuntimeUsageReason = 'runtime-id' | 'version' | 'default';

export interface ProjectRuntimeUsage {
  project: Project;
  reason: RuntimeUsageReason;
}

function usageReason(project: Project): RuntimeUsageReason {
  if (project.nodeRuntimeId) return 'runtime-id';
  if (isExplicitNodeVersion(project.nodeVersion)) return 'version';
  return 'default';
}

export function getProjectsUsingRuntime(
  projects: Project[],
  runtime: NodeVersion,
  versions: NodeVersion[],
  appDefault?: AppDefaultNode | null,
  systemRuntime?: NodeVersion | null,
): ProjectRuntimeUsage[] {
  const runtimeId = getNodeRuntimeId(runtime);
  return projects
    .filter(project => project.type === 'node')
    .flatMap(project => {
      const resolved = resolveProjectRuntime(project, versions, appDefault, systemRuntime).runtime;
      if (!resolved || getNodeRuntimeId(resolved) !== runtimeId) return [];
      return [{ project, reason: usageReason(project) }];
    });
}
