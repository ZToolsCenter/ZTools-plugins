<script setup lang="ts">
import { ref, computed } from 'vue'
import { PLATFORM_ICONS } from '../data/platform-icons'

const props = defineProps<{
  platformId: string
  size?: number
}>()

const imgError = ref(false)

const platformIcons: Record<string, string> = {
  'antigravity': PLATFORM_ICONS.antigravity,
  'cherry-studio': PLATFORM_ICONS['cherry-studio'],
  'claude': PLATFORM_ICONS.claude,
  'cline': PLATFORM_ICONS.cline,
  'codebuddy': PLATFORM_ICONS.codebuddy,
  'codex': PLATFORM_ICONS.codex,
  'copilot': PLATFORM_ICONS.copilot,
  'cursor': PLATFORM_ICONS.cursor,
  'gemini': PLATFORM_ICONS.gemini,
  '_generic': PLATFORM_ICONS.generic,
  'hermes': PLATFORM_ICONS.hermes,
  'kilo': PLATFORM_ICONS.kilo,
  'kiro': PLATFORM_ICONS.kiro,
  'mimo': PLATFORM_ICONS.mimo,
  'openclaw': PLATFORM_ICONS.openclaw,
  'opencode': PLATFORM_ICONS.opencode,
  'qoder': PLATFORM_ICONS.qoder,
  'qoderwork': PLATFORM_ICONS.qoderwork,
  'trae': PLATFORM_ICONS.trae,
  'trae-cn': PLATFORM_ICONS.trae,
  'windsurf': PLATFORM_ICONS.windsurf,
}

const fallbackIcons: Record<string, string> = {
  'antigravity': '🚀',
  'cherry-studio': '🍒',
  'claude': '🤖',
  'cline': '🔧',
  'codebuddy': '🤝',
  'codex': '⚡',
  'copilot': '🐙',
  'cursor': '▮',
  'gemini': '✦',
  '_generic': '📦',
  'hermes': '🤖',
  'kilo': '💎',
  'kiro': '✨',
  'mimo': '🤖',
  'openclaw': '🐾',
  'opencode': '⬛',
  'qoder': '🔍',
  'qoderwork': '🔍',
  'trae': '⚡',
  'trae-cn': '⚡',
  'windsurf': '🌊',
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
