<script setup lang="ts">
/**
 * 分组管理弹窗（取代旧的出厂预设弹窗：新架构无预设库，分组全部由用户自建）。
 * 纯渲染：分组数据走 props，增删改/启停向父级 emit。
 */
import { ref } from 'vue';
import type { GroupVO } from '../store/types';

defineProps<{ open: boolean; groups: GroupVO[] }>();
const emit = defineEmits<{
  close: [];
  create: [name: string];
  rename: [id: string, name: string];
  toggle: [id: string, enabled: boolean];
  remove: [id: string];
}>();

const newName = ref('');
const editingId = ref<string | null>(null);
const editingName = ref('');
const error = ref('');

function addGroup(): void {
  const name = newName.value.trim();
  if (!name) {
    error.value = '请输入分组名称';
    return;
  }
  emit('create', name);
  newName.value = '';
  error.value = '';
}

function startRename(group: GroupVO): void {
  editingId.value = group.id;
  editingName.value = group.name;
}
function commitRename(): void {
  if (editingId.value && editingName.value.trim()) {
    emit('rename', editingId.value, editingName.value.trim());
  }
  editingId.value = null;
}
</script>

<template>
  <div v-if="open" class="scrim on" @click.self="emit('close')">
    <div class="modal on">
      <header>
        <h3>分组管理</h3>
        <button class="btn ghost sm close" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <!-- 新建分组 -->
        <div class="add-row">
          <input
            v-model="newName"
            placeholder="新建分组名称，例如：JetBrains 全家桶"
            @keydown.enter="addGroup"
          />
          <button class="btn primary" @click="addGroup">新建</button>
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>

        <!-- 分组列表 -->
        <ul v-if="groups.length" class="group-list">
          <li v-for="g in groups" :key="g.id" class="group-item" :class="{ off: !g.enabled }">
            <template v-if="editingId === g.id">
              <input v-model="editingName" class="rename-input" @keydown.enter="commitRename" @blur="commitRename" />
            </template>
            <template v-else>
              <span class="g-name" @dblclick="startRename(g)">{{ g.name }}</span>
              <span v-if="!g.enabled" class="off-tag">已停用</span>
            </template>

            <span class="g-spacer" />
            <div class="g-ops">
              <button class="mini" title="重命名" @click="startRename(g)">✎</button>
              <button class="mini" @click="emit('toggle', g.id, !g.enabled)">
                {{ g.enabled ? '停用' : '启用' }}
              </button>
              <button class="mini danger" title="删除分组（其映射转入未分组）" @click="emit('remove', g.id)">✕</button>
            </div>
          </li>
        </ul>
        <p v-else class="empty-tip">还没有分组，可在上方新建；不建组的映射会归入「未分组」。</p>
      </div>

      <footer>
        <span class="left">分组仅用于归类，删除分组不会删除其映射</span>
        <div class="right">
          <button class="btn primary" @click="emit('close')">完成</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal { width: 480px; max-width: calc(100vw - 32px); }
.add-row { display: flex; gap: 8px; }
.add-row input { flex: 1; min-width: 0; }
.form-error { color: var(--bad-ink); font-size: var(--fs-xs); margin-top: 6px; }
.group-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
.group-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-control);
  background: var(--panel-2);
}
.group-item.off { opacity: 0.55; }
.g-name { font-size: var(--fs-sm); font-weight: 600; color: var(--ink-1); cursor: text; }
.off-tag {
  font-size: 10.5px; padding: 1px 8px; border-radius: var(--r-pill);
  background: var(--bg); color: var(--ink-3); border: 1px solid var(--border);
}
.g-spacer { flex: 1; }
.g-ops { display: inline-flex; gap: 4px; }
.mini {
  min-height: 24px; padding: 2px 9px; font-size: 11px; border-radius: var(--r-control);
  border: 1px solid var(--border-strong); background: var(--bg); color: var(--ink-2);
}
.mini.danger:hover { color: var(--bad-ink); border-color: rgba(192, 69, 60, 0.3); background: var(--bad-soft); }
.rename-input { flex: 1; min-width: 0; }
.empty-tip { margin-top: 14px; font-size: var(--fs-xs); color: var(--ink-3); }
</style>
