<template>
  <div class="base-converter">
    <!-- 输入区：自定义输入进制 + 数字 -->
    <div class="block in">
      <div class="label">输入数字</div>
      <div class="radix-and-num">
        <div class="radix-input-div">
          <input
            class="radix-input"
            type="number"
            min="2"
            max="36"
            v-model.number="fromRadix"
          />
          <span class="radix-input-suffix"> 进制 </span>
        </div>
        <input
          class="num-input"
          type="text"
          :value="modelValue"
          @input="onInput"
        />
      </div>
    </div>

    <!-- 结果区：自定义目标进制 -->
    <div class="block res">
      <div class="label">转换结果</div>
      <div class="radix-and-num">
        <div class="radix-input-div">
          <input
            class="radix-input"
            type="number"
            min="2"
            max="36"
            v-model.number="toRadix"
          />
          <span class="radix-input-suffix"> 进制 </span>
        </div>
        <input
          class="num-input"
          type="text"
          placeholder="转换结果"
          :value="result"
          readonly
        />
      </div>
      <div :class="{ copy: true, done: copiedKey === 'auto' }">
        <a class="copy-a" @click="handleCopy(result, 'auto')"> COPY </a>
      </div>
    </div>

    <!-- 固定结果区：二 / 八 / 十 / 十六进制 -->
    <ItemBlock :base-value="modelValue" :base-key="fromRadix" :convert-key="2" />
    <ItemBlock :base-value="modelValue" :base-key="fromRadix" :convert-key="8" />
    <ItemBlock :base-value="modelValue" :base-key="fromRadix" :convert-key="10" />
    <ItemBlock :base-value="modelValue" :base-key="fromRadix" :convert-key="16" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ItemBlock from './ItemBlock.vue'

const props = withDefaults(defineProps<{ modelValue?: string }>(), {
  modelValue: ''
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const fromRadix = ref(10)
const toRadix = ref(2)
const copiedKey = ref('')

// 按输入进制解析，再转换为目标进制；非法输入显示为空
const result = computed(() => {
  const converted = parseInt(props.modelValue, fromRadix.value).toString(toRadix.value)
  return converted === 'NaN' ? '' : converted
})

const onInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

const handleCopy = async (text: string, key: string) => {
  copiedKey.value = key
  await navigator.clipboard.writeText(text)
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 800)
}
</script>

<style scoped>
.base-converter {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
}

.base-converter .block {
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

.base-converter .block.in .label {
  background-color: #1abc9c;
  color: #fff;
}

.base-converter .block .label {
  text-align: center;
  line-height: 40px;
  padding: 0 10px;
  border-right: 1px solid #ccc;
  background-color: #f5f7fa;
  flex-shrink: 0;
  white-space: nowrap;
}

.base-converter .block .radix-and-num {
  flex: 1;
  display: flex;
  height: 100%;
}

.base-converter .block .radix-and-num .radix-input-div {
  height: 100%;
  text-align: center;
  line-height: 40px;
  padding: 0 10px;
  border-right: 1px solid #ccc;
  background-color: #f5f7fa;
  flex-shrink: 0;
  white-space: nowrap;
}

.base-converter .block .radix-and-num .radix-input-div .radix-input {
  margin: auto;
  border: none !important;
  outline: none !important;
  font-size: 15px;
  text-align: right;
  width: 50px;
  background-color: #f5f7fa;
  color: inherit;
}

.base-converter .block .radix-and-num .radix-input-div .radix-input-suffix {
  text-align: center;
  line-height: 40px;
  padding-left: 0;
  height: 100%;
}

.base-converter .block .radix-and-num .num-input {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  border: none !important;
  outline: none !important;
  margin: 0 10px;
  background: transparent;
  color: inherit;
}

.base-converter .block .copy {
  height: 100%;
  width: 50px;
  flex-shrink: 0;
  text-align: center;
  line-height: 40px;
  background-color: #f5f7fa;
  border-left: 1px solid #ccc;
}

.base-converter .block .copy .copy-a {
  cursor: pointer;
}

.base-converter .block .copy.done {
  background-color: #67c23a;
  color: #fff;
}

@media (prefers-color-scheme: dark) {
  .base-converter .block .label,
  .base-converter .block .radix-and-num .radix-input-div,
  .base-converter .block .radix-and-num .radix-input-div .radix-input,
  .base-converter .block .copy {
    background-color: #3a3d40;
  }

  .base-converter .block,
  .base-converter .block .label,
  .base-converter .block .radix-and-num .radix-input-div,
  .base-converter .block .copy {
    border-color: #555;
  }

  .base-converter .block.in .label {
    background-color: #1abc9c;
  }

  .base-converter .block .copy.done {
    background-color: #67c23a;
  }
}
</style>
