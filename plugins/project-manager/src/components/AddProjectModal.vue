<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { api } from '../api';
import type { Project, CustomCommand } from '../types';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { normalizeNvmVersion, findInstalledNodeVersion } from '../utils/nvm';
import { useSettingsStore } from '../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();
const props = defineProps<{ 
    modelValue: boolean,
    editProject?: Project | null
}>();
const emit = defineEmits(['update:modelValue', 'add', 'update']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const isEdit = computed(() => !!props.editProject);

const defaultEditor = computed(() => {
  const editors = settingsStore.settings.editors || [];
  if (!editors.length) return null;
  return editors.find(editor => editor.id === settingsStore.settings.defaultEditorId) || editors[0];
});

const editorPlaceholder = computed(() => defaultEditor.value
  ? `${t('project.editorDefault')} (${defaultEditor.value.name || defaultEditor.value.path})`
  : t('project.editorDefault'));

const editorHint = computed(() => defaultEditor.value
  ? `${t('project.editorHint')}：${defaultEditor.value.name || defaultEditor.value.path}`
  : t('project.editorHint'));

const form = ref<{
  id: string;
  name: string;
  path: string;
  type: 'node' | 'other';
  nodeVersion: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  scripts: string[];
  visibleScripts: string[];
  customCommands: CustomCommand[];
  editorId: string;
}>({
  id: '',
  name: '',
  path: '',
  type: 'node',
  nodeVersion: '',
  packageManager: 'npm',
  scripts: [],
  visibleScripts: [],
  customCommands: [],
  editorId: ''
});

const nodeVersions = ref<string[]>([]);
const loading = ref(false);

function resetForm() {
    form.value = {
        id: '',
        name: '',
        path: '',
        type: 'node',
        nodeVersion: nodeVersions.value[0] || '',
        packageManager: 'npm',
        scripts: [],
        visibleScripts: [],
        customCommands: [],
        editorId: ''
    };
}

watch(() => props.modelValue, (val) => {
  if (val) {
      if (props.editProject) {
          form.value = {
              ...props.editProject,
              nodeVersion: props.editProject.nodeVersion || '',
              packageManager: props.editProject.packageManager || 'npm',
              scripts: props.editProject.scripts || [],
              visibleScripts: props.editProject.visibleScripts || [...(props.editProject.scripts || [])],
              customCommands: props.editProject.customCommands
                  ? props.editProject.customCommands.map(c => ({ ...c }))
                  : [],
              editorId: props.editProject.editorId || ''
          };
      } else {
          resetForm();
      }
  }
});

onMounted(async () => {
  try {
    const list = await api.getNvmList();
    nodeVersions.value = list.map(v => v.version);
    if (nodeVersions.value.length > 0) {
      form.value.nodeVersion = nodeVersions.value[0];
    }
  } catch (e) {
    console.error('Failed to load node versions', e);
  }
});

async function selectFolder() {
  try {
    const selected = await api.openDialog({
      directory: true,
      multiple: false,
    });
    
    if (selected && typeof selected === 'string') {
      form.value.path = selected;
      // Auto scan
      try {
        loading.value = true;
        const info = await api.scanProject(selected);
        
        // Auto fill name if empty
        if (!form.value.name && info.name) {
            form.value.name = info.name;
        }
        
        // Set type based on scan result
        if (info.projectType === 'node') {
            form.value.type = 'node';
            if (info.packageManager) {
                form.value.packageManager = info.packageManager;
            }
            form.value.scripts = info.scripts;
            form.value.visibleScripts = [...info.scripts];

            const normalizedNvmVersion = normalizeNvmVersion(info.nvmVersion);
            if (normalizedNvmVersion) {
              const installed = findInstalledNodeVersion(nodeVersions.value, normalizedNvmVersion);

              if (installed) {
                form.value.nodeVersion = installed;
              } else {
                try {
                  ElMessage.info(t('project.autoInstallStart', { version: normalizedNvmVersion }));
                  await api.installNode(normalizedNvmVersion);
                  ElMessage.success(t('project.autoInstallSuccess', { version: normalizedNvmVersion }));
                  const list = await api.getNvmList();
                  nodeVersions.value = list.map(v => v.version);

                  const newInstalled = findInstalledNodeVersion(nodeVersions.value, normalizedNvmVersion);
                  if (newInstalled) {
                    form.value.nodeVersion = newInstalled;
                  }
                } catch (installErr) {
                  ElMessage.error(`${t('project.autoInstallFailed', { version: normalizedNvmVersion })}: ${String(installErr)}`);
                  console.error('Failed to auto-install node version', installErr);
                }
              }
            } else if (info.nvmVersion) {
              console.warn('Invalid .nvmrc version, skipping auto install', info.nvmVersion);
              ElMessage.warning(t('project.invalidNvmrc'));
            }
        } else {
            form.value.type = 'other';
            form.value.scripts = [];
        }
      } catch (e) {
        console.error('Failed to scan project', e);
        // Even if scan fails, still set the name from path
        if (!form.value.name) {
            form.value.name = selected.split(/[/\\]/).pop() || '';
        }
        form.value.type = 'other';
      } finally {
        loading.value = false;
      }
    }
  } catch (err) {
    console.error('Failed to open dialog:', err);
  }
}

function addCustomCommand() {
    form.value.customCommands.push({
        id: crypto.randomUUID(),
        name: '',
        command: ''
    });
}

function removeCustomCommand(index: number) {
    form.value.customCommands.splice(index, 1);
}

function toggleVisibleScript(script: string) {
  if (form.value.visibleScripts.includes(script)) {
    form.value.visibleScripts = form.value.visibleScripts.filter(item => item !== script);
    return;
  }

  form.value.visibleScripts = [...form.value.visibleScripts, script];
}

function submit() {
  if (!form.value.name || !form.value.path) return;
  
  const project: Project = {
    id: isEdit.value ? form.value.id : crypto.randomUUID(),
    name: form.value.name,
    path: form.value.path,
    type: form.value.type,
  };

  if (form.value.type === 'node') {
    project.nodeVersion = form.value.nodeVersion;
    project.packageManager = form.value.packageManager;
    project.scripts = form.value.scripts;
    project.visibleScripts = form.value.visibleScripts;
  }

  if (form.value.customCommands.length > 0) {
    project.customCommands = form.value.customCommands.filter(c => c.name && c.command);
  }

  if (form.value.editorId) {
    project.editorId = form.value.editorId;
  }
  
  if (isEdit.value) {
      emit('update', project);
  } else {
      emit('add', project);
  }
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('project.editProject') : t('dashboard.addProject')"
    width="680px"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
    class="project-modal"
  >
    <el-form label-position="top" :model="form" class="project-form">
        <el-form-item :label="t('project.name')">
            <el-input v-model="form.name" :placeholder="t('project.namePlaceholder')" />
        </el-form-item>
        
        <el-form-item :label="t('project.path')" required>
            <div class="flex gap-2 w-full">
                <el-input v-model="form.path" :placeholder="t('project.selectFolder')" readonly>
                    <template #append>
                        <el-button @click="selectFolder">
                             <el-icon><div class="i-mdi-folder" /></el-icon>
                        </el-button>
                    </template>
                </el-input>
            </div>
        </el-form-item>

        <el-form-item :label="t('project.type')">
            <el-select v-model="form.type" class="w-full">
                <el-option label="Node" value="node" />
                <el-option :label="t('project.typeOther')" value="other" />
            </el-select>
        </el-form-item>

        <template v-if="form.type === 'node'">
            <div class="grid gap-4 md:grid-cols-2">
                <div class="min-w-0">
                    <el-form-item :label="t('project.nodeVersion')">
                        <el-select v-model="form.nodeVersion">
                            <el-option :label="t('nodes.select')" value="" />
                            <el-option v-for="v in nodeVersions" :key="v" :label="v" :value="v" />
                        </el-select>
                    </el-form-item>
                </div>
                <div class="min-w-0">
                    <el-form-item :label="t('project.packageManager')">
                        <el-select v-model="form.packageManager">
                            <el-option label="npm" value="npm" />
                            <el-option label="yarn" value="yarn" />
                            <el-option label="pnpm" value="pnpm" />
                            <el-option label="cnpm" value="cnpm" />
                        </el-select>
                    </el-form-item>
                </div>
            </div>

            <!-- Scripts visibility selection -->
            <el-form-item v-if="form.scripts.length > 0" :label="t('project.scripts')">
                <div class="w-full rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-900/40 p-3">
                    <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">{{ t('project.scriptsVisibilityHint') }}</p>
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <button
                            v-for="script in form.scripts"
                            :key="script"
                            type="button"
                            @click="toggleVisibleScript(script)"
                            class="script-toggle"
                            :class="form.visibleScripts.includes(script)
                                ? 'script-toggle-active'
                                : 'script-toggle-inactive'"
                        >
                            <span class="truncate font-mono text-[12px]">{{ script }}</span>
                            <div
                                class="text-sm transition-transform duration-200"
                                :class="form.visibleScripts.includes(script)
                                    ? 'i-mdi-checkbox-marked-circle text-blue-500 scale-100'
                                    : 'i-mdi-checkbox-blank-circle-outline text-slate-300 dark:text-slate-500 scale-90'"
                            />
                        </button>
                    </div>
                </div>
            </el-form-item>
        </template>

        <!-- Custom Commands (available for all project types) -->
        <el-form-item :label="t('project.customCommands')">
            <div class="w-full space-y-3">
                <div
                    v-for="(cmd, index) in form.customCommands"
                    :key="cmd.id"
                    class="rounded-xl border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900/30 p-3"
                >
                    <div class="flex items-start gap-3 min-w-0">
                        <div class="grid min-w-0 flex-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                            <el-input v-model="cmd.name" :placeholder="t('project.commandName')" />
                            <el-input v-model="cmd.command" :placeholder="t('project.commandContent')" />
                        </div>
                        <el-button type="danger" text @click="removeCustomCommand(index)" class="!mt-1">
                            <el-icon><div class="i-mdi-close" /></el-icon>
                        </el-button>
                    </div>
                </div>
                <el-button type="primary" text @click="addCustomCommand">
                    <el-icon class="mr-1"><div class="i-mdi-plus" /></el-icon>
                    {{ t('project.addCommand') }}
                </el-button>
            </div>
        </el-form-item>

        <!-- Editor Selection -->
        <el-form-item v-if="settingsStore.settings.editors && settingsStore.settings.editors.length > 1" :label="t('project.editor')">
            <el-select v-model="form.editorId" class="w-full" clearable :placeholder="editorPlaceholder">
                <el-option v-for="editor in settingsStore.settings.editors" :key="editor.id" :label="editor.name || editor.path" :value="editor.id" />
            </el-select>
            <div class="text-xs text-slate-400 mt-1">{{ editorHint }}</div>
        </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submit" :disabled="!form.name || !form.path" :loading="loading">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.project-form {
  min-height: 0;
}

.script-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-radius: 0.85rem;
  border-width: 1px;
  padding: 0.7rem 0.8rem;
  text-align: left;
  transition: all 0.2s ease;
}

.script-toggle-active {
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.1);
  color: rgb(37, 99, 235);
}

.script-toggle-inactive {
  border-color: rgba(148, 163, 184, 0.25);
  background: rgba(255, 255, 255, 0.85);
  color: rgb(71, 85, 105);
}

.dark .script-toggle-inactive {
  background: rgba(15, 23, 42, 0.72);
  color: rgb(203, 213, 225);
}

.script-toggle:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.project-modal {
  display: flex;
  width: min(680px, calc(100vw - 32px));
  max-height: 90vh;
  flex-direction: column;
  overflow: hidden;
}

:deep(.project-modal .el-dialog__body) {
  flex: 1;
  min-height: 0;
  max-height: calc(90vh - 120px);
  overflow-y: auto;
  padding-top: 12px;
}

:deep(.project-modal .el-dialog__footer) {
  flex-shrink: 0;
  padding-top: 12px;
}
</style>
