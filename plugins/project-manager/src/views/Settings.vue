<script setup lang="ts">
import { ref, computed, onMounted, toRaw } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useProjectStore } from '../stores/project';
import { useNodeStore } from '../stores/node';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { Settings } from '../types';

const { t } = useI18n();
const settingsStore = useSettingsStore();
const projectStore = useProjectStore();
const nodeStore = useNodeStore();
const appVersion = ref('');
const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';
const contextMenuEnabled = ref(false);
const contextMenuSupported = ref(false);
const autoLaunchEnabled = ref(false);

// ─── Draft settings (not directly bound to store) ───
function deepClone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }
const draft = ref<Settings>(deepClone(toRaw(settingsStore.settings)));

const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(settingsStore.settings));

function resetDraft() {
    draft.value = deepClone(toRaw(settingsStore.settings));
}

function handleSave() {
    Object.assign(settingsStore.settings, deepClone(toRaw(draft.value)));
    ElMessage.success(t('common.success'));
}

function handleCancel() {
    resetDraft();
}

onMounted(async () => {
    appVersion.value = await api.getAppVersion();
    if (settingsStore.availableTerminals.length === 0) {
        settingsStore.fetchAvailableTerminals();
    }

    if (!isPlugin) {
        contextMenuSupported.value = await api.isContextMenuSupported();
        if (contextMenuSupported.value) {
            contextMenuEnabled.value = await api.checkContextMenu();
        }
        const autostart = await import('@tauri-apps/plugin-autostart');
        autoLaunchEnabled.value = await autostart.isEnabled();
    }
});

async function toggleContextMenu(val: boolean) {
    try {
        await api.setContextMenu(val, draft.value.locale);
        ElMessage.success(t('common.success'));
    } catch (e) {
        ElMessage.error(t('common.error') + ': ' + e);
        contextMenuEnabled.value = !val;
    }
}

async function toggleAutoLaunch(val: boolean) {
    try {
        const autostart = await import('@tauri-apps/plugin-autostart');
        if (val) {
            await autostart.enable();
        } else {
            await autostart.disable();
        }
        ElMessage.success(t('common.success'));
    } catch (e) {
        ElMessage.error(t('common.error') + ': ' + e);
        autoLaunchEnabled.value = !val;
    }
}

async function selectEditor() {
    try {
        const selected = await api.openDialog({
            multiple: false,
            filters: [{
                name: 'Executable',
                extensions: ['exe', 'cmd', 'bat']
            }]
        });
        if (selected && typeof selected === 'string') {
            return selected;
        }
    } catch (e) {
        console.error(e);
    }
    return null;
}

function addEditor() {
    if (!draft.value.editors) draft.value.editors = [];
    draft.value.editors.push({ id: crypto.randomUUID(), name: '', path: '' });
}

function removeEditor(index: number) {
    if (!draft.value.editors) return;
    draft.value.editors.splice(index, 1);
}

async function browseEditorPath(index: number) {
    const path = await selectEditor();
    if (path && draft.value.editors?.[index]) {
        draft.value.editors[index].path = path;
        if (!draft.value.editors[index].name) {
            draft.value.editors[index].name = path.split(/[/\\]/).pop()?.replace(/\.\w+$/, '') || '';
        }
    }
}

async function addCustomTerminal() {
    try {
        const selected = await api.openDialog({
            multiple: false,
            filters: [{
                name: 'Executable',
                extensions: ['exe', 'cmd', 'bat', 'sh', '']
            }]
        });
        if (selected && typeof selected === 'string') {
            const name = selected.split(/[/\\]/).pop() || selected;
            if (!draft.value.customTerminals) draft.value.customTerminals = [];
            if (draft.value.customTerminals.some(ct => ct.id === selected)) {
                ElMessage.warning(t('settings.terminalAlreadyExists'));
                return;
            }
            draft.value.customTerminals.push({ id: selected, name });
        }
    } catch (e) {
        console.error(e);
    }
}

function removeCustomTerminal(id: string) {
    if (!draft.value.customTerminals) return;
    draft.value.customTerminals = draft.value.customTerminals.filter(ct => ct.id !== id);
    if (draft.value.defaultTerminal === id) {
        draft.value.defaultTerminal = settingsStore.allTerminals[0]?.id || 'cmd';
    }
}

async function exportData() {
    try {
        const path = await api.saveDialog({
            filters: [{
                name: 'JSON',
                extensions: ['json']
            }],
            defaultPath: 'frontend-manager-backup.json'
        });

        if (path) {
            const data = {
                projects: projectStore.projects,
                settings: settingsStore.settings,
                customNodes: nodeStore.versions.filter(v => v.source === 'custom')
            };
            await api.writeTextFile(path, JSON.stringify(data, null, 2));
            ElMessage.success(t('settings.exportSuccess'));
        }
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('settings.exportError')}: ${e}`);
    }
}

async function importData() {
    try {
        const path = await api.openDialog({
            multiple: false,
            filters: [{
                name: 'JSON',
                extensions: ['json']
            }]
        });

        if (path && typeof path === 'string') {
            const content = await api.readTextFile(path);
            const data = JSON.parse(content);
            
            if (data.projects) projectStore.projects = data.projects;
            if (data.settings) settingsStore.settings = data.settings;
            if (data.customNodes) {
                // Merge custom nodes
                const existing = new Set(nodeStore.versions.map(v => v.path));
                data.customNodes.forEach((n: any) => {
                    if (!existing.has(n.path)) {
                        nodeStore.versions.push(n);
                    }
                });
            }
            // Sync draft with imported settings
            resetDraft();
            ElMessage.success(t('settings.importSuccess'));
        }
    } catch (e) {
        console.error(e);
        ElMessage.error(`${t('settings.importError')}: ${e}`);
    }
}

function openReleases() {
    api.openUrl('https://github.com/cuteyuchen/project-manager/releases');
}

const aiTestLoading = ref(false);
const aiTestResult = ref<{ success: boolean; message: string } | null>(null);

async function testAiConnection() {
    const s = draft.value;
    if (!s.gitAiBaseUrl || !s.gitAiApiKey || !s.gitAiModel) {
        aiTestResult.value = { success: false, message: t('settings.gitAiTestMissingConfig') };
        return;
    }
    aiTestLoading.value = true;
    aiTestResult.value = null;

    const url = s.gitAiBaseUrl.replace(/\/$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await globalThis.fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${s.gitAiApiKey}`,
            },
            body: JSON.stringify({
                model: s.gitAiModel,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            aiTestResult.value = { success: true, message: t('settings.gitAiTestSuccess') };
        } else if (response.status === 401 || response.status === 403) {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestAuthError') };
        } else if (response.status === 404) {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestModelNotFound') };
        } else if (response.status === 429) {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestRateLimit') };
        } else {
            const text = await response.text().catch(() => '');
            aiTestResult.value = { success: false, message: t('settings.gitAiTestHttpError', { status: response.status, error: text.slice(0, 200) }) };
        }
    } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestTimeout') };
        } else if (e.message?.includes('fetch') || e.message?.includes('network') || e.message?.includes('Failed')) {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestUnreachable') };
        } else {
            aiTestResult.value = { success: false, message: t('settings.gitAiTestError', { error: String(e).slice(0, 200) }) };
        }
    } finally {
        aiTestLoading.value = false;
    }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Top action bar — sticky -->
    <div class="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-slate-700/20 bg-white dark:bg-[#0f172a] shrink-0 z-10">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold text-slate-800 dark:text-white">{{ t('settings.title') }}</h1>
        <transition name="fade">
          <span v-if="isDirty" class="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium">
            {{ t('settings.unsavedChanges') }}
          </span>
        </transition>
      </div>
      <div class="flex items-center gap-2">
        <el-button :disabled="!isDirty" @click="handleCancel">
          {{ t('common.cancel') }}
        </el-button>
        <el-button type="primary" :disabled="!isDirty" @click="handleSave">
          <div class="i-mdi-content-save text-sm mr-1" />
          {{ t('common.save') }}
        </el-button>
      </div>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto p-6">
      <div class="max-w-4xl mx-auto space-y-5">
        <!-- General Settings -->
        <el-card class="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 shadow-sm">
          <template #header>
            <div class="font-bold flex items-center gap-2">
              <div class="i-mdi-cog text-blue-500" />
              {{ t('settings.general') }}
            </div>
          </template>
          <el-form label-position="top" class="max-w-lg">
            <el-form-item :label="t('settings.editors')">
              <div class="w-full space-y-2">
                <div v-for="(editor, index) in (draft.editors || [])" :key="editor.id" class="flex gap-2 items-center">
                  <el-input v-model="editor.name" :placeholder="t('settings.editorName')" class="w-[120px]" size="small" />
                  <el-input v-model="editor.path" :placeholder="t('settings.editorPathPlaceholder')" class="flex-1" size="small" readonly>
                    <template #append>
                      <el-button @click="browseEditorPath(index)" size="small">{{ t('settings.selectFile') }}</el-button>
                    </template>
                  </el-input>
                  <el-button type="danger" text @click="removeEditor(index)" :disabled="(draft.editors?.length || 0) <= 1" size="small">
                    <el-icon><div class="i-mdi-close" /></el-icon>
                  </el-button>
                </div>
                <el-button type="primary" text @click="addEditor" size="small">
                  <el-icon class="mr-1"><div class="i-mdi-plus" /></el-icon>
                  {{ t('settings.addEditor') }}
                </el-button>
                <div class="text-xs text-slate-500 dark:text-slate-400">{{ t('settings.editorsHint') }}</div>
              </div>
            </el-form-item>

            <el-form-item :label="t('settings.defaultTerminal')">
              <div class="flex gap-2 w-full">
                <el-select v-model="draft.defaultTerminal" class="flex-1">
                  <el-option-group :label="t('settings.detectedTerminals')">
                    <el-option v-for="term in settingsStore.availableTerminals" :key="term.id" :label="term.name" :value="term.id" />
                  </el-option-group>
                  <el-option-group v-if="draft.customTerminals?.length" :label="t('settings.customTerminals')">
                    <el-option v-for="ct in draft.customTerminals" :key="ct.id" :label="ct.name" :value="ct.id" />
                  </el-option-group>
                </el-select>
                <el-button @click="addCustomTerminal" :title="t('settings.addTerminal')">
                  <div class="i-mdi-plus text-sm" />
                </el-button>
              </div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ t('settings.terminalHint') }}</div>
              <!-- Custom terminals list -->
              <div v-if="draft.customTerminals?.length" class="mt-2 space-y-1">
                <div v-for="ct in draft.customTerminals" :key="ct.id" class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded px-2 py-1">
                  <div class="i-mdi-console text-sm text-slate-400" />
                  <span class="flex-1 truncate font-mono" :title="ct.id">{{ ct.name }}</span>
                  <button @click="removeCustomTerminal(ct.id)" class="text-red-400 hover:text-red-500 cursor-pointer">
                    <div class="i-mdi-close text-sm" />
                  </button>
                </div>
              </div>
            </el-form-item>

            <el-form-item :label="t('settings.contextMenu')" v-if="!isPlugin && contextMenuSupported">
              <el-switch v-model="contextMenuEnabled" @change="toggleContextMenu" />
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ t('settings.contextMenuHint') }}</div>
            </el-form-item>

            <el-form-item :label="t('settings.autoLaunch')" v-if="!isPlugin">
              <el-switch v-model="autoLaunchEnabled" @change="toggleAutoLaunch" />
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ t('settings.autoLaunchHint') }}</div>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- Appearance -->
        <el-card class="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 shadow-sm">
          <template #header>
            <div class="font-bold flex items-center gap-2">
              <div class="i-mdi-palette text-purple-500" />
              {{ t('settings.appearance') }}
            </div>
          </template>
          <el-form label-position="top" class="max-w-lg">
            <el-form-item :label="t('settings.language')">
              <el-select v-model="draft.locale" class="w-full">
                <el-option label="中文" value="zh" />
                <el-option label="English" value="en" />
              </el-select>
            </el-form-item>

            <el-form-item :label="t('settings.theme')">
              <el-select v-model="draft.themeMode" class="w-full">
                <el-option :label="t('settings.themeMode.dark')" value="dark" />
                <el-option :label="t('settings.themeMode.light')" value="light" />
                <el-option :label="t('settings.themeMode.system')" value="auto" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- Update -->
        <el-card class="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 shadow-sm">
          <template #header>
            <div class="font-bold flex items-center gap-2">
              <div class="i-mdi-update text-green-500" />
              {{ t('settings.update') }}
            </div>
          </template>
          <el-form label-position="top" class="max-w-lg">
            <el-form-item :label="t('settings.version')">
              <el-tag type="info" effect="plain" round>v{{ appVersion }}</el-tag>
            </el-form-item>

            <el-form-item :label="t('settings.autoUpdate')" v-if="!isPlugin">
              <el-switch v-model="draft.autoUpdate" />
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">{{ t('settings.autoUpdateHint') }}</div>
            </el-form-item>

            <div class="mt-2">
              <div class="text-sm font-medium mb-2">{{ t('settings.releases') }}</div>
              <el-button link type="primary" @click="openReleases">
                https://github.com/cuteyuchen/project-manager/releases
                <el-icon class="ml-1"><div class="i-mdi-open-in-new" /></el-icon>
              </el-button>
            </div>
          </el-form>
        </el-card>

        <!-- Data Management -->
        <el-card class="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 shadow-sm">
          <template #header>
            <div class="font-bold flex items-center gap-2">
              <div class="i-mdi-database text-amber-500" />
              {{ t('settings.data') }}
            </div>
          </template>
          <div class="flex gap-4">
            <el-button type="primary" @click="exportData">
              <el-icon class="mr-1"><div class="i-mdi-export" /></el-icon>
              {{ t('settings.export') }}
            </el-button>
            <el-button @click="importData">
              <el-icon class="mr-1"><div class="i-mdi-import" /></el-icon>
              {{ t('settings.import') }}
            </el-button>
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-2">{{ t('settings.dataHint') }}</div>
        </el-card>

        <!-- AI Commit Message Configuration -->
        <el-card class="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 shadow-sm">
          <template #header>
            <div class="font-bold flex items-center gap-2">
              <div class="i-mdi-auto-fix text-violet-500" />
              {{ t('settings.gitAi') }}
            </div>
          </template>
          <el-form label-position="top">
            <el-form-item :label="t('settings.gitAiEnabled')">
              <el-switch v-model="draft.gitAiEnabled" />
            </el-form-item>
            <template v-if="draft.gitAiEnabled">
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-6 max-w-2xl">
                <el-form-item :label="t('settings.gitAiBaseUrl')">
                  <el-input v-model="draft.gitAiBaseUrl" :placeholder="t('settings.gitAiBaseUrlPlaceholder')" clearable />
                </el-form-item>
                <el-form-item :label="t('settings.gitAiModel')">
                  <el-input v-model="draft.gitAiModel" :placeholder="t('settings.gitAiModelPlaceholder')" clearable />
                </el-form-item>
                <el-form-item :label="t('settings.gitAiApiKey')" class="lg:col-span-2">
                  <el-input v-model="draft.gitAiApiKey" type="password" show-password :placeholder="t('settings.gitAiApiKeyPlaceholder')" />
                </el-form-item>
                <el-form-item :label="t('settings.gitAiPromptTemplate')" class="lg:col-span-2">
                  <el-input v-model="draft.gitAiPromptTemplate" type="textarea" :rows="3" :placeholder="t('settings.gitAiPromptPlaceholder')" />
                </el-form-item>
                <el-form-item class="lg:col-span-2">
                  <div class="flex items-center gap-3">
                    <el-button :loading="aiTestLoading" @click="testAiConnection" type="primary" plain>
                      <el-icon class="mr-1" v-if="!aiTestLoading"><div class="i-mdi-connection" /></el-icon>
                      {{ t('settings.gitAiTestBtn') }}
                    </el-button>
                    <div v-if="aiTestResult" class="text-sm flex items-center gap-1">
                      <div v-if="aiTestResult.success" class="i-mdi-check-circle text-green-500" />
                      <div v-else class="i-mdi-close-circle text-red-500" />
                      <span :class="aiTestResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                        {{ aiTestResult.message }}
                      </span>
                    </div>
                  </div>
                </el-form-item>
              </div>
            </template>
          </el-form>
        </el-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
