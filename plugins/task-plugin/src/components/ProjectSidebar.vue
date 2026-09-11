<template>
  <div class="proj-list">
    <n-button size="small" block dashed @click="showCreate = true">＋ 新建项目</n-button>
    <n-scrollbar class="list-scroll">
      <div
        v-for="p in projects"
        :key="p._id"
        class="item"
        :class="{ active: p._id === currentProjectId }"
        @click="selectProject(p._id)"
      >
        <span class="label">{{ p.name }}</span>
        <span class="ops" @click.stop>
          <button class="op" title="重命名" @click="startRename(p)">✎</button>
          <button class="op danger" title="删除" @click="confirmDelete(p)">✕</button>
        </span>
      </div>
    </n-scrollbar>

    <n-modal v-model:show="showCreate" preset="dialog" title="新建项目" positive-text="创建" negative-text="取消" @positive-click="doCreate">
      <n-input v-model:value="newName" placeholder="项目名称" maxlength="30" @keyup.enter="doCreate" />
    </n-modal>

    <n-modal v-model:show="showRename" preset="dialog" title="重命名项目" positive-text="保存" negative-text="取消" @positive-click="doRename">
      <n-input v-model:value="renameName" placeholder="项目名称" maxlength="30" @keyup.enter="doRename" />
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import {
  createProject,
  currentProjectId,
  deleteProject,
  projects,
  renameProject,
  selectProject
} from '../store'
import type { ProjectDoc } from '../types'

const message = useMessage()

const showCreate = ref(false)
const newName = ref('')
const showRename = ref(false)
const renameName = ref('')
let renaming: ProjectDoc | null = null

function doCreate() {
  const name = newName.value.trim()
  if (!name) return false
  if (projects.value.some(p => p.name === name)) {
    message.warning('项目已存在')
    return false
  }
  void createProject(name)
  newName.value = ''
  showCreate.value = false
}function startRename(p: ProjectDoc) {
  renaming = p
  renameName.value = p.name
  showRename.value = true
}

function doRename() {
  if (!renaming) return
  void renameProject(renaming, renameName.value.trim())
  showRename.value = false
  renaming = null
}

function confirmDelete(p: ProjectDoc) {
  window.confirm(`删除项目「${p.name}」及其全部任务？`) && void deleteProject(p)
}
</script>

<style scoped>
.proj-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.list-scroll {
  flex: 1;
  min-height: 0;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(24, 160, 88, 0.14);
  color: #18a058;
  font-weight: 600;
}
.label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ops {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.item:hover .ops {
  display: inline-flex;
}
.op {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  opacity: 0.65;
}
.op:hover {
  background: rgba(128, 128, 128, 0.2);
  opacity: 1;
}
.op.danger:hover {
  color: #d03050;
}
</style>
