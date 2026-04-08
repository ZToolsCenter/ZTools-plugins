<script setup lang="ts">
import { ref, computed } from 'vue';
import { useGitStore } from '../../stores/git';
import { useSettingsStore } from '../../stores/settings';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import type { Project } from '../../types';
import { showPersistentGitError } from './message';

const props = defineProps<{
  project: Project;
}>();

const { t } = useI18n();
const gitStore = useGitStore();
const settingsStore = useSettingsStore();

const commitMessage = computed({
  get: () => gitStore.commitMessage[props.project.id] || '',
  set: (v: string) => { gitStore.commitMessage[props.project.id] = v; },
});
const aiGenerating = ref(false);

const stagedFiles = computed(() => {
  const s = gitStore.getStatus(props.project.id);
  return s?.staged || [];
});

const aiEnabled = computed(() => settingsStore.settings.gitAiEnabled);

function isCancelledError(error: unknown): boolean {
  return String(error).toLowerCase().includes('cancelled');
}

async function handleCommit() {
  if (!commitMessage.value.trim()) {
    ElMessage.warning(t('git.commitEmpty'));
    return;
  }
  if (stagedFiles.value.length === 0) {
    ElMessage.warning(t('git.commitNoStaged'));
    return;
  }
  try {
    await gitStore.commit(props.project.id, props.project.path, commitMessage.value.trim());
    commitMessage.value = '';
    ElMessage.success(t('git.commitSuccess'));
  } catch (e: any) {
    if (isCancelledError(e)) {
      ElMessage.info(t('git.operationCancelled'));
      return;
    }
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleCommitAndPush() {
  if (!commitMessage.value.trim()) {
    ElMessage.warning(t('git.commitEmpty'));
    return;
  }
  if (stagedFiles.value.length === 0) {
    ElMessage.warning(t('git.commitNoStaged'));
    return;
  }
  try {
    await gitStore.commit(props.project.id, props.project.path, commitMessage.value.trim());
    commitMessage.value = '';
    await gitStore.push(props.project.id, props.project.path);
    ElMessage.success(t('git.commitAndPushSuccess'));
  } catch (e: any) {
    if (isCancelledError(e)) {
      ElMessage.info(t('git.operationCancelled'));
      return;
    }
    showPersistentGitError(t('git.operationFailed', { error: String(e) }));
  }
}

async function handleAiGenerate() {
  const s = settingsStore.settings;
  const service = s.gitAiPrimaryService;
  if (!service?.apiKey?.trim() || !service?.baseUrl?.trim() || !service?.model?.trim()) {
    ElMessage.warning(t('git.aiConfigMissing'));
    return;
  }
  aiGenerating.value = true;
  try {
    const msg = await gitStore.generateAiCommitMessage(props.project.id, props.project.path, {
      service,
      promptTemplate: s.gitAiPromptTemplate,
      stream: s.gitAiStream,
    });
    if (msg) {
      commitMessage.value = msg;
      ElMessage.success(t('git.aiSuccess'));
    }
  } catch (e: any) {
    const msg = String(e);
    if (msg.includes('no_staged')) {
      ElMessage.warning(t('git.aiNoStaged'));
    } else {
      showPersistentGitError(t('git.aiError', { error: msg }));
    }
  } finally {
    aiGenerating.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col shrink-0 overflow-hidden bg-white/40 dark:bg-[#0f172a]/40 font-sans">
    <!-- Header -->
    <div class="flex items-center justify-between px-2.5 py-1 border-b border-slate-200/40 dark:border-slate-700/20 shrink-0">
      <span class="text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
        <div class="i-mdi-message-text-outline text-xs text-blue-500/60" />
        {{ t('git.commitMessage') }}
      </span>
      <div class="flex items-center gap-1">
        <button
          v-if="aiEnabled"
          @click="handleAiGenerate"
          :disabled="aiGenerating"
          class="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :title="t('git.aiGenerate')"
        >
          <div :class="aiGenerating ? 'i-mdi-loading animate-spin' : 'i-mdi-auto-fix'" class="text-xs" />
          {{ aiGenerating ? t('git.aiGenerating') : t('git.aiGenerate') }}
        </button>
        <span v-if="stagedFiles.length > 0" class="text-[9px] text-blue-500/80 bg-blue-500/8 px-1.5 py-0.5 rounded-full leading-none font-medium">{{ stagedFiles.length }} {{ t('git.staged') }}</span>
      </div>
    </div>
    <!-- Textarea -->
    <div class="p-1.5 flex-1 min-h-0 overflow-hidden">
      <textarea
        v-model="commitMessage"
        :placeholder="t('git.commitPlaceholder')"
        class="w-full h-full box-border px-2 py-1.5 text-[11px] rounded-md border border-slate-200/60 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-900/20 text-slate-700 dark:text-slate-300 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/30 placeholder:text-slate-400/40 transition-all duration-150"
        @keydown.ctrl.enter="handleCommit"
      />
    </div>
    <!-- Commit buttons -->
    <div class="px-1.5 pb-1.5 shrink-0 flex gap-1.5">
      <button @click="handleCommit"
        :disabled="!commitMessage.trim() || stagedFiles.length === 0"
        class="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1 shadow-sm hover:shadow">
        <div class="i-mdi-check text-xs" />
        {{ t('git.commit') }}
      </button>
      <button @click="handleCommitAndPush"
        :disabled="!commitMessage.trim() || stagedFiles.length === 0"
        class="flex-1 py-1.5 rounded-md text-[11px] font-medium bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1 shadow-sm hover:shadow"
        :title="t('git.commitAndPush')">
        <div class="i-mdi-source-commit text-xs" />
        {{ t('git.commitAndPush') }}
      </button>
    </div>
  </div>
</template>
