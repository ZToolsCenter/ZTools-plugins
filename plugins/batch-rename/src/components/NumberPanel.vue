<script setup lang="ts">
import type { NumberRule, SequenceStyle } from '../core/session'

const props = defineProps<{ modelValue: NumberRule }>()
const emit = defineEmits<{ 'update:modelValue': [value: NumberRule] }>()

function update<K extends keyof NumberRule>(key: K, value: NumberRule[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function updateNumber(key: 'start' | 'digits', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  update(key, Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)
}

const styles: { value: SequenceStyle; label: string }[] = [
  { value: 'arabic', label: '阿拉伯数字' },
  { value: 'chinese-lower', label: '中文小写' },
  { value: 'chinese-upper', label: '中文大写' },
  { value: 'alpha-lower', label: '英文小写字母' },
  { value: 'alpha-upper', label: '英文大写字母' }
]
</script>

<template>
  <section class="number-panel" aria-label="自动编号设置">
    <label class="material-field"><span>序号前面字符</span><input :value="modelValue.prefix" type="text" placeholder="如：课程_" @input="update('prefix', ($event.target as HTMLInputElement).value)"></label>
    <div class="number-card">
      <label class="mini-field"><span>开始序号</span><input :value="modelValue.start" type="number" min="0" step="1" @input="updateNumber('start', $event)"></label>
      <label class="mini-field"><span>序号类型</span><select :value="modelValue.style" @change="update('style', ($event.target as HTMLSelectElement).value as SequenceStyle)"><option v-for="style in styles" :key="style.value" :value="style.value">{{ style.label }}</option></select></label>
      <label v-if="modelValue.style === 'arabic'" class="mini-field"><span>固定位数</span><input :value="modelValue.digits || ''" type="number" min="0" step="1" placeholder="如：2" @input="updateNumber('digits', $event)"></label>
    </div>
    <label class="material-field"><span>序号后面字符</span><input :value="modelValue.suffix" type="text" placeholder="如：_完成版" @input="update('suffix', ($event.target as HTMLInputElement).value)"></label>
  </section>
</template>

<style scoped>
.number-panel { display: grid; grid-template-columns: minmax(0, 1fr) 210px minmax(0, 1fr); align-items: center; gap: 26px; height: 100%; }
.material-field, .mini-field { min-width: 0; display: flex; flex-direction: column; justify-content: center; border: 1px solid var(--border-input); border-radius: 8px; background: var(--surface-subdued); }
.material-field { height: 68px; padding: 8px 14px; }
.mini-field { height: 44px; padding: 4px 12px; border-radius: 5px; }
.material-field:focus-within, .mini-field:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--focus-ring); }
label span { color: var(--muted); font-size: 11px; }
label input, label select { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 13px; }
.number-card { padding: 10px; display: grid; gap: 6px; border: 1px solid var(--border-input); border-radius: 8px; }
@media (max-width: 760px) { .number-panel { grid-template-columns: 1fr 1fr; gap: 10px; } .number-card { grid-row: span 2; grid-column: 2; } }
</style>
