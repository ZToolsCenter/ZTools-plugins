<script setup lang="ts">
import { computed, ref } from 'vue'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const CHARSETS = {
  digit: '0123456789',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  special: '!@#$%^&*()-_=+[]{}|;:,.<>?'
} as const

const length = ref(16)
const count = ref(1)
const useDigit = ref(true)
const useUpper = ref(true)
const useLower = ref(true)
const useSpecial = ref(false)
const results = ref<string[]>([])
const error = ref('')

const charsetPool = computed(() => {
  let pool = ''
  if (useDigit.value) pool += CHARSETS.digit
  if (useUpper.value) pool += CHARSETS.upper
  if (useLower.value) pool += CHARSETS.lower
  if (useSpecial.value) pool += CHARSETS.special
  return pool
})

const pickRandomChar = (pool: string) => {
  const randomValues = new Uint32Array(1)
  crypto.getRandomValues(randomValues)
  return pool[randomValues[0] % pool.length]
}

const generateOne = (pool: string, len: number) => {
  let result = ''
  for (let i = 0; i < len; i++) {
    result += pickRandomChar(pool)
  }
  return result
}

const generate = () => {
  error.value = ''
  const len = Number(length.value)
  const countVal = Number(count.value)
  const pool = charsetPool.value

  if (!useDigit.value && !useUpper.value && !useLower.value && !useSpecial.value) {
    error.value = '请至少选择一种字符类型'
    results.value = []
    return
  }
  if (Number.isNaN(len) || Number.isNaN(countVal)) {
    error.value = '请输入有效的数字'
    results.value = []
    return
  }
  if (len < 1 || len > 1024 || !Number.isInteger(len)) {
    error.value = '字符串长度须为 1 ~ 1024 的整数'
    results.value = []
    return
  }
  if (countVal < 1 || countVal > 1000 || !Number.isInteger(countVal)) {
    error.value = '生成数量须为 1 ~ 1000 的整数'
    results.value = []
    return
  }

  const output: string[] = []
  for (let i = 0; i < countVal; i++) {
    output.push(generateOne(pool, len))
  }
  results.value = output
}

const copyResults = () => {
  if (!results.value.length) return
  const text = results.value.join('\n')
  window.ztools.copyText(text)
  window.ztools.showNotification('已复制到剪贴板')
}
</script>

<template>
  <div class="random-string">
    <h1>随机字符串生成</h1>

    <div class="random-string-form">
      <label class="random-string-field">
        <span>字符串长度</span>
        <input v-model.number="length" type="number" min="1" max="1024" />
      </label>
      <label class="random-string-field">
        <span>生成数量</span>
        <input v-model.number="count" type="number" min="1" max="1000" />
      </label>
    </div>

    <div class="random-string-charset">
      <span class="random-string-charset__label">字符类型</span>
      <label class="random-string-charset__item">
        <input v-model="useDigit" type="checkbox" />
        <span>数字 (0-9)</span>
      </label>
      <label class="random-string-charset__item">
        <input v-model="useUpper" type="checkbox" />
        <span>大写字母 (A-Z)</span>
      </label>
      <label class="random-string-charset__item">
        <input v-model="useLower" type="checkbox" />
        <span>小写字母 (a-z)</span>
      </label>
      <label class="random-string-charset__item">
        <input v-model="useSpecial" type="checkbox" />
        <span>特殊字符 (!@#$%...)</span>
      </label>
    </div>

    <div class="random-string-actions">
      <button @click="generate">生成</button>
      <button :disabled="!results.length" @click="copyResults">复制结果</button>
    </div>

    <div v-if="error" class="random-string-error">{{ error }}</div>

    <pre v-if="results.length" class="random-string-result">{{ results.join('\n') }}</pre>
  </div>
</template>

<style scoped>
.random-string {
  padding: 20px;
  box-sizing: border-box;
}

.random-string h1 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: bold;
}

.random-string-form {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 16px;
}

.random-string-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.random-string-field input[type='number'] {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
  color: inherit;
}

.random-string-charset {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.random-string-charset__label {
  font-size: 13px;
  font-weight: bold;
}

.random-string-charset__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.random-string-charset__item input[type='checkbox'] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.random-string-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.random-string-actions button {
  padding: 0 20px;
  border-radius: 4px;
}

.random-string-error {
  margin-top: 16px;
  color: #e74c3c;
  font-size: 13px;
}

.random-string-result {
  margin-top: 20px;
  padding: 16px;
  background: #fff;
  border-radius: 7px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}

@media (prefers-color-scheme: dark) {
  .random-string-field input[type='number'] {
    background: #424242;
    border-color: #555;
  }

  .random-string-result {
    background: #424242;
  }
}
</style>
