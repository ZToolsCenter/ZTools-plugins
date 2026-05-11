<script setup>
import { ref, watchEffect, watch } from 'vue';
import { NModal, NForm, NFormItem, NInput, NInputNumber, NButton, NSpace } from 'naive-ui';

const props = defineProps({
  show: { type: Boolean, default: false },
  editItem: { type: Object, default: null },
  maxOrder: { type: Number, default: 0 },
  existingNames: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:show', 'save']);

const formData = ref({ name: '', description: '', order: 1 });
const formRef = ref(null);

watchEffect(() => {
  if (props.editItem) {
    Object.assign(formData.value, {
      name: props.editItem.name,
      description: props.editItem.description,
      order: props.editItem.order,
    });
  }
});

watch(
  () => props.show,
  (val) => {
    if (val && !props.editItem) {
      Object.assign(formData.value, { name: '', description: '', order: props.maxOrder + 1 });
      formRef.value?.restoreValidation();
    }
  }
);

const rules = {
  name: [
    { required: true, message: '请输入数据类型名称', trigger: ['input', 'blur'] },
    {
      validator: (_rule, value) =>
        !value?.trim() ||
        !props.existingNames.some(
          (item) =>
            item.name.toLowerCase() === value.toLowerCase().trim() &&
            item._id !== props.editItem?._id
        ),
      message: '数据类型名称已存在',
      trigger: ['input', 'blur'],
    },
  ],
};

const cancel = () => emit('update:show', false);

const save = async () => {
  try {
    await formRef.value?.validate();
    emit('save', formData.value);
    emit('update:show', false);
  } catch {}
};
</script>

<template>
  <NModal
    :show="show"
    @update:show="(val) => emit('update:show', val)"
    :title="editItem ? '编辑数据类型' : '新增数据类型'"
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
      <NFormItem
        label="数据类型名称"
        path="name"
        ><NInput
          v-model:value="formData.name"
          placeholder="请输入数据类型名称"
          maxlength="20"
          show-count
      /></NFormItem>
      <NFormItem
        label="数据类型描述"
        path="description"
        ><NInput
          v-model:value="formData.description"
          placeholder="请输入数据类型描述"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
      /></NFormItem>
      <NFormItem
        label="排序"
        path="order"
        ><NInputNumber
          v-model:value="formData.order"
          :min="1"
          style="width: 100%"
      /></NFormItem>
    </NForm>
    <template #footer
      ><NSpace justify="end"
        ><NButton
          size="small"
          @click="cancel"
          >取消</NButton
        ><NButton
          size="small"
          type="primary"
          @click="save"
          >{{ editItem ? '保存' : '添加' }}</NButton
        ></NSpace
      ></template
    >
  </NModal>
</template>

<style scoped>
.form-scroll-area {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
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

.form-scroll-area::-webkit-scrollbar-thumb:hover {
  background-color: #909399;
}
</style>
