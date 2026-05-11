<template>
  <div class="compress-list">
    <div class="compress-list__list">
      <compress-item v-for="(it, idx) in modelValue.images" :data="it" :key="idx" @cancel="handleCancel(idx)" @refresh="handleRefresh(idx)" />
    </div>
    <div class="compress-list__total">
      <p class="compress-list__total__progress">
        <span>完成 {{ (total.progress * 100).toFixed(2) }}%</span>
        <span>成功 {{ total.success }}</span>
        <span>失败 {{ total.error }}</span>
      </p>
      <p>
        <span>共减少</span>
        <span class="blue">{{ bytes(total.reduce) }}</span>
        <span class="green">{{ (total.ratio * 100).toFixed(2) }}%</span>
      </p>
      <el-button type="primary" @click="handleReplaceAll" :disabled="!total.complate">覆盖原图</el-button>
      <el-button type="primary" @click="handleCopyAll" :disabled="!total.complate">复制所有</el-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compress-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &__list {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 10px;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__total {
    position: relative;
    height: 50px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    color: var(--el-text-color-primary);
    &:before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: v-bind(progress);
      height: 5px;
      border-radius: 2px;
      background: #90caf9;
      transition: width 0.5s;
    }

    &__progress {
      flex: 1;
    }

    p {
      span {
        padding: 0 8px;

        &.blue {
          color: var(--el-color-primary);
        }

        &.green {
          color: var(--el-color-success);
        }
      }
    }
  }
}
</style>

<script lang="ts" setup>
import axios, { AxiosError, CancelTokenSource } from 'axios';
import { computed, nextTick, onMounted, PropType } from 'vue';
import { Action, ElButton, ElMessage, ElMessageBox } from 'element-plus';

import compressItem from './compress-item.vue';
import { bytes, Queue, random } from '../utils';

const props = defineProps({
  modelValue: { type: Object as PropType<TinypngConfig.List>, required: true }
});
const emit = defineEmits(['update:modelValue']);

const cancelTokens: CancelTokenSource[] = [];
const total = computed(() => {
  const progress = props.modelValue.images.reduce((a, b) => a + (b.compress?.progress ?? 0), 0);
  const totalSize = props.modelValue.images.reduce((a, b) => a + b.size, 0);
  const totalSurplus = props.modelValue.images.reduce((a, b) => a + (b.compress?.size ?? b.size), 0);
  const reduce = totalSize - totalSurplus;
  const success = props.modelValue.images.filter(it => it.compress?.progress === 1).length;
  const error = props.modelValue.images.filter(it => it.compress?.error).length;
  const canceled = props.modelValue.images.filter(it => it.compress?.canceled).length;
  const totalCount = props.modelValue.images.length;
  return {
    progress: progress && progress / totalCount,
    success,
    error,
    reduce,
    ratio: reduce && reduce / totalSize,
    complate: success + error + canceled === totalCount && success > 0
  };
});

const progress = computed(() => total.value.progress * 100 + '%');

async function updateItem(idx: number, value: DeepPartial<TinypngConfig.List.Image>) {
  const { images } = props.modelValue;
  emit('update:modelValue', {
    ...props.modelValue,
    images: [
      ...images.slice(0, idx),
      { ...images[idx], ...value, compress: { ...images[idx].compress, ...value.compress } },
      ...images.slice(idx + 1)
    ]
  } as TinypngConfig.List);
  await nextTick();
}

async function cacheError(idx: number, error: AxiosError<TinypngApi.Error>) {
  console.error('error: ', error);
  if (error.message !== 'canceled') {
    await updateItem(idx, { compress: { error: true, msg: error.response?.data?.message ?? error.message } });
  }
  return { data: null };
}
async function compressOne(idx: number) {
  try {
    if (!window.services) return;
    const it = props.modelValue.images[idx];
    if (it.compress.canceled) return;
    if (!(it.compress.progress >= 0.67 && it.compress.downloadUrl)) {
      await updateItem(idx, { compress: { progress: 0 } });
      const buf = await window.services.readFile(it.path);
      const fakeIp = Array.from({ length: 4 }, () => random(0, 255)).join('.');
      cancelTokens[idx] = axios.CancelToken.source();
      const { data } = await axios
        .post<TinypngApi.Upload.Response>('/backend/opt/shrink', buf, {
          baseURL: random(['https://tinypng.com', 'https://tinyjpg.com', 'https://tinify.cn']),
          headers: { 'content-type': 'image/png', 'X-Forwarded-For': fakeIp },
          cancelToken: cancelTokens[idx].token,
          onUploadProgress: e => updateItem(idx, { compress: { progress: (e.total ? e.loaded / e.total : 0) * 0.33 } }),
          onDownloadProgress: e => updateItem(idx, { compress: { progress: (e.total ? e.loaded / e.total : 0) * 0.33 + 0.34 } })
        })
        .catch(cacheError.bind(void 0, idx));
      if (!data) return;
      await updateItem(idx, { compress: { size: data.output.size, downloadUrl: data.output.url, progress: 0.67 } });
    }
    await updateItem(idx, { compress: { progress: 0.67 } });
    cancelTokens[idx] = axios.CancelToken.source();
    const { data: compressed } = await axios
      .get<ArrayBuffer>(props.modelValue.images[idx].compress.downloadUrl!, {
        responseType: 'arraybuffer',
        cancelToken: cancelTokens[idx].token,
        onDownloadProgress: e => updateItem(idx, { compress: { progress: (e.total ? e.loaded / e.total : 0) * 0.32 + 0.67 } })
      })
      .catch(cacheError.bind(void 0, idx));
    if (!compressed) return;
    await window.services.writeFile(it.compress.path, compressed);
    await updateItem(idx, { compress: { progress: 1 } });
  } catch (e) {
    console.error('e: ', e);
    await updateItem(idx, { compress: { error: true, msg: String(e) } });
  }
}

async function handleCancel(idx: number) {
  cancelTokens[idx]?.cancel();
  await updateItem(idx, { compress: { canceled: true } });
}

async function handleRefresh(idx: number) {
  await updateItem(idx, { compress: { canceled: false, error: false, msg: '' } });
  await compressOne(idx);
}

async function handleCopyAll() {
  const files = await window.services!.readDir(props.modelValue.tempdir);
  window.ztools.copyFile(files) ? ElMessage.success('复制成功！') : ElMessage.error('复制失败！');
}

async function handleReplaceAll() {
  const result: Action = await ElMessageBox.confirm('您确定要覆盖此文件吗？此操作不可还原！', {
    confirmButtonText: '确认',
    cancelButtonText: '取消'
  }).catch(t => t);
  if (result !== 'confirm') return;
  await window
    .services!.replaceFiles(props.modelValue.images.filter(it => it.compress.progress === 1).map(it => [it.compress.path, it.path]))
    .then(() => ElMessage.success('覆盖成功！'))
    .catch(error => ElMessage.error(String(error)));
}

onMounted(async () => {
  if (!window.services) return;
  const queue = new Queue(3);
  for (let i = 0; i < props.modelValue.images.length; i++) {
    await queue.push(compressOne(i));
  }
  await queue.finish();
});
</script>
