<script setup lang="ts">
/**
 * ProviderIcon — cherry-studio inspired inline SVG component
 *
 * Renders provider/brand icons as inline SVGs so hardcoded brand colors
 * (e.g. Anthropic #CA9F7B) show properly, and `currentColor` fills inherit
 * from the parent element's CSS `color` property.
 *
 * Variants (matches cherry-studio CompoundIcon convention):
 *   avatar — circular container (like cherry-studio CompoundIcon.Avatar)
 *   mono   — standalone icon, inherits text color (like cherry-studio default)
 *
 * Usage:
 *   <ProviderIcon icon="openai" />                — avatar circle (default)
 *   <ProviderIcon icon="openai" variant="mono" /> — standalone icon
 *   <ProviderIcon icon="openai" :size="32" />     — custom size
 */

import { computed } from 'vue'

const props = withDefaults(defineProps<{
  icon?: string
  size?: number
  variant?: 'avatar' | 'mono'
}>(), {
  size: 20,
  variant: 'avatar',
})

/* ── SVG module registry ─────────────────────────────────────── */

const providerModules = import.meta.glob<string>('/src/assets/providers/*.svg', {
  query: '?raw', eager: true, import: 'default',
})

const platformModules = import.meta.glob<string>('/src/assets/platforms/*.svg', {
  query: '?raw', eager: true, import: 'default',
})

const ICON_ALIAS: Record<string, string> = {
  siliconcloud: 'silicon',
  chatglm: 'zhipu',
}

function resolveName(icon: string): string {
  return ICON_ALIAS[icon] || icon
}

/* ── Unique IDs (cherry-studio useId equivalent) ──────────────── */

let uidCounter = 0

function injectSvg(raw: string): string {
  const uid = `c${++uidCounter}`
  return raw
    .replace(/\sid="([^"]+)"/g,      ` id="${uid}-$1"`)
    .replace(/url\(#/g,               `url(#${uid}-`)
    .replace(/xlink:href="#/g,        `xlink:href="#${uid}-`)
    .replace(/\shref="#/g,            ` href="#${uid}-`)
}

/* ── Computed SVG content ────────────────────────────────────── */

const iconSvg = computed(() => {
  if (!props.icon) return ''
  const name = resolveName(props.icon)
  const raw = (
    providerModules[`/src/assets/providers/${name}.svg`]
    ?? platformModules[`/src/assets/platforms/${name}.svg`]
    ?? ''
  )
  return raw ? injectSvg(raw) : ''
})
</script>

<template>
  <!-- Avatar variant: circular themed container (cherry-studio CompoundIcon.Avatar) -->
  <span
    v-if="variant === 'avatar'"
    class="pi-avatar"
    :style="{ width: size + 'px', height: size + 'px', minWidth: size + 'px' }"
  >
    <span
      v-if="iconSvg"
      v-html="iconSvg"
      class="pi-avatar-icon"
    />
    <span v-else class="pi-fallback">&#x2699;</span>
  </span>

  <!-- Mono variant: standalone icon, inherits text color (cherry-studio default) -->
  <span
    v-else-if="iconSvg"
    v-html="iconSvg"
    class="pi-mono"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
  <span v-else class="pi-fallback-mono">&#x2699;</span>
</template>

<style scoped>
.pi-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 50%;
}

.pi-avatar-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.pi-avatar-icon :deep(svg) {
  width: 100%;
  height: 100%;
  transform: scale(1.5);
}

.pi-mono {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pi-mono :deep(svg) {
  width: 100%;
  height: 100%;
}

.pi-fallback {
  font-size: inherit;
  line-height: 1;
}

.pi-fallback-mono {
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}
</style>