<template>
  <div class="use">
    <div class="action-bar">
      <n-space size="small">
        <n-input
          v-model:value="searchContent.name"
          type="text"
          placeholder="请输入数据名称"
          size="small"
          clearable
        />
        <n-input
          v-model:value="searchContent.code"
          type="text"
          placeholder="请输入执行代码"
          size="small"
          clearable
        />
        <n-radio-group
          :value="settings?.displayShape || '1'"
          @update:value="handleDisplayShapeChange"
          size="small"
        >
          <n-radio-button
            value="1"
            label="卡片"
          />
          <n-radio-button
            value="2"
            label="列表"
          />
        </n-radio-group>
      </n-space>
    </div>

    <div class="content-container">
      <n-empty
        v-if="filteredDataList.length === 0"
        description="暂无数据"
        style="margin-top: 100px"
      >
        <template #extra>
          <n-button
            size="small"
            @click="goToConfiguration"
          >
            去添加数据
          </n-button>
        </template>
      </n-empty>

      <div
        v-else
        class="data-display"
      >
        <n-list
          v-if="settings?.displayShape === '1'"
          :style="{ maxHeight: 'calc(100vh - 100px)' }"
        >
          <n-list-item>
            <n-space
              wrap
              :size="[8, 8]"
            >
              <n-button
                v-for="item in filteredDataList"
                :key="item._id"
                size="small"
                @click="handleButtonClick(item)"
              >
                {{ item.name }}
              </n-button>
            </n-space>
          </n-list-item>
        </n-list>

        <n-list
          v-else
          hoverable
          clickable
          :style="{ maxHeight: 'calc(100vh - 100px)' }"
        >
          <n-list-item
            v-for="item in filteredDataList"
            :key="item._id"
            @click="handleListClick(item)"
          >
            <div class="list-item-content">
              <div class="item-name">{{ item.name }}</div>
              <div class="item-value">{{ getPreviewValue(item) }}</div>
            </div>
          </n-list-item>
        </n-list>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject, nextTick } from 'vue';
import { useMessage } from 'naive-ui';
import Mock from 'mockjs';
import { copyContent } from '../utils/copy-content.js';

const DB_PREFIX = 'virtual-data-';
const message = useMessage();
const activeTab = inject('activeTab');
const openAddDrawer = inject('openAddDrawer');
const settings = inject('settings');

const searchContent = reactive({
  name: '',
  code: '',
});

const dataList = ref([]);
const previewCache = ref(new Map());

const filteredDataList = computed(() => {
  let result = dataList.value;

  if (searchContent.name) {
    result = result.filter((item) =>
      item.name.toLowerCase().includes(searchContent.name.toLowerCase())
    );
  }

  if (searchContent.code) {
    result = result.filter((item) =>
      item.code.toLowerCase().includes(searchContent.code.toLowerCase())
    );
  }
  return result;
});

async function loadDataList() {
  try {
    const docs = await ztools.db.promises.allDocs(DB_PREFIX);
    dataList.value = (docs || [])
      .filter((doc) => doc._id !== 'virtual-data-settings-main')
      .sort((a, b) => a.sort - b.sort);

    // 清除缓存，确保数据更新后重新生成预览值
    previewCache.value.clear();
  } catch (error) {
    console.error('加载数据失败:', error);
    message.error('加载数据失败');
  }
}

function executeCode(code) {
  try {
    const executeFn = new Function('Mock', `return ${code}`);
    const result = executeFn(Mock);
    return result;
  } catch (err) {
    console.error('执行代码失败:', err);
    message.error(`执行失败：${err.message}`);
    return null;
  }
}

function formatResult(data) {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

function getPreviewValue(item) {
  const cacheKey = item._id;

  if (previewCache.value.has(cacheKey)) {
    return previewCache.value.get(cacheKey);
  }

  const result = executeCode(item.code);
  const previewValue = result === null ? '执行失败' : formatResult(result);

  previewCache.value.set(cacheKey, previewValue);
  return previewValue;
}

async function handleButtonClick(item) {
  if (!settings?.clickToCopy) {
    return;
  }

  const result = executeCode(item.code);
  if (result !== null) {
    const formattedResult = formatResult(result);
    try {
      await copyContent(formattedResult);

      if (settings?.showCopyTip) {
        message.success('已复制到剪贴板');
      }

      if (settings?.closeAfterCopy) {
        setTimeout(() => {
          nextTick(() => {
            window.ztools.outPlugin(true);
            window.ztools.hideMainWindow();
          });
        }, 1);
      }
    } catch (error) {
      console.error('复制失败:', error);
      if (settings?.showCopyTip) {
        message.error('复制失败');
      }
    }
  }
}

function handleListClick(item) {
  handleButtonClick(item);
}

function goToConfiguration() {
  if (openAddDrawer) {
    openAddDrawer();
  }
}

const SETTINGS_ID = 'settings-main';

async function handleDisplayShapeChange(val) {
  if (settings) {
    settings.displayShape = val;
    try {
      const existingDoc = await ztools.db.promises.get(SETTINGS_ID);
      const settingsData = {
        _id: SETTINGS_ID,
        ...settings,
        updatedAt: Date.now(),
      };
      if (existingDoc) {
        await ztools.db.promises.put({
          ...settingsData,
          _rev: existingDoc._rev,
        });
      } else {
        await ztools.db.promises.put(settingsData);
      }
    } catch (error) {
      console.error('保存显示方式失败:', error);
    }
  }
}

onMounted(() => {
  loadDataList();
});
</script>

<style scoped>
.use {
  height: 100%;
  background: #fff;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  padding: 12px;
  height: calc(100vh - 63px);
}

.action-bar {
  padding: 0;
}

.content-container {
  margin-top: 12px;
  padding: 0;
}

.data-display {
  overflow: hidden;
}

:deep(.n-list) {
  overflow-y: auto !important;
  padding: 0 !important;
}

:deep(.n-list-item) {
  padding: 6px 12px !important;
  border: none !important;
  transition: background-color 0.2s !important;
}

.list-item-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-name {
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.item-value {
  font-size: 12px;
  color: #666;
  word-break: break-all;
  line-height: 1.4;
  max-height: 40px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
