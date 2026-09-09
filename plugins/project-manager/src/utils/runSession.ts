import type { ProjectExitPayload } from '../api/types';
import type { RunSessionStatus } from '../types';

export const ACTIVE_RUN_SESSION_STATUSES: readonly RunSessionStatus[] = [
  'starting',
  'running',
  'stopping',
];

export function isRunSessionActive(status: RunSessionStatus | undefined): boolean {
  return status ? ACTIVE_RUN_SESSION_STATUSES.includes(status) : false;
}

export function isActiveRunSession(
  activeSessionIdByCommand: Readonly<Record<string, string>>,
  commandKey: string,
  sessionId: string,
): boolean {
  return activeSessionIdByCommand[commandKey] === sessionId;
}

export function classifyProjectExit(
  payload: Pick<ProjectExitPayload, 'exitCode' | 'stopped' | 'waitError'>,
): RunSessionStatus {
  if (payload.stopped) return 'stopped';
  if (!payload.waitError && payload.exitCode === 0) return 'success';
  return 'failed';
}

export function createRunSessionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('crypto.randomUUID is required to create a run session');
  return `run_${uuid}`;
}

export function formatDuration(durationMs: number | null | undefined): string {
  const milliseconds = Math.max(0, Math.round(durationMs ?? 0));
  if (milliseconds === 0) return '0ms';

  if (milliseconds < 60_000) {
    const seconds = (Math.round(milliseconds / 100) / 10).toFixed(1).replace(/\.0$/, '');
    return `${seconds}s`;
  }

  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) {
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatExitSummary(payload: ProjectExitPayload): string {
  const duration = formatDuration(payload.durationMs);
  if (payload.stopped) return `[Runner] Process stopped · ${duration}`;
  if (payload.waitError) return `[Runner] Process failed · ${duration}`;
  if (payload.exitCode === null) return `[Runner] Process failed with no exit code · ${duration}`;
  return `[Runner] Process exited with code ${payload.exitCode} · ${duration}`;
}
