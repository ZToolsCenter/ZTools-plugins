<script setup lang="ts">
import { ImageOff } from 'lucide-vue-next'
import { ref } from 'vue'
import { iconSvgUrl } from '../services/iconify'
import type { IconItem } from '../types/icon'

const props = defineProps<{
  item: IconItem
  index: number
  selected: boolean
  color: string
}>()

const emit = defineEmits<{
  select: [index: number]
}>()

const failed = ref(false)
</script>

<template>
  <button
    type="button"
    class="icon-card"
    :class="{ selected }"
    :data-icon-index="index"
    :aria-label="`${index + 1}，${item.name}，${item.collectionName}`"
    :aria-pressed="selected"
    :title="`${index + 1} · ${item.id} · ${item.collectionName}`"
    @click="emit('select', index)"
  >
    <span class="icon-sequence" aria-hidden="true">{{ index + 1 }}</span>
    <span class="icon-artboard">
      <ImageOff v-if="failed" :size="28" class="image-error" aria-hidden="true" />
      <img
        v-else
        :src="iconSvgUrl(item.id, item.palette ? undefined : color)"
        :alt="item.name"
        loading="lazy"
        @error="failed = true"
      />
    </span>
    <span class="icon-meta">
      <strong>{{ item.name }}</strong>
    </span>
  </button>
</template>
