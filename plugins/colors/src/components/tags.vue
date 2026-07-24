<script setup lang="ts">
import { getTagStyle } from "@/utils/tags";

interface Props {
  tags: string[];
}

let props = defineProps<Props>();
</script>
<template>
  <div class="flex min-h-[28px] flex-wrap gap-2">
    <span
      v-for="tag in tags"
      :key="tag"
      :class="[
        'inline-flex cursor-pointer items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-95',
        getTagStyle(tag).bg,
        getTagStyle(tag).text,
        getTagStyle(tag).hover,
      ]"
    >
      <span class="mr-1 text-[10px] opacity-60">✦</span>
      {{ tag }}
    </span>
  </div>
</template>
