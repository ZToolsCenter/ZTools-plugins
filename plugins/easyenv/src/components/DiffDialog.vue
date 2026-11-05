<script setup lang="ts">
import { computed } from 'vue'
import type { DiffItem } from '../api'

const props = defineProps<{
  modelValue: boolean
  userDiff: DiffItem[]
  machineDiff: DiffItem[]
  isAdmin: boolean
  applying?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

const total = computed(() => props.userDiff.length + props.machineDiff.length)
const needUac = computed(() => props.machineDiff.length > 0 && !props.isAdmin)

function tagType(state: DiffItem['state']) {
  if (state === 'add') return 'success'
  if (state === 'update') return 'warning'
  return 'danger'
}

function stateText(state: DiffItem['state']) {
  if (state === 'add') return '新增'
  if (state === 'update') return '修改'
  return '删除'
}

// 长值折叠：只展示首尾，避免 PATH 撑爆弹窗
function brief(v?: string) {
  const s = String(v ?? '')
  if (s.length <= 200) return s || '（空）'
  return s.slice(0, 120) + ' … ' + s.slice(-60)
}
</script>

<template>
  <el-dialog v-model="visible" title="确认修改" width="90%" top="10vh">
    <div class="diff-summary">
      共 <b>{{ total }}</b> 项变更
      <template v-if="needUac">
        ，系统变量写入将触发一次 UAC 提权确认
      </template>
    </div>

    <div v-for="group in [
      { key: 'user', label: '用户变量', items: userDiff },
      { key: 'machine', label: '系统变量', items: machineDiff }
    ]" :key="group.key">
      <div v-if="group.items.length" class="diff-group-title">{{ group.label }}</div>
      <div v-for="item in group.items" :key="group.key + item.name" class="diff-item">
        <el-tag :type="tagType(item.state)" size="small" effect="dark">
          {{ stateText(item.state) }}
        </el-tag>
        <span class="diff-name">{{ item.name || '(默认)' }}</span>
        <div class="diff-values">
          <template v-if="item.state === 'update'">
            <div class="diff-before">- {{ brief(item.before) }}</div>
            <div class="diff-after">+ {{ brief(item.after) }}</div>
          </template>
          <template v-else-if="item.state === 'add'">
            <div class="diff-after">+ {{ brief(item.after) }}</div>
          </template>
          <template v-else>
            <div class="diff-before">- {{ brief(item.before) }}</div>
          </template>
        </div>
      </div>
    </div>

    <div class="tip diff-tip">
      应用前会自动创建一份快照，改错可在「快照」里一键回滚。已打开的终端不会读到新值，需要重开。
    </div>

    <template #footer>
      <el-button @click="visible = false">返回修改</el-button>
      <el-button type="primary" :loading="applying" @click="emit('confirm')">
        应用 {{ total }} 项修改
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.diff-summary {
  font-size: 13px;
  margin-bottom: 10px;
  color: var(--el-text-color-regular);
}
.diff-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin: 12px 0 6px;
}
.diff-item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.diff-name {
  margin-left: 8px;
  font-weight: 600;
  font-family: Consolas, 'Courier New', monospace;
  word-break: break-all;
}
.diff-values {
  margin-top: 6px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
}
.diff-before {
  color: var(--el-color-danger);
}
.diff-after {
  color: var(--el-color-success);
}
.diff-tip {
  margin-top: 4px;
}
</style>
