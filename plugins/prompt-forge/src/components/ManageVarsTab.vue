<script setup lang="ts">
import type { Variable } from '../types'

defineProps<{
  editVars: Variable[]
}>()

const emit = defineEmits<{
  (e: 'update:editVars', vars: Variable[]): void
  (e: 'addVar'): void
  (e: 'removeVar', idx: number): void
}>()
</script>

<template>
  <div class="vh"><h3>变量配置</h3><button class="btn" @click="emit('addVar')">+ 添加</button></div>
  <div v-if="editVars.length" class="vt">
    <div class="vr header"><div>变量名</div><div>默认值</div><div style="text-align:center">必填</div><div></div></div>
    <div v-for="(v, i) in editVars" :key="i" class="vr">
      <input :value="v.name" @input="v.name = ($event.target as HTMLInputElement).value; emit('update:editVars', [...editVars])" />
      <input :value="v.defaultValue" placeholder="默认…" @input="v.defaultValue = ($event.target as HTMLInputElement).value; emit('update:editVars', [...editVars])" />
      <div style="text-align:center"><input type="checkbox" :checked="v.required" @change="v.required = ($event.target as HTMLInputElement).checked; emit('update:editVars', [...editVars])" /></div>
      <button class="db" @click="emit('removeVar', i)">×</button>
    </div>
  </div>
  <div v-else class="empty">没有变量</div>
</template>

<style scoped>
.vh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.vh h3 { font-size: 14px; margin: 0; }
.vt { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); }
.vr { display: grid; grid-template-columns: 1fr 1fr 50px 30px; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--pf-border); }
.vr.header { font-size: 11px; font-weight: 600; color: var(--pf-text-muted); background: var(--pf-bg-elevated); }
.vr input { height: 28px; padding: 2px 6px; font-size: 12px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); }
.vr input:focus { border-color: var(--pf-accent); outline: none; }
.db { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--pf-danger); color: var(--pf-danger); background: var(--pf-danger-soft); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; }
.db:hover { background: var(--pf-danger); color: #fff; }
.empty { padding: 24px; text-align: center; color: var(--pf-text-muted); }
</style>
