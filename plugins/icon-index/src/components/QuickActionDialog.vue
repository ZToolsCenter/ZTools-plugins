<script setup lang="ts">
import { Copy, Download, FileImage, FileType2, X } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { iconSvgUrl } from '../services/iconify'
import type { IconItem, QuickIconAction } from '../types/icon'

const props = defineProps<{
  open: boolean
  item: IconItem | null
  sequence: number
  color: string
  pngSize: number
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  action: [action: QuickIconAction]
}>()

const dialog = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    dialog.value?.focus()
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open && item" class="quick-action-overlay" @mousedown.self="emit('close')">
        <section
          ref="dialog"
          class="quick-action-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="`${item.name} 导出操作`"
          tabindex="-1"
        >
          <header class="quick-dialog-header">
            <span class="quick-dialog-sequence">{{ sequence }}</span>
            <div class="quick-dialog-title">
              <strong>{{ item.name }}</strong>
              <span>{{ item.collectionName }}</span>
            </div>
            <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')">
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <div class="quick-dialog-preview">
            <img :src="iconSvgUrl(item.id, item.palette ? undefined : color)" :alt="item.name" />
            <span v-if="item.license">{{ item.license.spdx || item.license.title }}</span>
          </div>

          <div class="quick-action-rows">
            <div class="quick-action-row">
              <button
                type="button"
                :disabled="busy"
                aria-keyshortcuts="Alt+1"
                title="Alt+1"
                @click="emit('action', 'copy-svg')"
              >
                <span class="action-number">1</span>
                <Copy :size="17" aria-hidden="true" />
                <FileType2 :size="15" aria-hidden="true" />
                复制 SVG
              </button>
              <button
                type="button"
                :disabled="busy"
                aria-keyshortcuts="Alt+2"
                title="Alt+2"
                @click="emit('action', 'copy-png')"
              >
                <span class="action-number">2</span>
                <Copy :size="17" aria-hidden="true" />
                <FileImage :size="15" aria-hidden="true" />
                复制 PNG
              </button>
            </div>
            <div class="quick-action-row">
              <button
                type="button"
                :disabled="busy"
                aria-keyshortcuts="Alt+3"
                title="Alt+3"
                @click="emit('action', 'save-svg')"
              >
                <span class="action-number">3</span>
                <Download :size="17" aria-hidden="true" />
                <FileType2 :size="15" aria-hidden="true" />
                保存 SVG
              </button>
              <button
                type="button"
                :disabled="busy"
                aria-keyshortcuts="Alt+4"
                title="Alt+4"
                @click="emit('action', 'save-png')"
              >
                <span class="action-number">4</span>
                <Download :size="17" aria-hidden="true" />
                <FileImage :size="15" aria-hidden="true" />
                保存 PNG
              </button>
            </div>
          </div>

          <footer class="quick-dialog-footer">PNG · {{ pngSize }} px</footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
