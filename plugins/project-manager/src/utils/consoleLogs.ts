import type { RunLogEntry, RunLogStream } from '../types';

export const MAX_SESSION_LOG_LINES = 2000;
export const CONSOLE_RENDER_WINDOW_SIZE = 500;

export type LogStreamFilter = 'all' | RunLogStream;

const ANSI_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_PATTERN = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g;
const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-_]|\([0-2A-Z]|\)[0-2A-Z])/g;

/** 移除 CSI、OSC、以及常见两字节 ANSI 控制序列，保留用户可读文本。 */
export function stripAnsi(text: string): string {
  return text
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_ESCAPE_PATTERN, '');
}

export function filterLogEntries(
  entries: readonly RunLogEntry[],
  filter: LogStreamFilter,
): RunLogEntry[] {
  if (filter === 'all') return [...entries];
  return entries.filter(entry => entry.stream === filter);
}

/** 裁剪仅影响内存窗口，保留原 sequence，避免 render window 移动时 key 改变。 */
export function trimLogEntries(
  entries: readonly RunLogEntry[],
  maxLines = MAX_SESSION_LOG_LINES,
): RunLogEntry[] {
  const safeMax = Math.max(1, Math.floor(maxLines));
  return entries.length > safeMax ? entries.slice(entries.length - safeMax) : [...entries];
}

export interface LogMatch {
  entryIndex: number;
  sequence: number;
}

/** 在当前 filter 后的全部内存日志中查找，不受 Console render window 限制。 */
export function searchLogEntries(
  entries: readonly RunLogEntry[],
  query: string,
  filter: LogStreamFilter = 'all',
): LogMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  return entries
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(({ entry }) => {
      if (filter !== 'all' && entry.stream !== filter) return false;
      return stripAnsi(entry.text).toLocaleLowerCase().includes(normalizedQuery);
    })
    .map(({ entry, entryIndex }) => ({ entryIndex, sequence: entry.sequence }));
}

export function nextMatchIndex(
  matchCount: number,
  currentIndex: number,
  direction: 'next' | 'previous',
): number {
  if (matchCount <= 0) return -1;
  if (currentIndex < 0) return direction === 'next' ? 0 : matchCount - 1;
  if (direction === 'next') return (currentIndex + 1 + matchCount) % matchCount;
  return (currentIndex - 1 + matchCount) % matchCount;
}

export interface RenderWindow<T> {
  items: T[];
  start: number;
  end: number;
}

/** 默认显示末尾窗口；传入 focusIndex 时确保命中项落在窗口内。 */
export function getRenderWindow<T>(
  items: readonly T[],
  windowSize = CONSOLE_RENDER_WINDOW_SIZE,
  focusIndex?: number,
): RenderWindow<T> {
  const safeSize = Math.max(1, Math.floor(windowSize));
  if (items.length <= safeSize) return { items: [...items], start: 0, end: items.length };

  let start = items.length - safeSize;
  if (focusIndex !== undefined && focusIndex >= 0 && focusIndex < items.length) {
    start = Math.min(
      Math.max(0, focusIndex - Math.floor(safeSize / 2)),
      items.length - safeSize,
    );
  }
  return { items: items.slice(start, start + safeSize), start, end: start + safeSize };
}

export function formatLogEntriesPlainText(
  entries: readonly RunLogEntry[],
  partialText?: string,
): string {
  const lines = entries.map(entry => stripAnsi(entry.text));
  if (partialText) lines.push(stripAnsi(partialText));
  return lines.join('\n');
}

export interface RunLogExportMetadata {
  project: string;
  command: string;
  status: string;
  started: string;
  ended: string;
  duration: string;
  exitCode: string;
  node: string;
  runtime: string;
  packageManager: string;
  cwd: string;
}

export function buildSessionLogExportText(
  metadata: RunLogExportMetadata,
  entries: readonly RunLogEntry[],
  partialText?: string,
): string {
  return [
    `Project: ${metadata.project}`,
    `Command: ${metadata.command}`,
    `Status: ${metadata.status}`,
    `Started: ${metadata.started}`,
    `Ended: ${metadata.ended}`,
    `Duration: ${metadata.duration}`,
    `Exit Code: ${metadata.exitCode}`,
    `Node: ${metadata.node}`,
    `Runtime: ${metadata.runtime}`,
    `Package Manager: ${metadata.packageManager}`,
    `Working Directory: ${metadata.cwd}`,
    '',
    '--- Output ---',
    formatLogEntriesPlainText(entries, partialText),
  ].join('\n');
}

export function getStreamLabel(filter: LogStreamFilter): string {
  if (filter === 'stdout') return 'stdout';
  if (filter === 'stderr') return 'stderr';
  if (filter === 'system') return 'Runner';
  return 'All';
}
