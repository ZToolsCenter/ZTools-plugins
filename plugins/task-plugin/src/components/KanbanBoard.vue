<template>
  <div class="board">
    <template v-if="columns.length">
      <!-- 开始列：固定最前 -->
      <BoardColumn
        :column="columns[0]"
        :is-first="true"
        :is-last="columns.length === 1"
        @edit-task="t => emit('edit-task', t)"
      />

      <!-- 进行中列：可拖动调序，始终位于开始列与结束列之间 -->
      <draggable
        class="mid-cols"
        :list="middleColumns"
        item-key="id"
        group="cols"
        handle=".col-head"
        :animation="180"
        ghost-class="col-ghost"
        @change="persistOrder"
      >
        <template #item="{ element }">
          <BoardColumn
            :column="element"
            :is-first="false"
            :is-last="false"
            @edit-task="t => emit('edit-task', t)"
          />
        </template>
      </draggable>

      <!-- 结束列：固定最后 -->
      <BoardColumn
        v-if="endColumn"
        :column="endColumn"
        :is-first="columns.length === 1"
        :is-last="true"
        @edit-task="t => emit('edit-task', t)"
      />

      <div class="add-col" @click="showAdd = true">＋ 添加列</div>
    </template>
    <div v-else class="empty-tip">左侧点击「＋ 新建项目」开始使用</div>

    <n-modal v-model:show="showAdd" preset="dialog" title="添加列（进行中）" positive-text="添加" negative-text="取消" @positive-click="doAdd">
      <n-input v-model:value="newColName" placeholder="列名称" maxlength="12" @keyup.enter="doAdd" />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { NInput, NModal, useMessage } from 'naive-ui'
import draggable from 'vuedraggable'
import BoardColumn from './BoardColumn.vue'
import { addColumn, columns, endColumn, saveColumns } from '../store'
import type { Column } from '../types'

const emit = defineEmits<{ (e: 'edit-task', task: any): void }>()

const message = useMessage()
const showAdd = ref(false)
const newColName = ref('')

const middleColumns = ref<Column[]>([])

watch(
  columns,
  val => {
    middleColumns.value = val.slice(1, -1).map(c => ({ ...c }))
  },
  { immediate: true, deep: false }
)

function persistOrder() {
  const first = columns.value[0]
  const last = columns.value[columns.value.length - 1]
  if (!first || !last) return
  void saveColumns([first, ...middleColumns.value, last])
}

function doAdd() {
  const name = newColName.value.trim()
  if (!name) return false
  if (columns.value.some(c => c.name === name)) {
    message.warning('列名已存在')
    return false
  }
  void addColumn(name)
  newColName.value = ''
  showAdd.value = false
}
</script>

<style scoped>
.board {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 6px 18px 16px;
  overflow-x: auto;
}
.empty-tip {
  margin: auto;
  color: rgba(128, 128, 128, 0.7);
  font-size: 13px;
}
.mid-cols {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.col-ghost {
  opacity: 0.4;
}
.add-col {
  flex-shrink: 0;
  width: 120px;
  border: 1px dashed rgba(128, 128, 128, 0.4);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(128, 128, 128, 0.9);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.add-col:hover {
  border-color: #18a058;
  color: #18a058;
}
</style>
