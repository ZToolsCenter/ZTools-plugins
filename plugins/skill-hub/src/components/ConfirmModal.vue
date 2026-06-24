<script setup lang="ts">
defineProps<{
  title?: string
  message: string
  confirmText?: string
}>()

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <div class="confirm-overlay" @click.self="emit('cancel')">
    <div class="confirm-modal">
      <div class="confirm-header">
        <div class="confirm-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <h3 class="confirm-title">{{ title || '确认删除' }}</h3>
        <button class="confirm-close" @click="emit('cancel')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="confirm-body">
        <p class="confirm-desc" v-html="message"></p>
      </div>
      <div class="confirm-footer">
        <button class="confirm-btn cancel" @click="emit('cancel')">取消</button>
        <button class="confirm-btn delete" @click="emit('confirm')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          {{ confirmText || '删除' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.confirm-modal { width: 420px; max-width: 90vw; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); }

.confirm-header { display: flex; align-items: center; gap: 10px; padding: 18px 20px; border-bottom: 1px solid hsl(var(--border)); }
.confirm-icon { width: 32px; height: 32px; border-radius: 8px; background: hsl(var(--destructive) / 0.1); color: hsl(var(--destructive)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.confirm-title { font-size: 15px; font-weight: 600; color: hsl(var(--foreground)); margin: 0; flex: 1; }
.confirm-close { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--duration-base) var(--ease-standard); }
.confirm-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }

.confirm-body { padding: 18px 20px; }
.confirm-desc { font-size: 13px; line-height: 1.6; color: hsl(var(--muted-foreground)); margin: 0; }
.confirm-desc :deep(strong) { color: hsl(var(--foreground)); font-weight: 600; }

.confirm-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid hsl(var(--border)); }
.confirm-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.confirm-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.confirm-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.confirm-btn.delete { background: hsl(var(--destructive)); color: #fff; }
.confirm-btn.delete:hover { opacity: 0.9; }
</style>
