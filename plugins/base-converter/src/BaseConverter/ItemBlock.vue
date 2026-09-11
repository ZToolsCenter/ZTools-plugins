<template>
  <div class="block">
    <div class="label">转换结果</div>
    <div class="radix-and-num">
      <div class="radix-input-div">{{ radixName }}</div>
      <input
        class="num-input"
        type="text"
        :placeholder="placeholder"
        :value="result"
        readonly
      />
    </div>
    <div :class="{ copy: true, done: copied }">
      <a class="copy-a" @click="handleCopy"> COPY </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    baseValue?: string
    baseKey?: number
    convertKey?: number
  }>(),
  {
    baseValue: '0',
    baseKey: 10,
    convertKey: 10
  }
)

const RADIX_NAMES: Record<number, string> = {
  2: '二进制',
  8: '八进制',
  10: '十进制',
  16: '十六进制'
}

// 按输入进制解析，再转换为目标进制；非法输入显示为空
const result = computed(() => {
  const num = parseInt(props.baseValue, props.baseKey)
  const converted = num.toString(props.convertKey)
  return converted === 'NaN' ? '' : converted
})

const radixName = computed(() => RADIX_NAMES[props.convertKey] || '')
const placeholder = computed(() => `${radixName.value}转换结果`)

const copied = ref(false)
const handleCopy = async () => {
  await navigator.clipboard.writeText(result.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 800)
}
</script>

<style scoped>
.block {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: 42px;
  border: 1px solid #ccc;
  align-items: center;
  margin-bottom: 10px;
  border-radius: 5px;
  overflow: hidden;
}

.block .label {
  text-align: center;
  line-height: 40px;
  padding: 0 10px;
  border-right: 1px solid #ccc;
  background-color: #f5f7fa;
  flex-shrink: 0;
  white-space: nowrap;
}

.block .radix-and-num {
  flex: 1;
  display: flex;
  height: 100%;
}

.block .radix-and-num .radix-input-div {
  height: 100%;
  text-align: center;
  line-height: 40px;
  padding: 0 10px;
  border-right: 1px solid #ccc;
  background-color: #f5f7fa;
  flex-shrink: 0;
  white-space: nowrap;
}

.block .radix-and-num .num-input {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  border: none !important;
  outline: none !important;
  margin: 0 10px;
  background: transparent;
  color: inherit;
}

.block .copy {
  height: 100%;
  width: 50px;
  flex-shrink: 0;
  text-align: center;
  line-height: 40px;
  background-color: #f5f7fa;
  border-left: 1px solid #ccc;
}

.block .copy .copy-a {
  cursor: pointer;
}

.block .copy.done {
  background-color: #67c23a;
  color: #fff;
}

@media (prefers-color-scheme: dark) {
  .block .label,
  .block .radix-and-num .radix-input-div,
  .block .copy {
    background-color: #3a3d40;
  }

  .block,
  .block .label,
  .block .radix-and-num .radix-input-div,
  .block .copy {
    border-color: #555;
  }

  .block .copy.done {
    background-color: #67c23a;
  }
}
</style>
