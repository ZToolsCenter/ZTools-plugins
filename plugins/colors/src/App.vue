<script setup lang="ts">
// import { onPluginEnter, onPluginOut } from "@ztools-center/ztools-api-types";
import { computed, onMounted, ref } from "vue";
import ColorWheel from "./components/ColorWheel.vue";
import ColorSlider from "./components/ColorSlider.vue";
import ColorFormats from "./components/ColorFormats.vue";
import HarmonyColors from "./components/HarmonyColors.vue";
// import { showSuccess } from "./utils/notification";
import { copyColor } from "./utils/copy";

// let enterAction = ref<{
//   code: string;
//   type: string;
//   payload: any;
//   option: any;
//   from?: PluginEnterFrom;
// } | null>();
// let route = ref("");

const currentColor = ref("#312588");

// onMounted(() => {
//   onPluginEnter((action) => {
//     route.value = action.code;
//     // enterAction.value = action;
//   });
//   onPluginOut(() => {
//     route.value = "";
//   });
// });

let currentColorNotHash = computed(() =>
  currentColor.value.startsWith("#") ? currentColor.value.substring(1) : currentColor.value,
);
let isColorRemovalHash = ref(false);
let clickCopyColor = () => {
  if (isColorRemovalHash.value) {
    copyColor(currentColorNotHash.value);
  } else {
    copyColor(currentColor.value);
  }
};
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
    <!-- 顶部工具栏 -->
    <!--<div
      class="bg-white shadow-sm border-b border-gray-200 px-6 py-3 flex items-center justify-between"
    >
      <div class="flex items-center space-x-4">
        <h1 class="text-lg font-semibold text-gray-800">颜色助手</h1>
      </div>
      <div class="flex items-center space-x-3">
        <button class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors">
          颜色助手
        </button>

        <button class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors">
          收藏颜色
        </button>
      </div>
    </div>-->

    <!-- 主要内容区域 -->
    <div class="p-6 grid grid-cols-12 gap-6 max-w-7xl mx-auto">
      <!-- 左侧：色轮和滑块 -->
      <div class="col-span-4 space-y-6">
        <div class="bg-white rounded-2xl shadow-lg p-6">
          <div class="flex justify-center mb-6">
            <ColorWheel v-model="currentColor" />
          </div>
          <div class="space-y-4">
            <ColorSlider v-model="currentColor" type="saturation" />
            <ColorSlider v-model="currentColor" type="value" />
          </div>
        </div>
      </div>

      <!-- 中间：颜色格式显示 -->
      <div class="col-span-4">
        <div class="h-full bg-white rounded-2xl shadow-lg p-6">
          <ColorFormats :color="currentColor" />
        </div>
      </div>

      <!-- 右侧：和谐色 -->
      <div class="col-span-4">
        <div class="bg-white rounded-2xl shadow-lg p-6">
          <HarmonyColors :color="currentColor" />
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div
      class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between"
    >
      <div class="flex items-center space-x-4">
        <label class="flex items-center space-x-2 cursor-pointer">
          <input v-model="isColorRemovalHash" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-700">色值去 "#"</span>
        </label>
      </div>
      <div class="flex items-center space-x-3">
        <button
          class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          @click="clickCopyColor()"
        >
          复制颜色
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
