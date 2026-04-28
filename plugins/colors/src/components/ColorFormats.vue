<script setup lang="ts">
import { colord } from "colord";
import { computed } from "vue";
import { copyColor } from "@/utils/copy";
import { useMessage } from "@/utils/message";
import { useFavorites } from "../utils/favorites";
import ColorFormat from "./ColorFormat.vue";

const message = useMessage();
const { addFavorite } = useFavorites();
let color = defineModel<string>();
let col = computed({
  get: () => colord(color.value ?? "#000000"),
  set: (v) => {
    color.value = v.toHex();
  },
});

const formats = ["hex", "rgb", "hsv/hsb", "hsl"] as const;

// 添加到收藏
const addToFavorites = () => {
  try {
    addFavorite(color.value || "#000000");
    message.success("已添加到收藏");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "添加失败");
  }
};
</script>

<template>
  <div class="space-y-3">
    <!-- 收藏按钮 -->
    <button
      @click="addToFavorites"
      class="flex w-full items-center justify-center space-x-2 rounded-lg bg-gradient-to-r from-pink-500 to-red-500 px-4 py-2 text-white shadow-md transition-all hover:from-pink-600 hover:to-red-600 hover:shadow-lg"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
      <span class="font-medium">添加到收藏</span>
    </button>

    <!-- HEX -->
    <ColorFormat v-for="format in formats" :key="format" :flag="format" v-model="col"></ColorFormat>
  </div>
</template>
