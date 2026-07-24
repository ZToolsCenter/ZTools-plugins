<script setup lang="ts">
import { colord } from "colord";
import { computed } from "vue";
import { useConfigStore } from "@/utils/config";
import { useTagsEditing, type ColorFavorite } from "@/utils/favorites";
import { colorToCSS, colorToDisplay } from "@/utils/favorites";
import { copyColor, copyColor2, copyCSS } from "../utils/copy";
import Tags from "./tags.vue";

const editing = useTagsEditing();
const config = useConfigStore();

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
const cssColor = computed(() => colorToCSS(props.favorite.color));
const displayText = computed(() => colorToDisplay(props.favorite.color));

// 纯色用 colord 格式化后复制，渐变直接复制 CSS 原文
const handleCopy = () => {
  if (props.favorite.color.type === "hex") {
    copyColor2(colord(props.favorite.color.hex), config);
  } else {
    copyCSS(cssColor.value);
  }
};
</script>

<template>
  <div class="group relative overflow-hidden rounded-xl shadow-md transition-all hover:shadow-xl">
    <!-- 颜色块 -->
    <div
      class="relative aspect-square cursor-pointer p-2"
      :style="{ background: cssColor }"
      @click="handleCopy"
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
        <span class="font-mono text-sm font-medium text-gray-700">{{ displayText }}</span>
      </div>
    </div>
  </div>
</template>
