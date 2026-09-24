<script setup lang="ts">
/**
 * 主应用程序入口组件。
 * 管理文件导入、工作流配置、预览和重命名操作。
 * @description 作为应用的核心容器，协调文件导入、工作流构建、实时预览和重命名执行的全流程
 */
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { registry } from '@/core/registry'
import { applyWorkflow } from '@/core/engine'
import type { FileItem, ActionInstance, ClipboardCopyRequest } from '@/core/types'
import { fsBridge } from '@/core/bridge'
import {
  buildTargetPath,
  formatClipboardItems,
  getExtension,
  isAbsoluteFilePath,
  uniquePaths
} from '@/core/file-items'
import { collectTransferFiles, getPathsForFiles, isEditableElement } from '@/core/transfers'
import { useFileQueue } from '@/composables/useFileQueue'
import { driver } from 'driver.js'
import type { DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'

// 重构组件与 i18n
import ControlHeader from '@/components/layout/ControlHeader.vue'
import WorkflowSidebar from '@/components/workflow/WorkflowSidebar.vue'
import RenamingTable from '@/components/preview/RenamingTable.vue'
import SettingsDialog from '@/components/layout/SettingsDialog.vue'

// --- 状态管理 ---
const {
  visibleItems,
  breadcrumbs,
  importPaths,
  appendFallbackFiles,
  openDirectory,
  navigateToBreadcrumb,
  removeItems,
  clear: clearFileQueue
} = useFileQueue()
/** Ordered list of actions to apply to files */
const workflow = ref<ActionInstance[]>([])
/** Whether the settings dialog is currently open */
const isSettingsOpen = ref(false)
/** Whether the sidebar is collapsed */
const isSidebarCollapsed = ref(false)
/** Visual style for connector lines between actions */
const lineStyle = ref<'solid' | 'dashed' | 'none'>('solid')
/** Number of currently selected files */
const selectedCount = ref(0)
/** Set of selected file IDs */
const selectedIds = ref<string[]>([])
/** Whether the drag preview overlay is active */
const isDragOverPreview = ref(false)
/** Current depth during drag operations (for nested folder handling) */
const dragDepth = ref(0)

type ToastTone = 'error' | 'warning' | 'info' | 'success'

type AppToast = {
  id: number
  message: string
  tone: ToastTone
}

const activeToast = ref<AppToast | null>(null)
let toastTimer: number | undefined
/** Internationalization helper */
const { t } = useI18n()
/** Local storage key for tracking onboarding completion */
const ONBOARDING_STORAGE_KEY = 'fr-onboarding-completed-v1'

const clearToastTimer = () => {
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer)
    toastTimer = undefined
  }
}

const showToast = (message: string, tone: ToastTone = 'warning') => {
  clearToastTimer()
  activeToast.value = {
    id: Date.now(),
    message,
    tone
  }

  toastTimer = window.setTimeout(() => {
    activeToast.value = null
    toastTimer = undefined
  }, 3600)
}

const dismissToast = () => {
  clearToastTimer()
  activeToast.value = null
}

const getToastToneClass = (tone: ToastTone) => {
  if (tone === 'error') {
    return 'border-destructive/40 bg-destructive/12 text-destructive'
  }

  if (tone === 'success') {
    return 'border-success/40 bg-success-soft text-success-foreground'
  }

  if (tone === 'info') {
    return 'border-info/40 bg-info-soft text-info-foreground'
  }

  return 'border-warning/40 bg-warning-soft text-warning-foreground'
}

/**
 * Checks if the user has completed the onboarding tutorial.
 * @returns True if onboarding was previously completed
 */
const hasCompletedOnboarding = () => {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const markOnboardingCompleted = () => {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

const startOnboarding = async (force = false) => {
  if (!force && hasCompletedOnboarding()) {
    return
  }

  await nextTick()

  const steps: DriveStep[] = [
    {
      element: '#onboarding-guide-btn',
      popover: {
        title: t('onboarding.entry_title'),
        description: t('onboarding.entry_description'),
        side: 'bottom' as const,
        align: 'start' as const
      }
    },
    {
      element: '#onboarding-import-btn',
      popover: {
        title: t('onboarding.import_title'),
        description: t('onboarding.import_description'),
        side: 'bottom' as const,
        align: 'start' as const
      }
    },
    {
      element: '#onboarding-workflow',
      popover: {
        title: t('onboarding.workflow_title'),
        description: t('onboarding.workflow_description'),
        side: 'right' as const,
        align: 'start' as const
      }
    },
    {
      element: '#onboarding-add-rule-btn',
      popover: {
        title: t('onboarding.rule_title'),
        description: t('onboarding.rule_description'),
        side: 'right' as const,
        align: 'start' as const
      }
    },
    {
      element: '#onboarding-workflow-list',
      popover: {
        title: t('onboarding.reorder_title'),
        description: t('onboarding.reorder_description'),
        side: 'right' as const,
        align: 'center' as const
      }
    },
    {
      element: '#onboarding-preview',
      popover: {
        title: t('onboarding.preview_title'),
        description: t('onboarding.preview_description'),
        side: 'left' as const,
        align: 'start' as const
      }
    },
    {
      element: '#onboarding-run-btn',
      popover: {
        title: t('onboarding.run_title'),
        description: t('onboarding.run_description'),
        side: 'bottom' as const,
        align: 'center' as const
      }
    }
  ].filter((step) => Boolean(document.querySelector(step.element)))

  if (steps.length === 0) {
    return
  }

  markOnboardingCompleted()

  const tour = driver({
    showProgress: true,
    allowClose: true,
    nextBtnText: t('onboarding.next'),
    prevBtnText: t('onboarding.prev'),
    doneBtnText: t('onboarding.done'),
    steps
  })

  tour.drive()
}

// 三态主题：system | light | dark
/** Current theme setting (system, light, or dark) */
const theme = ref<string>(localStorage.getItem('fr-theme') || 'system')
/** Available brand preset options */
const BRAND_PRESETS = ['professional', 'soft', 'high-contrast'] as const
/** Type representing a valid brand preset */
type BrandPreset = (typeof BRAND_PRESETS)[number]

/**
 * Parses a string value to determine the brand preset.
 * @param value - String value from localStorage
 * @returns Valid BrandPreset or default 'professional'
 */
const parseBrandPreset = (value: string | null): BrandPreset => {
  if (value && BRAND_PRESETS.includes(value as BrandPreset)) {
    return value as BrandPreset
  }
  return 'professional'
}

const brandPreset = ref<BrandPreset>(parseBrandPreset(localStorage.getItem('fr-brand-preset')))

// --- 主题逻辑 ---
/** Media query for detecting system color scheme preference */
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
/**
 * Handler for system theme changes when in system mode.
 * @param e - Media query list event
 */
const handleSystemThemeChange = (e: MediaQueryListEvent) => {
  if (theme.value === 'system') {
    document.documentElement.classList.toggle('dark', e.matches)
  }
}

const applyTheme = (newTheme: string) => {
  const root = document.documentElement
  let effectiveTheme = newTheme
  
  if (newTheme === 'system') {
    effectiveTheme = systemThemeMedia.matches ? 'dark' : 'light'
  }

  root.classList.toggle('dark', effectiveTheme === 'dark')
  localStorage.setItem('fr-theme', newTheme)
}

const applyBrandPreset = (preset: BrandPreset) => {
  const root = document.documentElement
  root.setAttribute('data-brand-preset', preset)
  localStorage.setItem('fr-brand-preset', preset)
}

watch(theme, (nextTheme, prevTheme) => {
  if (prevTheme === 'system') {
    systemThemeMedia.removeEventListener('change', handleSystemThemeChange)
  }
  if (nextTheme === 'system') {
    systemThemeMedia.addEventListener('change', handleSystemThemeChange)
  }
  applyTheme(nextTheme)
})

watch(brandPreset, (nextPreset) => {
  applyBrandPreset(nextPreset)
})

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

const validateNewName = (name: string): string | null => {
  const trimmed = name.trim()
  if (!trimmed) return '文件名不能为空'
  if (trimmed === '.' || trimmed === '..') return '文件名无效'
  if (INVALID_FILE_NAME_CHARS.test(trimmed)) return '文件名包含非法字符'
  if (WINDOWS_RESERVED_NAMES.test(trimmed)) return '文件名是系统保留名称'
  return null
}

// --- 实时预览计算 ---
const previewFiles = computed(() => {
  const workflowPreview = applyWorkflow(visibleItems.value, workflow.value)
  const sourceById = new Map(visibleItems.value.map((file) => [file.id, file]))

  return workflowPreview.map((previewFile) => {
    const sourceFile = sourceById.get(previewFile.id)
    if (!sourceFile) {
      return previewFile
    }

    if (sourceFile.status === 'error') {
      return {
        ...previewFile,
        status: 'error' as const,
        errorMessage: sourceFile.errorMessage
      }
    }

    if (sourceFile.status === 'success') {
      return {
        ...previewFile,
        status: 'success' as const,
        errorMessage: undefined
      }
    }

    return previewFile
  })
})

// --- 操作方法 ---
const addAction = (pluginId: string) => {
  const plugin = registry.get(pluginId)
  if (!plugin) return
  
  workflow.value.push({
    instanceId: Math.random().toString(36).substring(2, 9),
    pluginId,
    config: Object.keys(plugin.configSchema || {}).reduce((acc: any, key) => {
      acc[key] = plugin.configSchema[key].default
      return acc
    }, {}),
    enabled: true
  })
}

const removeAction = (index: number) => {
  workflow.value.splice(index, 1)
}

const moveAction = ({ from, to }: { from: number; to: number }) => {
  const length = workflow.value.length
  if (length <= 1) return
  if (from < 0 || from >= length) return

  const next = [...workflow.value]
  const [moved] = next.splice(from, 1)
  if (!moved) return

  const clampedTo = Math.min(Math.max(0, to), length)
  const insertIndex = from < clampedTo ? clampedTo - 1 : clampedTo
  next.splice(insertIndex, 0, moved)
  workflow.value = next
}

const handleImportPaths = async (filePaths: string[], notifySkipped = true) => {
  const result = await importPaths(filePaths)
  selectedCount.value = 0
  selectedIds.value = []

  if (notifySkipped && result.skipped > 0) {
    showToast(t('app.import_skipped_toast', { count: result.skipped }), 'warning')
  }

  return result
}

const appendImportedFiles = async (importedFiles: File[]) => {
  if (!importedFiles.length) return 0
  const filePaths = getPathsForFiles(importedFiles)
  if (filePaths.length > 0) {
    return (await handleImportPaths(filePaths)).imported
  }

  const imported = appendFallbackFiles(importedFiles)
  selectedCount.value = 0
  selectedIds.value = []
  return imported
}

const handlePreviewDragEnter = (event: DragEvent) => {
  event.preventDefault()
  dragDepth.value += 1
  isDragOverPreview.value = true
}

const handlePreviewDragOver = (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

const handlePreviewDragLeave = (event: DragEvent) => {
  event.preventDefault()
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) {
    isDragOverPreview.value = false
  }
}

const handlePreviewDrop = async (event: DragEvent) => {
  event.preventDefault()
  dragDepth.value = 0
  isDragOverPreview.value = false

  const droppedFiles = collectTransferFiles(event.dataTransfer)
  await appendImportedFiles(droppedFiles)
}

const clearFiles = () => {
  clearFileQueue()
  selectedCount.value = 0
  selectedIds.value = []
}

const removeFileFromQueue = (fileId: string) => {
  removeItems([fileId])
}

const removeFilesFromQueue = (fileIds: string[]) => {
  removeItems(fileIds)
}

const handlePaste = async (event: ClipboardEvent) => {
  const pastedFiles = collectTransferFiles(event.clipboardData)
  if (isEditableElement(event.target) && pastedFiles.length === 0) return

  const eventPaths = getPathsForFiles(pastedFiles)
  event.preventDefault()
  const clipboardPaths = eventPaths.length > 0 ? [] : await fsBridge.getClipboardFilePaths()
  const paths = uniquePaths([...eventPaths, ...clipboardPaths])

  if (paths.length > 0) {
    const result = await handleImportPaths(paths, false)
    if (result.imported > 0) {
      const messageKey = result.skipped > 0 ? 'app.paste_imported_with_skipped_toast' : 'app.paste_imported_toast'
      showToast(t(messageKey, { count: result.imported, skipped: result.skipped }), result.skipped > 0 ? 'warning' : 'success')
    } else if (result.duplicates > 0) {
      showToast(t('app.import_duplicate_toast'), 'info')
    }
    return
  }

  const imported = await appendImportedFiles(pastedFiles)
  if (imported > 0) {
    showToast(t('app.paste_imported_toast', { count: imported }), 'success')
  }
}

const handleOpenDirectory = async (file: FileItem) => {
  const opened = await openDirectory(file)
  if (!opened) {
    showToast(t('app.folder_open_failed'), 'error')
    return
  }
  selectedCount.value = 0
  selectedIds.value = []
}

const handleNavigateBreadcrumb = async (index: number) => {
  const opened = await navigateToBreadcrumb(index)
  if (!opened) {
    showToast(t('app.folder_open_failed'), 'error')
    return
  }
  selectedCount.value = 0
  selectedIds.value = []
}

const hasCommittedRename = (file: FileItem) => {
  return Boolean(file.lastRenamedFromPath && file.lastRenamedFromName)
}

const revertCommittedRename = async (file: FileItem) => {
  const previousPath = file.lastRenamedFromPath
  const previousName = file.lastRenamedFromName

  if (!previousPath || !previousName) {
    return
  }

  if (!isAbsoluteFilePath(file.path) || !isAbsoluteFilePath(previousPath)) {
    file.status = 'error'
    file.errorMessage = '撤回失败：路径无效'
    return
  }

  const currentExists = await fsBridge.exists(file.path)
  if (!currentExists) {
    file.status = 'error'
    file.errorMessage = '撤回失败：当前文件不存在'
    return
  }

  const previousExists = await fsBridge.exists(previousPath)
  if (previousExists) {
    file.status = 'error'
    file.errorMessage = '撤回失败：目标原文件名已存在'
    return
  }

  const result = await fsBridge.rename(file.path, previousPath)
  if (!result.success) {
    file.status = 'error'
    file.errorMessage = result.error || '撤回失败'
    return
  }

  file.path = previousPath
  file.originalName = previousName
  file.newName = previousName
  file.extension = getExtension(previousName, file.isDirectory)
  file.status = 'success'
  file.errorMessage = undefined
  file.lastRenamedFromPath = undefined
  file.lastRenamedFromName = undefined
}

const revertFile = async (fileId: string) => {
  const file = visibleItems.value.find((f) => f.id === fileId)
  if (!file) return

  if (hasCommittedRename(file)) {
    await revertCommittedRename(file)
    return
  }

  file.newName = file.originalName
  file.status = 'idle'
  file.errorMessage = undefined
}

const revertFiles = async (fileIds: string[]) => {
  if (fileIds.length === 0) return
  const idSet = new Set(fileIds)

  for (const file of visibleItems.value) {
    if (idSet.has(file.id)) {
      if (hasCommittedRename(file)) {
        await revertCommittedRename(file)
      } else {
        file.newName = file.originalName
        file.status = 'idle'
        file.errorMessage = undefined
      }
    }
  }
}

const revertSelectedFiles = async () => {
  if (selectedIds.value.length === 0) return
  await revertFiles(selectedIds.value)
}

const deleteSelectedFiles = () => {
  if (selectedIds.value.length === 0) return
  removeFilesFromQueue(selectedIds.value)
}

const handleSelectionChange = (selection: { count: number; ids: string[] }) => {
  selectedCount.value = selection.count
  selectedIds.value = selection.ids
}

const copyItems = async (request: ClipboardCopyRequest) => {
  const selected = new Set(selectedIds.value)
  const items = selected.size > 0
    ? visibleItems.value.filter((item) => selected.has(item.id))
    : visibleItems.value

  if (items.length === 0) return

  const copied = await fsBridge.writeClipboardText(formatClipboardItems(items, request))
  if (!copied) {
    showToast(t('app.copy_failed_toast'), 'error')
    return
  }

  const targetLabel = request.field === 'path' ? t('app.copy_target_paths') : t('app.copy_target_names')
  showToast(t('app.copy_success_toast', { count: items.length, target: targetLabel }), 'success')
}

const runRenaming = async () => {
  const previewById = new Map(previewFiles.value.map((file) => [file.id, file]))
  const plans = visibleItems.value
    .map((sourceFile) => {
      const previewFile = previewById.get(sourceFile.id)
      if (!previewFile) return null
      return {
        source: sourceFile,
        nextName: previewFile.newName,
        targetPath: buildTargetPath(sourceFile.path, previewFile.newName)
      }
    })
    .filter((plan): plan is { source: FileItem; nextName: string; targetPath: string } => {
      return plan !== null && plan.source.originalName !== plan.nextName
    })

  if (plans.length === 0) return

  const pathSet = new Set<string>()
  const validPlans: typeof plans = []
  let conflictCount = 0
  let otherErrorCount = 0

  for (const plan of plans) {
    if (!isAbsoluteFilePath(plan.source.path)) {
      plan.source.status = 'error'
      plan.source.errorMessage = '源文件路径无效，请重新导入文件'
      otherErrorCount += 1
      continue
    }

    const sourceExists = await fsBridge.exists(plan.source.path)
    if (!sourceExists) {
      plan.source.status = 'error'
      plan.source.errorMessage = '源文件不存在，请重新导入文件'
      otherErrorCount += 1
      continue
    }

    const validationError = validateNewName(plan.nextName)
    if (validationError) {
      plan.source.status = 'error'
      plan.source.errorMessage = validationError
      otherErrorCount += 1
      continue
    }

    const normalizedTargetPath = plan.targetPath.toLowerCase()
    if (pathSet.has(normalizedTargetPath)) {
      plan.source.status = 'error'
      plan.source.errorMessage = '存在重复的目标文件名'
      conflictCount += 1
      continue
    }

    const normalizedSourcePath = plan.source.path.toLowerCase()
    if (normalizedTargetPath !== normalizedSourcePath) {
      const targetExists = await fsBridge.exists(plan.targetPath)
      if (targetExists) {
        plan.source.status = 'error'
        plan.source.errorMessage = '目标文件已存在，已阻止覆盖'
        conflictCount += 1
        continue
      }
    }

    pathSet.add(normalizedTargetPath)
    validPlans.push(plan)
  }

  for (const plan of validPlans) {
    plan.source.status = 'modified'
    plan.source.errorMessage = undefined

    const previousPath = plan.source.path
    const previousName = plan.source.originalName

    const normalizedSourcePath = plan.source.path.toLowerCase()
    const normalizedTargetPath = plan.targetPath.toLowerCase()
    if (normalizedTargetPath !== normalizedSourcePath) {
      const targetExists = await fsBridge.exists(plan.targetPath)
      if (targetExists) {
        plan.source.status = 'error'
        plan.source.errorMessage = '目标文件已存在，已阻止覆盖'
        conflictCount += 1
        continue
      }
    }

    const result = await fsBridge.rename(plan.source.path, plan.targetPath)
    if (result.success) {
      plan.source.path = plan.targetPath
      plan.source.originalName = plan.nextName
      plan.source.newName = plan.nextName
      plan.source.lastRenamedFromPath = previousPath
      plan.source.lastRenamedFromName = previousName
      plan.source.extension = getExtension(plan.nextName, plan.source.isDirectory)
      plan.source.status = 'success'
      plan.source.errorMessage = undefined
    } else {
      plan.source.status = 'error'
      plan.source.errorMessage = result.error
      otherErrorCount += 1
    }
  }

  if (conflictCount > 0) {
    showToast(t('app.rename_conflict_toast', { count: conflictCount }), 'error')
    return
  }

  if (otherErrorCount > 0) {
    showToast(t('app.rename_failed_toast', { count: otherErrorCount }), 'error')
  }
}

onMounted(() => {
  if (theme.value === 'system') {
    systemThemeMedia.addEventListener('change', handleSystemThemeChange)
  }
  applyTheme(theme.value)
  applyBrandPreset(brandPreset.value)
  window.addEventListener('paste', handlePaste)

  window.setTimeout(() => {
    void startOnboarding(false)
  }, 320)
})

onUnmounted(() => {
  clearToastTimer()
  window.removeEventListener('paste', handlePaste)
  systemThemeMedia.removeEventListener('change', handleSystemThemeChange)
})
</script>

<template>
  <div class="app-shell flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-sans select-none antialiased">
    <!-- 顶部操作栏 -->
    <ControlHeader 
      id="onboarding-header"
      :file-count="visibleItems.length"
      :selected-count="selectedCount"
      @show-settings="isSettingsOpen = true"
      @import-paths="handleImportPaths"
      @copy-items="copyItems"
      @clear-files="clearFiles"
      @run="runRenaming"
      @revert-files="revertSelectedFiles"
      @delete-files="deleteSelectedFiles"
      @start-guide="startOnboarding(true)"
    />

    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧工作流（流式中心 UI） -->
      <WorkflowSidebar 
        id="onboarding-workflow"
        :workflow="workflow"
        :line-style="lineStyle"
        :is-collapsed="isSidebarCollapsed"
        @add-action="addAction"
        @remove-action="removeAction"
        @move-action="moveAction"
        @toggle-collapse="isSidebarCollapsed = !isSidebarCollapsed"
      />

      <!-- 右侧预览区域 -->
      <main
        id="onboarding-preview"
        :class="[
          'preview-stage flex-1 flex flex-col relative transition-all duration-300',
          isDragOverPreview && 'ring-2 ring-primary/40 ring-inset bg-primary/5',
        ]"
        @dragenter="handlePreviewDragEnter"
        @dragover="handlePreviewDragOver"
        @dragleave="handlePreviewDragLeave"
        @drop="handlePreviewDrop"
      >
        <div
          v-if="isDragOverPreview"
          class="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/45 bg-primary/8 backdrop-blur-sm"
        >
          <div class="px-6 text-center">
            <p class="text-base font-black tracking-tight text-primary">{{ t('app.drag_import_title') }}</p>
            <p class="mt-1 text-xs font-medium text-muted-foreground">{{ t('app.drag_import_desc') }}</p>
          </div>
        </div>
        <RenamingTable
          :files="previewFiles"
          :breadcrumbs="breadcrumbs"
          @open-directory="handleOpenDirectory"
          @navigate-breadcrumb="handleNavigateBreadcrumb"
          @remove-file="removeFileFromQueue"
          @remove-files="removeFilesFromQueue"
          @revert-file="revertFile"
          @revert-files="revertFiles"
          @selection-change="handleSelectionChange"
        />
      </main>
    </div>

    <!-- 全局设置中心 -->
    <SettingsDialog 
      v-model:open="isSettingsOpen" 
      v-model:theme="theme"
      v-model:brand-preset="brandPreset"
    />

    <Transition name="fr-toast">
      <div
        v-if="activeToast"
        :key="activeToast.id"
        role="status"
        aria-live="polite"
        :class="[
          'pointer-events-auto fixed right-4 bottom-4 z-120 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-lg',
          getToastToneClass(activeToast.tone)
        ]"
      >
        <p class="text-sm font-semibold tracking-tight">{{ activeToast.message }}</p>
        <button
          type="button"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-current/30 text-current/80 transition-colors hover:bg-black/10 hover:text-current"
          @click="dismissToast"
          :aria-label="t('app.toast_close')"
        >
          ×
        </button>
      </div>
    </Transition>
  </div>
</template>

<style>
/* 核心平衡样式 */
body {
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 隐藏滚动条但保留功能 */
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* 过渡动画 */
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 300ms;
}

.app-shell {
  background-image:
    radial-gradient(1200px 420px at 8% -15%, color-mix(in oklab, var(--primary) 12%, transparent), transparent 62%),
    radial-gradient(980px 360px at 92% -10%, color-mix(in oklab, var(--info) 10%, transparent), transparent 66%);
}

.preview-stage {
  background-color: color-mix(in oklab, var(--background) 88%, var(--muted) 12%);
}

.driver-overlay {
  background: rgba(15, 23, 42, 0.38) !important;
}

.driver-popover {
  background-color: var(--popover);
  color: var(--popover-foreground);
  border-radius: 14px;
  border: 1px solid color-mix(in oklab, var(--border) 72%, transparent);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16);
}

.driver-popover-title {
  font-weight: 800;
  color: var(--popover-foreground);
}

.driver-popover-description {
  color: color-mix(in oklab, var(--foreground) 76%, transparent);
  line-height: 1.45;
}

.driver-popover-close-btn {
  color: color-mix(in oklab, var(--foreground) 46%, transparent);
}

.driver-popover-close-btn:hover,
.driver-popover-close-btn:focus {
  color: var(--foreground);
}

.driver-popover-progress-text {
  color: color-mix(in oklab, var(--foreground) 62%, transparent);
}

.driver-popover-footer button {
  text-shadow: none;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: color-mix(in oklab, var(--card) 92%, transparent);
  color: var(--foreground);
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}

.driver-popover-footer button:hover,
.driver-popover-footer button:focus {
  background: color-mix(in oklab, var(--accent) 82%, var(--card));
}

.driver-popover-next-btn {
  border-color: color-mix(in oklab, var(--primary) 36%, transparent) !important;
  background: color-mix(in oklab, var(--primary) 90%, white) !important;
  color: var(--primary-foreground) !important;
}

.driver-popover-next-btn:hover,
.driver-popover-next-btn:focus {
  background: color-mix(in oklab, var(--primary) 78%, black) !important;
}

.driver-popover-arrow {
  border-color: var(--popover);
}

.dark .driver-overlay {
  background: rgba(2, 6, 23, 0.68) !important;
}

.dark .driver-popover {
  border-color: color-mix(in oklab, var(--border) 84%, transparent);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.48);
}

.dark .driver-popover-footer button {
  background: color-mix(in oklab, var(--card) 88%, black);
  color: var(--foreground);
}

.dark .driver-popover-next-btn {
  background: color-mix(in oklab, var(--primary) 82%, black) !important;
}

.fr-toast-enter-active,
.fr-toast-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.fr-toast-enter-from,
.fr-toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .app-shell {
    background-image: none;
  }

  .fr-toast-enter-active,
  .fr-toast-leave-active {
    transition: none;
  }
}
</style>
