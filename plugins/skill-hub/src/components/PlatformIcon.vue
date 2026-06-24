<script setup lang="ts">
import { ref, computed } from 'vue'
import { PLATFORM_ICONS } from '../data/platform-icons'

const props = defineProps<{
  platformId: string
  size?: number
}>()

const imgError = ref(false)

const platformIcons: Record<string, string> = {
  'claude': PLATFORM_ICONS.claude,
  'codex': PLATFORM_ICONS.codex,
  'gemini': PLATFORM_ICONS.gemini,
  'opencode': PLATFORM_ICONS.opencode,
  'cursor': PLATFORM_ICONS.cursor,
  'windsurf': PLATFORM_ICONS.windsurf,
  'trae': PLATFORM_ICONS.trae,
  'trae-cn': PLATFORM_ICONS.trae,
  'copilot': PLATFORM_ICONS.copilot,
  'kiro': PLATFORM_ICONS.kiro,
  'cline': PLATFORM_ICONS.cline,
  'amp': PLATFORM_ICONS.opencode,
  'openclaw': PLATFORM_ICONS.openclaw,
  'kilo': PLATFORM_ICONS.kilo,
  'hermes': PLATFORM_ICONS.hermes,
  'codebuddy': PLATFORM_ICONS.codebuddy,
  'qoder': PLATFORM_ICONS.qoder,
  'qoderwork': PLATFORM_ICONS.qoderwork,
  'antigravity': PLATFORM_ICONS.antigravity,
  'cherry-studio': PLATFORM_ICONS.cherryStudio,
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
