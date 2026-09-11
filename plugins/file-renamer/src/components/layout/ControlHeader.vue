<script setup lang="ts">
/**
 * 顶部操作栏组件。
 * @description 提供应用的主要操作入口，包括文件导入、设置访问、新手引导和批量操作功能
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { FRButton, FRTooltip } from '@/components/ui'
import type { ClipboardCopyRequest } from '@/core/types'
import {
  Braces,
  ChevronDown,
  ClipboardCopy,
  FilePlus2,
  FolderPlus,
  List,
  Play,
  Settings,
  Sparkles,
  Trash2,
  Undo2
} from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  fileCount: number
  selectedCount: number
}>()

const emit = defineEmits<{
  (e: 'show-settings'): void
  (e: 'import-paths', filePaths: string[]): void
  (e: 'copy-items', request: ClipboardCopyRequest): void
  (e: 'clear-files'): void
  (e: 'run'): void
  (e: 'revert-files'): void
  (e: 'delete-files'): void
  (e: 'start-guide'): void
}>()

const copyMenuOpen = ref(false)
const copyMenu = ref<HTMLElement | null>(null)

onClickOutside(copyMenu, () => {
  copyMenuOpen.value = false
})

function copyItems(request: ClipboardCopyRequest) {
  emit('copy-items', request)
  copyMenuOpen.value = false
}

function importFiles() {
  if (typeof window.ztools?.showOpenDialog === 'function') {
    const selectedPaths = window.ztools.showOpenDialog({
      title: t('app.import_files'),
      properties: ['openFile', 'multiSelections']
    })

    if (selectedPaths?.length) {
      emit('import-paths', selectedPaths)
    }
  }
}

function importFolders() {
  if (typeof window.ztools?.showOpenDialog === 'function') {
    const selectedPaths = window.ztools.showOpenDialog({
      title: t('app.import_folders'),
      properties: ['openDirectory', 'multiSelections']
    })

    if (selectedPaths?.length) {
      emit('import-paths', selectedPaths)
    }
  }
}
</script>

<template>
  <header
    class="h-14 px-4 flex justify-between items-center bg-background/78 backdrop-blur-md border-b border-border/80 sticky top-0 z-40 transition-all">
    <div class="flex items-center gap-3">
      <div class="flex gap-1.5">
        <FRTooltip :content="t('app.import_files')">
          <button
            id="onboarding-import-btn"
            type="button"
            :aria-label="t('app.import_files')"
            class="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-bold h-9 px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-lg shadow-primary/20 gap-2 active:scale-95"
            @click="importFiles"
          >
            <FilePlus2 class="w-3.5 h-3.5" />
            <span class="hidden lg:inline">{{ t('app.import_files') }}</span>
          </button>
        </FRTooltip>

        <FRTooltip :content="t('app.import_folders')">
          <button
            type="button"
            :aria-label="t('app.import_folders')"
            class="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-bold h-9 px-3 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-all cursor-pointer gap-2 active:scale-95"
            @click="importFolders"
          >
            <FolderPlus class="w-3.5 h-3.5" />
            <span class="hidden lg:inline">{{ t('app.import_folders') }}</span>
          </button>
        </FRTooltip>

        <FRTooltip :content="t('app.clear_all')">
          <FRButton variant="outline" size="sm" class="gap-1.5 h-9 px-3 rounded-lg" :aria-label="t('app.clear_all')" @click="$emit('clear-files')">
            <Trash2 class="w-3.5 h-3.5 opacity-70" />
            <span class="hidden lg:inline">{{ t('app.clear_all') }}</span>
          </FRButton>
        </FRTooltip>
      </div>

      <div class="h-4 w-px bg-border mx-1"></div>

      <FRTooltip :content="t('app.settings')">
        <FRButton variant="ghost" size="icon" class="rounded-full h-8 w-8 text-muted-foreground"
          :aria-label="t('app.settings')"
          @click="$emit('show-settings')">
          <Settings class="w-4 h-4" />
        </FRButton>
      </FRTooltip>

      <FRTooltip :content="t('app.beginner_guide')">
        <FRButton id="onboarding-guide-btn" variant="ghost" size="icon" class="rounded-full h-8 w-8 text-muted-foreground"
          :aria-label="t('app.beginner_guide')"
          @click="$emit('start-guide')">
          <Sparkles class="w-4 h-4" />
        </FRButton>
      </FRTooltip>
    </div>

    <div class="flex items-center gap-2">
      <div ref="copyMenu" class="relative">
        <FRTooltip :content="t('app.copy_menu')">
          <FRButton
            variant="outline"
            size="sm"
            class="gap-1.5 h-9 px-3 rounded-lg"
            :disabled="fileCount === 0"
            :aria-expanded="copyMenuOpen"
            aria-haspopup="menu"
            @click="copyMenuOpen = !copyMenuOpen"
          >
            <ClipboardCopy class="h-3.5 w-3.5" />
            <span class="hidden lg:inline">{{ t('app.copy_menu') }}</span>
            <ChevronDown class="hidden h-3 w-3 opacity-60 lg:block" />
          </FRButton>
        </FRTooltip>

        <div
          v-if="copyMenuOpen"
          role="menu"
          class="absolute right-0 top-11 z-60 w-64 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl"
        >
          <p class="px-2 pb-1.5 text-[10px] font-semibold text-muted-foreground">
            {{ selectedCount > 0 ? t('app.copy_selected', { count: selectedCount }) : t('app.copy_all', { count: fileCount }) }}
          </p>
          <div class="grid grid-cols-[1fr_auto_auto] items-center gap-1 border-t border-border/70 py-1.5">
            <span class="px-2 text-xs font-semibold">{{ t('app.copy_paths') }}</span>
            <button type="button" role="menuitem" :aria-label="t('app.copy_path_text')" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted" @click="copyItems({ field: 'path', format: 'text' })">
              <List class="h-3.5 w-3.5" />{{ t('app.copy_text') }}
            </button>
            <button type="button" role="menuitem" :aria-label="t('app.copy_path_json')" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted" @click="copyItems({ field: 'path', format: 'json' })">
              <Braces class="h-3.5 w-3.5" />JSON
            </button>
          </div>
          <div class="grid grid-cols-[1fr_auto_auto] items-center gap-1 border-t border-border/70 pt-1.5">
            <span class="px-2 text-xs font-semibold">{{ t('app.copy_names') }}</span>
            <button type="button" role="menuitem" :aria-label="t('app.copy_name_text')" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted" @click="copyItems({ field: 'name', format: 'text' })">
              <List class="h-3.5 w-3.5" />{{ t('app.copy_text') }}
            </button>
            <button type="button" role="menuitem" :aria-label="t('app.copy_name_json')" class="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted" @click="copyItems({ field: 'name', format: 'json' })">
              <Braces class="h-3.5 w-3.5" />JSON
            </button>
          </div>
        </div>
      </div>

      <FRButton
        id="onboarding-run-btn"
        class="gap-2 px-5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 font-black h-9 text-xs transition-all active:scale-95 disabled:opacity-30 disabled:grayscale"
        :aria-label="t('app.start_rename')" :disabled="fileCount === 0" @click="$emit('run')">
        <Play class="w-4 h-4 fill-current" />
        <span class="hidden lg:inline">{{ t('app.start_rename') }}</span>
      </FRButton>
      <FRButton
        class="gap-1.5 rounded-lg border border-warning/35 bg-warning-soft hover:bg-warning-soft/80 text-warning-foreground font-semibold h-9 text-xs transition-all disabled:opacity-30 disabled:grayscale"
        :aria-label="t('table.revert_selected')" :disabled="selectedCount === 0" @click="$emit('revert-files')">
        <Undo2 class="w-3.5 h-3.5" />
        <span class="hidden lg:inline">{{ t('table.revert_selected') }}</span>
      </FRButton>
      <FRButton
        class="gap-1.5 rounded-lg border border-destructive/35 bg-destructive/10 hover:bg-destructive/16 text-destructive font-semibold h-9 text-xs transition-all disabled:opacity-30 disabled:grayscale"
        :aria-label="t('table.delete_selected')" :disabled="selectedCount === 0" @click="$emit('delete-files')">
        <Trash2 class="w-3.5 h-3.5" />
        <span class="hidden lg:inline">{{ t('table.delete_selected') }}</span>
      </FRButton>

    </div>
  </header>
</template>
