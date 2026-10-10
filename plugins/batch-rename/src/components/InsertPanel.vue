<script setup lang="ts">
import type { InsertInfo, InsertRule, SequenceStyle } from '../core/session'

const props = defineProps<{ modelValue: InsertRule }>()
const emit = defineEmits<{ 'update:modelValue': [value: InsertRule] }>()
const sequenceStyles: { value: SequenceStyle; label: string }[] = [
  { value: 'arabic', label: '阿拉伯数字' }, { value: 'chinese-lower', label: '中文小写数字' },
  { value: 'chinese-upper', label: '中文大写数字' }, { value: 'alpha-lower', label: '英文小写字母' },
  { value: 'alpha-upper', label: '英文大写字母' }
]
const information: { value: InsertInfo; label: string }[] = [
  { value: 'created', label: '文件创建时间' }, { value: 'modified', label: '文件修改时间' },
  { value: 'size', label: '文件大小' }, { value: 'dimensions', label: '图片尺寸（宽×高）' },
  { value: 'captured', label: '照片拍摄时间' }
]

function update<K extends keyof InsertRule>(key: K, value: InsertRule[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function updateNumber<K extends keyof InsertRule['number']>(key: K, value: InsertRule['number'][K]) {
  update('number', { ...props.modelValue.number, [key]: value })
}

function numericValue(event: Event, minimum: number) {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? Math.max(minimum, Math.trunc(value)) : minimum
}
</script>

<template>
  <section class="insert-panel" aria-label="插入内容设置">
    <div class="segmented-row">
      <div class="segmented-group"><span>内容：</span><div class="segmented-tabs">
        <button v-for="option in ([['text', '文本'], ['number', '序号'], ['info', '文件信息']] as const)" :key="option[0]" type="button"
          :class="{ active: modelValue.kind === option[0] }" @click="update('kind', option[0])">{{ option[1] }}</button>
      </div></div>
      <div class="segmented-group"><span>位置：</span><div class="segmented-tabs">
        <button v-for="option in ([['start', '开头'], ['index', '指定位置'], ['end', '末尾']] as const)" :key="option[0]" type="button"
          :class="{ active: modelValue.position === option[0] }" @click="update('position', option[0])">{{ option[1] }}</button>
      </div></div>
    </div>
    <div v-if="modelValue.kind === 'text'" class="single-row">
      <label class="material-field"><span>固定文本内容</span><input :value="modelValue.text" type="text" placeholder="输入要插入的固定文本..." @input="update('text', ($event.target as HTMLInputElement).value)"></label>
      <label v-if="modelValue.position === 'index'" class="material-field index-field"><span>位置（从 1 开始）</span><input :value="modelValue.index" type="number" min="1" @input="update('index', numericValue($event, 1))"></label>
    </div>
    <div v-else-if="modelValue.kind === 'number'" class="three-cols">
      <label class="material-field"><span>序号前面字符</span><input :value="modelValue.number.prefix" type="text" placeholder="如：Part_" @input="updateNumber('prefix', ($event.target as HTMLInputElement).value)"></label>
      <div class="number-card">
        <label class="mini-field"><span>开始序号</span><input :value="modelValue.number.start" type="number" min="0" @input="updateNumber('start', numericValue($event, 0))"></label>
        <label class="mini-field"><span>序号类型</span><select :value="modelValue.number.style" @change="updateNumber('style', ($event.target as HTMLSelectElement).value as SequenceStyle)"><option v-for="style in sequenceStyles" :key="style.value" :value="style.value">{{ style.label }}</option></select></label>
        <label v-if="modelValue.number.style === 'arabic'" class="mini-field"><span>固定位数（补零）</span><input :value="modelValue.number.digits || ''" type="number" min="0" placeholder="如：2" @input="updateNumber('digits', numericValue($event, 0))"></label>
      </div>
      <label class="material-field"><span>序号后面字符</span><input :value="modelValue.number.suffix" type="text" placeholder="如：_HD" @input="updateNumber('suffix', ($event.target as HTMLInputElement).value)"></label>
    </div>
    <div v-else class="three-cols">
      <label class="material-field"><span>文件信息前面字符</span><input :value="modelValue.prefix" type="text" placeholder="如：[" @input="update('prefix', ($event.target as HTMLInputElement).value)"></label>
      <label class="material-field"><span>文件信息类型</span><select :value="modelValue.info" @change="update('info', ($event.target as HTMLSelectElement).value as InsertInfo)"><option v-for="item in information" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <label class="material-field"><span>文件信息后面字符</span><input :value="modelValue.suffix" type="text" placeholder="如：]" @input="update('suffix', ($event.target as HTMLInputElement).value)"></label>
    </div>
    <label v-if="modelValue.position === 'index' && modelValue.kind !== 'text'" class="position-field">指定位置（从 1 开始）<input :value="modelValue.index" type="number" min="1" @input="update('index', numericValue($event, 1))"></label>
  </section>
</template>

<style scoped>
.insert-panel { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; align-items: start; gap: 14px; height: 100%; }
.segmented-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.segmented-group { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; white-space: nowrap; }
.segmented-tabs { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-subdued); }
.segmented-tabs button { padding: 5px 11px; color: var(--muted); background: transparent; font-size: 12px; }
.segmented-tabs button.active { color: var(--primary); background: var(--surface-card); box-shadow: 0 1px 3px rgba(15, 23, 42, .08); font-weight: 600; }
.single-row, .three-cols { display: flex; align-items: center; align-self: center; gap: 14px; }
.three-cols { display: grid; grid-template-columns: minmax(0, 1fr) 220px minmax(0, 1fr); }
.material-field, .mini-field { min-width: 0; display: flex; flex-direction: column; justify-content: center; border: 1px solid var(--border-input); border-radius: 8px; background: var(--surface-subdued); }
.material-field { flex: 1; height: 68px; padding: 8px 14px; }
.mini-field { height: 42px; padding: 4px 10px; border-radius: 5px; }
.material-field:focus-within, .mini-field:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--focus-ring); }
label span { color: var(--muted); font-size: 11px; }
label input, label select { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 13px; }
.index-field { flex: none; width: 150px; }
.number-card { display: grid; gap: 4px; padding: 7px; border: 1px solid var(--border); border-radius: 8px; }
.insert-panel:has(.position-field) .mini-field { height: 32px; }
.position-field { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.position-field input { width: 70px; padding: 5px; border: 1px solid var(--border-input); border-radius: 5px; }
@media (max-width: 780px) { .segmented-row { flex-wrap: wrap; } .three-cols { grid-template-columns: 1fr 1fr; } .number-card { grid-row: span 2; grid-column: 2; } }
</style>
