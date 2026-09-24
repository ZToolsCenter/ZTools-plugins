<script setup lang="ts">
import { onMounted, ref } from 'vue'
import EditorPanel from '../editor/EditorPanel.vue'

/** 弱依赖的 toast：ztools 有则用，没有则静默 */
function toast(msg: string) {
  const anyZtools = window.ztools as unknown as { showToast?: (m: string) => void }
  anyZtools.showToast?.(msg)
}

const shot = ref<{ dataURL: string; width: number; height: number } | null>(null)
const error = ref('')

/** 从 URL query 取图 dataURL。img 可能是内联 dataURL，也可能是临时文件路径（大图走文件通道），后者经 readTempImage 读回。 */
function imageFromQuery(): string | null {
  const p = new URLSearchParams(window.location.search)
  const raw = p.get('img')
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  try {
    return window.services.readTempImage(decodeURIComponent(raw))
  } catch {
    return null
  }
}

function enterEditor(dataURL: string) {
  const img = new Image()
  img.onload = () => {
    shot.value = { dataURL, width: img.naturalWidth, height: img.naturalHeight }
  }
  img.onerror = () => {
    error.value = '图片数据加载失败'
  }
  img.src = dataURL
}

function onCopy(dataURL: string) {
  window.services.copyImageDataURL(dataURL)
  toast('已复制到剪贴板')
}
function onSave(dataURL: string) {
  // 每次弹出系统保存框，由用户选择保存位置；取消则仅关闭不提示
  const r = window.services.saveImageDataURL(dataURL, {})
  if (!r.canceled && r.path) toast(`已保存: ${r.path}`)
}
/** 钉图：子窗口不能直接建窗（会 "plugin not found"），经 sendToParent 转主窗口创建置顶图窗 */
function onPin(dataURL: string) {
  const anyZtools = window.ztools as unknown as { sendToParent?: (channel: string, ...args: any[]) => void }
  if (typeof anyZtools.sendToParent === 'function') {
    anyZtools.sendToParent('screenshot-annotate:open-pin', dataURL)
    toast('已钉到桌面')
  } else {
    toast('当前环境不支持钉图')
  }
}

function close() {
  window.close()
}

onMounted(() => {
  const dataURL = imageFromQuery()
  if (dataURL) enterEditor(dataURL)
  else error.value = '未传入截图数据，请通过「Z截图」命令触发'
})
</script>

<template>
  <div class="cap-root">
    <EditorPanel
      v-if="shot"
      :data-url="shot.dataURL"
      :width="shot.width"
      :height="shot.height"
      :on-copy="onCopy"
      :on-save="onSave"
      :on-pin="onPin"
      :on-close="close"
    />
    <div v-else class="loading">
      <span>{{ error || '加载中…' }}</span>
    </div>
  </div>
</template>

<style>
.cap-root {
  width: 100%;
  height: 100%;
  /* 透明承载窗口：图片与悬浮工具条之间、四周均为可见的透明区域 */
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.loading {
  color: #aaa;
  font-size: 14px;
}
</style>