<script setup lang="ts">
import type { SharedItem } from './types'
import ShareItem from './ShareItem.vue'

defineProps<{
  items: SharedItem[]
  depth?: number
  serverRunning?: boolean
  shareUrl?: string
  copiedItemId?: string
}>()

const emit = defineEmits<{
  toggle: [id: string, enabled: boolean]
  remove: [id: string]
  showQr: [item: SharedItem]
  copyUrl: [item: SharedItem]
  preview: [item: SharedItem]
}>()

function onToggle(id: string, enabled: boolean) { emit('toggle', id, enabled) }
function onRemove(id: string) { emit('remove', id) }
function onShowQr(item: SharedItem) { emit('showQr', item) }
function onCopyUrl(item: SharedItem) { emit('copyUrl', item) }
function onPreview(item: SharedItem) { emit('preview', item) }
</script>

<template>
  <div class="file-tree">
    <template v-for="item in items" :key="item.id">
      <ShareItem
        :item="item"
        :depth="$props.depth ?? 0"
        :server-running="$props.serverRunning ?? false"
        :share-url="$props.shareUrl ?? ''"
        :copied-item-id="$props.copiedItemId ?? ''"
        @toggle="(enabled: boolean) => onToggle(item.id, enabled)"
        @remove="onRemove(item.id)"
        @show-qr="onShowQr(item)"
        @copy-url="onCopyUrl(item)"
        @preview="onPreview(item)"
      />
      <FileTree
        v-if="item.children && item.children.length > 0"
        :items="item.children"
        :depth="($props.depth ?? 0) + 1"
        :server-running="$props.serverRunning"
        :share-url="$props.shareUrl"
        :copied-item-id="$props.copiedItemId"
        @toggle="onToggle"
        @remove="onRemove"
        @show-qr="onShowQr"
        @copy-url="onCopyUrl"
        @preview="onPreview"
      />
    </template>
  </div>
</template>
