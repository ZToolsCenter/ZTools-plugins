<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  folders,
  settings,
  terminals,
  addFolder,
  removeFolder,
  clearFolders,
  saveFolders,
  refreshTerminals,
  displayName,
  TERMINAL_LABELS
} from '../store'
import type { FolderItem } from '../store'
import type { TerminalType } from '../types'
import TerminalSelect from './TerminalSelect.vue'

// 主输入框搜索无法唯一解析时带入的关键字：过滤列表展示，无命中则显示全部
const props = defineProps<{ keyword?: string }>()

const visibleFolders = computed<FolderItem[]>(() => {
  const kw = (props.keyword || '').trim().toLowerCase()
  if (!kw) return folders.value
  const hits = folders.value.filter(
    (f) => displayName(f.path).toLowerCase().includes(kw) || f.path.toLowerCase().includes(kw)
  )
  return hits.length ? hits : folders.value
})

onMounted(() => {
  refreshTerminals()
})

// 点击条目：优先用「条目固定的终端」，其次默认终端设置，最后自动探测
function onOpen(item: FolderItem) {
  const wanted = item.terminal || settings.value.defaultTerminal || 'auto'
  try {
    window.services.openInTerminal(item.path, wanted)
  } catch (e) {
    ElMessage.error((e as Error).message || '打开失败')
  }
}

// 为单个条目固定终端；选「跟随默认」(空值) 则清除固定
function onItemTerminalChange(item: FolderItem, v: string) {
  item.terminal = (v || undefined) as TerminalType | undefined
  saveFolders()
  if (item.terminal) {
    ElMessage.success(`该条目将始终使用 ${TERMINAL_LABELS[item.terminal]} 打开`)
  }
}

// 添加文件夹：支持一次选择多个，逐条入库并汇总提示
function onAdd() {
  const picked = window.services.pickFolders()
  if (!picked.length) return
  let added = 0
  let dup = 0
  for (const p of picked) {
    if (addFolder(p)) added++
    else dup++
  }
  if (added) ElMessage.success(`已添加 ${added} 个文件夹`)
  if (dup) ElMessage.warning(`${dup} 个已在列表中`)
}

// 清空全部收藏：二次确认后清空（列表为空时不显示入口）
function onClearAll() {
  ElMessageBox.confirm(`确定清空全部 ${folders.value.length} 个收藏？此操作不可恢复。`, '清空全部', {
    confirmButtonText: '清空',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(() => {
      clearFolders()
      ElMessage.success('已清空')
    })
    .catch(() => {})
}

// ---------- 拖拽文件夹到面板添加（路径经 window.ztools.getPathForFile 获取） ----------

const dragDepth = ref(0)

function onDragEnter() {
  dragDepth.value++
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

async function onDrop(e: DragEvent) {
  dragDepth.value = 0
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  // getPathForFile 把 File 对象还原为真实文件系统路径（Electron 场景）
  const rawPaths = files
    .map((f) => (window.ztools as unknown as { getPathForFile?: (f: File) => string }).getPathForFile?.(f))
    .filter(Boolean)
  if (!rawPaths.length) {
    ElMessage.warning('无法读取拖入内容的路径')
    return
  }
  let added = 0
  let dup = 0
  const errors: string[] = []
  for (const p of rawPaths) {
    try {
      // 文件自动取父目录；路径不存在等错误单独收集
      const dir = window.services.normalizeTarget(p)
      if (addFolder(dir)) added++
      else dup++
    } catch (err) {
      errors.push((err as Error).message)
    }
  }
  if (added) ElMessage.success(`已添加 ${added} 个文件夹`)
  if (dup) ElMessage.warning(`${dup} 项已在列表中`)
  if (errors.length) ElMessage.error(errors[0])
}

function onRemove(item: FolderItem) {
  removeFolder(item.id)
}
</script>

<template>
  <div
    class="qt-panel"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div class="qt-toolbar">
      <TerminalSelect />
      <div class="qt-toolbar-actions">
        <el-button v-if="folders.length" size="small" type="danger" plain @click="onClearAll">清空全部</el-button>
        <el-button type="primary" size="small" @click="onAdd">添加文件夹</el-button>
      </div>
    </div>

    <div v-if="dragDepth > 0" class="qt-drop-hint">
      <div class="qt-drop-hint-title">松手添加到此列表</div>
      <div class="qt-drop-hint-desc">支持文件夹和文件（文件自动取父目录）</div>
    </div>

    <div v-if="folders.length === 0" class="qt-empty">
      <div class="qt-empty-title">还没有收藏的文件夹</div>
      <div class="qt-empty-desc">
        点击右上角「添加文件夹」收藏常用目录；也可以直接把文件夹粘贴 / 拖入 ZTools，秒开终端。
      </div>
    </div>

    <div v-else class="qt-list">
      <div v-for="item in visibleFolders" :key="item.id" class="qt-item" @click="onOpen(item)">
        <div class="qt-item-main">
          <div class="qt-item-name">{{ displayName(item.path) }}</div>
          <div class="qt-item-path">{{ item.path }}</div>
        </div>
        <div class="qt-item-term" @click.stop>
          <el-select
            :model-value="item.terminal || ''"
            size="small"
            placeholder="跟随默认"
            style="width: 108px"
            @change="(v: string) => onItemTerminalChange(item, v)"
          >
            <el-option label="跟随默认" value="" />
            <el-option
              v-for="t in terminals"
              :key="t.type"
              :label="t.label + (t.available ? '' : '（未安装）')"
              :value="t.type"
              :disabled="!t.available"
            />
          </el-select>
        </div>
        <el-tag v-if="item.terminal" size="small" type="info" class="qt-item-tag" effect="plain">
          {{ TERMINAL_LABELS[item.terminal] || item.terminal }}
        </el-tag>
        <el-button class="qt-item-del" link type="danger" size="small" @click.stop="onRemove(item)">
          删除
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qt-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  min-height: 100%;
  box-sizing: border-box;
}

.qt-drop-hint {
  position: absolute;
  inset: 6px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  border: 2px dashed var(--el-color-primary, #409eff);
  border-radius: 10px;
  pointer-events: none;
}

.qt-drop-hint-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary, #409eff);
}

.qt-drop-hint-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.qt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.qt-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.qt-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--el-text-color-secondary, var(--text-color, #909399));
}

.qt-empty-title {
  font-size: 14px;
  margin-bottom: 6px;
}

.qt-empty-desc {
  font-size: 12px;
  line-height: 1.6;
}

.qt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qt-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--el-bg-color, var(--bg-color, transparent));
  color: var(--el-text-color-regular, var(--text-color, inherit));
  border: 1px solid var(--el-border-color-lighter, var(--border-color, #e4e7ed));
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.qt-item:hover {
  background: var(--el-fill-color-light, #f5f7fa);
  border-color: var(--el-color-primary-light-5, #a0cfff);
}

.qt-item-main {
  flex: 1;
  min-width: 0;
}

.qt-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, var(--text-color, #303133));
}

.qt-item-path {
  font-size: 12px;
  color: var(--el-text-color-secondary, var(--text-color, #909399));
  opacity: 0.75;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.qt-item-term {
  flex-shrink: 0;
}

.qt-item-tag {
  flex-shrink: 0;
}

.qt-item-del {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.qt-item:hover .qt-item-del {
  opacity: 1;
}
</style>
