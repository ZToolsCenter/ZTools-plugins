<script setup lang="ts">
import {
  OPERATOR_OPTIONS,
  isGroup,
  type CombineMode,
  type QueryGroup,
  type QueryNode,
  type QueryOperator,
  type SearchCondition,
} from '../services/queryBuilder'
import SearchableSelect from './SearchableSelect.vue'

defineProps<{
  group: QueryGroup
  fieldOptions: Array<{ value: string; label: string }>
  depth?: number
}>()

const emit = defineEmits<{ remove: [] }>()

const combineOptions = [
  { value: 'must', label: '并且 (AND)' },
  { value: 'should', label: '或者 (OR)' },
]

const operatorOptions = OPERATOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

function needsValue(op: SearchCondition['operator']) {
  return OPERATOR_OPTIONS.find((o) => o.value === op)?.needsValue ?? true
}

function needsRange(op: SearchCondition['operator']) {
  return OPERATOR_OPTIONS.find((o) => o.value === op)?.needsRange ?? false
}

function removeChild(group: QueryGroup, id: string) {
  group.children = group.children.filter((c) => c.id !== id)
}

function asCond(n: QueryNode): SearchCondition {
  return n as SearchCondition
}

function asGroup(n: QueryNode): QueryGroup {
  return n as QueryGroup
}

function setCombine(group: QueryGroup, v: string) {
  group.combine = (v === 'should' ? 'should' : 'must') as CombineMode
}

function setField(cond: SearchCondition, v: string) {
  cond.field = v
}

function setOperator(cond: SearchCondition, v: string) {
  cond.operator = v as QueryOperator
}
</script>

<template>
  <div class="group" :class="{ nested: (depth ?? 0) > 0 }">
    <div v-if="(depth ?? 0) > 0" class="hrow group-head">
      <span class="muted">子组</span>
      <SearchableSelect
        :model-value="group.combine"
        :options="combineOptions"
        width="140px"
        @update:model-value="setCombine(group, $event)"
      />
      <button class="btn btn-sm btn-danger" type="button" @click="emit('remove')">
        删除组
      </button>
    </div>

    <div v-for="(child, idx) in group.children" :key="child.id" class="child">
      <ConditionGroup
        v-if="isGroup(child)"
        :group="asGroup(child)"
        :field-options="fieldOptions"
        :depth="(depth ?? 0) + 1"
        @remove="removeChild(group, child.id)"
      />
      <template v-else>
        <div class="cond hrow">
          <SearchableSelect
            :model-value="asCond(child).field"
            :options="fieldOptions"
            width="180px"
            placeholder="选择字段"
            @update:model-value="setField(asCond(child), $event)"
          />
          <SearchableSelect
            :model-value="asCond(child).operator"
            :options="operatorOptions"
            width="120px"
            @update:model-value="setOperator(asCond(child), $event)"
          />
          <input
            v-if="needsValue(asCond(child).operator)"
            v-model="asCond(child).value"
            class="form-control form-control-sm cond-val"
            :placeholder="needsRange(asCond(child).operator) ? '起始值' : '值'"
          />
          <input
            v-if="needsRange(asCond(child).operator)"
            v-model="asCond(child).valueTo"
            class="form-control form-control-sm cond-val"
            placeholder="结束值"
          />
          <SearchableSelect
            v-if="idx < group.children.length - 1"
            :model-value="group.combine"
            :options="combineOptions"
            width="120px"
            @update:model-value="setCombine(group, $event)"
          />
          <button class="btn btn-sm btn-danger" type="button" @click="removeChild(group, child.id)">
            删除
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group.nested {
  margin-left: 10px;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.group-head {
  gap: 6px;
}
.cond {
  gap: 6px;
  flex-wrap: nowrap;
  align-items: center;
  width: 100%;
}
.cond-val {
  width: 120px;
  flex: 1 1 100px;
  min-width: 80px;
}
.child {
  min-width: 0;
}
@media (max-width: 900px) {
  .cond {
    flex-wrap: wrap;
  }
}
</style>
