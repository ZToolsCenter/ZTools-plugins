<script lang="ts" setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

const inputValue = ref('')
const encoding = ref<'utf-8' | 'gbk'>('utf-8')
const isDark = ref(false)

// 初始化当前主题
isDark.value = window.ztools.isDarkColors()

// 同步进入参数中的粘贴文本到输入框
watch(
  () => props.enterAction?.inputState?.pastedText,
  (pastedText) => {
    inputValue.value = typeof pastedText === 'string' ? pastedText : ''
  },
  {
    immediate: true
  }
)

// 计算当前输入框中的字符串长度
const textLength = computed(() => inputValue.value.length)

// 计算当前输入框内容的字节数
const byteLength = computed(() => {
  if (encoding.value === 'utf-8') {
    return new TextEncoder().encode(inputValue.value).length
  }

  return Array.from(inputValue.value).reduce((total, char) => {
    const codePoint = char.codePointAt(0) ?? 0

    if (codePoint <= 0x7f) {
      return total + 1
    }

    return total + 2
  }, 0)
})
</script>

<template>
  <div class="calcu-page" :class="{ dark: isDark }">
    <div class="calcu-panel">
      <textarea
        v-model="inputValue"
        class="calcu-input"
        placeholder="请输入内容"
      />
      <div class="calcu-footer">
        <div class="encoding-group">
          <label class="encoding-option" :class="{ active: encoding === 'utf-8' }">
            <input v-model="encoding" type="radio" value="utf-8" name="encoding" />
            <span class="encoding-dot"></span>
            <span class="encoding-text">UTF-8</span>
          </label>
          <label class="encoding-option" :class="{ active: encoding === 'gbk' }">
            <input v-model="encoding" type="radio" value="gbk" name="encoding" />
            <span class="encoding-dot"></span>
            <span class="encoding-text">GBK</span>
          </label>
        </div>
        <div class="calcu-length">
          <span class="length-item">字符数：{{ textLength }}</span>
          <span class="length-item">字节数：{{ byteLength }}</span>
        </div>
      </div>
    </div>
    </div>
</template>

<style scoped>
.calcu-page {
  --page-bg-start: #f2f7f8;
  --page-bg-end: #e5edf0;
  --page-glow: rgba(56, 189, 248, 0.07);
  --panel-border: rgba(255, 255, 255, 0.68);
  --panel-bg: rgba(247, 250, 252, 0.78);
  --panel-shadow: rgba(15, 23, 42, 0.1);
  --input-border: #d7e1e7;
  --input-bg: rgba(253, 255, 255, 0.92);
  --input-color: #21313c;
  --input-shadow: rgba(33, 49, 60, 0.03);
  --focus-shadow: rgba(14, 116, 144, 0.08);
  --footer-border: #dde6eb;
  --footer-bg-start: rgba(255, 255, 255, 0.84);
  --footer-bg-end: rgba(241, 246, 248, 0.9);
  --option-border: #d8e2e8;
  --option-bg: rgba(250, 252, 253, 0.9);
  --option-color: #596f7b;
  --option-hover-border: #8ecdd9;
  --option-hover-shadow: rgba(8, 145, 178, 0.07);
  --option-active-text: #17465b;
  --option-active-bg-start: #eff7fa;
  --option-active-bg-end: #e5f0f4;
  --option-active-shadow: rgba(14, 116, 144, 0.08);
  --dot-border: #a7bac4;
  --dot-bg: #ffffff;
  --text-primary: #314651;
  min-height: 100vh;
  padding: 24px;
  box-sizing: border-box;
  background:
    radial-gradient(circle at top left, var(--page-glow), transparent 28%),
    linear-gradient(120deg, rgba(255, 255, 255, 0.28) 0%, transparent 38%),
    linear-gradient(180deg, var(--page-bg-start) 0%, var(--page-bg-end) 100%);
}

.calcu-page.dark {
  --page-bg-start: #111827;
  --page-bg-end: #0b1220;
  --page-glow: rgba(56, 189, 248, 0.18);
  --panel-border: rgba(148, 163, 184, 0.18);
  --panel-bg: rgba(15, 23, 42, 0.82);
  --panel-shadow: rgba(2, 6, 23, 0.45);
  --input-border: #334155;
  --input-bg: rgba(15, 23, 42, 0.95);
  --input-color: #e5eefb;
  --input-shadow: rgba(2, 6, 23, 0.28);
  --focus-shadow: rgba(56, 189, 248, 0.18);
  --footer-border: #334155;
  --footer-bg-start: #111827;
  --footer-bg-end: #172033;
  --option-border: #334155;
  --option-bg: #0f172a;
  --option-color: #cbd5e1;
  --option-hover-border: #38bdf8;
  --option-hover-shadow: rgba(56, 189, 248, 0.12);
  --option-active-text: #e0f2fe;
  --option-active-bg-start: #0f2b46;
  --option-active-bg-end: #123553;
  --option-active-shadow: rgba(56, 189, 248, 0.16);
  --dot-border: #64748b;
  --dot-bg: #0f172a;
  --text-primary: #e5eefb;
}

.calcu-panel {
  height: calc(100vh - 48px);
  padding: 18px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  background: var(--panel-bg);
  box-shadow:
    0 18px 44px var(--panel-shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(12px);
  position: relative;
  overflow: hidden;
}

.calcu-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(56, 189, 248, 0.035), transparent 24%);
}

.calcu-input {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  padding: 18px 20px;
  box-sizing: border-box;
  border: 1px solid var(--input-border);
  border-radius: 10px;
  font-size: 16px;
  line-height: 1.6;
  resize: none;
  outline: none;
  color: var(--input-color);
  background: var(--input-bg);
  box-shadow: inset 0 1px 2px var(--input-shadow);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.calcu-input::placeholder {
  color: color-mix(in srgb, var(--input-color) 55%, transparent);
}

.calcu-input:focus {
  border-color: #0891b2;
  box-shadow:
    0 0 0 4px var(--focus-shadow),
    0 10px 24px rgba(14, 116, 144, 0.05);
}

.calcu-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--footer-border);
  border-radius: 10px;
  background: linear-gradient(180deg, var(--footer-bg-start) 0%, var(--footer-bg-end) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
}

.encoding-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.encoding-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--option-border);
  border-radius: 10px;
  color: var(--option-color);
  background: var(--option-bg);
  cursor: pointer;
  transition: all 0.2s ease;
}

.encoding-option:hover {
  border-color: var(--option-hover-border);
  box-shadow: 0 8px 18px var(--option-hover-shadow);
  transform: translateY(-1px);
}

.encoding-option.active {
  border-color: #0284c7;
  color: var(--option-active-text);
  background: linear-gradient(180deg, var(--option-active-bg-start) 0%, var(--option-active-bg-end) 100%);
  box-shadow: 0 8px 18px var(--option-active-shadow);
}

.encoding-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.encoding-dot {
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border: 2px solid var(--dot-border);
  border-radius: 50%;
  background: var(--dot-bg);
  transition: all 0.2s ease;
}

.encoding-option.active .encoding-dot {
  border-color: #0284c7;
  box-shadow: inset 0 0 0 4px #0284c7;
}

.encoding-text {
  font-size: 14px;
  font-weight: 600;
}

.calcu-length {
  display: flex;
  gap: 24px;
  font-size: 16px;
  color: var(--text-primary);
  flex-wrap: wrap;
}

.length-item {
  padding: 6px 0;
  font-weight: 600;
  letter-spacing: 0.01em;
}

@media (max-width: 720px) {
  .calcu-page {
    padding: 16px;
  }

  .calcu-panel {
    height: calc(100vh - 32px);
    padding: 14px;
    border-radius: 12px;
  }

  .calcu-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .calcu-length {
    gap: 16px;
  }
}
</style>
