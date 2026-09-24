<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useGitStore } from '../../stores/git.ts';
import type { Project, GitStashEntry, GitTag, GitRemote } from '../../types.ts';
import { showPersistentGitError } from './message.ts';
import { api } from '../../api/index.ts';

/***********************组件输入*********************/

const props = defineProps<{
  modelValue: boolean;
  project: Project;
  /** 初始 Tab */
  initialTab?: 'branches' | 'tags' | 'remotes' | 'stash';
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'open-branches'): void;
}>();

const { t } = useI18n();
const gitStore = useGitStore();

/***********************面板状态*********************/

const activeTab = ref<'branches' | 'tags' | 'remotes' | 'stash'>('stash');
const loading = ref(false);

const stashes = ref<GitStashEntry[]>([]);
const tags = ref<GitTag[]>([]);
const remotes = ref<GitRemote[]>([]);
const stashMessage = ref('');
const newTagName = ref('');
const newRemoteName = ref('');
const newRemoteUrl = ref('');

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const localBranches = computed(() => gitStore.getLocalBranches(props.project.id));

/***********************数据加载*********************/

async function refreshAll() {
  loading.value = true;
  try {
    await Promise.all([
      gitStore.refreshBranches(props.project.id, props.project.path),
      loadStashes(),
      loadTags(),
      loadRemotes(),
    ]);
  } finally {
    loading.value = false;
  }
}

async function loadStashes() {
  try {
    stashes.value = await gitStore.listStashes(props.project.path);
  } catch (e) {
    stashes.value = [];
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function loadTags() {
  try {
    tags.value = await gitStore.listTags(props.project.path);
  } catch (e) {
    tags.value = [];
  }
}

async function loadRemotes() {
  try {
    remotes.value = await api.gitRemoteList(props.project.path);
  } catch (e) {
    remotes.value = [];
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    if (props.initialTab) activeTab.value = props.initialTab;
    await refreshAll();
  },
);

/***********************Stash 操作*********************/

async function handleStashSave() {
  try {
    await gitStore.stashSave(props.project.id, props.project.path, stashMessage.value.trim() || undefined);
    stashMessage.value = '';
    ElMessage.success(t('git.stashSuccess'));
    await loadStashes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleStashPop(index: number) {
  try {
    await gitStore.stashPop(props.project.id, props.project.path, index);
    ElMessage.success(t('git.stashPopSuccess'));
    await loadStashes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleStashApply(index: number) {
  try {
    await gitStore.stashApply(props.project.id, props.project.path, index);
    ElMessage.success(t('git.stashApplySuccess'));
    await loadStashes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleStashDrop(index: number) {
  try {
    await ElMessageBox.confirm(t('git.stashDropConfirm'), t('common.warning'), { type: 'warning' });
  } catch {
    return;
  }
  try {
    await gitStore.stashDrop(props.project.id, props.project.path, index);
    ElMessage.success(t('git.stashDropSuccess'));
    await loadStashes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

/***********************Tag 操作*********************/

async function handleCreateTag() {
  const name = newTagName.value.trim();
  if (!name) {
    ElMessage.warning(t('git.tagNameRequired'));
    return;
  }
  try {
    await gitStore.createTag(props.project.id, props.project.path, name);
    newTagName.value = '';
    ElMessage.success(t('git.tagCreateSuccess', { name }));
    await loadTags();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleDeleteTag(name: string) {
  try {
    await ElMessageBox.confirm(t('git.deleteTagConfirm', { name }), t('common.warning'), { type: 'warning' });
  } catch {
    return;
  }
  try {
    await gitStore.deleteTag(props.project.id, props.project.path, name);
    ElMessage.success(t('git.deleteTagSuccess', { name }));
    await loadTags();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

/***********************Remote 操作*********************/

async function handleAddRemote() {
  const name = newRemoteName.value.trim();
  const url = newRemoteUrl.value.trim();
  if (!name || !url) {
    ElMessage.warning(t('git.remoteFieldsRequired'));
    return;
  }
  try {
    await api.gitRemoteAdd(props.project.path, name, url);
    newRemoteName.value = '';
    newRemoteUrl.value = '';
    ElMessage.success(t('git.remoteAdded'));
    await loadRemotes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleRemoveRemote(name: string) {
  try {
    await ElMessageBox.confirm(t('git.remoteDeleteConfirm', { name }), t('common.warning'), { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.gitRemoteRemove(props.project.path, name);
    ElMessage.success(t('git.remoteDeleted'));
    await loadRemotes();
  } catch (e) {
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

/***********************分支*********************/

function openFullBranchDialog() {
  visible.value = false;
  emit('open-branches');
}

function formatStashId(index: number): string {
  return `stash@{${index}}`;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('git.repoCenter')"
    width="560px"
    destroy-on-close
    append-to-body
    align-center
    class="git-repo-center-dialog"
  >
    <div class="tabs">
      <button
        v-for="tab in ([
          { id: 'stash', label: t('git.stash') },
          { id: 'tags', label: t('git.tags') },
          { id: 'remotes', label: t('git.remotes') },
          { id: 'branches', label: t('git.branch') },
        ] as const)"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
      <button type="button" class="tab refresh" :disabled="loading" @click="refreshAll">
        <div :class="loading ? 'i-mdi-loading animate-spin' : 'i-mdi-refresh'" class="text-sm" />
      </button>
    </div>

    <!-- Stash -->
    <div v-if="activeTab === 'stash'" class="panel">
      <div class="row">
        <input v-model="stashMessage" class="input flex-1" :placeholder="t('git.stashMessagePlaceholder')" />
        <button type="button" class="btn primary" @click="handleStashSave">{{ t('git.stashSave') }}</button>
      </div>
      <div v-if="stashes.length === 0" class="empty">{{ t('git.stashEmpty') }}</div>
      <ul v-else class="list">
        <li v-for="s in stashes" :key="s.index" class="list-item">
          <div class="meta">
            <span class="mono">{{ formatStashId(s.index) }}</span>
            <span class="msg">{{ s.message }}</span>
            <span class="date">{{ s.date }}</span>
          </div>
          <div class="actions">
            <button type="button" class="btn sm" @click="handleStashApply(s.index)">{{ t('git.stashApply') }}</button>
            <button type="button" class="btn sm" @click="handleStashPop(s.index)">{{ t('git.stashPop') }}</button>
            <button type="button" class="btn sm danger" @click="handleStashDrop(s.index)">{{ t('git.stashDrop') }}</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Tags -->
    <div v-else-if="activeTab === 'tags'" class="panel">
      <div class="row">
        <input v-model="newTagName" class="input flex-1" :placeholder="t('git.tagNamePlaceholder')" />
        <button type="button" class="btn primary" @click="handleCreateTag">{{ t('git.createTag') }}</button>
      </div>
      <div v-if="tags.length === 0" class="empty">{{ t('git.noTags') }}</div>
      <ul v-else class="list">
        <li v-for="tag in tags" :key="tag.name" class="list-item">
          <div class="meta">
            <span class="msg">{{ tag.name }}</span>
            <span class="mono">{{ tag.hash }}</span>
          </div>
          <div class="actions">
            <button type="button" class="btn sm danger" @click="handleDeleteTag(tag.name)">{{ t('git.deleteTag') }}</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Remotes -->
    <div v-else-if="activeTab === 'remotes'" class="panel">
      <div class="row wrap">
        <input v-model="newRemoteName" class="input" :placeholder="t('git.remoteNamePlaceholder')" />
        <input v-model="newRemoteUrl" class="input flex-1" :placeholder="t('git.remoteUrlPlaceholder')" />
        <button type="button" class="btn primary" @click="handleAddRemote">{{ t('git.remoteAdd') }}</button>
      </div>
      <div v-if="remotes.length === 0" class="empty">{{ t('git.noRemotes') }}</div>
      <ul v-else class="list">
        <li v-for="r in remotes" :key="`${r.name}-${r.remote_type}-${r.url}`" class="list-item">
          <div class="meta">
            <span class="msg">{{ r.name }} <small>({{ r.remote_type }})</small></span>
            <span class="mono">{{ r.url }}</span>
          </div>
          <div class="actions">
            <button
              v-if="r.remote_type === 'fetch'"
              type="button"
              class="btn sm danger"
              @click="handleRemoveRemote(r.name)"
            >{{ t('git.remoteDelete') }}</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Branches 摘要 + 打开完整对话框 -->
    <div v-else class="panel">
      <div class="row between">
        <span class="hint">{{ t('git.localBranches') }} ({{ localBranches.length }})</span>
        <button type="button" class="btn primary" @click="openFullBranchDialog">{{ t('git.manageBranches') }}</button>
      </div>
      <ul class="list">
        <li v-for="b in localBranches.slice(0, 20)" :key="b.name" class="list-item">
          <div class="meta">
            <span class="msg" :class="{ current: b.is_current }">
              {{ b.name }}
              <small v-if="b.is_current">HEAD</small>
            </span>
            <span v-if="b.upstream" class="mono">{{ b.upstream }} ↑{{ b.ahead }} ↓{{ b.behind }}</span>
          </div>
        </li>
      </ul>
    </div>
  </el-dialog>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--app-border, #e2e8f0);
  padding-bottom: 8px;
}
.tab {
  border: none;
  background: transparent;
  padding: 6px 10px;
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  border-radius: 6px;
  cursor: pointer;
  color: var(--app-text-secondary, #64748b);
}
.tab.active {
  background: var(--app-primary-soft, #dbeafe);
  color: var(--app-primary, #2563eb);
  font-weight: 600;
}
.tab.refresh {
  margin-left: auto;
}
.panel {
  min-height: 240px;
  max-height: 420px;
  overflow: auto;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.row.wrap {
  flex-wrap: wrap;
}
.row.between {
  justify-content: space-between;
}
.input {
  border: 1px solid var(--app-border, #e2e8f0);
  background: var(--app-surface-soft, #f8fafc);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  color: var(--app-text, #0f172a);
  min-width: 0;
}
.flex-1 {
  flex: 1;
}
.btn {
  border: 1px solid var(--app-border, #e2e8f0);
  background: var(--app-surface-soft, #f8fafc);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: var(--app-font-control);
  cursor: pointer;
  color: var(--app-text-secondary, #64748b);
  white-space: nowrap;
}
.btn.primary {
  background: var(--app-primary, #2563eb);
  border-color: transparent;
  color: #fff;
}
.btn.sm {
  padding: 3px 8px;
  font-size: var(--app-font-control);
}
.btn.danger {
  color: var(--app-danger, #dc2626);
  border-color: color-mix(in srgb, var(--app-danger, #dc2626) 30%, transparent);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--app-border, #e2e8f0);
  background: var(--app-surface, #fff);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.msg {
  font-size: var(--app-font-body);
  line-height: var(--app-line-height-body);
  color: var(--app-text, #0f172a);
}
.msg.current {
  color: var(--app-primary, #2563eb);
  font-weight: 600;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: var(--app-font-meta);
  color: var(--app-text-secondary, #475569);
  word-break: break-all;
}
.date {
  font-size: var(--app-font-meta);
  color: var(--app-text-muted, #64748b);
}
.actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  align-items: flex-start;
}
.empty,
.hint {
  font-size: var(--app-font-meta);
  line-height: var(--app-line-height-caption);
  color: var(--app-text-muted, #94a3b8);
  padding: 12px 0;
}
</style>
