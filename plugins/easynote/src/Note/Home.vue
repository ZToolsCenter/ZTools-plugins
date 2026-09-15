<template>
  <div class="home">
    <div class="home-section">
      <span class="home-label">编辑模式</span>
      <el-radio-group :model-value="settings.mode" size="small" @change="onMode">
        <el-radio-button value="wysiwyg">所见即所得</el-radio-button>
        <el-radio-button value="split">双栏</el-radio-button>
      </el-radio-group>
      <div class="home-font">
        <span class="home-label">字号</span>
        <el-button
          size="small"
          :icon="Minus"
          circle
          :disabled="settings.fontSize <= 12"
          @click="decFont"
        />
        <span class="home-font-val">{{ settings.fontSize }}</span>
        <el-button
          size="small"
          :icon="Plus"
          circle
          :disabled="settings.fontSize >= 28"
          @click="incFont"
        />
      </div>
    </div>

    <div class="home-actions">
      <el-button type="primary" :icon="Plus" @click="$emit('new')">新建便签</el-button>
      <span class="home-tip">在便利贴内可 Ctrl+滚轮 调字号</span>
    </div>

    <div class="home-columns">
      <HomeColumn
        title="笔记"
        empty-text="暂无笔记"
        :items="notes"
        tag-type="primary"
        @open="$emit('open', $event)"
        @open-sticky="$emit('openSticky', $event)"
        @change-type="onChangeType"
        @delete="onDelete"
        @clear="onClear('note')"
      />

      <HomeColumn
        title="待办"
        empty-text="暂无待办"
        :items="todos"
        tag-type="warning"
        @open="$emit('open', $event)"
        @open-sticky="$emit('openSticky', $event)"
        @change-type="onChangeType"
        @delete="onDelete"
        @clear="onClear('todo')"
      >
        <template #count>{{ doneCount }}/{{ todos.length }}</template>
        <template #prefix="{ item }">
          <el-checkbox
            class="home-item-check"
            :model-value="item.done"
            @click.stop
            @change="onToggleDone(item.id)"
          />
        </template>
      </HomeColumn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Minus } from '@element-plus/icons-vue'
import HomeColumn from './components/HomeColumn.vue'
import { useNotes } from './composables/useNotes'
import { useSettings } from './composables/useSettings'

defineEmits<{
  (e: 'new'): void
  (e: 'open', id: string): void
  (e: 'openSticky', id: string): void
}>()

const { sortedNotes, deleteNote, clearByType, toggleDone, changeType } = useNotes()
const { settings, setMode, setFontSize } = useSettings()

const notes = computed(() => sortedNotes.value.filter((n) => n.type === 'note'))
const todos = computed(() => {
  const list = sortedNotes.value.filter((n) => n.type === 'todo')
  // 未完成在上，已完成在下；各组内按 updatedAt 降序
  return list.sort((a, b) => Number(a.done) - Number(b.done))
})
const doneCount = computed(() => todos.value.filter((n) => n.done).length)

function onMode(v: string | number | boolean | undefined) {
  setMode(v as 'wysiwyg' | 'split')
}
function incFont() {
  setFontSize(settings.value.fontSize + 1)
}
function decFont() {
  setFontSize(settings.value.fontSize - 1)
}
function onDelete(id: string) {
  deleteNote(id)
}
function onToggleDone(id: string) {
  toggleDone(id)
}
function onChangeType(id: string) {
  changeType(id)
}

/** 清空指定类型的便签：二次确认后删除该栏全部条目 */
async function onClear(type: 'note' | 'todo') {
  const list = type === 'note' ? notes.value : todos.value
  if (!list.length) return

  const label = type === 'note' ? '笔记' : '待办'
  try {
    await ElMessageBox.confirm(
      `将删除全部 ${list.length} 条${label}，删除后无法恢复。`,
      `清空${label}`,
      {
        type: 'warning',
        confirmButtonText: '确认清空',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        closeOnClickModal: false
      }
    )
  } catch {
    return // 取消
  }

  const removed = clearByType(type)
  if (removed) ElMessage.success(`已删除 ${removed} 条${label}`)
}
</script>
