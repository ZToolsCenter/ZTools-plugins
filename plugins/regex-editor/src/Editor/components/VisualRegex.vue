<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import visualRegex from 'visual-regex'

const props = defineProps<{
  pattern: string
  flags: string
}>()

const containerRef = ref<HTMLElement>()
const parseError = ref('')

async function renderVisual() {
  await nextTick()
  const el = containerRef.value
  if (!el) return

  el.innerHTML = ''
  parseError.value = ''

  if (!props.pattern.trim()) return

  try {
    const regex = new RegExp(props.pattern, props.flags)
    const visual = visualRegex(regex)
    const canvas = visual.visualCanvas()
    canvas.style.display = 'block'
    canvas.style.maxWidth = '100%'
    canvas.style.height = 'auto'
    el.appendChild(canvas)
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : '正则格式有误，无法生成可视化'
  }
}

watch(() => [props.pattern, props.flags], renderVisual, { immediate: true })
</script>

<template>
  <div class="visual-regex-wrap">
    <div ref="containerRef" class="visual-regex-canvas" />
    <p v-if="!pattern.trim()" class="visual-placeholder">输入正则后，这里会显示可视化铁路图</p>
    <p v-else-if="parseError" class="visual-error">{{ parseError }}</p>
  </div>
</template>

<style scoped>
.visual-regex-wrap {
  position: relative;
  min-height: 80px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border-color);
  overflow-x: auto;
}

.visual-regex-canvas {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  min-height: 60px;
}

.visual-regex-canvas:empty {
  display: none;
}

.visual-placeholder,
.visual-error {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.visual-placeholder {
  color: var(--text-muted);
}

.visual-error {
  color: #ef4444;
}
</style>
