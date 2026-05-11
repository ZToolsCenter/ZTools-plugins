<template>
  <div class="main" @dragenter="draged = true" @dragleave="draged = false" @dragover.prevent="draged = true" @drop.prevent="handleDrop">
    <template v-if="configs.list.length">
      <tab :list="configs.list" v-model="active" />
      <compress-list v-for="(_it, idx) in configs.list" v-model="configs.list[idx]" v-show="idx === active" />
    </template>
    <transition name="fade">
      <div :data-draged="draged" class="main__drag" v-if="!configs.list.length || draged">
        <icon name="upload" size="60px"></icon>
        <p v-if="draged">松手压缩此图片</p>
        <p v-else>请将图片或文件夹拖放到此处</p>
      </div>
    </transition>
  </div>
</template>

<style lang="scss" scoped>
.main {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &__drag {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background: var(--el-mask-color-extra-light);
    z-index: 3;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    transition: 0.3s;
    color: var(--el-text-color-regular);
    pointer-events: none;

    &[data-draged='true'] {
      background: var(--el-mask-color);
      color: var(--el-text-color-primary);
    }
  }
}
</style>

<script setup lang="ts">
import { useDark } from '@vueuse/core';
import { onMounted, onUnmounted, ref } from 'vue';
import { Action, ElMessageBox } from 'element-plus';

import Tab from './components/tab.vue';
import Icon from './components/icon.vue';
import CompressList from './components/compress-list.vue';

useDark();

const configs = ref<TinypngConfig>({ list: [] });
const active = ref<number>(0);
const draged = ref<boolean>(false);

async function handleTinypingCompression(e: Event) {
  const { detail } = e as CustomEvent<TinypngConfig.List>;
  if (detail.images.length > 20) {
    const result: Action = await ElMessageBox.confirm('当前文件超过20个可能会压缩失败！', {
      cancelButtonText: '放弃',
      confirmButtonText: '继续'
    }).catch(t => t);
    if (result !== 'confirm') return;
  }

  configs.value.list.push(detail);
  active.value = configs.value.list.length - 1;
}

function handleDrop(e: DragEvent) {
  draged.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  // @ts-ignore
  const paths = files.map(f => window.ztools.getPathForFile(f)).filter(Boolean);
  if (paths.length > 0) {
    window.services!.handlePluginEnter({ code: 'drop', type: 'drop', payload: paths.map(p => ({ path: p })) });
  }
}

onMounted(() => {
  window.addEventListener('tinyping-compression', handleTinypingCompression);
});

onUnmounted(() => {
  window.removeEventListener('tinyping-compression', handleTinypingCompression);
});
</script>
