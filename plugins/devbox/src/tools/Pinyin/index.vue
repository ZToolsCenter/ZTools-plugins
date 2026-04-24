<script lang="ts" setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, CopyDocument } from '@element-plus/icons-vue'
import { pinyin } from 'pinyin-pro'

interface FormatItem {
  label: string
  value: string
}

const input = ref('')
const formats = ref<FormatItem[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function convert() {
  const text = input.value.trim()
  if (!text) {
    formats.value = []
    return
  }

  const arr: string[] = pinyin(text, { type: 'array', toneType: 'none' })

  formats.value = [
    { label: '全拼', value: arr.join('') },
    {
      label: '小驼峰',
      value: arr.map((s, i) => i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)).join('')
    },
    {
      label: '大驼峰',
      value: arr.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    },
    { label: '下划线', value: arr.join('_') },
    { label: '常量命名', value: arr.join('_').toUpperCase() },
    { label: '短横线', value: arr.join('-') },
    { label: '仅首字母', value: arr.map(s => s.charAt(0)).join('') },
  ]
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function clear() {
  input.value = ''
  formats.value = []
}

watch(input, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(convert, 200)
})
</script>

<template>
  <div class="pinyin-tool">
    <h2>中文转拼音</h2>
    <p class="desc">将中文转换为拼音命名格式，支持全拼、驼峰、下划线、常量、首字母等多种格式</p>

    <div class="input-area">
      <el-input
        v-model="input"
        type="textarea"
        :rows="3"
        placeholder="输入中文，例如：特殊成绩标识"
        size="small"
      />
      <div class="input-actions" v-if="input">
        <el-button size="small" @click="clear">
          <el-icon><Delete /></el-icon>
          清空
        </el-button>
      </div>
    </div>

    <div class="format-list" v-if="formats.length">
      <div
        v-for="item in formats"
        :key="item.label"
        class="format-item"
        @click="copyText(item.value)"
      >
        <span class="format-label">{{ item.label }}</span>
        <span class="format-value">{{ item.value }}</span>
        <el-icon class="format-copy"><CopyDocument /></el-icon>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pinyin-tool {
  padding: 12px;
  max-width: 600px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 16px;
  font-size: 13px;
}

.input-area {
  margin-bottom: 16px;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.format-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 12px;
}

.format-item:hover {
  background: var(--bg-hover, #f5f7ff);
}

.format-label {
  flex-shrink: 0;
  width: 64px;
  color: #909399;
  font-size: 12px;
}

.format-value {
  flex: 1;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  color: var(--text-primary, #333);
  user-select: none;
  word-break: break-all;
}

.format-copy {
  flex-shrink: 0;
  color: #667eea;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.15s;
}

.format-item:hover .format-copy {
  opacity: 1;
}

@media (prefers-color-scheme: dark) {
  .format-item {
    background: #2c2c2c;
    border-color: #444;
  }

  .format-item:hover {
    background: #363640;
  }

  .format-value {
    color: #ddd;
  }

  .format-label {
    color: #909399;
  }

  .format-copy {
    color: #8ba4f7;
  }

  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }
}
</style>
