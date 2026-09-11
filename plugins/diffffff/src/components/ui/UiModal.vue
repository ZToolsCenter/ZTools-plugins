<!--
  UiModal：北欧风居中弹窗容器（替代 ztools-ui ZModal，reka-ui DialogRoot）。

  只负责「壳」：遮罩（暖黑低透明 + 轻微 blur）、居中纸面卡（大圆角 + 分层
  轻阴影）、Esc / 遮罩点击关闭（update:open 回写 v-model:show）、进出场
  淡入 + 轻微上浮。内容（头部 / 主体 / 底部）由消费方插槽自理。
  a11y：title prop 经 sr-only DialogTitle 提供可访问名（消费方可见标题自理），
  内容滚动 / 焦点圈定由 reka Dialog 内建。
-->
<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { VisuallyHidden } from 'reka-ui'

defineProps<{
  show: boolean
  /** 可访问名（sr-only；消费方自行渲染可见标题） */
  title: string
}>()

const emit = defineEmits<{ 'update:show': [value: boolean] }>()
</script>

<template>
  <DialogRoot :open="show" @update:open="emit('update:show', $event)">
    <DialogPortal>
      <DialogOverlay class="ui-modal-overlay" />
      <DialogContent class="ui-modal-content" :trap-focus="true">
        <!-- 可访问名：视觉标题由消费方渲染，这里兜底 aria 语义 -->
        <VisuallyHidden>
          <DialogTitle>{{ title }}</DialogTitle>
        </VisuallyHidden>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* 遮罩：暖黑低透明 + 轻 blur（薄纱感，不压暗内容） */
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 22000;
  background-color: color-mix(in srgb, #2a241c 32%, transparent);
  backdrop-filter: blur(2px);
  animation: ui-overlay-in 0.15s var(--ease-quiet);
}

/* 面板：纸面卡，纸感进出场（淡入 + 6px 上浮） */
.ui-modal-content {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 22001;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-l, 12px);
  background-color: var(--dialog-bg, #ffffff);
  box-shadow: var(--shadow-3);
  animation: ui-modal-in 0.15s var(--ease-quiet);
}

.ui-modal-overlay[data-state='closed'],
.ui-modal-content[data-state='closed'] {
  animation: none;
  opacity: 0;
  transition: opacity 0.1s var(--ease-quiet);
}

@keyframes ui-overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes ui-modal-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 6px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-modal-overlay,
  .ui-modal-content {
    animation: none;
  }
}
</style>
