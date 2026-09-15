<!--
  UiToastHost：轻量 toast 渲染宿主（替代 ztools-ui ZToast）。

  渲染模块级单例 toastState（composables/useToast.ts），挂载一次即可。
  视觉：顶部居中的小纸面卡（发丝边 + 轻阴影 + 小圆角），文案行首以
  「彩色小圆点」区分类型 —— info 雾蓝 / success 雾绿 / error 陶土红
  （Scandi「少量柔和彩色点做状态标记」）。转场淡入 + 8px 下落，0.14s。
  fixed 定位（z-index 23000，高于浮层），挂载位置不影响布局。
-->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { toastState, useToast } from '../../composables/useToast'

const { dispose } = useToast()

// Host 卸载兜底：隐藏 toast 并清自动消失计时（防幽灵回调）
onBeforeUnmount(dispose)
</script>

<template>
  <div class="ui-toast-portal" aria-live="polite">
    <Transition name="ui-toast">
      <div v-if="toastState.visible" class="ui-toast" :class="`is-${toastState.type}`" role="status">
        <span class="ui-toast-dot" aria-hidden="true"></span>
        <span class="ui-toast-message">{{ toastState.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ui-toast-portal {
  position: fixed;
  top: 12px;
  left: 0;
  right: 0;
  z-index: 23000;
  display: flex;
  justify-content: center;
  /* 不挡交互：toast 是反馈不是对话框 */
  pointer-events: none;
}

.ui-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(80vw, 480px);
  padding: 7px 14px;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-m, 8px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-2);
  font-size: 12px;
  color: var(--text-color, #2e2c28);
}

/* 类型小圆点：唯一色彩信号（卡片本体保持纸面中性） */
.ui-toast-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background-color: var(--accent-blue, #5e86a8);
}

.ui-toast.is-success .ui-toast-dot {
  background-color: var(--accent-green, #5d8a67);
}

.ui-toast.is-error .ui-toast-dot {
  background-color: var(--danger-color, #b3563e);
}

.ui-toast-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 转场：淡入 + 轻微下落（短促干净） */
.ui-toast-enter-active {
  transition: opacity 0.14s var(--ease-quiet), transform 0.14s var(--ease-quiet);
}

.ui-toast-leave-active {
  transition: opacity 0.1s var(--ease-quiet);
}

.ui-toast-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.ui-toast-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ui-toast-enter-active,
  .ui-toast-leave-active {
    transition: none;
  }
}
</style>
