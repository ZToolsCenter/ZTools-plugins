<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  dirs: string[]
}>()

const emit = defineEmits<{
  close: []
  deleted: [count: number]
}>()

interface UnregisteredSkill {
  path: string
  name: string
}

const skills = ref<UnregisteredSkill[]>([])

function init() {
  const result: UnregisteredSkill[] = []
  for (const dir of props.dirs) {
    const folderName = dir.split(/[\\/]/).pop() || dir
    const skillFilePath = window.services.pathJoin(dir, 'SKILL.md')
    let name = folderName
    try {
      const content = window.services.readFileText(skillFilePath)
      const match = content.match(/^name:\s*(.+)/m)
      if (match) name = match[1].trim()
    } catch {}
    result.push({ path: dir, name })
  }
  skills.value = result
}

init()

const selected = ref(new Set<string>())

const allSelected = computed(() =>
  skills.value.length > 0 && skills.value.every(s => selected.value.has(s.path))
)

const selectedCount = computed(() => selected.value.size)

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set(skills.value.map(s => s.path))
  }
}

function toggleItem(path: string) {
  const next = new Set(selected.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  selected.value = next
}

function deleteSelected() {
  for (const path of selected.value) {
    try {
      window.services.removeFile(path)
    } catch (e) {
      console.error('[cleanup] Failed to delete', path, e)
    }
  }
  emit('deleted', selected.value.size)
}
</script>

<template>
  <div class="cleanup-overlay" @click.self="emit('close')">
    <div class="cleanup-modal">
      <div class="cleanup-header">
        <div class="cleanup-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <h3 class="cleanup-title">清理未注册的技能</h3>
        <button class="cleanup-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="cleanup-body">
        <p class="cleanup-desc">以下技能文件夹在 <code>skills-repo</code> 中但未在注册表中登记，请选择要删除的项：</p>

        <div class="cleanup-select-header">
          <span class="cleanup-select-label">共 {{ skills.length }} 个文件夹</span>
          <button class="cleanup-select-all" @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</button>
        </div>

        <div class="cleanup-list">
          <label
            v-for="s in skills"
            :key="s.path"
            class="cleanup-item"
            :class="{ checked: selected.has(s.path) }"
          >
            <input
              type="checkbox"
              :checked="selected.has(s.path)"
              @change="toggleItem(s.path)"
              class="cleanup-checkbox"
            />
            <svg class="cleanup-folder-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="cleanup-item-name">{{ s.name }}</span>
          </label>
        </div>
      </div>

      <div class="cleanup-footer">
        <button class="cleanup-btn cancel" @click="emit('close')">取消</button>
        <button
          class="cleanup-btn delete"
          :disabled="selectedCount === 0"
          @click="deleteSelected"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          删除{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cleanup-overlay { position: fixed; inset: 0; background: hsl(0 0% 0% / 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(4px); }
.cleanup-modal { width: 460px; max-width: 90vw; max-height: 80vh; background: hsl(var(--card)); border: 1px solid hsl(var(--border)); border-radius: 16px; overflow: hidden; box-shadow: 0 24px 64px hsl(0 0% 0% / 0.2); display: flex; flex-direction: column; }

.cleanup-header { display: flex; align-items: center; gap: 10px; padding: 18px 20px; border-bottom: 1px solid hsl(var(--border)); }
.cleanup-icon { width: 32px; height: 32px; border-radius: 8px; background: hsl(var(--destructive) / 0.1); color: hsl(var(--destructive)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.cleanup-title { font-size: 15px; font-weight: 600; color: hsl(var(--foreground)); margin: 0; flex: 1; }
.cleanup-close { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: hsl(var(--muted-foreground)); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--duration-base) var(--ease-standard); }
.cleanup-close:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }

.cleanup-body { padding: 18px 20px; overflow-y: auto; flex: 1; }
.cleanup-desc { font-size: 13px; line-height: 1.6; color: hsl(var(--muted-foreground)); margin: 0 0 12px; }
.cleanup-desc code { font-family: inherit; font-size: 12px; padding: 1px 5px; border-radius: 4px; background: hsl(var(--muted)); color: hsl(var(--foreground)); }

.cleanup-select-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cleanup-select-label { font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.cleanup-select-all { font-size: 11px; font-weight: 600; color: hsl(var(--primary)); background: none; border: none; cursor: pointer; padding: 0; }
.cleanup-select-all:hover { opacity: 0.7; }

.cleanup-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
.cleanup-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.cleanup-item:hover { border-color: hsl(var(--primary) / 0.3); }
.cleanup-item.checked { border-color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.04); }
.cleanup-checkbox { accent-color: hsl(var(--destructive)); }
.cleanup-folder-icon { color: hsl(var(--muted-foreground)); flex-shrink: 0; }
.cleanup-item-name { font-size: 12px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; }

.cleanup-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid hsl(var(--border)); }
.cleanup-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.cleanup-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.cleanup-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.cleanup-btn.delete { background: hsl(var(--destructive)); color: #fff; }
.cleanup-btn.delete:hover:not(:disabled) { opacity: 0.9; }
.cleanup-btn.delete:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
