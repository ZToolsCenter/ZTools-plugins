<script setup lang="ts">
import { useFavorites, type ColorFavorite } from "@/utils/favorites";

interface Props {
  allTags: string[];
  selectedTags: string[];
  favorites: ColorFavorite[];
}

interface Emits {
  (e: "toggle-tag", tag: string): void;
  (e: "clear-tags"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// 计算每个标签的颜色数量
const getTagCount = (tag: string) => {
  return props.favorites.filter((f) => f.tags.includes(tag)).length;
};
</script>

<template>
  <div class="sticky top-6 rounded-xl bg-white p-4 shadow-lg">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-semibold text-gray-800">标签筛选</h3>
      <button
        v-if="selectedTags.length > 0"
        @click="$emit('clear-tags')"
        class="text-xs text-blue-600 hover:text-blue-700"
      >
        清除
      </button>
    </div>

    <div v-if="allTags.length > 0" class="space-y-2">
      <button
        v-for="tag in allTags"
        :key="tag"
        @click="$emit('toggle-tag', tag)"
        :class="[
          'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
          selectedTags.includes(tag)
            ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
            : 'text-gray-700 hover:bg-gray-100 hover:shadow-sm',
        ]"
      >
        <span>{{ tag }}</span>
        <span
          :class="[
            'rounded-full px-2 py-0.5 text-xs font-medium',
            selectedTags.includes(tag) ? 'bg-blue-400/30 text-white' : 'bg-gray-200 text-gray-600',
          ]"
        >
          {{ getTagCount(tag) }}
        </span>
      </button>
    </div>

    <div v-else class="py-8 text-center text-gray-400">
      <p class="text-sm">暂无标签</p>
      <p class="mt-2 text-xs">为颜色添加标签后将显示在这里</p>
    </div>
  </div>
</template>
