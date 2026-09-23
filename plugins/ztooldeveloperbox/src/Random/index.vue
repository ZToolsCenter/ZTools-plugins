<script setup lang="ts">
import { ref } from 'vue'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const min = ref(1)
const max = ref(100)
const count = ref(1)
const isInteger = ref(true)
const decimalPlaces = ref(2)
const results = ref<string[]>([])
const error = ref('')

const generate = () => {
  error.value = ''
  const minVal = Number(min.value)
  const maxVal = Number(max.value)
  const countVal = Number(count.value)

  if (Number.isNaN(minVal) || Number.isNaN(maxVal) || Number.isNaN(countVal)) {
    error.value = '请输入有效的数字'
    results.value = []
    return
  }
  if (minVal > maxVal) {
    error.value = '最小值不能大于最大值'
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
    const raw = minVal + Math.random() * (maxVal - minVal)
    if (isInteger.value) {
      output.push(String(Math.floor(raw)))
    } else {
      const places = Math.max(0, Math.min(10, Number(decimalPlaces.value) || 0))
      output.push(raw.toFixed(places))
    }
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
  <div class="random">
    <h1>随机数生成</h1>

    <div class="random-form">
      <label class="random-field">
        <span>最小值</span>
        <input v-model.number="min" type="number" />
      </label>
      <label class="random-field">
        <span>最大值</span>
        <input v-model.number="max" type="number" />
      </label>
      <label class="random-field">
        <span>生成数量</span>
        <input v-model.number="count" type="number" min="1" max="1000" />
      </label>
      <label class="random-field random-field--checkbox">
        <input v-model="isInteger" type="checkbox" />
        <span>整数</span>
      </label>
      <label v-if="!isInteger" class="random-field">
        <span>小数位数</span>
        <input v-model.number="decimalPlaces" type="number" min="0" max="10" />
      </label>
    </div>

    <div class="random-actions">
      <button @click="generate">生成</button>
      <button :disabled="!results.length" @click="copyResults">复制结果</button>
    </div>

    <div v-if="error" class="random-error">{{ error }}</div>

    <pre v-if="results.length" class="random-result">{{ results.join('\n') }}</pre>
  </div>
</template>

<style scoped>
.random {
  padding: 20px;
  box-sizing: border-box;
}

.random h1 {
  margin: 0 0 20px;
  font-size: 18px;
  font-weight: bold;
}

.random-form {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 16px;
}

.random-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.random-field--checkbox {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding-top: 22px;
}

.random-field input[type='number'] {
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
  color: inherit;
}

.random-field input[type='checkbox'] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.random-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}

.random-actions button {
  padding: 0 20px;
  border-radius: 4px;
}

.random-error {
  margin-top: 16px;
  color: #e74c3c;
  font-size: 13px;
}

.random-result {
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
  .random-field input[type='number'] {
    background: #424242;
    border-color: #555;
  }

  .random-result {
    background: #424242;
  }
}
</style>
