<script setup lang="ts">
import { ref, computed } from 'vue'
import { getAvatarColor } from '../utils/color'

export interface SkillPickItem {
  name: string
  description: string
  dir: string
  id?: string
}

const props = defineProps<{
  skills: SkillPickItem[]
}>()

const emit = defineEmits<{
  select: [dir: string]
  close: []
}>()

const selectedDir = ref('')
const hoveredIdx = ref(-1)

function handleSelect(dir: string) {
  selectedDir.value = dir
  emit('select', dir)
}
</script>

<template>
  <div class="pick-overlay" @click.self="emit('close')">
    <div class="pick-modal">
      <!-- Header -->
      <div class="pick-header">
        <div class="pick-header-info">
          <h2 class="pick-title">选择技能</h2>
          <p class="pick-subtitle">在仓库中找到 {{ skills.length }} 个技能，请选择要导入的哪一个</p>
        </div>
        <button class="pick-close" @click="emit('close')" title="取消">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- List -->
      <div class="pick-body">
        <div
          v-for="(s, idx) in skills"
          :key="s.dir"
          class="pick-item"
          :class="{ active: selectedDir === s.dir, hovered: hoveredIdx === idx }"
          @click="handleSelect(s.dir)"
          @mouseenter="hoveredIdx = idx"
          @mouseleave="hoveredIdx = -1"
        >
          <div class="pick-item-avatar" :style="{ background: getAvatarColor(s.name) }">
            {{ s.name.charAt(0).toUpperCase() }}
          </div>
          <div class="pick-item-info">
            <div class="pick-item-name">{{ s.name || '未命名' }}</div>
            <div class="pick-item-desc">{{ s.description || '暂无描述' }}</div>
            <div class="pick-item-dir">{{ s.dir }}</div>
          </div>
          <div class="pick-item-check" v-if="selectedDir === s.dir">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="pick-footer">
        <button class="pick-btn cancel" @click="emit('close')">取消</button>
        <button class="pick-btn confirm" :disabled="!selectedDir" @click="selectedDir && emit('select', selectedDir)">
          导入此技能
        </button>
      </div>
    </div>
  </div>
</template>



<style scoped>
.pick-overlay {
  position: fixed;
  inset: 0;
  background: hsl(0 0% 0% / 0.45);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 20px;
}

.pick-modal {
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px hsl(0 0% 0% / 0.25);
}

/* Header */
.pick-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
}

.pick-header-info { min-width: 0; }

.pick-title {
  font-size: 17px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0 0 4px;
}

.pick-subtitle {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin: 0;
}

.pick-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--duration-base) var(--ease-standard);
  margin-top: -2px;
}

.pick-close:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

/* Body */
.pick-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pick-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
  border: 1.5px solid transparent;
}

.pick-item:hover,
.pick-item.hovered {
  background: hsl(var(--accent));
}

.pick-item.active {
  background: hsl(var(--primary) / 0.08);
  border-color: hsl(var(--primary) / 0.3);
}

.pick-item-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.pick-item-info {
  flex: 1;
  min-width: 0;
}

.pick-item-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-item-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 0 2px;
}

.pick-item-dir {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.7);
  font-family: 'SF Mono', Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-item-check {
  flex-shrink: 0;
  color: hsl(var(--primary));
  display: flex;
}

/* Footer */
.pick-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid hsl(var(--border));
  flex-shrink: 0;
}

.pick-btn {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all var(--duration-base) var(--ease-standard);
}

.pick-btn.cancel {
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.pick-btn.cancel:hover {
  background: hsl(var(--border));
}

.pick-btn.confirm {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.pick-btn.confirm:hover {
  background: hsl(var(--primary) / 0.85);
}

.pick-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
