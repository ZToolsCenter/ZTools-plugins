<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api';
import type { Project, GitRemote } from '../../types';

const props = defineProps<{
  project: Project;
}>();

const visible = defineModel<boolean>();
const { t } = useI18n();

const remotes = ref<GitRemote[]>([]);
const isLoading = ref(false);

// Form for add / edit
const editingRemote = ref<string | null>(null); // null = adding new, string = editing name
const formName = ref('');
const formUrl = ref('');

watch(visible, async (v) => {
  if (v) {
    editingRemote.value = null;
    formName.value = '';
    formUrl.value = '';
    await loadRemotes();
  }
});

async function loadRemotes() {
  isLoading.value = true;
  try {
    const list = await api.gitRemoteList(props.project.path);
    // Deduplicate: keep only fetch entries (remote -v shows both fetch and push)
    const seen = new Set<string>();
    remotes.value = list.filter(r => {
      if (seen.has(r.name)) return false;
      seen.add(r.name);
      return true;
    });
  } catch (e) {
    ElMessage.error(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

function startEdit(remote: GitRemote) {
  editingRemote.value = remote.name;
  formName.value = remote.name;
  formUrl.value = remote.url;
}

function cancelEdit() {
  editingRemote.value = null;
  formName.value = '';
  formUrl.value = '';
}

async function handleAdd() {
  const name = formName.value.trim();
  const url = formUrl.value.trim();
  if (!name || !url) return;
  isLoading.value = true;
  try {
    await api.gitRemoteAdd(props.project.path, name, url);
    ElMessage.success(t('git.remoteAdded'));
    formName.value = '';
    formUrl.value = '';
    await loadRemotes();
  } catch (e) {
    ElMessage.error(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function handleUpdate() {
  if (!editingRemote.value) return;
  const url = formUrl.value.trim();
  if (!url) return;
  isLoading.value = true;
  try {
    await api.gitRemoteSetUrl(props.project.path, editingRemote.value, url);
    ElMessage.success(t('git.remoteUpdated'));
    cancelEdit();
    await loadRemotes();
  } catch (e) {
    ElMessage.error(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}

async function handleRemove(name: string) {
  try {
    await ElMessageBox.confirm(
      t('git.remoteDeleteConfirm', { name }),
      t('common.warning'),
      { type: 'warning' },
    );
  } catch {
    return;
  }
  isLoading.value = true;
  try {
    await api.gitRemoteRemove(props.project.path, name);
    ElMessage.success(t('git.remoteDeleted'));
    if (editingRemote.value === name) cancelEdit();
    await loadRemotes();
  } catch (e) {
    ElMessage.error(t('git.operationFailed', { error: String(e) }));
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('git.repoSettings')"
    width="640px"
    :close-on-click-modal="false"
    align-center
    class="git-remote-dialog"
  >
    <!-- Remote list -->
    <div class="mb-3">
      <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 px-1">
        {{ t('git.remotes') }}
      </div>
      <div class="text-[10px] text-slate-400 dark:text-slate-500 mb-2 px-1">
        {{ t('git.multiRemoteHint') }}
      </div>
      <div class="rounded-md border border-slate-200/40 dark:border-slate-700/30 overflow-hidden">
        <!-- Table header -->
        <div class="flex items-center px-3 py-1.5 bg-slate-50/60 dark:bg-slate-800/40 border-b border-slate-200/40 dark:border-slate-700/30 text-[10px] font-medium text-slate-400 dark:text-slate-500">
          <span class="w-[100px] shrink-0">{{ t('git.remoteName') }}</span>
          <span class="flex-1 min-w-0">{{ t('git.remoteUrl') }}</span>
        </div>
        <!-- Remote entries -->
        <div
          v-for="remote in remotes"
          :key="remote.name"
          class="flex items-center gap-2 px-3 py-2 hover:bg-slate-100/60 dark:hover:bg-slate-800/30 text-[12px] group border-b border-slate-200/20 dark:border-slate-700/20 last:border-b-0"
        >
          <span class="w-[100px] shrink-0 font-medium text-slate-700 dark:text-slate-300 truncate">
            {{ remote.name }}
          </span>
          <span class="flex-1 min-w-0 text-slate-500 dark:text-slate-400 truncate font-mono text-[11px]" :title="remote.url">
            {{ remote.url }}
          </span>
          <div class="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity shrink-0">
            <button
              @click="startEdit(remote)"
              class="text-blue-500 hover:text-blue-700 cursor-pointer p-0.5"
              :title="t('git.remoteUpdate')"
            >
              <div class="i-mdi-pencil-outline text-sm" />
            </button>
            <button
              @click="handleRemove(remote.name)"
              class="text-red-400 hover:text-red-600 cursor-pointer p-0.5"
              :title="t('git.remoteDelete')"
            >
              <div class="i-mdi-delete-outline text-sm" />
            </button>
          </div>
        </div>
        <!-- Empty state -->
        <div v-if="remotes.length === 0 && !isLoading" class="px-3 py-4 text-center text-slate-400 text-[11px]">
          {{ t('git.noRemotes') }}
        </div>
      </div>
    </div>

    <!-- Add / Edit form -->
    <div class="p-3 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/40 dark:border-slate-700/30">
      <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
        {{ editingRemote ? t('git.remoteUpdate') : t('git.remoteAdd') }}
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <el-input
          v-model="formName"
          :placeholder="t('git.remoteNamePlaceholder')"
          size="small"
          class="w-full sm:w-[120px]"
          :disabled="!!editingRemote"
        />
        <el-input
          v-model="formUrl"
          :placeholder="t('git.remoteUrlPlaceholder')"
          size="small"
          class="min-w-0 flex-1"
          @keydown.enter="editingRemote ? handleUpdate() : handleAdd()"
        />
        <el-button
          v-if="!editingRemote"
          size="small"
          type="primary"
          :loading="isLoading"
          :disabled="!formName.trim() || !formUrl.trim()"
          class="w-full sm:w-auto"
          @click="handleAdd"
        >
          {{ t('git.remoteAdd') }}
        </el-button>
        <template v-else>
          <el-button
            size="small"
            type="primary"
            :loading="isLoading"
            :disabled="!formUrl.trim()"
            class="w-full sm:w-auto"
            @click="handleUpdate"
          >
            {{ t('common.save') }}
          </el-button>
          <el-button size="small" class="w-full sm:w-auto" @click="cancelEdit">
            {{ t('common.cancel') }}
          </el-button>
        </template>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
:deep(.git-remote-dialog .el-dialog) {
  width: min(640px, calc(100vw - 32px));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.git-remote-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
}
</style>
