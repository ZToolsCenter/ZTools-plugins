<template>
  <div class="compress-item">
    <img :src="toFileUrl(data.path)" :alt="data.name" />
    <p>{{ data.name }}</p>
    <span>{{ bytes(data.size) }}</span>
    <span>{{ data.compress?.size ? bytes(data.compress.size) : '-' }}</span>
    <span class="green">{{ data.compress?.size ? `-${(((data.size - data.compress.size) / data.size) * 100).toFixed(2)}%` : '-' }}</span>
    <button
      class="compress-item__btn"
      :disabled="data.compress.progress === 1 || data.compress.canceled || data.compress.error"
      @click="$emit('cancel')"
    >
      <icon name="cancel" />
    </button>
    <button class="compress-item__btn" :disabled="data.compress.progress < 1" @click="handleCopy">
      <icon name="copy" />
    </button>
    <button class="compress-item__btn" :disabled="data.compress.progress < 1" @click="handleReplace">
      <icon name="image-replace" />
    </button>

    <div class="compress-item__error" v-if="data.compress.error || data.compress.canceled">
      <p>{{ data.compress.canceled ? '已取消' : data.compress.msg }}</p>
      <button @click="$emit('refresh')">
        <icon name="refresh" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compress-item {
  position: relative;
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  color: var(--el-text-color-primary);

  &:nth-child(2n) {
    background: var(--el-fill-color-dark);
  }

  &:before {
    content: '';
    position: absolute;
    left: 0;
    bottom: 0;
    width: v-bind(progress);
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, #4ae3e7 33.3vw, #29a9ef 33.4vw, #29a9ef 66.3vw, #0b73f7 66.4vw);
    transition: width 0.5s;
  }

  > img {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }

  > p {
    flex: 1;
    padding-left: 20px;
  }

  > span {
    width: 90px;
    text-align: center;
  }

  .green {
    color: var(--el-color-success);
  }

  &__btn {
    padding: 5px;
    margin: 0 4px;
    font-size: 22px;
  }

  &__error {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: #ccc;

    p {
      line-height: 1.5;
    }

    button {
      font-size: 22px;
      color: #ccc;
    }
  }
}
</style>

<script lang="ts" setup>
import { computed, PropType } from 'vue';
import { Action, ElMessage, ElMessageBox } from 'element-plus';

import { bytes, toFileUrl } from '../utils';
import Icon from './icon.vue';

const props = defineProps({
  data: { type: Object as PropType<TinypngConfig.List.Image>, required: true }
});

defineEmits(['cancel', 'refresh']);

const progress = computed(() => (props.data.compress?.progress ?? 0) * 100 + '%');

function handleCopy() {
  window.ztools.copyFile(props.data.compress.path) ? ElMessage.success('复制成功！') : ElMessage.error('复制失败！');
}

async function handleReplace() {
  const result: Action = await ElMessageBox.confirm('您确定要覆盖此文件吗？此操作不可还原！', {
    confirmButtonText: '确认',
    cancelButtonText: '取消'
  }).catch(t => t);
  if (result !== 'confirm') return;

  await window
    .services!.replaceFiles([[props.data.compress.path, props.data.path]])
    .then(() => ElMessage.success('覆盖成功！'))
    .catch(error => ElMessage.error(String(error)));
}
</script>
