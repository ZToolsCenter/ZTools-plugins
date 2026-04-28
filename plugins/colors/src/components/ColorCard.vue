<script setup lang="ts">
import { computed } from "vue";
import { useTagsEditing, type ColorFavorite } from "@/utils/favorites";
import { copyColor } from "../utils/copy";
import Tags from "./tags.vue";

const editing = useTagsEditing();

interface Props {
  favorite: ColorFavorite;
}

interface Emits {
  (e: "remove", id: string): void;
  (e: "update:favorite", favorite: ColorFavorite): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const tags = computed(() => props.favorite.tags ?? []);
</script>

<template>
  <div class="group relative overflow-hidden rounded-xl shadow-md transition-all hover:shadow-xl">
    <!-- 颜色块 -->
    <div
      class="relative aspect-square cursor-pointer p-2"
      :style="{ backgroundColor: favorite.color }"
      @click="copyColor(favorite.color)"
      title="点击复制颜色值"
    >
      <!-- 标签 -->
      <div class="max-h-[100%] overflow-hidden">
        <Tags :tags="tags"></Tags>
      </div>
      <!-- 悬浮操作层 -->
      <div
        class="bg-opacity-0 group-hover:bg-opacity-30 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#00000033] opacity-0 transition-all group-hover:opacity-100"
      >
        <button
          @click.stop="editing.startEditing(favorite.id)"
          class="rounded-lg bg-white px-3 py-1 text-sm font-medium text-blue-500 transition-colors hover:bg-blue-50"
        >
          编辑标签
        </button>
        <button
          @click.stop="$emit('remove', favorite.id)"
          class="rounded-lg bg-white px-3 py-1 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
        >
          取消收藏
        </button>
      </div>
    </div>

    <!-- 颜色信息和标签 -->
    <div
      class="absolute right-0 bottom-0 left-0 bg-white p-3"
      :style="{
        background: 'linear-gradient(to bottom, transparent 0%, white 20%, white 100%)',
      }"
    >
      <div class="mt-2 flex items-center justify-between">
        <span class="font-mono text-sm font-medium text-gray-700">{{ favorite.color }}</span>
      </div>
    </div>
  </div>
</template>
