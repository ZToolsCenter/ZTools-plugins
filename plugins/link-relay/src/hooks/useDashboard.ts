/**
 * useDashboard —— 首页业务编排 hook（模块级单例，Home 与各弹窗共享同一份状态）。
 *
 * 定位（新架构）：
 * - store 三张表（group/mapping/log）只做纯数据 CRUD + 自动持久化；
 * - 本 hook 负责「读模型组装 + 交互/业务编排」：实时扫描状态、拼组名、KPI、筛选、选择、折叠、
 *   增删改、并把每个操作写入 log 表；
 * - 所有宿主能力只经 api 层（dirApi/envApi），本 hook 不直接碰 window.services / ztools。
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue';
import { useGroupStore, useLogStore, useMappingStore } from '../store';
import * as dirApi from '../api/dir';
import * as envApi from '../api/env';
import { devSeedGroupNames, devSeedMappings } from '../api/dev';
import { presetGroupKeys, presetMappingDTOs } from './seedPresets';
import { formatBytes, parseLineList } from '../utils/format';
import {
  FilterEnum,
  type FilterKey,
  isAbnormalStatus,
  isPendingStatus,
  statusAction,
  statusSeverity,
  UNGROUPED_ID,
  UNGROUPED_NAME,
  ViewModeEnum,
  type ViewMode,
} from '../utils/enums';
import type { GroupVO, LogAction, LogLevel, LogResource } from '../store/types';
import type { LinkStatus, MappingCreateDTO, MappingVO } from '../store/types/mapping';

// ────────────── 视图模型类型（供组件 props 使用） ──────────────

/** 表格行视图模型：映射实体 + 组名 + 派生的可勾选/主操作 */
export interface MappingRowVM {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  sourcePath: string;
  targetPath: string;
  exeNames: string[];
  cachePatterns: string[];
  /** 行自身开关与组开关叠加后的有效启用态 */
  enabled: boolean;
  status: LinkStatus;
  sizeBytes: number;
  lastMigratedAt: string;
  lastError: string;
  /** linked 行不可勾选 */
  selectable: boolean;
  /** 由状态推导的主操作（停用行置空） */
  action: ReturnType<typeof statusAction>;
}

/** 分组视图模型 */
export interface GroupVM {
  id: string;
  name: string;
  enabled: boolean;
  rows: MappingRowVM[];
  /** 组内最严重状态 */
  aggregatedStatus: LinkStatus;
}

export interface KpiSummary {
  total: number;
  linked: number;
  pending: number;
  conflict: number;
  saveSize: number;
  saveSizeFormatted: string;
}

/** 添加/编辑弹窗表单（文本域在提交时由本 hook 解析为数组） */
export interface MappingDraft {
  id?: string;
  name: string;
  groupId: string;
  sourcePath: string;
  targetPath: string;
  exeNamesText: string;
  cachePatternsText: string;
}

// ────────────── 模块级单例 UI / 交互状态（非持久化） ──────────────

const loading = ref(false);
const error = ref<string | null>(null);
const lastScan = ref<Date | null>(null);
const filter = ref<FilterKey>(FilterEnum.All);
const viewMode = ref<ViewMode>(ViewModeEnum.Grouped);
const selectedIds = reactive(new Set<string>());
const collapsed = reactive(new Set<string>());
const editingId = ref<string | null>(null);
/** 新增/编辑弹窗可见（新增时 editingId 为 null，故可见态独立维护） */
const editorVisible = ref(false);
/** 新增时预选的分组（组标题「＋添加」传入） */
const pendingGroup = ref<string>(UNGROUPED_ID);

let cache: DashboardApi | null = null;

/** 单行实体 → 行视图模型 */
function toRowVM(row: MappingVO, groupName: string, groupEnabled: boolean): MappingRowVM {
  const enabled = row.enabled && groupEnabled;
  return {
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    groupName,
    sourcePath: row.sourcePath,
    targetPath: row.targetPath,
    exeNames: row.exeNames,
    cachePatterns: row.cachePatterns,
    enabled,
    status: row.status,
    sizeBytes: row.sizeBytes,
    lastMigratedAt: row.lastMigratedAt,
    lastError: row.lastError,
    selectable: enabled && row.status !== 'linked',
    action: enabled ? statusAction(row.status) : { type: 'none', label: '已停用', disabled: true },
  };
}

function matchStatus(status: LinkStatus, key: FilterKey): boolean {
  switch (key) {
    case FilterEnum.Pending:
      return isPendingStatus(status);
    case FilterEnum.Linked:
      return status === 'linked';
    case FilterEnum.Conflict:
      return isAbnormalStatus(status);
    case FilterEnum.All:
    default:
      return true;
  }
}

export interface DashboardApi {
  // state
  loading: Ref<boolean>;
  error: Ref<string | null>;
  lastScan: Ref<Date | null>;
  filter: Ref<FilterKey>;
  viewMode: Ref<ViewMode>;
  selectedIds: Set<string>;
  collapsed: Set<string>;
  editingId: Ref<string | null>;
  editorVisible: Ref<boolean>;
  pendingGroup: Ref<string>;
  // derived
  groups: ComputedRef<GroupVO[]>;
  allRows: ComputedRef<MappingRowVM[]>;
  flatRows: ComputedRef<MappingRowVM[]>;
  visibleGroups: ComputedRef<GroupVM[]>;
  kpi: ComputedRef<KpiSummary>;
  filterCounts: ComputedRef<Record<FilterKey, number>>;
  checkedCount: ComputedRef<number>;
  selectedItemIds: ComputedRef<string[]>;
  allVisibleChecked: ComputedRef<boolean>;
  visibleIndeterminate: ComputedRef<boolean>;
  hasSelection: ComputedRef<boolean>;
  editingRow: ComputedRef<MappingRowVM | null>;
  // lifecycle
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  // view actions
  setFilter: (f: FilterKey) => void;
  setView: (v: ViewMode) => void;
  toggleRow: (id: string, checked: boolean) => void;
  toggleAllVisible: (checked: boolean) => void;
  clearSelection: () => void;
  toggleCollapse: (groupId: string) => void;
  // editor
  openAdd: (groupId?: string) => void;
  openEdit: (id: string) => void;
  closeEditor: () => void;
  submitMapping: (draft: MappingDraft) => void;
  browseDirectory: (title?: string) => string;
  // mapping CRUD
  removeMapping: (id: string) => void;
  // group CRUD
  createGroup: (name: string) => string | null;
  renameGroup: (id: string, name: string) => void;
  toggleGroup: (id: string, enabled: boolean) => void;
  removeGroup: (id: string) => void;
}

export function useDashboard(): DashboardApi {
  if (cache) return cache;

  const groupStore = useGroupStore();
  const mappingStore = useMappingStore();
  const logStore = useLogStore();

  /** 组 id → 组（缺失组的行归入未分组） */
  function groupNameOf(groupId: string): string {
    if (!groupId) return UNGROUPED_NAME;
    return groupStore.findById(groupId)?.name ?? UNGROUPED_NAME;
  }
  function groupEnabledOf(groupId: string): boolean {
    if (!groupId) return true;
    return groupStore.findById(groupId)?.enabled ?? true;
  }

  // ── 读模型 ──
  const groups = computed<GroupVO[]>(() => groupStore.groups);
  const allRows = computed<MappingRowVM[]>(() =>
    mappingStore.rows.map((row) => toRowVM(row, groupNameOf(row.groupId), groupEnabledOf(row.groupId)))
  );

  const flatRows = computed<MappingRowVM[]>(() => allRows.value.filter((r) => matchStatus(r.status, filter.value)));

  const visibleGroups = computed<GroupVM[]>(() => {
    const result: GroupVM[] = [];
    const pushGroup = (id: string, name: string, enabled: boolean, members: MappingRowVM[]) => {
      const rows = members.filter((r) => matchStatus(r.status, filter.value));
      if (rows.length === 0) return;
      const aggregatedStatus = rows.reduce<LinkStatus>(
        (acc, r) => (statusSeverity(r.status) > statusSeverity(acc) ? r.status : acc),
        'unknown'
      );
      result.push({ id, name, enabled, rows, aggregatedStatus });
    };

    // 已建组按 groupStore 顺序
    for (const group of groupStore.groups) {
      pushGroup(group.id, group.name, group.enabled, allRows.value.filter((r) => r.groupId === group.id));
    }
    // 未分组（含引用了已删除组的行）固定置尾
    pushGroup(UNGROUPED_ID, UNGROUPED_NAME, true, allRows.value.filter((r) => !r.groupId || !groupStore.findById(r.groupId)));
    return result;
  });

  const kpi = computed<KpiSummary>(() => {
    const rows = allRows.value;
    const saveSize = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
    return {
      total: rows.length,
      linked: rows.filter((r) => r.status === 'linked').length,
      pending: rows.filter((r) => isPendingStatus(r.status)).length,
      conflict: rows.filter((r) => isAbnormalStatus(r.status)).length,
      saveSize,
      saveSizeFormatted: formatBytes(saveSize),
    };
  });

  const filterCounts = computed<Record<FilterKey, number>>(() => {
    const rows = allRows.value;
    return {
      [FilterEnum.All]: rows.length,
      [FilterEnum.Pending]: rows.filter((r) => isPendingStatus(r.status)).length,
      [FilterEnum.Linked]: rows.filter((r) => r.status === 'linked').length,
      [FilterEnum.Conflict]: rows.filter((r) => isAbnormalStatus(r.status)).length,
    };
  });

  const checkedCount = computed(() => selectedIds.size);
  const selectedItemIds = computed(() =>
    allRows.value.filter((r) => selectedIds.has(r.id)).map((r) => r.id)
  );
  /** 当前视图下可见的行：平铺=flatRows；分组=所有未折叠组内的行 */
  const visibleRows = computed<MappingRowVM[]>(() => {
    if (viewMode.value === ViewModeEnum.Flat) return flatRows.value;
    const rows: MappingRowVM[] = [];
    for (const g of visibleGroups.value) {
      if (!collapsed.has(g.id)) rows.push(...g.rows);
    }
    return rows;
  });
  const allVisibleChecked = computed(() => {
    const selectable = visibleRows.value.filter((r) => r.selectable);
    return selectable.length > 0 && selectable.every((r) => selectedIds.has(r.id));
  });
  const visibleIndeterminate = computed(() => {
    const selectable = visibleRows.value.filter((r) => r.selectable);
    const checked = selectable.filter((r) => selectedIds.has(r.id));
    return checked.length > 0 && checked.length < selectable.length;
  });
  const hasSelection = computed(() => selectedIds.size > 0);
  const editingRow = computed(() => (editingId.value ? allRows.value.find((r) => r.id === editingId.value) ?? null : null));

  // ── 日志辅助 ──
  function writeLog(
    resource: LogResource,
    action: LogAction,
    level: LogLevel,
    message: string,
    resourceId = '',
    resourceName = ''
  ): void {
    logStore.create({ resource, action, level, message, resourceId, resourceName });
  }

  // ── 扫描 ──
  /** preload 文件系统检测为同步，先让出一帧避免阻塞首屏绘制 */
  function nextPaint(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      await nextPaint();
      for (const row of mappingStore.rows) {
        const dir = dirApi.checkLink(row.sourcePath, row.targetPath);
        mappingStore.update(row.id, { status: dir.status, sizeBytes: dir.sizeBytes });
      }
      lastScan.value = new Date();
      pruneSelection();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '扫描失败';
    } finally {
      loading.value = false;
    }
  }

  /** 清理已不可勾选行的选中态 */
  function pruneSelection(): void {
    const valid = new Set(allRows.value.filter((r) => r.selectable).map((r) => r.id));
    for (const id of [...selectedIds]) {
      if (!valid.has(id)) selectedIds.delete(id);
    }
  }

  /** dev 首帧种子数据（仅无宿主且两表为空时执行一次，纯内存） */
  /**
   * 两表皆空的首次启动播种（只执行一次）：
   * - 宿主环境：从 src/assets/config.json 实例化出厂预设（vscode / qoder），%ENV% 已展开为绝对路径；
   * - dev 浏览器：播纯内存虚拟数据（RelocatorTest，零真实 IDE 路径、零磁盘 IO）。
   */
  function seedIfEmpty(): void {
    if (mappingStore.count > 0 || groupStore.count > 0) return;
    if (envApi.isHost()) {
      const idByKey = new Map<string, string>();
      for (const g of presetGroupKeys()) idByKey.set(g.key, groupStore.create({ name: g.name }).id);
      for (const dto of presetMappingDTOs((key) => idByKey.get(key) ?? UNGROUPED_ID)) mappingStore.create(dto);
      return;
    }
    const idByName = new Map<string, string>();
    for (const name of devSeedGroupNames()) idByName.set(name, groupStore.create({ name }).id);
    for (const dto of devSeedMappings((name) => idByName.get(name) ?? UNGROUPED_ID)) mappingStore.create(dto);
  }

  let initialized = false;
  async function init(): Promise<void> {
    if (initialized) {
      await refresh();
      return;
    }
    initialized = true;
    seedIfEmpty();
    await refresh();
  }

  // ── 视图 / 选择 / 折叠 ──
  function setFilter(f: FilterKey): void { filter.value = f; }
  function setView(v: ViewMode): void { viewMode.value = v; }
  function toggleRow(id: string, checked: boolean): void {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
  }
  function toggleAllVisible(checked: boolean): void {
    visibleRows.value.filter((r) => r.selectable).forEach((r) => {
      if (checked) selectedIds.add(r.id);
      else selectedIds.delete(r.id);
    });
  }
  function clearSelection(): void { selectedIds.clear(); }
  function toggleCollapse(groupId: string): void {
    if (collapsed.has(groupId)) collapsed.delete(groupId);
    else collapsed.add(groupId);
  }

  // ── 编辑器 ──
  function openAdd(groupId?: string): void {
    editingId.value = null;
    pendingGroup.value = groupId ?? UNGROUPED_ID;
    editorVisible.value = true;
  }
  function openEdit(id: string): void {
    editingId.value = id;
    editorVisible.value = true;
  }
  function closeEditor(): void {
    editingId.value = null;
    editorVisible.value = false;
  }

  function browseDirectory(title?: string): string {
    return dirApi.pickDirectory(title);
  }

  function submitMapping(draft: MappingDraft): void {
    const payload: MappingCreateDTO = {
      name: draft.name.trim(),
      sourcePath: draft.sourcePath.trim(),
      targetPath: draft.targetPath.trim(),
      groupId: draft.groupId || UNGROUPED_ID,
      exeNames: parseLineList(draft.exeNamesText),
      cachePatterns: parseLineList(draft.cachePatternsText),
    };
    if (editingId.value) {
      mappingStore.update(editingId.value, payload);
      writeLog('mapping', 'update', 'info', `修改映射「${payload.name}」`, editingId.value, payload.name);
    } else {
      const created = mappingStore.create(payload);
      writeLog('mapping', 'create', 'info', `新增映射「${payload.name}」`, created.id, payload.name);
    }
    closeEditor();
    void refresh();
  }

  function removeMapping(id: string): void {
    const target = mappingStore.findById(id);
    mappingStore.remove(id);
    selectedIds.delete(id);
    writeLog('mapping', 'delete', 'warn', `删除映射「${target?.name ?? id}」`, id, target?.name ?? '');
    void refresh();
  }

  // ── 分组 CRUD ──
  function createGroup(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const created = groupStore.create({ name: trimmed });
    writeLog('group', 'create', 'info', `新增分组「${trimmed}」`, created.id, trimmed);
    return created.id;
  }

  function renameGroup(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    groupStore.update(id, { name: trimmed });
    writeLog('group', 'update', 'info', `分组重命名为「${trimmed}」`, id, trimmed);
  }

  function toggleGroup(id: string, enabled: boolean): void {
    groupStore.update(id, { enabled });
    const name = groupStore.findById(id)?.name ?? id;
    writeLog('group', 'toggle', enabled ? 'success' : 'warn', `${enabled ? '启用' : '停用'}分组「${name}」`, id, name);
  }

  function removeGroup(id: string): void {
    const name = groupStore.findById(id)?.name ?? id;
    // 组删除后其下行落入未分组（不级联删行，避免误删配置）
    for (const row of mappingStore.query({ groupId: id })) mappingStore.update(row.id, { groupId: UNGROUPED_ID });
    groupStore.remove(id);
    collapsed.delete(id);
    writeLog('group', 'delete', 'warn', `删除分组「${name}」（其映射转入未分组）`, id, name);
  }

  const api: DashboardApi = {
    loading, error, lastScan, filter, viewMode, selectedIds, collapsed, editingId, editorVisible, pendingGroup,
    groups, allRows, flatRows, visibleGroups, kpi, filterCounts, checkedCount, selectedItemIds,
    allVisibleChecked, visibleIndeterminate, hasSelection, editingRow,
    init, refresh,
    setFilter, setView, toggleRow, toggleAllVisible, clearSelection, toggleCollapse,
    openAdd, openEdit, closeEditor, submitMapping, browseDirectory, removeMapping,
    createGroup, renameGroup, toggleGroup, removeGroup,
  };
  cache = api;
  return api;
}
