/**
 * useMigration —— 迁移流程编排 hook（模块级单例）。
 *
 * 负责：dry-run 预览、确认、执行迁移、单行重建/修复、进度事件订阅、结果回写与操作日志。
 * - 引擎能力全部走 migrateApi（api 层负责与 preload 对接及状态翻译），本 hook 只做编排；
 * - 确认/进度两个弹窗的开关用通用 useDialog 管理；
 * - 执行结果回写 mapping 表（状态 / 上次迁移时间 / 错误）并追加 log 表，随后重新扫描。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { useGroupStore, useLogStore, useMappingStore } from '../store';
import * as migrateApi from '../api/migrate';
import type { ConflictStrategy, MigrationOptions, MigrationResult, PreviewResult } from '../api/migrate';
import useDialog from './useDialog';
import { UNGROUPED_NAME } from '../utils/enums';
import { useDashboard, type MappingRowVM } from './useDashboard';

/** 进度弹窗中的一行运行日志（瞬时，不持久化；持久化审计走 log 表） */
export interface RunLog {
  level: string;
  message: string;
  time: string;
}

export interface ProgressInfo {
  filesCopied: number;
  bytesCopied: number;
  currentFile: string;
}

let cache: MigrationApi | null = null;

export interface MigrationApi {
  preview: Ref<PreviewResult | null>;
  running: Ref<boolean>;
  runLogs: Ref<RunLog[]>;
  currentPhase: Ref<string>;
  currentItem: Ref<string>;
  progressInfo: Ref<ProgressInfo>;
  confirmVisible: Ref<boolean>;
  progressVisible: Ref<boolean>;
  actionableCount: ComputedRef<number>;
  openConfirm: (itemIds?: string[]) => void;
  closeConfirm: () => void;
  confirmMigrate: (options: MigrationOptions) => Promise<void>;
  runRowAction: (row: MappingRowVM) => Promise<void>;
  cancelMigration: () => void;
  closeProgress: () => void;
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export function useMigration(): MigrationApi {
  if (cache) return cache;

  const dashboard = useDashboard();
  const groupStore = useGroupStore();
  const mappingStore = useMappingStore();
  const logStore = useLogStore();

  const confirmDialog = useDialog({ title: '迁移预览' });
  const progressDialog = useDialog({ title: '正在迁移' });

  const preview = ref<PreviewResult | null>(null);
  const running = ref(false);
  const runLogs = ref<RunLog[]>([]);
  const currentPhase = ref('');
  const currentItem = ref('');
  const progressInfo = ref<ProgressInfo>({ filesCopied: 0, bytesCopied: 0, currentFile: '' });

  const actionableCount = computed(
    () => preview.value?.operations.filter((o) => o.action !== 'skip').length ?? 0
  );

  /** 组 id → 显示名 */
  function groupNameOf(groupId: string): string {
    if (!groupId) return UNGROUPED_NAME;
    return groupStore.findById(groupId)?.name ?? UNGROUPED_NAME;
  }

  /** 用最新 mapping 表构造引擎项 */
  function buildItems(ids?: string[]) {
    const rows = ids?.length ? mappingStore.query().filter((r) => ids.includes(r.id)) : mappingStore.query();
    return rows.map((row) => migrateApi.toEngineItem(row, groupNameOf(row.groupId)));
  }

  // ── 进度订阅（只订一次） ──
  let subscribed = false;
  function subscribeProgress(): void {
    if (subscribed) return;
    subscribed = true;
    migrateApi.onProgress((type, data) => {
      const evt = { type, ...((data ?? {}) as Record<string, unknown>) } as { type: string } & Record<string, unknown>;
      if (evt.type === 'phase') {
        currentPhase.value = String(evt.message ?? '');
        currentItem.value = String(evt.groupDisplayName ?? '');
      } else if (evt.type === 'progress') {
        progressInfo.value = {
          filesCopied: Number(evt.filesCopied ?? 0),
          bytesCopied: Number(evt.bytesCopied ?? 0),
          currentFile: String(evt.currentFile ?? ''),
        };
      } else if (evt.type === 'log') {
        runLogs.value = [...runLogs.value, { level: String(evt.level ?? 'info'), message: String(evt.message ?? ''), time: nowTime() }];
      }
    });
  }

  function resetRuntime(): void {
    runLogs.value = [];
    currentPhase.value = '';
    currentItem.value = '';
    progressInfo.value = { filesCopied: 0, bytesCopied: 0, currentFile: '' };
  }

  // ── 预览 ──
  function openConfirm(itemIds?: string[]): void {
    subscribeProgress();
    const items = buildItems(itemIds);
    preview.value = migrateApi.dryRun(items, { itemIds });
    confirmDialog.openDialog();
  }
  function closeConfirm(): void {
    confirmDialog.closeDialog();
    preview.value = null;
  }

  // ── 结果回写 + 审计日志 ──
  function applyResults(results: MigrationResult[]): void {
    for (const result of results) {
      const row = mappingStore.findById(result.itemId);
      if (result.success) {
        mappingStore.update(result.itemId, {
          status: 'linked',
          sizeBytes: 0,
          lastMigratedAt: new Date().toISOString(),
          lastError: '',
        });
        logStore.create({
          resource: 'mapping', action: result.action === 'relink' ? 'relink' : result.action === 'repair' ? 'repair' : 'migrate',
          level: 'success', message: `「${row?.name ?? result.itemId}」${result.action === 'relink' ? '重建' : result.action === 'repair' ? '修复' : '迁移'}完成`,
          resourceId: result.itemId, resourceName: row?.name ?? '',
        });
      } else {
        mappingStore.update(result.itemId, { lastError: result.error ?? '迁移失败' });
        logStore.create({
          resource: 'mapping', action: 'migrate', level: 'error',
          message: `「${row?.name ?? result.itemId}」失败：${result.error ?? '迁移失败'}`,
          resourceId: result.itemId, resourceName: row?.name ?? '',
        });
      }
    }
  }

  // ── 确认执行 ──
  async function confirmMigrate(options: MigrationOptions): Promise<void> {
    if (!preview.value) return;
    const itemIds = preview.value.operations.filter((o) => o.action !== 'skip').map((o) => o.itemId);
    const merged: MigrationOptions = { itemIds, ...options };
    confirmDialog.closeDialog();
    progressDialog.openDialog();
    running.value = true;
    resetRuntime();
    try {
      const items = buildItems(itemIds);
      const results = await migrateApi.migrate(items, merged);
      applyResults(results);
    } catch (e) {
      runLogs.value = [...runLogs.value, { level: 'error', message: e instanceof Error ? e.message : '迁移失败', time: nowTime() }];
    } finally {
      running.value = false;
      dashboard.clearSelection();
      await dashboard.refresh();
    }
  }

  // ── 行内主操作：迁移走确认弹窗；重建/修复直接执行单行 ──
  async function runRowAction(row: MappingRowVM): Promise<void> {
    subscribeProgress();
    if (row.action.type === 'migrate') {
      openConfirm([row.id]);
      return;
    }
    if (row.action.type === 'none') return;

    const item = migrateApi.toEngineItem(mappingStore.findById(row.id)!, row.groupName);
    progressDialog.openDialog();
    running.value = true;
    resetRuntime();
    try {
      const strategy: ConflictStrategy | undefined = undefined;
      const result = row.action.type === 'relink'
        ? await migrateApi.relink(item)
        : await migrateApi.repair(item, strategy);
      applyResults([result]);
    } catch (e) {
      applyResults([{ success: false, itemId: row.id, action: row.action.type, error: e instanceof Error ? e.message : '操作失败' }]);
    } finally {
      running.value = false;
      await dashboard.refresh();
    }
  }

  function cancelMigration(): void {
    migrateApi.abortMigration();
    running.value = false;
  }

  function closeProgress(): void {
    progressDialog.closeDialog();
    closeConfirm();
  }

  const api: MigrationApi = {
    preview, running, runLogs, currentPhase, currentItem, progressInfo,
    confirmVisible: confirmDialog.visible, progressVisible: progressDialog.visible,
    actionableCount,
    openConfirm, closeConfirm, confirmMigrate, runRowAction, cancelMigration, closeProgress,
  };
  cache = api;
  return api;
}
