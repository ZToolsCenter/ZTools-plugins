<script setup lang="ts">
/**
 * 添加 / 编辑映射弹窗。
 * 表单草稿为组件局部状态；分组选项、编辑回填、提交、目录选择全部走 useDashboard（业务收敛在 hook）。
 */
import { reactive, ref, watch } from 'vue';
import { useDashboard, type MappingDraft } from '../hooks/useDashboard';
import { UNGROUPED_ID } from '../utils/enums';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const dashboard = useDashboard();

const form = reactive({
  name: '',
  groupId: UNGROUPED_ID,
  sourcePath: '',
  targetPath: '',
  exeNamesText: '',
  cachePatternsText: '',
});
const formError = ref('');

// 打开时回填：编辑用已有行，新增用组标题传入的预选分组
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    formError.value = '';
    const editing = dashboard.editingRow.value;
    if (editing) {
      form.name = editing.name;
      form.groupId = editing.groupId;
      form.sourcePath = editing.sourcePath;
      form.targetPath = editing.targetPath;
      form.exeNamesText = editing.exeNames.join('\n');
      form.cachePatternsText = editing.cachePatterns.join('\n');
    } else {
      form.name = '';
      form.groupId = dashboard.pendingGroup.value;
      form.sourcePath = '';
      form.targetPath = '';
      form.exeNamesText = '';
      form.cachePatternsText = '';
    }
  }
);

function pick(field: 'sourcePath' | 'targetPath'): void {
  const picked = dashboard.browseDirectory(field === 'sourcePath' ? '选择源目录' : '选择目标目录');
  if (picked) form[field] = picked;
}

function submit(): void {
  if (!form.name.trim()) {
    formError.value = '请填写映射名称';
    return;
  }
  if (!form.sourcePath.trim()) {
    formError.value = '请选择源目录';
    return;
  }
  if (!form.targetPath.trim()) {
    formError.value = '请选择目标目录';
    return;
  }
  const draft: MappingDraft = {
    id: dashboard.editingId.value ?? undefined,
    ...form,
  };
  dashboard.submitMapping(draft);
  emit('close');
}

function close(): void {
  dashboard.closeEditor();
  emit('close');
}
</script>

<template>
  <div v-if="open" class="scrim on" @click.self="close">
    <div class="modal on">
      <header>
        <h3>{{ dashboard.editingId.value ? '编辑映射' : '添加映射' }}</h3>
        <button class="btn ghost sm close" @click="close">✕</button>
      </header>

      <div class="body">
        <div class="field">
          <label>映射名称 <span class="req">*</span></label>
          <input v-model="form.name" placeholder="例如：扩展目录" />
        </div>

        <div class="field">
          <label>所属分组</label>
          <select v-model="form.groupId">
            <option :value="UNGROUPED_ID">未分组</option>
            <option v-for="g in dashboard.groups.value" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <div class="field">
          <label>源目录（系统盘，将被迁移） <span class="req">*</span></label>
          <div class="path-row">
            <input v-model="form.sourcePath" placeholder="例如 C:\Users\you\.vscode\extensions" spellcheck="false" />
            <button class="btn ghost" @click="pick('sourcePath')">浏览</button>
          </div>
        </div>

        <div class="field">
          <label>目标目录（其他盘，数据实际存放处） <span class="req">*</span></label>
          <div class="path-row">
            <input v-model="form.targetPath" placeholder="例如 D:\Data\vscode\extensions" spellcheck="false" />
            <button class="btn ghost" @click="pick('targetPath')">浏览</button>
          </div>
        </div>

        <div class="field">
          <label>关联进程（每行一个，迁移前检测，运行中拒绝执行）</label>
          <textarea v-model="form.exeNamesText" rows="2" placeholder="Code.exe&#10;Cursor.exe" spellcheck="false" />
        </div>

        <div class="field">
          <label>缓存排除规则（每行一个 glob，迁移时跳过）</label>
          <textarea v-model="form.cachePatternsText" rows="2" placeholder="**/Cache/**&#10;**/GPUCache/**" spellcheck="false" />
        </div>

        <p v-if="formError" class="form-error">{{ formError }}</p>
      </div>

      <footer>
        <div class="left">迁移仅移动目录数据并建立链接，不影响程序运行</div>
        <div class="right">
          <button class="btn" @click="close">取消</button>
          <button class="btn primary" @click="submit">保存</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal { width: 540px; max-width: calc(100vw - 32px); }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: var(--fs-xs); font-weight: 600; color: var(--ink-2); margin-bottom: 5px; }
.req { color: var(--bad-ink); }
.path-row { display: flex; gap: 8px; }
.path-row input { flex: 1; min-width: 0; }
textarea {
  width: 100%; resize: vertical; font-family: inherit; font-size: var(--fs-sm);
  padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: var(--r-control);
  background: var(--input-bg); color: var(--ink-1); line-height: 1.5;
}
textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.form-error { color: var(--bad-ink); font-size: var(--fs-xs); margin-top: 4px; }
</style>
