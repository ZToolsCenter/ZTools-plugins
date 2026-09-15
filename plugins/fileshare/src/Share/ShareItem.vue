<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SharedItem } from './types'

const props = defineProps<{
  item: SharedItem
  depth: number
  serverRunning?: boolean
  shareUrl?: string
  copiedItemId?: string
}>()

const emit = defineEmits<{
  toggle: [enabled: boolean]
  remove: []
  showQr: [item: SharedItem]
  copyUrl: [item: SharedItem]
  preview: [item: SharedItem]
}>()

const expanded = ref(true)
const leftPad = computed(() => `${props.depth * 20 + 12}px`)

function toggleExpand() {
  if (props.item.isDirectory && props.item.children && props.item.children.length > 0) {
    expanded.value = !expanded.value
  }
}

function openInExplorer() {
  window.ztools.shellShowItemInFolder(props.item.path)
}

function getFileIcon(): string {
  if (props.item.isDirectory) return 'folder'
  const ext = (props.item.name || '').split('.').pop()?.toLowerCase() || ''
  if (['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return 'audio'
  if (['mp4','webm','mkv','avi','mov','flv'].includes(ext)) return 'video'
  if (['jpg','jpeg','png','gif','svg','webp','bmp'].includes(ext)) return 'image'
  if (['js','ts','jsx','tsx','py','java','c','cpp','rs','go','rb','php','swift','kt','scala','dart','lua','r','sql','sh','bat','html','css','scss','less','vue','json','xml','yml','yaml'].includes(ext)) return 'code'
  if (['md','markdown'].includes(ext)) return 'markdown'
  return 'file'
}

const PREVIEWABLE_EXTS = ['jpg','jpeg','png','gif','svg','webp','bmp','ico','mp3','wav','ogg','flac','aac','m4a','mp4','webm','mkv','avi','mov','flv','txt','log','csv','json','xml','yml','yaml','toml','ini','cfg','conf','env','md','markdown','js','mjs','cjs','ts','tsx','jsx','py','java','c','cpp','h','hpp','rs','go','rb','php','swift','kt','kts','scala','dart','lua','r','sql','sh','bash','zsh','bat','cmd','ps1','html','htm','css','scss','less','vue','svelte']

function isPreviewable(): boolean {
  if (props.item.isDirectory) return false
  const ext = (props.item.name || '').split('.').pop()?.toLowerCase() || ''
  return PREVIEWABLE_EXTS.includes(ext)
}
</script>

<template>
  <div class="share-item-row" :style="{ paddingLeft: leftPad }">
    <!-- Expand arrow -->
    <button class="expand-btn" :class="{ 'has-children': item.isDirectory && item.children && item.children.length > 0 }" @click="toggleExpand">
      <svg v-if="item.isDirectory && item.children && item.children.length > 0" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" :class="{ expanded }" class="arrow-icon"><polyline points="9 18 15 12 9 6"/></svg>
    </button>

    <!-- Icon -->
    <span class="file-icon">
      <svg v-if="getFileIcon() === 'folder'" viewBox="0 0 24 24" width="18" height="18" class="icon-folder"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6.5l-1.5-2H5a2 2 0 00-2 2z" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      <svg v-else-if="getFileIcon() === 'audio'" viewBox="0 0 24 24" width="16" height="16" class="icon-audio"><path d="M9 18V5l12-2v13" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="6" cy="18" r="3" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="18" cy="16" r="3" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      <svg v-else-if="getFileIcon() === 'video'" viewBox="0 0 24 24" width="16" height="16" class="icon-video"><polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      <svg v-else-if="getFileIcon() === 'image'" viewBox="0 0 24 24" width="16" height="16" class="icon-image"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" fill="none" stroke-width="1.5"/><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" fill="none" stroke-width="1.5"/><polyline points="21 15 16 10 5 21" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      <svg v-else-if="getFileIcon() === 'code'" viewBox="0 0 24 24" width="16" height="16" class="icon-code"><polyline points="16 18 22 12 16 6" stroke="currentColor" fill="none" stroke-width="1.5"/><polyline points="8 6 2 12 8 18" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
      <svg v-else viewBox="0 0 24 24" width="16" height="16" class="icon-file"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" fill="none" stroke-width="1.5"/><polyline points="14 2 14 8 20 8" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>
    </span>

    <!-- Name -->
    <span class="item-name" :title="item.name">{{ item.name }}</span>

    <!-- Open in explorer -->
    <button class="action-btn" title="在资源管理器中打开" @click.stop="openInExplorer">
      <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><rect x="2" y="3" width="20" height="16" rx="2"/><path d="M8 21h8"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
    </button>

    <!-- Preview -->
    <button v-if="isPreviewable()" class="action-btn" title="预览" @click.stop="emit('preview', item)">
      <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>

    <!-- File count -->
    <span v-if="item.isDirectory && item.fileCount !== undefined" class="item-count">{{ item.fileCount }} files</span>

    <!-- Share actions (only when server running) -->
    <template v-if="serverRunning && shareUrl">
      <button class="action-btn" :class="{ copied: props.copiedItemId === item.id }" title="复制分享链接" @click.stop="emit('copyUrl', item)">
        <svg v-if="props.copiedItemId !== item.id" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        <svg v-else viewBox="0 0 24 24" width="13" height="13" stroke="#22c55e" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="action-btn" title="二维码" @click.stop="emit('showQr', item)">
        <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>
    </template>

    <!-- Toggle -->
    <button class="toggle-btn" :class="{ on: item.enabled }" @click.stop="emit('toggle', !item.enabled)" :title="item.enabled ? '关闭共享' : '开启共享'">
      <span class="toggle-knob"></span>
    </button>

    <!-- Remove -->
    <button class="remove-btn" @click.stop="emit('remove')" title="删除共享">
      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
</template>

<style scoped>
.share-item-row { display: flex; align-items: center; gap: 5px; padding: 5px 10px; min-height: 34px; transition: background 0.1s; }
.share-item-row:hover { background: var(--bg-secondary); }
.expand-btn { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0; border: none; background: none; color: var(--text-tertiary); cursor: default; flex-shrink: 0; }
.expand-btn.has-children { cursor: pointer; }
.arrow-icon { transition: transform 0.15s; }
.arrow-icon.expanded { transform: rotate(90deg); }
.file-icon { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; }
.icon-folder { color: #f59e0b; } .icon-audio { color: #8b5cf6; } .icon-video { color: #ef4444; } .icon-image { color: #22c55e; } .icon-code { color: #3b82f6; } .icon-file { color: var(--text-tertiary); }
.item-name { flex: 1; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-count { font-size: 10px; color: var(--text-tertiary); flex-shrink: 0; }
.action-btn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-tertiary); cursor: pointer; border-radius: 4px; flex-shrink: 0; }
.action-btn:hover { background: var(--bg-tertiary); color: var(--primary); }
.toggle-btn { width: 34px; height: 18px; border-radius: 9px; background: var(--border); border: none; cursor: pointer; position: relative; transition: background 0.2s; flex-shrink: 0; padding: 0; }
.toggle-btn.on { background: var(--success); }
.toggle-knob { position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
.toggle-btn.on .toggle-knob { transform: translateX(16px); }
.remove-btn { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-tertiary); cursor: pointer; border-radius: 4px; flex-shrink: 0; }
.remove-btn:hover { background: #fef2f2; color: #ef4444; }
[data-theme="dark"] .remove-btn:hover { background: #3b1515; }
</style>
