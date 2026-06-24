<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  platformId: string
  size?: number
}>()

const imgError = ref(false)

const platformIcons: Record<string, string> = {
  'claude': '/src/assets/platforms/claude.png',
  'codex': '/src/assets/platforms/codex.png',
  'gemini': '/src/assets/platforms/gemini.png',
  'opencode': '/src/assets/platforms/opencode.png',
  'cursor': '/src/assets/platforms/cursor.png',
  'windsurf': '/src/assets/platforms/windsurf.png',
  'trae': '/src/assets/platforms/trae.png',
  'trae-cn': '/src/assets/platforms/trae.png',
  'copilot': '/src/assets/platforms/copilot.svg',
  'kiro': '/src/assets/platforms/kiro.png',
  'cline': '/src/assets/platforms/cline.svg',
  'amp': '/src/assets/platforms/opencode.png',
  'openclaw': '/src/assets/platforms/openclaw.png',
  'kilo': '/src/assets/platforms/kilo-dark.svg',
  'hermes': '/src/assets/platforms/hermes.svg',
  'codebuddy': '/src/assets/platforms/codebuddy-dark.svg',
  'qoder': '/src/assets/platforms/qoder.png',
  'qoderwork': '/src/assets/platforms/qoderwork.png',
  'antigravity': '/src/assets/platforms/antigravity.svg',
  'cherry-studio': '/src/assets/platforms/cherry-studio.png',
}

const fallbackIcons: Record<string, string> = {
  'claude': '🤖',
  'codex': '⚡',
  'gemini': '✦',
  'opencode': '⬛',
  'cursor': '📁',
  'windsurf': '🌀',
  'trae': '🔷',
  'trae-cn': '🔷',
  'copilot': '🐙',
  'kiro': '⚡',
  'cline': '🔧',
  'amp': '⚡',
  'openclaw': '🐾',
  'kilo': '💎',
  'hermes': '🤖',
  'codebuddy': '🤝',
  'qoder': '🔍',
  'qoderwork': '🔍',
  'antigravity': '🚀',
  'cherry-studio': '💗',
  'mimo': '🔶',
}

const iconUrl = computed(() => platformIcons[props.platformId])
const fallback = computed(() => fallbackIcons[props.platformId] || '🤖')
const iconSize = computed(() => props.size || 24)
const showFallback = computed(() => !iconUrl.value || imgError.value)
</script>

<template>
  <div class="platform-icon" :style="{ width: iconSize + 'px', height: iconSize + 'px' }">
    <img
      v-if="!showFallback"
      :src="iconUrl"
      :alt="platformId"
      :style="{ width: iconSize + 'px', height: iconSize + 'px' }"
      @error="imgError = true"
      class="platform-img"
    />
    <span v-else class="platform-fallback" :style="{ fontSize: (iconSize * 0.6) + 'px' }">{{ fallback }}</span>
  </div>
</template>

<style scoped>
.platform-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.platform-img {
  object-fit: contain;
  border-radius: 4px;
}

.platform-fallback {
  line-height: 1;
}
</style>
