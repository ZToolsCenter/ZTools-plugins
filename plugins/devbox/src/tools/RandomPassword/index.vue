<script lang="ts" setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const length = ref(16)
const useUpper = ref(true)
const useLower = ref(true)
const useDigit = ref(true)
const useSymbol = ref(true)
const result = ref('')

function generate() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digit = '0123456789'
  const symbol = '!@#$%^&*()-_=+[]{}|;:,.<>?'
  let chars = ''
  if (useUpper.value) chars += upper
  if (useLower.value) chars += lower
  if (useDigit.value) chars += digit
  if (useSymbol.value) chars += symbol
  if (!chars) {
    result.value = ''
    return
  }
  let pw = ''
  const array = new Uint32Array(length.value)
  crypto.getRandomValues(array)
  for (let i = 0; i < length.value; i++) {
    pw += chars[array[i] % chars.length]
  }
  result.value = pw
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function getStrength(): { label: string; type: 'danger' | 'warning' | 'success' } {
  const len = length.value
  let pools = 0
  if (useUpper.value) pools++
  if (useLower.value) pools++
  if (useDigit.value) pools++
  if (useSymbol.value) pools++
  if (len < 8 || pools < 2) return { label: '弱', type: 'danger' }
  if (len < 12 || pools < 3) return { label: '中', type: 'warning' }
  return { label: '强', type: 'success' }
}
</script>

<template>
  <div class="random-password">
    <h2>随机密码</h2>
    <p class="desc">随机生成安全密码，可配置长度、字符集，实时显示密码强度</p>

    <div class="config">
      <div class="config-row">
        <span>密码长度</span>
        <el-input-number v-model="length" :min="4" :max="64" size="small" />
        <el-slider v-model="length" :min="4" :max="64" style="flex: 1" />
      </div>
      <div class="config-row checkboxes">
        <el-checkbox v-model="useUpper">大写字母 A-Z</el-checkbox>
        <el-checkbox v-model="useLower">小写字母 a-z</el-checkbox>
        <el-checkbox v-model="useDigit">数字 0-9</el-checkbox>
        <el-checkbox v-model="useSymbol">特殊字符 !@#$</el-checkbox>
      </div>
    </div>

    <div class="actions">
      <el-button type="primary" @click="generate">生成密码</el-button>
      <el-tag :type="getStrength().type" size="small">强度：{{ getStrength().label }}</el-tag>
    </div>

    <div v-if="result" class="result">
      <div class="result-value" @click="copyText(result)">{{ result }}</div>
      <el-button size="small" @click="copyText(result)">复制</el-button>
    </div>
  </div>
</template>

<style scoped>
.random-password {
  padding: 12px;
  max-width: 500px;
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

.config {
  margin-bottom: 16px;
}

.config-row {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.config-row span {
  color: var(--text-secondary, #888);
  flex-shrink: 0;
}

.checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.result {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 6px;
}

.result-value {
  flex: 1;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 15px;
  word-break: break-all;
  color: var(--text-primary, #333);
  cursor: pointer;
  letter-spacing: 1px;
}

.result-value:hover {
  color: #667eea;
}

@media (prefers-color-scheme: dark) {
  .result {
    background: #2c2c2c;
    border-color: #444;
  }

  .result-value {
    color: #ddd;
  }

  .result-value:hover {
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
