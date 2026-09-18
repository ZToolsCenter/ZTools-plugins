<script setup lang="ts">
/**
 * 映射表格（唯一表格组件，纯渲染）：只接收 props 列出数据、向父级 emit 交互。
 * 组头与行内聚在本文件，不拆子组件；状态文案/色调、字节格式化全部取自 utils。
 */
import type { ViewMode } from '../utils/enums';
import { statusLabel, statusTone } from '../utils/enums';
import { formatBytes } from '../utils/format';
import type { GroupVM, MappingRowVM } from '../hooks/useDashboard';

defineProps<{
  groups: GroupVM[];
  flatRows: MappingRowVM[];
  viewMode: ViewMode;
  collapsed: Set<string>;
  selected: Set<string>;
  loading: boolean;
  error: string | null;
  allChecked: boolean;
  indeterminate: boolean;
}>();

const emit = defineEmits<{
  select: [id: string, checked: boolean];
  selectAll: [checked: boolean];
  toggleGroup: [groupId: string];
  groupAdd: [groupId: string];
  rowAction: [row: MappingRowVM];
  edit: [id: string];
  remove: [id: string];
  retry: [];
}>();

function linkedCount(rows: MappingRowVM[]): number {
  return rows.filter((r) => r.status === 'linked').length;
}
function sizeText(bytes: number): string {
  return bytes > 0 ? formatBytes(bytes) : '—';
}
</script>

<template>
  <section class="table-wrap">
    <div class="table-scroll">
      <table v-if="!loading">
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                :checked="allChecked"
                :indeterminate="indeterminate"
                @change="emit('selectAll', ($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th>映射（源目录 → 目标目录）</th>
            <th class="col-status">状态</th>
            <th class="col-size">大小</th>
            <th class="col-action">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 分组视图 -->
          <template v-if="viewMode === 'grouped'">
            <template v-for="g in groups" :key="g.id || 'ungrouped'">
              <tr class="group-head">
                <td colspan="5">
                  <div class="gh">
                    <button
                      class="gh-caret"
                      :class="{ collapsed: collapsed.has(g.id) }"
                      :title="collapsed.has(g.id) ? '展开' : '折叠'"
                      @click="emit('toggleGroup', g.id)"
                    >
                      <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor">
                        <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
                      </svg>
                    </button>
                    <span class="gh-name">{{ g.name }}</span>
                    <span v-if="!g.enabled" class="gh-origin">已停用</span>
                    <span class="gh-spacer" />
                    <span class="gh-count num">{{ linkedCount(g.rows) }}/{{ g.rows.length }} 已链接</span>
                    <span class="gh-actions">
                      <button class="btn ghost sm" @click="emit('groupAdd', g.id)">＋ 添加</button>
                    </span>
                  </div>
                </td>
              </tr>

              <tr
                v-for="r in (collapsed.has(g.id) ? [] : g.rows)"
                :key="r.id"
                class="map-row"
                :class="{ selected: selected.has(r.id), disabled: !r.enabled }"
              >
                <td class="col-check">
                  <input
                    type="checkbox"
                    :checked="selected.has(r.id)"
                    :disabled="!r.selectable"
                    @change="emit('select', r.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>
                  <div class="map-cell">
                    <div class="map-label"><span>{{ r.name }}</span></div>
                    <div class="map-path mono" :title="`${r.sourcePath} → ${r.targetPath}`">
                      <span class="path-src">{{ r.sourcePath }}</span>
                      <svg class="path-arrow" width="12" height="12" viewBox="0 0 256 256" fill="currentColor">
                        <path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" />
                      </svg>
                      <span class="path-dst">{{ r.targetPath }}</span>
                    </div>
                  </div>
                </td>
                <td><span class="tag" :class="statusTone(r.status)">{{ statusLabel(r.status) }}</span></td>
                <td class="col-size num">{{ sizeText(r.sizeBytes) }}</td>
                <td class="col-action">
                  <button
                    class="btn sm"
                    :class="{ primary: !r.action.disabled }"
                    :disabled="r.action.disabled"
                    @click="emit('rowAction', r)"
                  >{{ r.action.label }}</button>
                  <span class="row-manage">
                    <button class="mini" title="编辑" @click="emit('edit', r.id)">✎</button>
                    <button class="mini danger" title="删除（仅删配置，不动磁盘数据）" @click="emit('remove', r.id)">✕</button>
                  </span>
                </td>
              </tr>
            </template>
          </template>

          <!-- 平铺视图 -->
          <template v-else>
          <tr
            v-for="r in flatRows"
            :key="r.id"
            class="map-row"
            :class="{ selected: selected.has(r.id), disabled: !r.enabled }"
          >
            <td class="col-check">
              <input
                type="checkbox"
                :checked="selected.has(r.id)"
                :disabled="!r.selectable"
                @change="emit('select', r.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td>
              <div class="map-cell">
                <div class="map-label">
                  <span>{{ r.name }}</span>
                  <span class="flat-group">{{ r.groupName }}</span>
                </div>
                <div class="map-path mono" :title="`${r.sourcePath} → ${r.targetPath}`">
                  <span class="path-src">{{ r.sourcePath }}</span>
                  <svg class="path-arrow" width="12" height="12" viewBox="0 0 256 256" fill="currentColor">
                    <path d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z" />
                  </svg>
                  <span class="path-dst">{{ r.targetPath }}</span>
                </div>
              </div>
            </td>
            <td><span class="tag" :class="statusTone(r.status)">{{ statusLabel(r.status) }}</span></td>
            <td class="col-size num">{{ sizeText(r.sizeBytes) }}</td>
            <td class="col-action">
              <button
                class="btn sm"
                :class="{ primary: !r.action.disabled }"
                :disabled="r.action.disabled"
                @click="emit('rowAction', r)"
              >{{ r.action.label }}</button>
              <span class="row-manage">
                <button class="mini" title="编辑" @click="emit('edit', r.id)">✎</button>
                <button class="mini danger" title="删除（仅删配置，不动磁盘数据）" @click="emit('remove', r.id)">✕</button>
              </span>
            </td>
          </tr>
          </template>
        </tbody>
      </table>

      <!-- 加载骨架 -->
      <div v-if="loading" class="state">
        <div class="skel" style="width: 60%" />
        <div class="skel" style="width: 90%" />
        <div class="skel" style="width: 75%" />
        <div class="skel" style="width: 85%" />
      </div>

      <!-- 错误态 -->
      <div v-else-if="error" class="state error-state">
        <p>{{ error }}</p>
        <button class="btn sm" @click="emit('retry')">重试</button>
      </div>

      <!-- 空态 -->
      <div v-else-if="groups.length === 0 && flatRows.length === 0" class="state empty-state">
        <svg width="40" height="40" viewBox="0 0 256 256" fill="currentColor" style="color: var(--ink-3); opacity: 0.4">
          <path d="M216,40H72A16,16,0,0,0,56,56V72H40A16,16,0,0,0,24,88V200a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V184h16a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM184,88v16H40V88Zm0,112H40V120H184v80Zm32-32H200V88a16,16,0,0,0-16-16H72V56H216Z" />
        </svg>
        <p>还没有任何映射</p>
        <p class="empty-hint">点击上方「添加映射」选择源目录与目标目录，即可迁移任意文件夹</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.table-wrap {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r);
  overflow: hidden;
  box-shadow: var(--shadow-card);
}
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.table-scroll table { min-width: 720px; }
thead th {
  text-align: left;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: clamp(7px, 1vw, 9px) clamp(10px, 1.6vw, 14px);
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  white-space: nowrap;
}
.col-check { width: 36px; }
.col-status { width: 92px; }
.col-size { text-align: right; width: 84px; }
.col-action { text-align: right; width: 150px; }

/* 组头 */
.group-head td {
  background: linear-gradient(180deg, #f6f9f8, #f1f5f4);
  padding: clamp(6px, 0.9vw, 7px) clamp(8px, 1.2vw, 10px);
  border-bottom: 1px solid var(--border);
}
.gh { display: flex; align-items: center; gap: 9px; width: 100%; }
.gh-caret {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 24px; padding: 2px; color: var(--ink-3); transition: transform 0.15s ease;
}
.gh-caret.collapsed { transform: rotate(-90deg); }
.gh-name { font-size: var(--fs-sm); font-weight: 650; color: var(--ink-1); }
.gh-origin {
  font-size: 10.5px; padding: 1px 8px; border-radius: var(--r-pill);
  background: var(--panel-2); color: var(--ink-3); border: 1px solid var(--border);
}
.gh-spacer { flex: 1; }
.gh-count { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; }
.gh-actions { display: flex; gap: 4px; }

/* 行 */
.map-row { transition: background 0.12s ease; }
.map-row:hover { background: var(--panel-2); }
.map-row.selected { background: var(--accent-soft); }
.map-row.disabled { opacity: 0.5; }
.map-row td { padding: clamp(7px, 1vw, 9px) clamp(10px, 1.6vw, 14px); border-bottom: 1px solid var(--border); vertical-align: middle; }
.col-check { text-align: center; }
.col-check input { accent-color: var(--accent); width: 15px; height: 15px; cursor: pointer; }
.col-size { text-align: right; font-weight: 600; color: var(--ink-1); white-space: nowrap; }
.col-action { text-align: right; white-space: nowrap; }
.map-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.map-label {
  font-size: var(--fs-sm); font-weight: 600; color: var(--ink-1);
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
}
.flat-group {
  display: inline-flex; font-size: var(--fs-xs); font-weight: 400; color: var(--ink-3);
  background: var(--panel-2); border-radius: var(--r-pill); padding: 1px 9px;
}
.map-path { display: flex; align-items: center; gap: 6px; color: var(--ink-3); font-size: var(--fs-xs); overflow: hidden; }
.map-path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.path-src { color: var(--bad-ink); }
.path-dst { color: var(--ok-ink); }
.path-arrow { color: var(--ink-3); flex-shrink: 0; }
.row-manage { display: inline-flex; gap: 2px; margin-left: 4px; }
.mini {
  min-height: 24px; padding: 2px 7px; font-size: 11px; border-radius: var(--r-control);
  border: 1px solid var(--border-strong); background: var(--bg); color: var(--ink-2);
}
.mini.danger:hover { color: var(--bad-ink); border-color: rgba(192, 69, 60, 0.3); background: var(--bad-soft); }

.state { padding: 40px 20px; text-align: center; }
.empty-state p, .error-state p { color: var(--ink-3); font-size: var(--fs-sm); margin-top: 10px; }
.empty-hint { font-size: var(--fs-xs) !important; opacity: 0.7; }
.error-state { color: var(--bad-ink); }
.error-state .btn { margin-top: 10px; }
</style>
