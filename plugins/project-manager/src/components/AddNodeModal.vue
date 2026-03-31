<script setup lang="ts">
import { ref, computed } from 'vue';
import { useNodeStore } from '../stores/node';
import { api } from '../api';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(['update:modelValue']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const nodeStore = useNodeStore();

const form = ref({
  version: '',
  path: ''
});

async function selectFolder() {
  const selected = await api.openDialog({
    directory: true,
    multiple: false,
  });
  
  if (selected && typeof selected === 'string') {
    form.value.path = selected;
    // Try to guess version from path
    const match = selected.match(/v(\d+\.\d+\.\d+)/);
    if (match) {
        form.value.version = 'v' + match[1];
    }
  }
}

function submit() {
  if (!form.value.version || !form.value.path) return;
  
  nodeStore.addCustomNode({
    version: form.value.version,
    path: form.value.path,
    source: 'custom'
  });
  
  visible.value = false;
  // Reset form
  form.value = { version: '', path: '' };
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('nodes.addNode')"
    width="500px"
    destroy-on-close
  >
    <el-form label-position="top">
        <el-form-item :label="t('nodes.path')" required>
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

        <el-form-item :label="t('nodes.version')" required>
            <el-input v-model="form.version" :placeholder="t('common.inputPlaceholder')" />
        </el-form-item>
    </el-form>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="submit" :disabled="!form.version || !form.path">
          {{ t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>
