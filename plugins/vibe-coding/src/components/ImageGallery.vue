<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps({
  attachments: { type: Array, default: () => [] },
  removable: { type: Boolean, default: false },
})
const emit = defineEmits(['remove'])
const previewUrls = ref(new Map())
const loadingIds = new Set()

/**
 * 从附件引用加载界面预览地址。
 * @param {Record<string, unknown>} attachment 图片附件引用。
 * @returns {Promise<void>} 预览地址写入完成后的 Promise。
 */
async function loadPreview(attachment) {
  const id = String(attachment?.attachmentId || '')
  if (!id || previewUrls.value.has(id) || loadingIds.has(id)) return
  loadingIds.add(id)
  try {
    const result = await window.zvcBridge?.readImageAttachment?.(id)
    if (result?.dataUrl) previewUrls.value = new Map(previewUrls.value).set(id, result.dataUrl)
  } finally {
    loadingIds.delete(id)
  }
}

/**
 * 释放不再属于当前列表的预览地址，避免长会话反复切换时累积内存。
 * @param {Array<Record<string, unknown>>} attachments 当前附件列表。
 * @returns {void} 无返回值。
 */
function reconcilePreviews(attachments) {
  const ids = new Set(attachments.map((item) => String(item?.attachmentId || '')).filter(Boolean))
  const next = new Map([...previewUrls.value].filter(([id]) => ids.has(id)))
  previewUrls.value = next
  for (const attachment of attachments) void loadPreview(attachment)
}

watch(() => props.attachments, reconcilePreviews, { immediate: true, deep: true })

onBeforeUnmount(() => {
  previewUrls.value = new Map()
})
</script>

<template>
  <div v-if="attachments.length" class="image-gallery" aria-label="图片附件">
    <div v-for="(attachment, index) in attachments" :key="attachment.attachmentId || index" class="image-attachment">
      <img v-if="previewUrls.get(attachment.attachmentId)" :src="previewUrls.get(attachment.attachmentId)" :alt="attachment.name || '图片附件'" loading="lazy" />
      <span v-else class="image-attachment-loading">加载中</span>
      <button v-if="removable" class="image-attachment-remove" type="button" v-tooltip.bottom="'移除图片'" aria-label="移除图片" @click="emit('remove', index)"><X :size="14" /></button>
    </div>
  </div>
</template>
