<script setup lang="ts">
defineProps<{
  items: TrashItem[]
  busyId: string | null
}>()

const emit = defineEmits<{
  close: []
  restore: [item: TrashItem]
  remove: [item: TrashItem]
  empty: []
}>()

function formatDeletedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="trash-backdrop" @click.self="emit('close')">
    <section class="trash-panel" role="dialog" aria-modal="true" aria-labelledby="trash-title">
      <header class="trash-header">
        <div>
          <h2 id="trash-title">回收站</h2>
          <span>{{ items.length }} 个项目</span>
        </div>
        <button type="button" class="trash-close" aria-label="关闭回收站" @click="emit('close')">×</button>
      </header>

      <div v-if="items.length" class="trash-list">
        <article v-for="item in items" :key="item.id" class="trash-item">
          <div class="trash-item-info">
            <strong>{{ item.originalPath.split('/').at(-1) }}</strong>
            <span>{{ item.originalPath }}</span>
            <small>{{ item.kind === 'directory' ? '文件夹' : '笔记' }} · {{ formatDeletedAt(item.deletedAt) }}</small>
          </div>
          <div class="trash-item-actions">
            <button type="button" class="button-secondary" :disabled="busyId !== null" @click="emit('restore', item)">恢复</button>
            <button type="button" class="trash-delete-button" :disabled="busyId !== null" @click="emit('remove', item)">永久删除</button>
          </div>
        </article>
      </div>
      <div v-else class="trash-empty">
        <p>回收站是空的</p>
        <span>删除的笔记和文件夹会暂时保存在这里。</span>
      </div>

      <footer v-if="items.length" class="trash-footer">
        <button type="button" class="trash-delete-button" :disabled="busyId !== null" @click="emit('empty')">清空回收站</button>
      </footer>
    </section>
  </div>
</template>
