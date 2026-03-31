<script setup lang="ts">
import { ref, computed } from 'vue';
import { useNodeStore } from '../stores/node';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const { t } = useI18n();
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const nodeStore = useNodeStore();
const versions = computed(() => nodeStore.versions.filter(v => v.source === 'nvm'));
const selectedVersion = ref('');
const loading = ref(false);

function selectVersion(v: string) {
    selectedVersion.value = v;
}

async function submit() {
  if (!selectedVersion.value) return;
  
  try {
    loading.value = true;
    // Use nvm use
    await api.useNode(selectedVersion.value);
    
    // After switching, we should update system node path detection
    // Wait a bit for nvm to switch symlink
    setTimeout(async () => {
        const savedPath = localStorage.getItem('system_node_path');
        // If we are using "System Default" (which means auto-detect), we should force re-detect
        if (!savedPath || savedPath === 'System Default') {
             const realPath = await api.getSystemNodePath();
             if (realPath !== 'System Default') {
                 // Update store directly to reflect change immediately
                 const idx = nodeStore.versions.findIndex(v => v.source === 'system');
                 if (idx !== -1) {
                     nodeStore.versions[idx].path = realPath;
                     nodeStore.versions[idx].version = selectedVersion.value;
                 }
             }
        }
        ElMessage.success(t('common.success'));
        visible.value = false;
        loading.value = false;
        
        // Refresh entire list
        nodeStore.loadNvmNodes();
    }, 1000);
    
  } catch (e: any) {
    ElMessage.error(e.message || t('common.error'));
    loading.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('nodes.setSystemPath')" 
    width="500px"
    destroy-on-close
    class="rounded-xl"
  >
    <div class="mb-4">
        <p class="text-sm text-slate-500 mb-2">Select a version from NVM to set as system default:</p>
        <div class="max-h-[300px] overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md">
            <div 
                v-for="v in versions" 
                :key="v.version"
                @click="selectVersion(v.version)"
                class="p-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 flex justify-between items-center transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0"
                :class="{'bg-blue-50 dark:bg-blue-900/30': selectedVersion === v.version}"
            >
                <span class="font-mono font-bold text-slate-700 dark:text-slate-300">{{ v.version }}</span>
                <div v-if="selectedVersion === v.version" class="i-mdi-check text-blue-500 text-lg" />
            </div>
            <div v-if="versions.length === 0" class="p-8 text-center text-slate-400">
                {{ t('nodes.noNodes') }}
            </div>
        </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submit" :loading="loading" :disabled="!selectedVersion">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
