<script setup lang="ts">
import { nextTick, onUpdated, ref } from 'vue'
import { Check, Clipboard, Download, ExternalLink, File, FileImage, Link, MoreHorizontal, Search, Trash2 } from 'lucide-vue-next'
import type { DeviceLinkMessage } from '../types'

defineProps<{ messages: DeviceLinkMessage[]; searchQuery?: string; savingAttachmentIds?: ReadonlySet<string> }>()
const emit = defineEmits<{
  copy: [id: string]
  open: [messageId: string, attachmentId: string]
  download: [messageId: string, attachmentId: string]
  delete: [id: string]
}>()
const list = ref<HTMLElement | null>(null)

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatDate(value: string) {
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString() ? '今天' : new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function showDate(index: number, messages: DeviceLinkMessage[]) {
  if (index === 0) return true
  return new Date(messages[index - 1].createdAt).toDateString() !== new Date(messages[index].createdAt).toDateString()
}

onUpdated(() => nextTick(() => {
  if (list.value) list.value.scrollTop = list.value.scrollHeight
}))
</script>

<template>
  <section ref="list" class="message-list">
    <div v-if="messages.length === 0" class="conversation-empty">
      <span class="conversation-empty__icon"><Search v-if="searchQuery" :size="26" /><Link v-else :size="26" /></span>
      <h2>{{ searchQuery ? '没有找到匹配消息' : '把内容放进这段私人会话' }}</h2>
      <p v-if="searchQuery">换个关键词试试，可搜索消息正文、发送设备、文件名或文件类型。</p>
      <p v-else>发送文字、链接、图片或文件。在线设备实时收到，离线设备可通过加密 WebDAV 补拉。</p>
    </div>
    <template v-for="(message, index) in messages" :key="message.id">
      <div v-if="showDate(index, messages)" class="date-divider"><span>{{ formatDate(message.createdAt) }}</span></div>
      <article class="message-row" :class="`message-row--${message.direction}`">
        <div class="message-bubble">
          <div v-if="message.direction === 'incoming'" class="message-sender">{{ message.senderName }}</div>
          <a v-if="message.kind === 'link' && message.text" class="message-link" :href="message.text" target="_blank" rel="noopener noreferrer">{{ message.text }}<ExternalLink :size="13" /></a>
          <p v-else-if="message.text" class="message-text">{{ message.text }}</p>
          <div v-for="attachment in message.attachments" :key="attachment.id" class="attachment">
            <button class="attachment__open" type="button" :aria-label="`打开附件 ${attachment.name}`" @click="emit('open', message.id, attachment.id)">
              <span class="attachment__icon"><FileImage v-if="attachment.mime.startsWith('image/')" :size="21" aria-hidden="true" /><File v-else :size="21" aria-hidden="true" /></span>
              <span class="attachment__info"><strong>{{ attachment.name }}</strong><small>{{ formatSize(attachment.size) }} · {{ attachment.mime }}</small></span>
              <ExternalLink :size="15" aria-hidden="true" />
            </button>
            <button
              class="attachment__download"
              type="button"
              :disabled="savingAttachmentIds?.has(attachment.id)"
              :aria-busy="savingAttachmentIds?.has(attachment.id)"
              :aria-label="savingAttachmentIds?.has(attachment.id) ? `正在保存附件 ${attachment.name}` : `下载附件 ${attachment.name}`"
              @click="emit('download', message.id, attachment.id)"
            >
              <Download :size="14" aria-hidden="true" /><span>{{ savingAttachmentIds?.has(attachment.id) ? '保存中…' : '下载' }}</span>
            </button>
          </div>
          <div class="message-meta">
            <span>{{ formatTime(message.createdAt) }}</span><Check v-if="message.direction === 'outgoing'" :size="12" />
            <button class="message-action" type="button" title="复制" @click="emit('copy', message.id)"><Clipboard :size="13" /></button>
            <span class="more-wrap"><MoreHorizontal :size="13" /><button class="delete-action" type="button" title="删除消息" @click="emit('delete', message.id)"><Trash2 :size="13" />删除</button></span>
          </div>
        </div>
      </article>
    </template>
  </section>
</template>
