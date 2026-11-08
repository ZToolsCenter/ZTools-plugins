<script setup lang="ts">
import type { Variable } from '../types'
import { shouldUseTextarea } from '../utils/index'

const props = defineProps<{
  editVars: Variable[]
}>()

const emit = defineEmits<{
  (e: 'update:editVars', vars: Variable[]): void
}>()

function updateVariable(index: number, patch: Partial<Variable>) {
  emit('update:editVars', props.editVars.map((variable, i) =>
    i === index ? { ...variable, ...patch } : variable
  ))
}

function updateDefaultValue(index: number, event: Event) {
  updateVariable(index, { defaultValue: (event.target as HTMLInputElement | HTMLTextAreaElement).value })
}

function updateRequired(index: number, event: Event) {
  updateVariable(index, { required: (event.target as HTMLInputElement).checked })
}

function hasDefaultValue(variable: Variable): boolean {
  return Boolean(variable.defaultValue?.trim())
}

function variableHint(variable: Variable): string {
  if (hasDefaultValue(variable)) {
    return variable.required
      ? '默认值已满足必填；使用时未填写或清空，仍会采用默认值'
      : '使用时未填写或清空，将采用默认值'
  }
  return variable.required
    ? '使用时必须填写，否则无法复制'
    : '可不填写；留空时变量将替换为空'
}
</script>

<template>
  <div class="vh">
    <h3>变量配置</h3>
    <span>变量由正文自动识别</span>
  </div>
  <div v-if="editVars.length" class="variable-list">
    <section v-for="(variable, index) in editVars" :key="variable.name" class="variable-card">
      <div class="variable-head">
        <code class="variable-name">{{ variable.name }}</code>
        <label class="required-control">
          <input
            type="checkbox"
            :checked="variable.required"
            @change="updateRequired(index, $event)"
          />
          <span>必填</span>
        </label>
      </div>
      <label class="default-field">
        <span>默认值</span>
        <textarea
          v-if="shouldUseTextarea(variable)"
          :value="variable.defaultValue ?? ''"
          rows="3"
          placeholder="未填写或清空时使用此默认值"
          @input="updateDefaultValue(index, $event)"
        ></textarea>
        <input
          v-else
          :value="variable.defaultValue ?? ''"
          type="text"
          placeholder="未填写或清空时使用此默认值"
          @input="updateDefaultValue(index, $event)"
        />
      </label>
      <p class="variable-hint" :class="{ required: variable.required && !hasDefaultValue(variable) }">
        {{ variableHint(variable) }}
      </p>
    </section>
  </div>
  <div v-else class="empty">在正文中添加变量后，会自动出现在这里</div>
</template>

<style scoped>
.vh { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.vh h3 { font-size: 14px; margin: 0; }
.vh > span { font-size: 11px; color: var(--pf-text-faint); }
.variable-list { display: flex; flex-direction: column; gap: 10px; }
.variable-card { padding: 12px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); }
.variable-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.variable-name { min-width: 0; color: var(--pf-accent); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.required-control { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--pf-text-secondary); font-size: 12px; cursor: pointer; user-select: none; }
.required-control input { width: 14px; height: 14px; margin: 0; accent-color: var(--pf-accent); }
.required-control input:focus-visible { outline: 2px solid var(--pf-accent); outline-offset: 2px; }
.default-field { display: flex; flex-direction: column; gap: 6px; color: var(--pf-text-muted); font-size: 11px; }
.default-field input, .default-field textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-bg); color: var(--pf-text); font-family: var(--pf-font); font-size: 12px; line-height: 1.5; }
.default-field input { height: 32px; }
.default-field textarea { min-height: 72px; max-height: 180px; resize: vertical; }
.default-field input:focus, .default-field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 2px var(--pf-accent-soft); }
.default-field input::placeholder, .default-field textarea::placeholder { color: var(--pf-text-faint); }
.variable-hint { margin: 8px 0 0; color: var(--pf-text-faint); font-size: 11px; line-height: 1.5; }
.variable-hint.required { color: var(--pf-danger); }
.empty { padding: 24px; text-align: center; color: var(--pf-text-muted); }
</style>
