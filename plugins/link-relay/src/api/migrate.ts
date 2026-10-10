/**
 * 迁移能力 —— 对接 preload 迁移引擎（window.services）的唯一出口。
 *
 * - 契约类型（计划 / 结果 / 进度）集中在本文件，引擎只认 kebab-case 状态与 EngineItem；
 * - toEngineItem 负责把 store 的 camelCase MappingVO 归一化为引擎入参（api 是唯一状态翻译边界）；
 * - dev 无宿主时走纯内存模拟（api/dev），推进虚拟状态、不触盘。
 */
import type { LinkStatus, MappingVO } from '../store/types/mapping';
import { devMarkLinked } from './dev';
import { expandPath, type NativeLinkStatus } from './dir';
import { formatBytes } from '../utils/format';

// ────────────── 契约类型 ──────────────

/** 冲突策略（UI 仅提供两种） */
export type ConflictStrategy = 'prefer-source' | 'prefer-target';

/** 引擎单步动作 */
export type EngineAction = 'migrate' | 'skip' | 'relink' | 'repair';

/** 引擎可迁移项（preload migration-engine 的入参形态，状态为 kebab） */
export interface EngineItem {
  id: string;
  enabled: boolean;
  groupDisplayName: string;
  label: string;
  exeNames: string[];
  cachePatterns: string[];
  dir: { path: string; target: string; status: NativeLinkStatus; size: number };
}

/** 单步操作计划 */
export interface OperationPlan {
  itemId: string;
  groupDisplayName: string;
  dirLabel: string;
  action: EngineAction;
  source: string;
  target: string;
  size: number;
  reason: string;
}

/** dry-run 预览结果 */
export interface PreviewResult {
  operations: OperationPlan[];
  totalSize: number;
  totalSizeFormatted: string;
  targetFree: number;
  targetFreeFormatted: string;
  conflicts: Array<{ itemId: string; groupDisplayName: string; dirLabel: string; source: string; target: string }>;
  hasConflicts: boolean;
}

/** 迁移选项 */
export interface MigrationOptions {
  /** 限定迁移的行 id；不传则迁移全部启用且可迁移的行 */
  itemIds?: string[];
  excludeCache?: boolean;
  keepBackup?: boolean;
  conflictStrategy?: ConflictStrategy;
}

/** 单步迁移结果 */
export interface MigrationResult {
  success: boolean;
  itemId: string;
  action: string;
  error?: string;
  filesCopied?: number;
  bytesCopied?: number;
  backupPath?: string | null;
  rolledBack?: boolean;
}

/** 进度事件（引擎以 (type, data) 两参推送） */
export type ProgressEvent =
  | { type: 'phase'; phase: string; itemId: string; groupDisplayName: string; dirLabel: string; message: string }
  | { type: 'progress'; filesCopied: number; bytesCopied: number; currentFile: string; itemId: string; groupDisplayName: string; dirLabel: string }
  | { type: 'log'; level: 'info' | 'ok' | 'warn' | 'error'; message: string }
  | { type: 'item-done'; itemId: string; success: boolean }
  | { type: 'done'; results: MigrationResult[] };

export type ProgressCallback = (type: ProgressEvent['type'], data: unknown) => void;

/** preload 暴露的迁移类原生方法集合（供 env.d.ts 组合 ServicesApi） */
export interface NativeMigrateApi {
  dryRun(items: EngineItem[], options?: MigrationOptions): PreviewResult;
  migrate(items: EngineItem[], options?: MigrationOptions): Promise<MigrationResult[]>;
  relink(item: EngineItem): Promise<MigrationResult>;
  repair(item: EngineItem, strategy?: ConflictStrategy): Promise<MigrationResult>;
  abortMigration(): void;
  onProgress(cb: ProgressCallback): () => void;
}

// ────────────── store 行 → 引擎项（camel → kebab） ──────────────

const TO_NATIVE: Record<LinkStatus, NativeLinkStatus> = {
  linked: 'linked',
  notLinked: 'not-linked',
  broken: 'broken',
  conflict: 'conflict',
  targetOnly: 'target-only',
  notInstalled: 'not-installed',
  unknown: 'unknown',
};

/** 单行配置 + 组名 → 引擎项 */
export function toEngineItem(row: MappingVO, groupName: string): EngineItem {
  return {
    id: row.id,
    enabled: row.enabled,
    groupDisplayName: groupName,
    label: row.name,
    exeNames: row.exeNames,
    cachePatterns: row.cachePatterns,
    dir: {
      path: expandPath(row.sourcePath),
      target: row.targetPath,
      status: TO_NATIVE[row.status],
      size: row.sizeBytes,
    },
  };
}

// ────────────── 宿主 / dev 分流 ──────────────

function native(): NativeMigrateApi | null {
  return typeof window !== 'undefined' && window.services ? window.services : null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── dev 内存模拟（与 preload migration-engine.dryRun 同形，零磁盘 IO） ──

const devListeners = new Set<ProgressCallback>();
function devEmit(type: ProgressEvent['type'], data: unknown): void {
  devListeners.forEach((fn) => {
    try {
      fn(type, data);
    } catch {
      /* 监听器异常不影响流程 */
    }
  });
}

function devDryRun(items: EngineItem[], options: MigrationOptions = {}): PreviewResult {
  const scoped = options.itemIds?.length
    ? items.filter((i) => options.itemIds!.includes(i.id))
    : items.filter((i) => i.enabled);

  const operations: OperationPlan[] = [];
  const conflicts: PreviewResult['conflicts'] = [];
  let totalSize = 0;

  for (const item of scoped) {
    const { dir } = item;
    let action: EngineAction = 'skip';
    let reason = '状态未知，跳过';
    switch (dir.status) {
      case 'linked':
        reason = '已正确链接，无需操作';
        break;
      case 'not-linked':
        action = 'migrate';
        reason = '实体目录，需迁移并创建链接';
        totalSize += dir.size;
        break;
      case 'target-only':
        action = 'relink';
        reason = '源不存在，目标有数据，直接创建链接';
        break;
      case 'broken':
        action = 'repair';
        reason = '链接断裂，需修复重建';
        break;
      case 'conflict':
        action = 'migrate';
        reason = `冲突：以${options.conflictStrategy === 'prefer-target' ? '目标盘' : '源盘'}数据为准，另一侧移入备份`;
        totalSize += dir.size;
        conflicts.push({ itemId: item.id, groupDisplayName: item.groupDisplayName, dirLabel: item.label, source: dir.path, target: dir.target });
        break;
      default:
        break;
    }
    operations.push({
      itemId: item.id,
      groupDisplayName: item.groupDisplayName,
      dirLabel: item.label,
      action,
      source: dir.path,
      target: dir.target,
      size: dir.size,
      reason,
    });
  }

  const targetFree = 100_000_000_000;
  return {
    operations,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    targetFree,
    targetFreeFormatted: '~100 GB',
    conflicts,
    hasConflicts: conflicts.length > 0,
  };
}

async function devMigrate(items: EngineItem[], options: MigrationOptions = {}): Promise<MigrationResult[]> {
  const plan = devDryRun(items, options);
  const results: MigrationResult[] = [];
  for (const op of plan.operations.filter((o) => o.action !== 'skip')) {
    const item = items.find((i) => i.id === op.itemId);
    if (!item) continue;
    devEmit('phase', { phase: 'copy', itemId: op.itemId, groupDisplayName: op.groupDisplayName, dirLabel: op.dirLabel, message: `复制数据到 ${op.target}…` });
    await delay(180);
    for (let i = 1; i <= 3; i++) {
      devEmit('progress', {
        filesCopied: i * 8,
        bytesCopied: Math.floor((op.size * i) / 3),
        currentFile: op.source,
        itemId: op.itemId,
        groupDisplayName: op.groupDisplayName,
        dirLabel: op.dirLabel,
      });
      await delay(90);
    }
    devMarkLinked(item.dir.path);
    const result: MigrationResult = { success: true, itemId: op.itemId, action: op.action, filesCopied: 24, bytesCopied: op.size, backupPath: null };
    results.push(result);
    devEmit('log', { level: 'ok', message: `[${op.groupDisplayName} - ${op.dirLabel}] 迁移完成` });
    devEmit('item-done', { itemId: op.itemId, success: true });
  }
  devEmit('done', { results });
  return results;
}

// ────────────── 对外 API ──────────────

/** dry-run 预览（不触盘） */
export function dryRun(items: EngineItem[], options?: MigrationOptions): PreviewResult {
  return native()?.dryRun(items, options) ?? devDryRun(items, options);
}

/** 执行迁移 */
export async function migrate(items: EngineItem[], options?: MigrationOptions): Promise<MigrationResult[]> {
  const host = native();
  return host ? host.migrate(items, options) : devMigrate(items, options);
}

/** 单行重建链接 */
export async function relink(item: EngineItem): Promise<MigrationResult> {
  const host = native();
  if (host) return host.relink(item);
  await delay(240);
  devMarkLinked(item.dir.path);
  devEmit('done', { results: [] });
  return { success: true, itemId: item.id, action: 'relink' };
}

/** 单行修复 */
export async function repair(item: EngineItem, strategy?: ConflictStrategy): Promise<MigrationResult> {
  const host = native();
  if (host) return host.repair(item, strategy);
  await delay(240);
  devMarkLinked(item.dir.path);
  devEmit('done', { results: [] });
  return { success: true, itemId: item.id, action: 'repair' };
}

/** 请求中止 */
export function abortMigration(): void {
  native()?.abortMigration();
}

/** 订阅进度，返回取消订阅函数 */
export function onProgress(cb: ProgressCallback): () => void {
  const host = native();
  if (host) return host.onProgress(cb);
  devListeners.add(cb);
  return () => devListeners.delete(cb);
}
