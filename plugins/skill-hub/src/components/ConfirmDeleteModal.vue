<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { storage } from '../utils/storage'
import type { Skill, InstallRecord } from '../types'
import { defaultPlatforms } from '../data/platforms'
import PlatformIcon from './PlatformIcon.vue'
import { loadRegistry, removeFromRegistry } from '../utils/skill-registry'

const props = defineProps<{
  skill: Skill
}>()

const emit = defineEmits(['close', 'deleted'])

const removeDistributed = ref(false)
const selectedPlatforms = ref<Set<string>>(new Set())

watch(removeDistributed, (val) => {
  if (val) {
    selectedPlatforms.value = new Set(uniquePlatforms.value.map(p => p.platformId))
  }
})

const installRecords = computed<InstallRecord[]>(() => {
  return storage.getInstalledForSkill(props.skill.id)
})

const platformNameMap = computed(() => {
  const map: Record<string, string> = {}
  for (const p of defaultPlatforms) map[p.id] = p.name
  return map
})

const uniquePlatforms = computed(() => {
  const seen = new Set<string>()
  const result: { platformId: string; name: string; mode: string }[] = []
  for (const record of installRecords.value) {
    if (seen.has(record.platformId)) continue
    seen.add(record.platformId)
    result.push({
      platformId: record.platformId,
      name: platformNameMap.value[record.platformId] || record.platformId,
      mode: record.mode,
    })
  }
  return result
})

const allSelected = computed(() =>
  uniquePlatforms.value.length > 0 && uniquePlatforms.value.every(p => selectedPlatforms.value.has(p.platformId))
)

function toggleAll() {
  if (allSelected.value) {
    selectedPlatforms.value = new Set()
  } else {
    selectedPlatforms.value = new Set(uniquePlatforms.value.map(p => p.platformId))
  }
}

function togglePlatform(id: string) {
  const next = new Set(selectedPlatforms.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedPlatforms.value = next
}

function deleteSkill() {
  const dir = window.services.pathJoin(window.ztools.getPath('userData'), 'skills-repo', props.skill.id)
  try { window.services.removeFile(dir) } catch {}

  if (removeDistributed.value && selectedPlatforms.value.size > 0) {
    for (const record of installRecords.value) {
      if (!selectedPlatforms.value.has(record.platformId)) continue
      try {
        window.services.removeFile(record.targetPath)
      } catch {}
    }
  }

  storage.removeAllForSkill(props.skill.id)
  storage.removeDownloadedId(props.skill.id)
  storage.removeSkillFromCache(props.skill.id)
  const registry = loadRegistry()
  removeFromRegistry(registry, props.skill.name)
  emit('deleted')
}
</script>

<template>
  <div class="confirm-overlay" @click.self="emit('close')">
    <div class="confirm-modal">
      <div class="confirm-header">
        <div class="confirm-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
        <h3 class="confirm-title">删除 Skill</h3>
        <button class="confirm-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="confirm-body">
        <p class="confirm-desc">确定要删除 <strong>{{ skill.name }}</strong> 吗？此操作不可撤销。</p>

        <div v-if="installRecords.length" class="distributed-section">
          <label class="remove-distributed-label">
            <input type="checkbox" v-model="removeDistributed" class="remove-distributed-checkbox" />
            <span>同时移除已分发的文件</span>
          </label>

          <div v-if="removeDistributed" class="platform-select">
            <div class="platform-select-header">
              <span class="platform-select-label">选择要移除的平台</span>
              <button class="platform-select-all" @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</button>
            </div>
            <div class="platform-list">
              <label
                v-for="p in uniquePlatforms"
                :key="p.platformId"
                class="platform-item"
                :class="{ checked: selectedPlatforms.has(p.platformId) }"
              >
                <input
                  type="checkbox"
                  :checked="selectedPlatforms.has(p.platformId)"
                  @change="togglePlatform(p.platformId)"
                  class="platform-checkbox"
                />
                <PlatformIcon :platform-id="p.platformId" :size="18" />
                <span class="platform-name">{{ p.name }}</span>
                <span class="platform-mode">{{ p.mode === 'symlink' ? '软链接' : '复制' }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="confirm-footer">
        <button class="confirm-btn cancel" @click="emit('close')">取消</button>
        <button class="confirm-btn delete" @click="deleteSkill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          删除
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
.confirm-desc strong { color: hsl(var(--foreground)); font-weight: 600; }

.distributed-section { margin-top: 14px; }
.remove-distributed-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; color: hsl(var(--foreground)); cursor: pointer; }
.remove-distributed-checkbox { accent-color: hsl(var(--primary)); }

.platform-select { margin-top: 10px; padding: 12px; border-radius: 10px; background: hsl(var(--muted) / 0.4); }
.platform-select-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.platform-select-label { font-size: 11px; font-weight: 500; color: hsl(var(--muted-foreground)); }
.platform-select-all { font-size: 11px; font-weight: 600; color: hsl(var(--primary)); background: none; border: none; cursor: pointer; padding: 0; }
.platform-select-all:hover { opacity: 0.7; }

.platform-list { display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto; }
.platform-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid hsl(var(--border)); background: hsl(var(--card)); cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.platform-item:hover { border-color: hsl(var(--primary) / 0.3); }
.platform-item.checked { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.04); }
.platform-checkbox { accent-color: hsl(var(--primary)); }
.platform-name { font-size: 12px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; }
.platform-mode { font-size: 10px; color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); padding: 1px 6px; border-radius: 4px; }

.confirm-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid hsl(var(--border)); }
.confirm-btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 8px; border: none; cursor: pointer; transition: all var(--duration-base) var(--ease-standard); }
.confirm-btn.cancel { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
.confirm-btn.cancel:hover { background: hsl(var(--muted) / 0.8); }
.confirm-btn.delete { background: hsl(var(--destructive)); color: #fff; }
.confirm-btn.delete:hover { opacity: 0.9; }
</style>
