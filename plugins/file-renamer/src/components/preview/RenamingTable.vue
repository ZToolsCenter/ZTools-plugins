<script setup lang="ts">
/**
 * 重命名预览表格组件。
 * @description 显示文件列表及其重命名预览结果，支持批量选择、删除、还原操作
 * @requires FileItem 文件数据类型定义
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileItem } from '@/core/types'
import {
  FROverflowTooltipText,
  FRTooltip,
  FRTable,
  FRTableBody,
  FRTableCell,
  FRTableHead,
  FRTableHeader,
  FRTableRow,
} from '@/components/ui'
import {
  Circle,
  Check,
  FileIcon,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode2,
  FileArchive,
  Folder,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  Undo2
} from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const { t } = useI18n()

const props = defineProps<{
  files: FileItem[]
}>()

const emit = defineEmits<{
  (e: 'remove-file', fileId: string): void
  (e: 'remove-files', fileIds: string[]): void
  (e: 'revert-file', fileId: string): void
  (e: 'revert-files', fileIds: string[]): void
  (e: 'selection-change', selection: { count: number; ids: string[] }): void
}>()

const selectedIds = ref<string[]>([])

const allSelected = computed(() => props.files.length > 0 && selectedIds.value.length === props.files.length)
const selectedCount = computed(() => selectedIds.value.length)

function emitSelectionChange() {
  emit('selection-change', {
    count: selectedIds.value.length,
    ids: [...selectedIds.value]
  })
}

watch(
  () => props.files,
  (nextFiles) => {
    const ids = new Set(nextFiles.map((file) => file.id))
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id))
    emitSelectionChange()
  },
  { deep: true }
)

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDateFull(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function getFileTypeLabel(file: FileItem) {
  if (file.isDirectory) return 'FOLDER'
  const e = (file.extension || '').toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'JPEG'
  if (e === 'png') return 'PNG'
  if (e === 'pdf') return 'PDF'
  if (e === 'doc') return 'DOC'
  if (e === 'docx') return 'DOCX'
  if (e === 'mp4') return 'MP4'
  if (e === 'zip') return 'ZIP'
  return (file.extension || 'FILE').toUpperCase()
}

function getFileIcon(file: FileItem) {
  if (file.isDirectory) return Folder
  const e = (file.extension || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(e)) return FileImage
  if (['mp4', 'mov', 'avi', 'mkv'].includes(e)) return FileVideo
  if (['mp3', 'wav', 'ogg', 'flac'].includes(e)) return FileAudio
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return FileArchive
  if (['js', 'ts', 'vue', 'html', 'css', 'json', 'py', 'go', 'rb'].includes(e)) return FileCode2
  if (['txt', 'md', 'doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx'].includes(e)) return FileText
  return FileIcon
}

function getFileIconTone(ext: string) {
  const e = (ext || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(e)) return 'bg-warning-soft text-warning-foreground border-warning/35'
  if (['pdf'].includes(e)) return 'bg-info-soft text-info-foreground border-info/35'
  if (['doc', 'docx', 'txt', 'md'].includes(e)) return 'bg-success-soft text-success-foreground border-success/35'
  if (['mp4', 'mov', 'avi', 'mkv'].includes(e)) return 'bg-primary/12 text-primary border-primary/35'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'bg-muted text-muted-foreground border-border'
  return 'bg-muted text-muted-foreground border-border'
}

function getStatusLabel(file: FileItem) {
  if (file.status === 'success') return t('table.status_success')
  if (file.status === 'error') return t('table.status_error')
  if (file.status === 'modified') return t('table.status_modified')
  return t('table.status_idle')
}

function getStatusKey(file: FileItem) {
  if (file.status === 'success') return 'success'
  if (file.status === 'error') return 'error'
  if (file.status === 'modified') return 'modified'
  return 'idle'
}

function getStatusTone(file: FileItem) {
  if (getStatusKey(file) === 'success') {
    return 'bg-success-soft text-success-foreground border-success/35'
  }
  if (getStatusKey(file) === 'error') {
    return 'bg-destructive/12 text-destructive border-destructive/35'
  }
  if (getStatusKey(file) === 'modified') {
    return 'bg-info-soft text-info-foreground border-info/35'
  }
  return 'bg-muted text-muted-foreground border-border'
}

function getTypeBadgeTone(ext: string) {
  const e = (ext || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(e)) return 'bg-warning-soft/70 text-warning-foreground border-warning/30'
  if (['pdf'].includes(e)) return 'bg-info-soft/70 text-info-foreground border-info/30'
  if (['doc', 'docx', 'txt', 'md'].includes(e)) return 'bg-success-soft/70 text-success-foreground border-success/30'
  if (['mp4', 'mov', 'avi', 'mkv'].includes(e)) return 'bg-primary/10 text-primary border-primary/30'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'bg-muted/80 text-muted-foreground border-border'
  return 'bg-muted/80 text-muted-foreground border-border'
}

function isSelected(fileId: string) {
  return selectedIds.value.includes(fileId)
}

function toggleSelect(fileId: string) {
  if (isSelected(fileId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== fileId)
  } else {
    selectedIds.value = [...selectedIds.value, fileId]
  }
  emitSelectionChange()
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = props.files.map((file) => file.id)
  }
  emitSelectionChange()
}

function getLinkedRowTone(file: FileItem) {
  if (!isSelected(file.id)) return ''
  if (getStatusKey(file) === 'success') return 'bg-success-soft/60 border-l-2 border-l-success'
  if (getStatusKey(file) === 'error') return 'bg-destructive/8 border-l-2 border-l-destructive'
  if (getStatusKey(file) === 'modified') return 'bg-info-soft/60 border-l-2 border-l-info'
  return 'bg-muted/60 border-l-2 border-l-border'
}

function removeFile(fileId: string) {
  selectedIds.value = selectedIds.value.filter((id) => id !== fileId)
  emit('remove-file', fileId)
  emitSelectionChange()
}

function removeSelectedFiles() {
  if (selectedIds.value.length === 0) return
  const idsToRemove = [...selectedIds.value]
  selectedIds.value = []
  emit('remove-files', idsToRemove)
  emitSelectionChange()
}

function revertFile(fileId: string) {
  selectedIds.value = selectedIds.value.filter((id) => id !== fileId)
  emit('revert-file', fileId)
}

function revertSelectedFiles() {
  if (selectedIds.value.length === 0) return
  const idsToRevert = [...selectedIds.value]
  selectedIds.value = []
  emit('revert-files', idsToRevert)
  emitSelectionChange()
}

function revertFileHandler(fileId: string) {
  selectedIds.value = selectedIds.value.filter((id) => id !== fileId)
  emit('revert-file', fileId)
  emitSelectionChange()
}

function canRevert(file: FileItem) {
  return file.newName !== file.originalName || Boolean(file.lastRenamedFromPath && file.lastRenamedFromName)
}
</script>

<template>
  <div class="file-preview-table flex-1 flex flex-col min-w-0 bg-background overflow-hidden relative">
    <!-- Empty State -->
    <div v-if="files.length === 0" class="flex-1 flex flex-col items-center justify-center opacity-20 select-none">
      <div class="relative mb-6">
        <FileIcon class="w-20 h-20 stroke-1" />
        <div class="absolute -right-2 -bottom-2 p-2 bg-primary/20 rounded-full animate-pulse">
          <Clock class="w-6 h-6 text-primary" />
        </div>
      </div>
      <h3 class="text-lg font-black uppercase tracking-tighter italic text-foreground">{{ t('app.no_files') }}</h3>
      <p class="text-[10px] font-medium mt-1 text-muted-foreground">{{ t('app.no_files_desc') }}</p>
      <div class="mt-4 rounded-xl border border-primary/20 bg-primary/8 px-4 py-2 text-center">
        <p class="text-[11px] font-bold tracking-tight text-primary">{{ t('app.drag_import_title') }}</p>
        <p class="mt-0.5 text-[10px] text-muted-foreground">{{ t('app.drag_import_desc') }}</p>
      </div>
    </div>

    <div v-else
      class="mx-4 mt-4 mb-4 flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-border/75 bg-card shadow-xl shadow-primary/10">
      <div class="flex items-center justify-between border-b border-border/75 px-3 py-2">
        <span class="text-[11px] font-medium text-muted-foreground">
          {{ selectedCount > 0 ? t('table.selected_count', { count: selectedCount }) : t('table.batch_tip') }}
        </span>
      </div>

      <FRTable wrapper-class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" class="w-full table-fixed text-[13px]">
        <FRTableHeader class="sticky top-0 bg-background/92 backdrop-blur-xl z-20 border-b border-border/75">
          <FRTableRow class="hover:bg-transparent border-none">
            <FRTableHead class="w-12 text-center h-10 px-2">
              <FRTooltip :content="t('table.select_all')">
                <button type="button"
                  class="mx-auto inline-flex h-5 w-5 items-center justify-center rounded border border-input bg-background text-muted-foreground transition-colors duration-200 hover:border-primary/45 hover:text-primary cursor-pointer"
                  @click="toggleSelectAll">
                  <Check v-if="allSelected" class="h-3.5 w-3.5" />
                  <Circle v-else class="h-3.5 w-3.5" />
                </button>
              </FRTooltip>
            </FRTableHead>
            <FRTableHead class="h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">{{
              t('table.original_name') }}</FRTableHead>
            <FRTableHead class="h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">{{
              t('table.new_name') }}</FRTableHead>
            <FRTableHead
              class="hidden 2xl:table-cell 2xl:w-20 h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {{ t('table.type') }}</FRTableHead>
            <FRTableHead
              class="hidden xl:table-cell xl:w-20 h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">{{
                t('table.size') }}</FRTableHead>
            <FRTableHead
              class="hidden 2xl:table-cell 2xl:w-24 h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {{ t('table.modified') }}</FRTableHead>
            <FRTableHead class="w-20 lg:w-24 h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">{{
              t('table.status') }}</FRTableHead>
            <FRTableHead class="w-20 h-10 text-[10px] font-semibold tracking-wide text-muted-foreground">{{
              t('table.actions') }}</FRTableHead>
          </FRTableRow>
        </FRTableHeader>
        <FRTableBody class="[&_tr:last-child]:border-b-0">
          <FRTableRow v-for="file in files" :key="file.id" :class="cn(
            'group border-b border-border/70 transition-colors duration-200 hover:bg-muted/55',
            getLinkedRowTone(file)
          )">
          <!-- 选择列 -->
            <FRTableCell class="py-2 px-2 text-center">
              <FRTooltip :content="t('table.select_item')">
                <button type="button"
                  class="mx-auto inline-flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 cursor-pointer"
                  :class="isSelected(file.id)
                    ? cn('shadow-sm', getStatusTone(file))
                    : 'border-input bg-background text-muted-foreground hover:border-primary/45 hover:text-primary'"
                  @click="toggleSelect(file.id)">
                  <Check v-if="isSelected(file.id)" class="h-3.5 w-3.5" />
                  <Circle v-else class="h-3.5 w-3.5" />
                </button>
              </FRTooltip>
            </FRTableCell>
            <!-- 原始名称列 -->
            <FRTableCell class="py-2.5 px-3 overflow-hidden">
              <div class="flex min-w-0 items-center gap-3">
                <div
                  :class="cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', file.isDirectory ? 'bg-amber-soft text-amber-foreground border-amber-soft/30' : getFileIconTone(file.extension))">
                  <component :is="getFileIcon(file)" class="h-4 w-4" />
                </div>
                <FROverflowTooltipText :text="file.originalName" class="min-w-0"
                  text-class="text-[13px] font-medium text-foreground" />
              </div>
            </FRTableCell>
            <!-- 新名称列 -->
            <FRTableCell class="py-2.5 px-3 overflow-hidden">
              <FROverflowTooltipText :text="file.newName" class="min-w-0"
                text-class="text-[13px] font-semibold text-primary" />
            </FRTableCell>
            <!-- 文件类型列 -->
            <FRTableCell class="hidden 2xl:table-cell py-2.5 px-2 whitespace-nowrap">
              <span
                :class="cn('inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', file.isDirectory ? 'bg-amber-soft/70 text-amber-foreground border-amber-soft/30' : getTypeBadgeTone(file.extension))">
                {{ getFileTypeLabel(file) }}
              </span>
            </FRTableCell>
            <!-- 文件大小列 -->
            <FRTableCell class="hidden xl:table-cell py-2.5 px-2 whitespace-nowrap">
              <span class="text-[12px] text-muted-foreground">{{ formatSize(file.size) }}</span>
            </FRTableCell>
            <!-- 最后修改时间列 -->
            <FRTableCell class="hidden 2xl:table-cell py-2.5 px-2 whitespace-nowrap">
              <FRTooltip :content="formatDateFull(file.lastModified)">
                <span class="text-[12px] text-muted-foreground">{{ formatDate(file.lastModified) }}</span>
              </FRTooltip>
            </FRTableCell>
            <!-- 状态列 -->
            <FRTableCell class="py-2.5 px-2 whitespace-nowrap">
              <div class="flex items-center">
                <FRTooltip :content="file.errorMessage" :disabled="!file.errorMessage">
                  <span :class="cn(
                    'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                    getStatusTone(file)
                  )">
                    <CheckCircle2 v-if="file.status === 'success'" class="h-3.5 w-3.5" />
                    <AlertCircle v-else-if="file.status === 'error'" class="h-3.5 w-3.5" />
                    <Clock v-else-if="file.status === 'modified'" class="h-3.5 w-3.5" />
                    {{ getStatusLabel(file) }}
                  </span>
                </FRTooltip>
              </div>
            </FRTableCell>
            <!-- 操作列 -->
            <FRTableCell class="py-2.5 px-1.5 lg:px-2">
              <div class="flex items-center gap-1">
                <FRTooltip :content="t('table.revert')">
                  <button type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-warning/30 bg-warning-soft text-warning-foreground transition-colors duration-200 hover:border-warning/45 hover:bg-warning-soft/80 cursor-pointer"
                    :disabled="!canRevert(file)" @click="revertFileHandler(file.id)">
                    <Undo2 class="h-3.5 w-3.5" />
                  </button>
                </FRTooltip>
                <FRTooltip :content="t('table.delete')">
                  <button type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-200 hover:border-destructive/35 hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                    @click="removeFile(file.id)">
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </FRTooltip>
              </div>
            </FRTableCell>
          </FRTableRow>
        </FRTableBody>
      </FRTable>
    </div>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .file-preview-table * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
