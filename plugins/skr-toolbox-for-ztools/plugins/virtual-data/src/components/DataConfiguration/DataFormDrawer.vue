<template>
  <n-drawer
    v-model:show="visible"
    :width="600"
    :body-style="{ padding: '16px' }"
  >
    <n-drawer-content
      :title="isEdit ? '编辑数据配置' : '添加数据配置'"
      closable
      size="small"
    >
      <n-form
        :model="formData"
        :rules="formRules"
        ref="formRef"
        :label-width="80"
        size="small"
      >
        <n-grid
          x-gap="12"
          :cols="2"
        >
          <n-gi>
            <n-form-item
              label="数据名称"
              path="name"
            >
              <n-input
                v-model:value="formData.name"
                placeholder="请输入数据名称"
                size="small"
                @input="handleNameInput"
              />
            </n-form-item>
          </n-gi>

          <n-gi>
            <n-form-item
              label="排序"
              path="sort"
            >
              <n-input-number
                v-model:value="formData.sort"
                placeholder="请输入排序值（数字越小越靠前）"
                size="small"
                :min="1"
                style="width: 100%"
              />
            </n-form-item>
          </n-gi>
        </n-grid>

        <n-grid
          x-gap="12"
          :cols="2"
        >
          <n-gi>
            <n-form-item
              label="执行代码"
              path="code"
            >
              <n-input
                type="textarea"
                rows="6"
                v-model:value="formData.code"
                placeholder="请输入 Mock 执行代码"
                @input="handleCodeInput"
                size="small"
              />
            </n-form-item>
          </n-gi>

          <n-gi>
            <n-form-item label="预览数据">
              <n-input
                type="textarea"
                rows="6"
                v-model:value="formData.result"
                placeholder="预览数据将自动显示在这里"
                readonly
                size="small"
              />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>

      <div
        class="tip-list"
        style="margin-top: 12px"
      >
        <div
          class="tip-item"
          v-for="item in tipList"
          :key="item"
        >
          <span class="tip-icon">!</span>
          <span class="tip-text">{{ item }}</span>
        </div>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <n-space size="small">
            <n-popselect
              :options="templateOptions"
              scrollable
              size="small"
              @update:value="handleTemplateSelect"
            >
              <n-button
                size="small"
                style="margin-right: 8px"
              >
                {{ formData.selectedLabel || '选择模板代码' }}
              </n-button>
            </n-popselect>
          </n-space>

          <n-space size="small">
            <n-button
              size="small"
              @click="handleCancel"
            >
              取消
            </n-button>
            <n-button
              type="primary"
              size="small"
              @click="handleSubmit"
            >
              保存
            </n-button>
          </n-space>
        </div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue';
import Mock from 'mockjs';
import { useMessage } from 'naive-ui';
import { generateUUID } from '../../utils/index.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  editItem: {
    type: Object,
    default: null,
  },
  maxSort: {
    type: Number,
    default: 0,
  },
  dataList: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['update:show', 'success']);

const DB_PREFIX = 'virtual-data-';
const message = useMessage();
const formRef = ref(null);

const visible = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value),
});

const isEdit = computed(() => !!props.editItem);

const formData = reactive({
  name: '',
  code: '',
  result: '',
  selectedLabel: '',
  sort: 1,
});

const tipList = [
  '必须使用 mockjs 生成数据，可使用变量：Mock，例如 Mock.Random.cname()',
  '官方文档：http://mockjs.com/',
  '不会编写执行代码可以问 Ai，如：mockjs 生成xx',
  '选择下面模板按纽可自动生成代码',
];

const templateOptions = [
  { label: '生成中文姓名', value: 'Mock.Random.cname()' },
  { label: '生成5个中文姓名', value: 'Array.from({ length: 5 }, () => Mock.Random.cname())' },
  {
    label: '生成手机号',
    value:
      'Mock.Random.pick(["13","14","15","16","17","18","19"]) + Mock.Random.string("number", 9)',
  },
  { label: '生成邮箱', value: 'Mock.Random.email()' },
  { label: '生成身份证号', value: 'Mock.Random.id()' },
  { label: '生成省份', value: 'Mock.Random.province()' },
  { label: '生成城市', value: 'Mock.Random.city()' },
  { label: '生成中文地址', value: 'Mock.Random.county(true).replace(/\\s*-+$/, "")' },
  {
    label: '生成详细地址',
    value:
      'Mock.Random.county(true).replace(/\\s*-+$/, "") + Mock.Random.cword(2,4) + "路" + Mock.Random.integer(1, 300) + "号"',
  },
  { label: '生成性别', value: 'Mock.Random.pick(["男","女"])' },
  { label: '生成年龄(18-60)', value: 'Mock.Random.integer(18, 60)' },
  { label: '生成日期', value: 'Mock.Random.date()' },
  { label: '生成时间', value: 'Mock.Random.time()' },
  { label: '生成年份', value: 'Mock.Random.date("yyyy")' },
  { label: '生成小数(0-1)', value: '(Math.random() * 0.99 + 0.01).toFixed(2)' },
  { label: '生成整数(0-100)', value: 'Mock.Random.integer(0, 100)' },
  { label: '生成随机密码', value: 'Mock.Random.string(6, 12)' },
  { label: '生成IP地址', value: 'Mock.Random.ip()' },
  { label: '生成颜色', value: 'Mock.Random.hex()' },
  {
    label: '生成完整用户信息',
    value: `{
    name: Mock.Random.cname(),
    age: Mock.Random.integer(18, 60),
    phone: Mock.Random.pick(["13","14","15","16","17","18","19"]) + Mock.Random.string("number", 9),
    idCard: Mock.Random.id(),
    address: Mock.Random.county(true).replace(/\\s*-+$/, "")
  }`,
  },
];

const formRules = reactive({
  name: [
    { required: true, message: '请输入数据名称', trigger: 'blur' },
    {
      validator: (rule, value) => {
        if (!value) return true;
        const isDuplicate = props.dataList.some((item) => {
          if (props.editItem && item._id === props.editItem._id) {
            return false;
          }
          return item.name.toLowerCase() === value.toLowerCase();
        });
        if (isDuplicate) {
          return new Error('数据名称已存在，请使用其他名称');
        }
        return true;
      },
      trigger: ['input', 'blur'],
    },
  ],
  code: [{ required: true, message: '请输入执行代码', trigger: 'blur' }],
});

watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      if (props.editItem) {
        Object.assign(formData, {
          name: props.editItem.name,
          code: props.editItem.code,
          result: '',
          selectedLabel: '',
          sort: props.editItem.sort,
        });
        executeCode();
      } else {
        Object.assign(formData, {
          name: '',
          code: '',
          result: '',
          selectedLabel: '',
          sort: props.maxSort + 1,
        });
      }
    }
  }
);

function formatResult(data) {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

function handleTemplateSelect(value) {
  const target = templateOptions.find((item) => item.value === value);
  formData.code = value;
  formData.selectedLabel = target?.label || '';
  executeCode();
}

function handleCodeInput() {
  if (formData.selectedLabel) {
    formData.selectedLabel = '';
  }
  executeCode();
}

function handleNameInput() {
  formRef.value?.validate(undefined, (rule) => {
    return rule?.key === 'name';
  });
}

function executeCode() {
  try {
    const code = formData.code.trim();
    if (!code) {
      formData.result = '';
      return null;
    }
    const executeFn = new Function('Mock', `return ${code}`);
    const result = executeFn(Mock);
    formData.result = formatResult(result);
    return result;
  } catch (err) {
    formData.result = `执行失败：${err.message}`;
    return new Error(err.message);
  }
}

function handleCancel() {
  visible.value = false;
  formRef.value?.restoreValidation();
}

async function handleSubmit() {
  try {
    await formRef.value?.validate();
    const execResult = executeCode();

    if (execResult instanceof Error) {
      message.error(`代码执行失败：${execResult.message}，请修正后再保存！`);
      return;
    }

    if (!formData.code.includes('Mock.')) {
      message.error('必须使用 Mock.js 生成数据！');
      return;
    }

    const now = Date.now();

    if (isEdit.value && props.editItem) {
      const existingDoc = await ztools.db.promises.get(props.editItem._id);
      if (existingDoc) {
        const updatedDoc = {
          ...existingDoc,
          name: formData.name,
          code: formData.code,
          sort: formData.sort,
          updatedAt: now,
        };
        await ztools.db.promises.put(updatedDoc);
      }
    } else {
      const newDoc = {
        _id: DB_PREFIX + generateUUID(),
        name: formData.name,
        code: formData.code,
        sort: formData.sort,
        createdAt: now,
        updatedAt: now,
      };
      await ztools.db.promises.put(newDoc);
    }

    visible.value = false;
    formRef.value?.restoreValidation();
    emit('success');
  } catch (error) {}
}
</script>

<style scoped>
.tip-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}

.tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1px solid #999;
  border-radius: 50%;
  font-size: 11px;
  color: #888;
  margin-top: 2px;
  flex-shrink: 0;
}

.tip-text {
  color: #666;
  font-size: 13px;
  line-height: 1.4;
}

.drawer-footer {
  display: flex;
  justify-content: space-between;
  width: 100%;
}
</style>
