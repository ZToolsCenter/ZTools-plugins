<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { onMounted, reactive, ref, watch } from 'vue'

const emit = defineEmits<{
  back: []
}>()

const DEFAULT_SETTINGS: ImageSettings = {
  jpegQuality: 75,
  concurrency: 3,
  recursiveFolders: false,
  ignoredFolders: []
}

const form = reactive({
  jpegQuality: DEFAULT_SETTINGS.jpegQuality,
  concurrency: DEFAULT_SETTINGS.concurrency,
  recursiveFolders: DEFAULT_SETTINGS.recursiveFolders
})
const ignoredFoldersText = ref('')
let ready = false

/** 将输入值限制在指定范围内。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}

/** 将忽略目录文本转换为去重后的目录名称。 */
function parseIgnoredFolders(value: string): string[] {
  return [...new Set(value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
}

/** 读取并显示已保存的插件设置。 */
function loadSettings(): void {
  const saved = window.imgCompRuntime?.getSettings?.() || DEFAULT_SETTINGS
  form.jpegQuality = clamp(saved.jpegQuality, 1, 100)
  form.concurrency = clamp(saved.concurrency, 1, 10)
  form.recursiveFolders = saved.recursiveFolders === true
  ignoredFoldersText.value = saved.ignoredFolders.join('\n')
  ready = true
}

/** 保存当前设置。 */
function persistSettings(): void {
  if (!ready) return
  window.imgCompRuntime?.saveSettings?.({
    jpegQuality: clamp(form.jpegQuality, 1, 100),
    concurrency: clamp(form.concurrency, 1, 10),
    recursiveFolders: form.recursiveFolders,
    ignoredFolders: parseIgnoredFolders(ignoredFoldersText.value)
  })
}

/** 修正数字输入框中可能超出范围的值。 */
function normalizeNumberInputs(): void {
  form.jpegQuality = clamp(form.jpegQuality, 1, 100)
  form.concurrency = clamp(form.concurrency, 1, 10)
  persistSettings()
}

watch(form, persistSettings, { deep: true })
watch(ignoredFoldersText, persistSettings)

onMounted(loadSettings)
</script>

<template>
  <div class="settings-page">
    <header class="settings-header">
      <button class="settings-back" type="button" title="返回图片压缩" @click="emit('back')">
        <ArrowLeft :size="18" :stroke-width="2" aria-hidden="true" />
      </button>
      <h1>设置</h1>
    </header>

    <main class="settings-content">
      <section class="settings-section">
        <div class="settings-item">
          <div class="settings-item-header">
            <label for="jpeg-quality">JPEG 压缩率</label>
          </div>
          <div class="settings-range-row">
            <input
              id="jpeg-quality"
              v-model.number="form.jpegQuality"
              class="settings-range"
              type="range"
              min="1"
              max="100"
              step="1"
              @change="normalizeNumberInputs"
            />
            <input
              v-model.number="form.jpegQuality"
              class="settings-number"
              type="number"
              min="1"
              max="100"
              step="1"
              aria-label="JPEG 压缩率数值"
              @change="normalizeNumberInputs"
            />
          </div>
          <p>取值范围 1-100，值越小压缩效率越高，值越大图片质量越好，通常建议设置为 75 或 85</p>
        </div>

        <div class="settings-item">
          <div class="settings-item-header">
            <label for="concurrency">并发线程数</label>
          </div>
          <div class="settings-range-row">
            <input
              id="concurrency"
              v-model.number="form.concurrency"
              class="settings-range"
              type="range"
              min="1"
              max="10"
              step="1"
              @change="normalizeNumberInputs"
            />
            <input
              v-model.number="form.concurrency"
              class="settings-number"
              type="number"
              min="1"
              max="10"
              step="1"
              aria-label="并发线程数数值"
              @change="normalizeNumberInputs"
            />
          </div>
          <p>适用于图片数量较多的情况，线程数越多在多文件下效率越高，同时电脑资源占用也越高</p>
        </div>

        <div class="settings-item settings-toggle-item">
          <label class="settings-toggle-row">
            <span class="settings-toggle-copy">
              <span class="settings-label">递归子文件夹</span>
              <span class="settings-description">开启后会递归压缩子文件夹下的图片</span>
            </span>
            <input v-model="form.recursiveFolders" type="checkbox" />
            <span class="settings-switch" aria-hidden="true"></span>
          </label>
        </div>

        <div class="settings-item" :class="{ 'is-disabled': !form.recursiveFolders }">
          <label class="settings-label" for="ignored-folders">文件夹忽略</label>
          <textarea
            id="ignored-folders"
            v-model="ignoredFoldersText"
            class="settings-textarea"
            rows="3"
            :disabled="!form.recursiveFolders"
            placeholder="每行一个目录名称，也可以使用逗号分隔"
          ></textarea>
          <p>递归模式下跳过这些文件夹的压缩</p>
        </div>
      </section>
    </main>
  </div>
</template>
