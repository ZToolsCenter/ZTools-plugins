<template>
  <div
    class="issuer-icon"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: emojiIcon ? `${size * 0.5}px` : `${size * 0.45}px`,
      backgroundColor: emojiIcon ? 'transparent' : bgColor,
    }"
  >
    <span v-if="emojiIcon" class="icon-emoji">{{ emojiIcon }}</span>
    <span v-else class="icon-letter">{{ firstLetter }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getIssuerIcon, getIssuerColor } from '@/utils/issuerIcons'

const props = withDefaults(defineProps<{
  issuer: string
  size?: number
}>(), {
  size: 40,
})

const emojiIcon = computed(() => getIssuerIcon(props.issuer))
const bgColor = computed(() => getIssuerColor(props.issuer))
const firstLetter = computed(() => props.issuer.charAt(0).toUpperCase() || '?')
</script>

<style scoped>
.issuer-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  user-select: none;
}

.icon-emoji {
  line-height: 1;
}

.icon-letter {
  color: var(--text-primary);
  font-weight: 700;
  line-height: 1;
}
</style>
