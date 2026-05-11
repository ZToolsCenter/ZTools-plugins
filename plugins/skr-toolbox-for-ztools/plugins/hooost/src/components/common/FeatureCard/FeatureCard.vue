<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { AdaptiveIcon } from '@/components'

interface Feature {
  name?: string
  code?: string
  explain?: string
  icon?: string
}

defineProps<{
  feature: Feature
}>()

const hasError = ref(false)
const isVisible = ref(false)
const cardRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function handleIconError(): void {
  hasError.value = true
}

onMounted(() => {
  if (!cardRef.value) return

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        isVisible.value = true
        // 一旦可见就停止观察，图标不需要再隐藏回去
        observer?.disconnect()
        observer = null
      }
    },
    { rootMargin: '200px' } // 提前 200px 开始加载，减少用户感知延迟
  )

  observer.observe(cardRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})
</script>
<template>
  <div ref="cardRef" class="card feature-card">
    <div class="feature-header">
      <div v-if="feature.icon" class="feature-icon">
        <!-- 未进入可视区域时显示轻量占位符 -->
        <div v-if="!isVisible" class="icon-placeholder icon-lazy-placeholder">
          {{ (feature.explain || feature.name || 'F').charAt(0).toUpperCase() }}
        </div>
        <template v-else>
          <span v-if="feature.icon.length <= 2" class="icon-emoji">{{ feature.icon }}</span>
          <AdaptiveIcon
            v-else-if="!hasError"
            :src="feature.icon"
            draggable="false"
            @error="handleIconError"
          />
          <div v-else class="icon-placeholder">
            {{ (feature.explain || feature.name || 'F').charAt(0).toUpperCase() }}
          </div>
        </template>
      </div>
      <div class="feature-title">
        {{ feature.explain || feature.name }}
      </div>
    </div>
    <div class="feature-commands">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.feature-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  cursor: default;
  transition: all 0.2s;
  gap: 8px;
}

.feature-card:hover {
  background: var(--hover-bg);
}

.feature-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.feature-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
}

.feature-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.feature-icon .icon-emoji {
  font-size: 16px;
  line-height: 1;
}

.feature-icon .icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--control-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
}

.feature-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  line-height: 1.4;
}

.feature-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 懒加载占位符 */
.icon-lazy-placeholder {
  opacity: 0.4;
}
</style>
