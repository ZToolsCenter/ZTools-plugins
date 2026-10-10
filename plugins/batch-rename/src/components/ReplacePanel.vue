<script setup lang="ts">
import type { ReplaceMode, ReplaceRule } from '../core/session'

const props = defineProps<{ modelValue: ReplaceRule[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: ReplaceRule[]] }>()
const modeLabels: Record<ReplaceMode, string> = {
  text: '普通替换', first: '前 N 位', last: '后 N 位', range: '从第 X 位开始的 N 位',
  after: '某字符之后的内容', before: '某字符之前的内容',
  'after-n': '某字符之后的 N 位', 'before-n': '某字符之前的 N 位'
}

function update(index: number, patch: Partial<ReplaceRule>) {
  emit('update:modelValue', props.modelValue.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
}

function addRule() {
  emit('update:modelValue', [...props.modelValue, {
    id: globalThis.crypto?.randomUUID?.() ?? `replace-${Date.now()}`,
    mode: 'text', find: '', replacement: '', start: 1, count: 1, includeExtension: false
  }])
}

function removeRule(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, itemIndex) => itemIndex !== index))
}
</script>

<template>
  <section class="replace-panel" aria-label="查找替换规则">
    <article v-for="(rule, index) in modelValue" :key="rule.id" class="replace-rule">
      <div v-if="modelValue.length > 1" class="rule-title"><strong>规则 {{ index + 1 }}</strong><button type="button" @click="removeRule(index)">删除</button></div>
      <div class="input-row">
        <label class="material-field find-field">
          <span>查找内容</span>
          <input v-if="rule.mode !== 'first' && rule.mode !== 'last' && rule.mode !== 'range'" :value="rule.find" type="text" :placeholder="rule.mode === 'text' ? '输入要查找的字符...' : '输入定位字符...'" @input="update(index, { find: ($event.target as HTMLInputElement).value })">
          <small v-else>{{ modeLabels[rule.mode] }}</small>
          <select :value="rule.mode" :aria-label="`规则 ${index + 1} 的查找方式`" :title="modeLabels[rule.mode]" @change="update(index, { mode: ($event.target as HTMLSelectElement).value as ReplaceMode })">
            <option v-for="(label, mode) in modeLabels" :key="mode" :value="mode">{{ label }}</option>
          </select>
        </label>
        <span class="arrow" aria-hidden="true">➜</span>
        <label class="material-field"><span>替换成</span><input :value="rule.replacement" type="text" placeholder="输入替换目标内容..." @input="update(index, { replacement: ($event.target as HTMLInputElement).value })"></label>
      </div>
      <div v-if="rule.mode === 'range' || rule.mode === 'first' || rule.mode === 'last' || rule.mode === 'after-n' || rule.mode === 'before-n'" class="extra-row">
        <label v-if="rule.mode === 'range'" class="material-field"><span>起始位置</span><input :value="rule.start" type="number" min="1" @input="update(index, { start: Number(($event.target as HTMLInputElement).value) })"></label>
        <label class="material-field"><span>位数</span><input :value="rule.count" type="number" min="1" @input="update(index, { count: Number(($event.target as HTMLInputElement).value) })"></label>
      </div>
      <div class="rule-actions">
        <label class="extension-option"><input :checked="rule.includeExtension" type="checkbox" @change="update(index, { includeExtension: ($event.target as HTMLInputElement).checked })">替换文件扩展名</label>
        <button v-if="index === modelValue.length - 1" class="add-rule" type="button" @click="addRule">＋ 添加替换规则</button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.replace-panel { display: grid; gap: 12px; }
.replace-rule { display: grid; gap: 14px; }
.replace-rule + .replace-rule { padding-top: 14px; border-top: 1px solid var(--border); }
.rule-title, .rule-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.rule-title { color: var(--muted); font-size: 12px; }
.rule-title button { color: var(--error); background: transparent; }
.input-row, .extra-row { display: flex; align-items: center; gap: 16px; }
.extra-row { justify-content: flex-start; }
.extra-row .material-field { max-width: 180px; }
.material-field { flex: 1; min-width: 0; height: 48px; padding: 4px 12px; display: flex; flex-direction: column; justify-content: center; position: relative; border: 1px solid var(--border-input); border-radius: 8px; background: var(--surface-subdued); }
.material-field:focus-within { border-color: var(--primary); box-shadow: 0 0 0 2px var(--focus-ring); background: var(--surface-card); }
.material-field span { color: var(--muted); font-size: 11px; line-height: 14px; }
.material-field input { width: 100%; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 13px; }
.material-field small { color: var(--text); font-size: 13px; }
.find-field { padding-right: 44px; }
.find-field select { position: absolute; right: 7px; top: 9px; width: 29px; height: 29px; border: 0; color: var(--muted); background: var(--surface-subdued); font-size: 12px; cursor: pointer; }
.arrow { color: var(--text-muted); font-size: 20px; }
.extension-option { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; }
.extension-option input { width: 17px; height: 17px; accent-color: var(--primary); }
.add-rule { height: 32px; padding: 0 12px; border: 1px solid var(--border-input); color: var(--primary); background: var(--surface-card); font-size: 12px; }
@media (max-width: 610px) { .input-row { gap: 8px; } .material-field { padding-left: 8px; } }
</style>
