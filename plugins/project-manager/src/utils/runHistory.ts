import type { Project, RunHistoryEntry, RunHistoryStatus, RunSession } from '../types';

export const RUN_HISTORY_FILE_NAME = 'run-history.json';
export const RUN_HISTORY_SCHEMA_VERSION = 1;
export const MAX_HISTORY_PER_PROJECT = 20;
export const MAX_HISTORY_ENTRIES = 500;
export const MAX_HISTORY_ERROR_LENGTH = 1500;

export interface RunHistoryFile {
  schemaVersion: typeof RUN_HISTORY_SCHEMA_VERSION;
  entries: RunHistoryEntry[];
}

export function isRunHistoryStatus(value: unknown): value is RunHistoryStatus {
  return value === 'success' || value === 'failed' || value === 'stopped';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function truncateHistoryError(value: string | undefined, maxLength = MAX_HISTORY_ERROR_LENGTH): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** 将 live Session 映射成纯 metadata；非 terminal Session 永远返回 null。 */
export function createRunHistoryEntry(
  session: RunSession,
  now = Date.now(),
): RunHistoryEntry | null {
  if (!isRunHistoryStatus(session.status)) return null;

  const endedAt = isFiniteNumber(session.endedAt) ? session.endedAt : now;
  const durationMs = Math.max(
    0,
    Math.round(isFiniteNumber(session.durationMs) ? session.durationMs : endedAt - session.startedAt),
  );

  return sanitizeRunHistoryEntry({
    historyId: session.sessionId,
    sessionId: session.sessionId,
    projectId: session.projectId,
    commandKey: session.commandKey,
    commandType: session.commandType,
    commandId: session.commandId,
    displayName: session.displayName,
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    endedAt,
    durationMs,
    exitCode: session.exitCode === undefined ? null : session.exitCode,
    errorMessage: session.errorMessage,
    nodeRuntimeId: session.nodeRuntimeId,
    nodeVersion: session.nodeVersion,
    nodePath: session.nodePath,
    packageManager: session.packageManager,
  });
}

/** 严格校验单条 entry，并只返回允许落盘的字段。 */
export function sanitizeRunHistoryEntry(value: unknown): RunHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const commandType = candidate.commandType;
  const exitCode = candidate.exitCode;

  if (
    typeof candidate.historyId !== 'string' || !candidate.historyId
    || typeof candidate.sessionId !== 'string' || !candidate.sessionId
    || typeof candidate.projectId !== 'string' || !candidate.projectId
    || typeof candidate.commandKey !== 'string' || !candidate.commandKey
    || (commandType !== 'script' && commandType !== 'custom')
    || typeof candidate.commandId !== 'string' || !candidate.commandId
    || typeof candidate.displayName !== 'string'
    || typeof candidate.cwd !== 'string'
    || !isRunHistoryStatus(candidate.status)
    || !isFiniteNumber(candidate.startedAt)
    || !isFiniteNumber(candidate.endedAt)
    || !isFiniteNumber(candidate.durationMs)
    || !(exitCode === null || (typeof exitCode === 'number' && Number.isInteger(exitCode)))
  ) {
    return null;
  }

  const entry: RunHistoryEntry = {
    historyId: candidate.historyId,
    sessionId: candidate.sessionId,
    projectId: candidate.projectId,
    commandKey: candidate.commandKey,
    commandType,
    commandId: candidate.commandId,
    displayName: candidate.displayName,
    cwd: candidate.cwd,
    status: candidate.status,
    startedAt: candidate.startedAt,
    endedAt: candidate.endedAt,
    durationMs: Math.max(0, Math.round(candidate.durationMs)),
    exitCode,
  };

  const errorMessage = truncateHistoryError(optionalString(candidate.errorMessage));
  if (errorMessage) entry.errorMessage = errorMessage;

  for (const field of ['nodeRuntimeId', 'nodeVersion', 'nodePath', 'packageManager'] as const) {
    const valueForField = optionalString(candidate[field]);
    if (valueForField) entry[field] = valueForField;
  }
  return entry;
}

function compareHistoryEntries(left: RunHistoryEntry, right: RunHistoryEntry): number {
  return right.endedAt - left.endedAt
    || right.startedAt - left.startedAt
    || left.historyId.localeCompare(right.historyId);
}

/** 去重并应用 per-project 20 / global 500 retention。结果顺序稳定。 */
export function applyRunHistoryRetention(
  entries: readonly RunHistoryEntry[],
  perProjectCap = MAX_HISTORY_PER_PROJECT,
  globalCap = MAX_HISTORY_ENTRIES,
): RunHistoryEntry[] {
  const deduped = new Map<string, RunHistoryEntry>();
  for (const raw of entries) {
    const entry = sanitizeRunHistoryEntry(raw);
    if (!entry) continue;
    const existing = deduped.get(entry.sessionId);
    if (!existing || compareHistoryEntries(entry, existing) < 0) deduped.set(entry.sessionId, entry);
  }

  const projectCounts = new Map<string, number>();
  const retained: RunHistoryEntry[] = [];
  for (const entry of [...deduped.values()].sort(compareHistoryEntries)) {
    const count = projectCounts.get(entry.projectId) || 0;
    if (count >= perProjectCap) continue;
    projectCounts.set(entry.projectId, count + 1);
    retained.push(entry);
    if (retained.length >= globalCap) break;
  }
  return retained;
}

export function parseRunHistory(content: string): RunHistoryEntry[] {
  if (!content.trim()) return [];
  try {
    const parsed = JSON.parse(content) as Partial<RunHistoryFile>;
    if (parsed?.schemaVersion !== RUN_HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.entries)) return [];
    return applyRunHistoryRetention(parsed.entries as RunHistoryEntry[]);
  } catch {
    return [];
  }
}

/** 显式重建字段，防止未来把日志或临时字段意外序列化进 History。 */
function toPersistedEntry(entry: RunHistoryEntry): RunHistoryEntry {
  const sanitized = sanitizeRunHistoryEntry(entry);
  if (!sanitized) throw new Error('Cannot serialize invalid run history entry');
  return sanitized;
}

export function serializeRunHistory(entries: readonly RunHistoryEntry[]): string {
  const retained = applyRunHistoryRetention(entries);
  const file: RunHistoryFile = {
    schemaVersion: RUN_HISTORY_SCHEMA_VERSION,
    entries: retained.map(toPersistedEntry),
  };
  return JSON.stringify(file, null, 2);
}

export function getProjectHistory(entries: readonly RunHistoryEntry[], projectId: string): RunHistoryEntry[] {
  return entries.filter(entry => entry.projectId === projectId).sort(compareHistoryEntries);
}

export function getCommandHistory(entries: readonly RunHistoryEntry[], commandKey: string): RunHistoryEntry[] {
  return entries.filter(entry => entry.commandKey === commandKey).sort(compareHistoryEntries);
}

export function getLatestProjectEntry(
  entries: readonly RunHistoryEntry[],
  projectId: string,
): RunHistoryEntry | undefined {
  return getProjectHistory(entries, projectId)[0];
}

/** 历史重跑只检查当前项目配置，不使用历史快照里的执行命令或运行时路径。 */
export function isHistoryCommandAvailable(entry: RunHistoryEntry, project: Project): boolean {
  if (entry.projectId !== project.id) return false;
  if (entry.commandType === 'script') return project.scripts?.includes(entry.commandId) === true;
  return project.customCommands?.some(command => command.id === entry.commandId) === true;
}

export function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return sanitized || '_';
}

export function formatRunLogFileTimestamp(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function buildRunLogFileName(
  projectName: string,
  commandName: string,
  timestamp = Date.now(),
): string {
  return `${sanitizeFilenamePart(projectName)}-${sanitizeFilenamePart(commandName)}-${formatRunLogFileTimestamp(timestamp)}.log`;
}
