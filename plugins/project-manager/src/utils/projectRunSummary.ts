import type { Project, RunHistoryEntry, RunHistoryStatus, RunSession } from '../types';
import { isRunSessionActive } from './runSession';

export interface ProjectRunSummary {
  projectId: string;
  status: 'running' | RunHistoryStatus;
  activeCount: number;
  sessionId?: string;
  commandKey: string;
  commandType: 'script' | 'custom';
  commandId: string;
  displayName: string;
  endedAt?: number;
  durationMs?: number;
  exitCode?: number | null;
  errorMessage?: string;
}

function compareEnded(left: { endedAt?: number; sessionId?: string }, right: { endedAt?: number; sessionId?: string }): number {
  return (right.endedAt ?? -Infinity) - (left.endedAt ?? -Infinity)
    || (left.sessionId || '').localeCompare(right.sessionId || '');
}

function compareActive(left: { startedAt: number; sessionId: string }, right: { startedAt: number; sessionId: string }): number {
  return right.startedAt - left.startedAt || left.sessionId.localeCompare(right.sessionId);
}

interface SummaryAggregate {
  activeCount: number;
  activeLatest: RunSession | null;
  terminalLatest: RunSession | RunHistoryEntry | null;
}

const EMPTY_AGGREGATE: SummaryAggregate = {
  activeCount: 0,
  activeLatest: null,
  terminalLatest: null,
};

function mergeAggregate(left: SummaryAggregate, right: SummaryAggregate): SummaryAggregate {
  let activeLatest = left.activeLatest;
  if (right.activeLatest && (!activeLatest || compareActive(right.activeLatest, activeLatest) < 0)) {
    activeLatest = right.activeLatest;
  }

  let terminalLatest = left.terminalLatest;
  if (right.terminalLatest && (!terminalLatest || compareEnded(right.terminalLatest, terminalLatest) < 0)) {
    terminalLatest = right.terminalLatest;
  }

  return {
    activeCount: left.activeCount + right.activeCount,
    activeLatest,
    terminalLatest,
  };
}

function summaryFromAggregate(aggregate: SummaryAggregate): ProjectRunSummary | null {
  if (aggregate.activeLatest) {
    const latest = aggregate.activeLatest;
    return {
      projectId: latest.projectId,
      status: 'running',
      activeCount: aggregate.activeCount,
      sessionId: latest.sessionId,
      commandKey: latest.commandKey,
      commandType: latest.commandType,
      commandId: latest.commandId,
      displayName: latest.displayName,
    };
  }

  const latest = aggregate.terminalLatest;
  if (!latest) return null;
  return {
    projectId: latest.projectId,
    status: latest.status as RunHistoryStatus,
    activeCount: 0,
    sessionId: latest.sessionId,
    commandKey: latest.commandKey,
    commandType: latest.commandType,
    commandId: latest.commandId,
    displayName: latest.displayName,
    endedAt: latest.endedAt,
    durationMs: latest.durationMs,
    exitCode: latest.exitCode,
    errorMessage: latest.errorMessage,
  };
}

export interface ProjectRunSummaryIndex {
  getProjectSummary(projectId: string): ProjectRunSummary | null;
  getSubtreeSummary(projectId: string): ProjectRunSummary | null;
}

/** 一次建立项目树与运行记录索引，避免每个项目行重复扫描全部历史。 */
export function createProjectRunSummaryIndex(
  projects: readonly Project[],
  sessions: Readonly<Record<string, RunSession>>,
  history: readonly RunHistoryEntry[],
): ProjectRunSummaryIndex {
  const projectIds = new Set(projects.map(project => project.id));
  const childrenByParentId = new Map<string, string[]>();
  for (const project of projects) {
    if (!project.parentId || !projectIds.has(project.parentId)) continue;
    const children = childrenByParentId.get(project.parentId) || [];
    children.push(project.id);
    childrenByParentId.set(project.parentId, children);
  }

  const ownAggregates = new Map<string, SummaryAggregate>();
  const terminalSessionIds = new Set<string>();
  for (const session of Object.values(sessions)) {
    if (!projectIds.has(session.projectId)) continue;
    const current = ownAggregates.get(session.projectId) || { ...EMPTY_AGGREGATE };
    if (isRunSessionActive(session.status)) {
      current.activeCount += 1;
      if (!current.activeLatest || compareActive(session, current.activeLatest) < 0) {
        current.activeLatest = session;
      }
    } else if (
      session.endedAt !== undefined
      && (session.status === 'success' || session.status === 'failed' || session.status === 'stopped')
    ) {
      terminalSessionIds.add(session.sessionId);
      if (!current.terminalLatest || compareEnded(session, current.terminalLatest) < 0) {
        current.terminalLatest = session;
      }
    }
    ownAggregates.set(session.projectId, current);
  }

  for (const entry of history) {
    if (!projectIds.has(entry.projectId) || terminalSessionIds.has(entry.sessionId)) continue;
    const current = ownAggregates.get(entry.projectId) || { ...EMPTY_AGGREGATE };
    if (!current.terminalLatest || compareEnded(entry, current.terminalLatest) < 0) {
      current.terminalLatest = entry;
    }
    ownAggregates.set(entry.projectId, current);
  }

  const subtreeAggregates = new Map<string, SummaryAggregate>();
  const visiting = new Set<string>();
  function aggregate(projectId: string): SummaryAggregate {
    const cached = subtreeAggregates.get(projectId);
    if (cached) return cached;
    if (visiting.has(projectId)) return { ...EMPTY_AGGREGATE };

    visiting.add(projectId);
    let result = ownAggregates.get(projectId) || { ...EMPTY_AGGREGATE };
    for (const childId of childrenByParentId.get(projectId) || []) {
      result = mergeAggregate(result, aggregate(childId));
    }
    visiting.delete(projectId);
    subtreeAggregates.set(projectId, result);
    return result;
  }

  for (const project of projects) aggregate(project.id);

  return {
    getProjectSummary(projectId) {
      if (!projectIds.has(projectId)) return null;
      return summaryFromAggregate(ownAggregates.get(projectId) || EMPTY_AGGREGATE);
    },
    getSubtreeSummary(projectId) {
      if (!projectIds.has(projectId)) return null;
      return summaryFromAggregate(subtreeAggregates.get(projectId) || EMPTY_AGGREGATE);
    },
  };
}

export function getProjectRunSummary(
  projectId: string,
  projects: readonly Project[],
  sessions: Readonly<Record<string, RunSession>>,
  history: readonly RunHistoryEntry[],
): ProjectRunSummary | null {
  return createProjectRunSummaryIndex(projects, sessions, history).getProjectSummary(projectId);
}

export function aggregateRunSummaryForSubtree(
  rootProjectId: string,
  projects: readonly Project[],
  sessions: Readonly<Record<string, RunSession>>,
  history: readonly RunHistoryEntry[],
): ProjectRunSummary | null {
  return createProjectRunSummaryIndex(projects, sessions, history).getSubtreeSummary(rootProjectId);
}
