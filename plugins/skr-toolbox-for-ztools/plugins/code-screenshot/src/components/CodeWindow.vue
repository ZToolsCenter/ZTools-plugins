<script setup lang="ts">
/**
 * 代码窗口组件
 * 负责显示代码编辑器和语法高亮结果，支持拖拽调整窗口宽度
 */
import { computed, ref } from 'vue'
import { state, BG_GRADIENTS } from '@/store'
import { useShiki } from '@/composables/useShiki'

// 获取 Shiki 语法高亮结果
const { isLoaded, highlightedHtml } = useShiki()

// 获取当前选中的背景渐变
const currentGradient = computed(() => {
  return BG_GRADIENTS.find(g => g.id === state.backgroundId) || BG_GRADIENTS[0]
})

// 文本域引用
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// --- 窗口宽度调整逻辑 ---
// 自定义宽度，'auto' 表示自动宽度
const customWidth = ref<number | 'auto'>('auto')
// 是否正在拖拽调整大小
const isDragging = ref(false)

/**
 * 开始拖拽调整窗口宽度
 * @param e - 鼠标事件对象
 * @param direction - 调整方向，'left' 或 'right'
 */
const startDrag = (e: MouseEvent, direction: 'left' | 'right') => {
  e.preventDefault()
  isDragging.value = true

  const startX = e.clientX
  const windowEl = document.querySelector('.mac-window') as HTMLElement
  if (!windowEl) return

  const startWidth = windowEl.getBoundingClientRect().width

  const onMouseMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    const multiplier = direction === 'right' ? 2 : -2
    const newWidth = Math.max(400, startWidth + delta * multiplier)
    customWidth.value = newWidth
  }

  const onMouseUp = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

/**
 * 重置为自动宽度
 */
const autoWidth = () => {
  customWidth.value = 'auto'
}

// 锁定内部滚动，防止视觉不同步
// 文本域滚动时保持光标位置视觉一致
const lockInternalScroll = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  if (target.scrollTop > 0) target.scrollTop = 0
  if (target.scrollLeft > 0) target.scrollLeft = 0
}
</script>

<template>
  <div class="window-wrapper">
    <!-- Center the screenshot -->
    <div class="preview-container">

      <!-- The screenshot capture area -->
      <div class="export-target" :style="{
        padding: `${state.padding}px`,
        background: state.showBackground ? currentGradient.colors : 'transparent',
      }">
        <!-- The Window Layer -->
        <div class="mac-window" :style="{ width: customWidth === 'auto' ? '100%' : `${customWidth}px` }"
          :class="{ 'theme-dark': state.darkMode, 'theme-light': !state.darkMode }">

          <!-- Window Frame -->
          <div class="window-header">
            <div class="mac-btns">
              <div class="mac-btn close"></div>
              <div class="mac-btn minimize"></div>
              <div class="mac-btn maximize"></div>
            </div>
            <input type="text" v-model="state.filename" class="filename-input" placeholder="Untitled"
              spellcheck="false" />
          </div>

          <!-- Code Area Container (CSS Grid perfectly overlaps elements) -->
          <div class="code-container">
            <div class="code-highlight" v-html="highlightedHtml" aria-hidden="true"></div>
            <!-- Textarea overlay -->
            <textarea ref="textareaRef" v-model="state.code" class="code-input" spellcheck="false"
              @scroll="lockInternalScroll"></textarea>
          </div>
        </div>
      </div>

      <!-- Handle indicators outside export area -->
      <div class="resize-handle left-handle" data-html2canvas-ignore="true" @mousedown="startDrag($event, 'left')">
      </div>
      <div class="resize-handle right-handle" data-html2canvas-ignore="true" @mousedown="startDrag($event, 'right')">
      </div>

    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/variables' as *;

// ── Wrapper ──────────────────────────────────────────────────────────────────

.window-wrapper {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
}

.preview-container {
  display: flex;
  position: relative;
  align-items: center;
  justify-content: center;
}

// ── Export Target (the screenshot canvas) ────────────────────────────────────

.export-target {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  transition: all var(--transition-slow);
  min-width: 400px;
  max-width: 100%;
  border-radius: 8px;
}

// ── Resize Handles ───────────────────────────────────────────────────────────

.resize-handle {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-full);
  cursor: ew-resize;
  z-index: 10;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.25);
  transition: all var(--transition-base);

  &:hover {
    background-color: var(--color-accent-blue);
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2), 0 0 8px rgba(56, 189, 248, 0.4);
    transform: translateY(-50%) scale(1.4);
  }

  &.left-handle {
    left: -20px;
  }

  &.right-handle {
    right: -20px;
  }
}

// ── Mac Window Frame ─────────────────────────────────────────────────────────

.mac-window {
  width: 100%;
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--color-window-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--color-window-border);
  display: flex;
  flex-direction: column;
  transition: all var(--transition-slow);

  // Dark themed window: rich shadow + inner top highlight
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;

  &.theme-light {
    background: rgba(255, 255, 255, 0.92);
    border-color: rgba(0, 0, 0, 0.08);
    box-shadow:
      0 20px 40px rgba(0, 0, 0, 0.12),
      0 0 0 1px rgba(255, 255, 255, 0.8) inset;
  }
}

// ── Window Header (Traffic lights + Filename) ────────────────────────────────

.window-header {
  display: flex;
  align-items: center;
  padding: var(--spacing-lg);
  position: relative;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);

  .theme-light & {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
}

.mac-btns {
  display: flex;
  gap: var(--spacing-sm);
  position: absolute;
  left: var(--spacing-lg);
}

.mac-btn {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  transition: filter var(--transition-base);

  &.close {
    background: #ff5f56;
  }

  &.minimize {
    background: #ffbd2e;
  }

  &.maximize {
    background: #27c93f;
  }

  .mac-window:hover &.close {
    filter: brightness(1.1);
  }

  .mac-window:hover &.minimize {
    filter: brightness(1.1);
  }

  .mac-window:hover &.maximize {
    filter: brightness(1.1);
  }
}

.filename-input {
  width: 100%;
  text-align: center;
  background: transparent;
  border: none;
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  color: var(--color-text-muted);
  outline: none;
  font-weight: 500;
  letter-spacing: 0.3px;
  transition: color var(--transition-base);

  &:focus {
    color: var(--color-text);
  }

  .theme-light & {
    color: #52525b;
  }
}

// ── Code Container (CSS Grid for perfect overlay) ────────────────────────────

.code-container {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  padding: 0 var(--spacing-xl) calc(var(--spacing-xl) + 4px) var(--spacing-xl);
  flex-grow: 1;
}

.code-highlight,
.code-input {
  grid-area: 1 / 1;
  font-family: #{$font-mono} !important;
  font-size: #{$font-size-md} !important;
  line-height: 24px !important;
  letter-spacing: normal !important;
  word-spacing: normal !important;
  width: 100%;
  height: 100%;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  color: transparent;
  caret-color: var(--color-text);
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-all;
  overflow-wrap: break-word;
  tab-size: 2;
  box-sizing: border-box;

  .theme-light & {
    caret-color: #000;
  }
}

.code-highlight {
  pointer-events: none;
  z-index: 1;
}

.code-input {
  resize: none;
  outline: none;
  color: transparent !important;
  background: transparent !important;
  z-index: 2;
  overflow: hidden;
}

// ── Shiki overrides (force inherit layout from grid parent) ──────────────────

:deep(pre) {
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  white-space: pre-wrap !important;
  word-wrap: break-word !important;
  word-break: break-all !important;
  overflow-wrap: break-word !important;
  font-family: inherit !important;
  font-size: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  word-spacing: inherit !important;
  tab-size: 2 !important;
  border: none !important;
}

:deep(code) {
  font-family: inherit !important;
  font-size: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  word-spacing: inherit !important;
}
</style>
