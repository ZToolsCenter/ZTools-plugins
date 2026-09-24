<!--
  UiConfirmDialog：确认弹窗（替代 ztools-ui ZConfirmDialog，reka-ui AlertDialog）。

  渲染模块级单例 confirmState（composables/useConfirm.ts），App.vue 挂载一次。
  能力（原 ZConfirmDialog 的 REL-001 缺口在此全部内建）：
  - Esc 关闭（AlertDialog 默认）→ 走取消出口（settle 幂等，先到者胜）；
  - 焦点圈定（AlertDialog trap-focus 内建）；
  - 打开时焦点落在「取消」次按钮（@open-auto-focus 劫持默认焦点 —— warning /
    danger 场景回车默认落在安全侧），关闭后焦点还原由 reka 自动承担。

  视觉：小纸面卡（大圆角 + 分层轻阴影），标题 + 正文 + 右侧按钮组
  （取消 = secondary / 确定 = primary 纯色；danger 类型确定钮转陶土红）。
  遮罩点击不关闭（AlertDialog 语义：破坏性确认不给误关出口，与原行为一致）。
-->
<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { useConfirmDialog } from '../../composables/useConfirm'

const { confirmState, handleConfirm, handleCancel } = useConfirmDialog()

/** 打开时把焦点引到「取消」按钮（默认焦点是内容面板本体） */
function focusCancel(event: Event): void {
  event.preventDefault()
  const target = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
    '.ui-confirm-cancel',
  )
  target?.focus()
}
</script>

<template>
  <AlertDialogRoot :open="confirmState.visible">
    <AlertDialogPortal>
      <AlertDialogOverlay class="ui-confirm-overlay" />
      <AlertDialogContent
        class="ui-confirm-content"
        role="alertdialog"
        aria-modal="true"
        @open-auto-focus="focusCancel"
      >
        <AlertDialogTitle class="ui-confirm-title">{{ confirmState.title }}</AlertDialogTitle>
        <AlertDialogDescription class="ui-confirm-message">
          {{ confirmState.message }}
        </AlertDialogDescription>
        <div class="ui-confirm-actions">
          <AlertDialogCancel class="ui-confirm-cancel" @click="handleCancel">
            {{ confirmState.cancelText }}
          </AlertDialogCancel>
          <AlertDialogAction
            class="ui-confirm-ok"
            :class="{ 'is-danger': confirmState.type === 'danger' }"
            @click="handleConfirm"
          >
            {{ confirmState.confirmText }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
.ui-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 22100;
  background-color: color-mix(in srgb, #2a241c 32%, transparent);
  backdrop-filter: blur(2px);
  animation: ui-confirm-fade 0.15s var(--ease-quiet);
}

/* 面板：小纸面卡，淡入 + 轻微上浮 */
.ui-confirm-content {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 22101;
  transform: translate(-50%, -50%);
  width: 360px;
  max-width: calc(100vw - 48px);
  padding: 16px 18px 14px;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-l, 12px);
  background-color: var(--dialog-bg, #ffffff);
  box-shadow: var(--shadow-3);
  animation: ui-confirm-pop 0.15s var(--ease-quiet);
}

.ui-confirm-overlay[data-state='closed'],
.ui-confirm-content[data-state='closed'] {
  animation: none;
  opacity: 0;
  transition: opacity 0.1s var(--ease-quiet);
}

@keyframes ui-confirm-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes ui-confirm-pop {
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
  .ui-confirm-overlay,
  .ui-confirm-content {
    animation: none;
  }
}

.ui-confirm-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #2e2c28);
}

.ui-confirm-message {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #8a8377);
}

.ui-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* 按钮复用 UiButton 的视觉口径（此处是 reka 行为插槽，样式就地对齐） */
.ui-confirm-cancel,
.ui-confirm-ok {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 12px;
  border-radius: var(--radius-s, 6px);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s var(--ease-quiet), border-color 0.12s var(--ease-quiet),
    color 0.12s var(--ease-quiet);
}

.ui-confirm-cancel {
  border: 1px solid var(--control-border, #ddd7cb);
  background-color: var(--surface, #ffffff);
  color: var(--text-color, #2e2c28);
  box-shadow: var(--shadow-1);
}

.ui-confirm-cancel:hover {
  border-color: var(--border-strong, #d7d1c4);
  background-color: color-mix(in srgb, var(--surface, #ffffff) 55%, var(--hover-bg, #f2f0ea));
}

.ui-confirm-ok {
  border: none;
  background-color: var(--primary-color, #4e7a60);
  color: var(--text-on-primary, #ffffff);
  box-shadow: var(--shadow-1);
}

.ui-confirm-ok:hover {
  background-color: color-mix(in srgb, var(--primary-color, #4e7a60) 90%, var(--bg-color, #f7f5f1));
}

/* danger 类型：确定钮转陶土红 */
.ui-confirm-ok.is-danger {
  background-color: var(--danger-color, #b3563e);
  color: #ffffff;
}

.ui-confirm-ok.is-danger:hover {
  background-color: color-mix(in srgb, var(--danger-color, #b3563e) 90%, var(--bg-color, #f7f5f1));
}

.ui-confirm-cancel:focus-visible,
.ui-confirm-ok:focus-visible {
  outline: 1.5px solid var(--primary-color);
  outline-offset: 1px;
}
</style>
