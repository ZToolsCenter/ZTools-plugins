<script setup>
import { ref, watch } from 'vue';
import { NForm, NFormItem, NInput, NInputNumber, NSelect, NGrid, NGi } from 'naive-ui';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  editItem: {
    type: Object,
    default: null,
  },
  projectId: {
    type: String,
    default: null,
  },
  existingNames: {
    type: Array,
    default: () => [],
  },
  dataTypeOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['update:show', 'save']);

const formRef = ref(null);
const formData = ref({
  name: '',
  value: '',
  dataTypeId: null,
  description: '',
});

const rules = {
  name: [
    { required: true, message: '请输入名称', trigger: ['input', 'blur'] },
    { max: 100, message: '名称不能超过100个字符', trigger: 'blur' },
    {
      validator: (_rule, value) => {
        if (!value?.trim()) return true;
        const duplicate = props.existingNames.some(
          (item) =>
            item.name === value.trim() && item._id !== props.editItem?._id
        );
        if (duplicate) return new Error('该名称在此项目下已存在');
        return true;
      },
      trigger: ['input', 'blur'],
    },
  ],
  value: [
    { required: true, message: '请输入值', trigger: ['input', 'blur'] },
  ],
  dataTypeId: [
    { required: true, message: '请选择数据类型', trigger: ['change', 'blur'] },
  ],
};

watch(
  () => props.editItem,
  (val) => {
    if (val) {
      Object.assign(formData.value, {
        name: val.name || '',
        value: val.value || '',
        dataTypeId: val.dataTypeId || null,
        description: val.description || '',
      });
    }
  }
);

watch(
  () => props.show,
  (val) => {
    if (val && !props.editItem) {
      Object.assign(formData.value, { name: '', value: '', dataTypeId: null, description: '' });
      formRef.value?.restoreValidation();
    }
  }
);

const cancel = () => emit('update:show', false);

const save = async () => {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  emit('save', formData.value);
  emit('update:show', false);
};
</script>

<template>
  <NModal
    :show="show"
    @update:show="(val) => emit('update:show', val)"
    :title="editItem ? '编辑数据' : '新增数据'"
    preset="card"
    style="width: 60vw"
  >
    <NForm
      ref="formRef"
      :model="formData"
      :rules="rules"
      size="small"
      class="form-scroll-area"
    >
      <NGrid
        :cols="24"
        :x-gap="16"
      >
        <NGi :span="24">
          <NFormItem
            label="名称"
            path="name"
          >
            <NInput
              v-model:value="formData.name"
              placeholder="请输入名称"
              maxlength="100"
              show-count
            />
          </NFormItem>
        </NGi>
        <NGi :span="24">
          <NFormItem
            label="值"
            path="value"
          >
            <NInput
              v-model:value="formData.value"
              placeholder="请输入值"
            />
          </NFormItem>
        </NGi>
        <NGi :span="24">
          <NFormItem
            label="数据类型"
            path="dataTypeId"
          >
            <NSelect
              v-model:value="formData.dataTypeId"
              :options="dataTypeOptions"
              placeholder="请选择类型"
              filterable
            />
          </NFormItem>
        </NGi>
        <NGi :span="24">
          <NFormItem
            label="描述"
            path="description"
          >
            <NInput
              v-model:value="formData.description"
              placeholder="请输入描述"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 5 }"
            />
          </NFormItem>
        </NGi>
      </NGrid>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton
          size="small"
          @click="cancel"
          >取消</NButton
        >
        <NButton
          size="small"
          type="primary"
          @click="save"
          >{{ editItem ? '保存' : '添加' }}</NButton
        >
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.form-scroll-area {
  max-height: 60vh;
  overflow-y: auto;
}

.form-scroll-area::-webkit-scrollbar {
  width: 6px;
}

.form-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}

.form-scroll-area::-webkit-scrollbar-thumb {
  background-color: #c0c4cc;
  border-radius: 3px;
}
</style>
