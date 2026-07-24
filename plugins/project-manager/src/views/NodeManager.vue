<script setup lang="ts">
import { ref } from 'vue';
import { useNodeStore } from '../stores/node';
import AddNodeModal from '../components/AddNodeModal.vue';
import InstallNodeModal from '../components/InstallNodeModal.vue';
import SetDefaultNodeModal from '../components/SetDefaultNodeModal.vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import type { NodeVersion } from '../types';

const { t } = useI18n();
const nodeStore = useNodeStore();
const showAddModal = ref(false);
const showInstallModal = ref(false);
const showSetDefaultModal = ref(false);
const target = import.meta.env.VITE_TARGET;
const isPlugin = target === 'utools' || target === 'ztools';

function openFolder(path: string) {
    api.openFolder(path).catch(err => {
        ElMessage.error(t('common.error') + ': ' + err);
    });
}

function refresh() {
    nodeStore.loadNvmNodes();
    ElMessage.success(t('common.success'));
}

async function handleSetDefault(row: NodeVersion) {
    try {
        await nodeStore.setDefaultNode(row);
        ElMessage.success(t('common.success'));
    } catch (error: any) {
        ElMessage.error(error?.message || t('common.error'));
    }
}

function handleRemove(path: string, source: string, version?: string) {
    if (source === 'nvm' && version) {
        ElMessageBox.confirm(
            t('nodes.uninstallConfirm', { version }),
            t('common.warning'),
            {
                confirmButtonText: t('common.confirm'),
                cancelButtonText: t('common.cancel'),
                type: 'warning',
            }
        ).then(async () => {
            try {
                await nodeStore.uninstallNode(version);
                ElMessage.success(t('common.success'));
            } catch (e: any) {
                ElMessage.error(e.message || t('common.error'));
            }
        });
        return;
    }

    ElMessageBox.confirm(
        t('common.deleteConfirm'),
        t('common.warning'),
        {
            confirmButtonText: t('common.confirm'),
            cancelButtonText: t('common.cancel'),
            type: 'warning',
        }
    ).then(() => {
        nodeStore.removeNode(path);
        ElMessage.success(t('common.success'));
    });
}
</script>

<template>
    <div class="p-6 h-full flex flex-col">
        <div class="flex justify-between items-center mb-6">
            <div>
            <h1
                :class="isPlugin 
                    ? 'text-2xl font-bold text-purple-500 mb-1' 
                    : 'text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 mb-1'">
                {{ t('nodes.title') }}</h1>
                <p class="text-slate-400 dark:text-slate-500 text-xs">Manage Node.js environments</p>
            </div>
            <div class="grid grid-cols-2 gap-2 w-fit">
                <el-button type="primary" @click="showInstallModal = true" class="!rounded-lg !ml-0" size="small">
                    <el-icon class="mr-1">
                        <div class="i-mdi-download" />
                    </el-icon> {{ t('nodes.installNode') }}
                </el-button>
                <el-button type="success" @click="showAddModal = true" class="!rounded-lg !ml-0" size="small">
                    <el-icon class="mr-1">
                        <div class="i-mdi-plus" />
                    </el-icon> {{ t('nodes.addNode') }}
                </el-button>
                <el-button type="warning" @click="showSetDefaultModal = true" class="!rounded-lg !ml-0" size="small">
                    <el-icon class="mr-1">
                        <div class="i-mdi-cog" />
                    </el-icon> {{ t('nodes.setSystemPath') }}
                </el-button>
                <el-button type="info" @click="refresh" class="!rounded-lg !ml-0" size="small">
                    <el-icon class="mr-1">
                        <div class="i-mdi-refresh" />
                    </el-icon> Refresh NVM
                </el-button>
            </div>
        </div>

        <div
            class="flex-1 bg-white dark:bg-[#1e293b] rounded-lg border border-slate-200 dark:border-slate-700/30 overflow-hidden shadow-sm transition-colors duration-200 min-h-0">
            <el-table :data="nodeStore.versions" style="width: 100%" height="100%"
                :row-style="{ background: 'transparent' }" class="custom-table">
                <el-table-column prop="version" :label="t('nodes.version')">
                    <template #default="{ row }">
                        <span class="font-semibold text-sm font-mono text-slate-800 dark:text-slate-200">{{ row.version
                        }}</span>
                    </template>
                </el-table-column>
                <el-table-column prop="source" :label="t('nodes.source')">
                    <template #default="{ row }">
                        <div class="flex items-center gap-2">
                            <el-tag v-if="row.source === 'system'" type="info" effect="light"
                                class="!border-slate-300 dark:!bg-slate-700/50 dark:!border-slate-600 dark:text-white">System</el-tag>
                            <el-tag v-else-if="row.source === 'nvm'" effect="light"
                                class="!text-purple-600 !border-purple-300 dark:!bg-purple-500/20 dark:!text-purple-300 dark:!border-purple-500/30">NVM</el-tag>
                            <el-tag v-else effect="light"
                                class="!text-amber-600 !border-amber-300 dark:!bg-amber-500/20 dark:!text-amber-300 dark:!border-amber-500/30">Custom</el-tag>
                            <el-tag v-if="row.source === 'system'" type="success" effect="light">{{ t('nodes.current') }}</el-tag>
                        </div>
                    </template>
                </el-table-column>
                <el-table-column prop="path" :label="t('nodes.path')" show-overflow-tooltip>
                    <template #default="{ row }">
                        <div class="flex items-center gap-2 group cursor-pointer" @click="openFolder(row.path)">
                            <span
                                class="text-slate-500 dark:text-slate-400 font-mono text-xs group-hover:text-blue-500 transition-colors">{{
                                    row.path }}</span>
                            <div
                                class="i-mdi-folder-open-outline text-xs opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                        </div>
                    </template>
                </el-table-column>
                <el-table-column :label="t('nodes.action')" width="220" align="center">
                    <template #default="{ row }">
                        <div class="flex items-center justify-center gap-2">
                            <el-button v-if="row.source !== 'system'" type="primary" size="small"
                                plain @click="handleSetDefault(row)" class="!rounded-md">{{ t('nodes.setDefault') }}</el-button>
                            <el-button v-if="row.source === 'custom' || row.source === 'nvm'" type="danger" size="small"
                                plain @click="handleRemove(row.path, row.source, row.version)" class="!rounded-md">{{
                                    row.source === 'nvm' ? t('nodes.uninstall') : t('common.delete') }}</el-button>
                        </div>
                    </template>
                </el-table-column>
            </el-table>
        </div>

        <AddNodeModal v-model="showAddModal" />
        <InstallNodeModal v-model="showInstallModal" />
        <SetDefaultNodeModal v-model="showSetDefaultModal" />
    </div>
</template>

<style scoped>
:deep(.el-table) {
    --el-table-border-color: #e2e8f0;
    --el-table-header-bg-color: transparent;
    --el-table-header-text-color: #475569;
    --el-table-bg-color: transparent;
    --el-table-tr-bg-color: transparent;
}

:deep(.el-table th.el-table__cell) {
    background-color: transparent !important;
}

:global(html.dark) :deep(.el-table th.el-table__cell) {
    background-color: transparent !important;
}

:global(html.dark) :deep(.el-table) {
    --el-table-border-color: #334155;
    --el-table-header-bg-color: transparent;
    --el-table-header-text-color: #94a3b8;
}

:deep(.el-table__inner-wrapper::before) {
    background-color: var(--el-table-border-color) !important;
}

:deep(.el-table__border-left-patch) {
    background-color: var(--el-table-border-color) !important;
}

/* Row hover effect */
:deep(.el-table__body tr:hover > td) {
    background-color: rgba(241, 245, 249, 0.5) !important;
}

:global(html.dark) :deep(.el-table__body tr:hover > td) {
    background-color: rgba(30, 41, 59, 0.5) !important;
}
</style>
