<template>
  <div class="hello">
    <div class="input-box">
      <n-input
        ref="inputRef"
        v-model:value="inputValue"
        placeholder="输入翻译内容"
        size="large"
        @keyup.enter="config?.translateMode === 'click' && handleClick()"
        clearable
      >
        <template #suffix>
          <n-button
            v-if="config?.translateMode === 'click'"
            text
            type="primary"
            :loading="loading"
            @click="handleClick"
          >
            翻译
          </n-button>
        </template>
      </n-input>
      <n-button
        quaternary
        circle
        class="setting-btn"
        @click="showDrawer = true"
      >
        <template #icon>
          <n-icon :component="SettingOutlined" />
        </template>
      </n-button>
    </div>

    <div
      v-if="showResult"
      class="result-list"
    >
      <div
        v-for="item in resultList"
        :key="item.label"
        class="result-item"
        @click="handleCopy(item.value)"
      >
        <span class="label">{{ item.label }}</span>
        <span class="value">{{ item.value }}</span>
      </div>
    </div>

    <SettingDrawer v-model="showDrawer" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue';
import md5 from 'md5';
import { SettingOutlined } from '@vicons/antd';
import { copyContent } from '@/utils/copy-content';
import { getConfig, hasValidConfig } from '@/utils/config';
import SettingDrawer from '@/components/SettingDrawer.vue';

const props = defineProps({
  enterAction: {
    type: Object,
    required: true,
  },
  onEnter: {
    type: Function,
    required: false,
  },
});

const message = useMessage();

const inputRef = ref(null);
const inputValue = ref('');
const loading = ref(false);
const showResult = ref(false);
const showDrawer = ref(false);
const resultList = ref([]);
const config = ref(null);
let debounceTimer = null;

function loadConfig() {
  config.value = getConfig();
}

function focusInput() {
  nextTick(() => {
    inputRef.value?.focus?.();
  });
}

onMounted(() => {
  loadConfig();
  focusInput();
  if (!hasValidConfig()) {
    showDrawer.value = true;
  }

  if (props.onEnter) {
    props.onEnter.value = focusInput;
  }
});

watch(showDrawer, (val) => {
  if (!val) {
    loadConfig();
    focusInput();
  }
});

watch(inputValue, (val) => {
  if (!val.trim()) {
    resultList.value = [];
    showResult.value = false;
    return;
  }
  if (config.value?.translateMode === 'realtime') {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      handleClick();
    }, config.value.delayTime);
  }
});

function cleanString(str) {
  return str
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateFormats(str) {
  const cleaned = cleanString(str);
  return [
    { label: '小驼峰', value: toCamelCase(cleaned) },
    { label: '大驼峰', value: toPascalCase(cleaned) },
    { label: '横线', value: toKebabCase(cleaned) },
    { label: '下划线', value: toSnakeCase(cleaned) },
    { label: '常量', value: toUpperSnakeCase(cleaned) },
    { label: '句子', value: toSentenceCase(cleaned) },
    { label: '全小写', value: toFlatCase(cleaned) },
    { label: '全大写', value: toUpperCaseFlat(cleaned) },
    { label: '点分隔', value: toDotCase(cleaned) },
    { label: '路径分隔', value: toPathCase(cleaned) },
  ];
}

function toCamelCase(str) {
  const s = str.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/\s+/g, '');
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function toPascalCase(str) {
  return str.replace(/(^|\s)(.)/g, (_, a, c) => c.toUpperCase()).replace(/\s+/g, '');
}

function toSnakeCase(str) {
  return str.toLowerCase().replace(/\s+/g, '_');
}

function toUpperSnakeCase(str) {
  return str.toUpperCase().replace(/\s+/g, '_');
}

function toKebabCase(str) {
  return str.toLowerCase().replace(/\s+/g, '-');
}

function toSentenceCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function toFlatCase(str) {
  return str.toLowerCase().replace(/\s+/g, '');
}

function toUpperCaseFlat(str) {
  return str.toUpperCase().replace(/\s+/g, '');
}

function toDotCase(str) {
  return str.toLowerCase().replace(/\s+/g, '.');
}

function toPathCase(str) {
  return str.toLowerCase().replace(/\s+/g, '/');
}

const handleClick = async () => {
  if (!inputValue.value.trim()) {
    return;
  }

  const currentConfig = getConfig();
  if (!currentConfig || !currentConfig.appId || !currentConfig.appKey) {
    message.warning('请先配置翻译服务');
    showDrawer.value = true;
    return;
  }

  loading.value = true;

  const salt = String(Date.now());
  const sign = md5(`${currentConfig.appId}${inputValue.value}${salt}${currentConfig.appKey}`);

  const formData = new URLSearchParams({
    q: inputValue.value,
    from: 'auto',
    to: 'en',
    appid: currentConfig.appId,
    salt,
    sign,
  });

  try {
    const res = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
    });
    const json = await res.json();

    const authErrorCodes = ['52001', '52003', '54000', '54001', '54003', '58000', '58002'];
    if (authErrorCodes.includes(json.error_code)) {
      showDrawer.value = true;
      return;
    }

    if (json.error_code) {
      return;
    }

    resultList.value = generateFormats(json.trans_result[0].dst);
    showResult.value = true;
  } catch (err) {
    message.error('翻译失败');
    console.error('请求失败', err);
  } finally {
    loading.value = false;
  }
};

const handleCopy = (value) => {
  const currentConfig = config.value;

  if (currentConfig?.copyOnSelect) {
    copyContent(value);
    message.success('已复制');
  }

  if (currentConfig?.closeOnSelect) {
    setTimeout(() => {
      nextTick(() => {
        window.ztools.outPlugin(true);
        window.ztools.hideMainWindow();
      });
    }, 1);
  }
};
</script>

<style scoped>
.hello {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.input-box {
  padding: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-box :deep(.n-input) {
  flex: 1;
}

.setting-btn {
  flex-shrink: 0;
}

.result-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
}

.result-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 4px;
}

.result-item:hover {
  background: #d7eaff;
}

.result-item:active {
  background: #e0efff;
}

.result-item .label {
  width: 60px;
  font-size: 12px;
  color: #999;
  white-space: nowrap;
  width: 60px;
}

.result-item .value {
  flex: 1;
  font-size: 13px;
  color: #333;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  width: calc(100% - 60px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-color-scheme: dark) {
  .result-item:hover {
    background: #1a3a5c;
  }

  .result-item:active {
    background: #0d2840;
  }

  .result-item .label {
    color: #888;
  }

  .result-item .value {
    color: #e0e0e0;
  }
}
</style>
