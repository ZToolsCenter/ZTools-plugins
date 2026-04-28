<script setup lang="ts">
import { computed, ref } from "vue";
import ColorFormats from "./components/ColorFormats.vue";
import ColorSlider from "./components/ColorSlider.vue";
import ColorWheel from "./components/ColorWheel.vue";
import FavoritesView from "./components/FavoritesView.vue";
import HarmonyColors from "./components/HarmonyColors.vue";
import ProvideMessage from "./components/ProvideMessage.vue";
import { useCounterStore } from "./utils/config";
import { copyColor } from "./utils/copy";
import zToolsApi from "./utils/ztoolsapi";

const config = useCounterStore();
const thereIsNoZToolsApiAvailable = !zToolsApi;
const currentColor = ref("#FFFFFF");

// 页面导航状态
const currentPage = ref<"picker" | "favorites">("picker");

const currentColorNotHash = computed(() =>
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

// 切换页面
const switchPage = (page: "picker" | "favorites") => {
  currentPage.value = page;
};
</script>

<template>
  <div v-if="thereIsNoZToolsApiAvailable">
    <div class="flex h-screen flex-col items-center justify-center">
      <p class="text-2xl font-semibold text-gray-800">颜色助手</p>
      <p class="text-gray-600">请使用 ZTools 打开此页面</p>
      <a class="text-blue-600 hover:underline" href="https://ztoolscenter.github.io/ZTools-doc/"
        >您可以查看开发者文档了解更多内容</a
      >
    </div>
  </div>
  <div v-else class="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
    <!-- 顶部导航栏 -->
    <div class="border-b border-gray-200 bg-white shadow-sm">
      <div class="mx-auto max-w-7xl px-6 py-4">
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold text-gray-800">颜色助手</h1>
          <div class="flex space-x-2">
            <button
              @click="switchPage('picker')"
              :class="[
                'rounded-lg px-4 py-2 transition-all',
                currentPage === 'picker'
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100',
              ]"
            >
              <span class="flex items-center space-x-2">
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
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                  />
                </svg>
                <span>取色器</span>
              </span>
            </button>
            <button
              @click="switchPage('favorites')"
              :class="[
                'rounded-lg px-4 py-2 transition-all',
                currentPage === 'favorites'
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100',
              ]"
            >
              <span class="flex items-center space-x-2">
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
                <span>收藏</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="mx-auto max-w-7xl p-6">
      <!-- 取色器页面 -->
      <div v-if="currentPage === 'picker'" class="grid grid-cols-12 gap-6">
        <!-- 左侧：色轮和滑块 -->
        <div class="col-span-6 space-y-6">
          <div class="rounded-2xl bg-white p-6 shadow-lg">
            <div class="mb-6 flex justify-center">
              <ColorWheel v-model="currentColor" />
            </div>
            <div class="space-y-4">
              <ColorSlider v-model="currentColor" type="saturation" />
              <ColorSlider v-model="currentColor" type="value" />
            </div>
          </div>
        </div>

        <!-- 右侧：和谐色 -->
        <div class="col-span-6">
          <div class="rounded-2xl bg-white p-6 shadow-lg">
            <HarmonyColors :color="currentColor" />
          </div>
        </div>
        <!-- 中间：颜色格式显示 -->
        <div class="col-span-6">
          <div class="rounded-2xl bg-white p-6 shadow-lg">
            <ColorFormats v-model="currentColor" />
          </div>
        </div>
        <!-- 底部操作栏 -->
        <div class="col-span-6">
          <div class="rounded-2xl bg-white p-6 shadow-lg">
            <div class="flex items-center space-x-4">
              <label class="flex cursor-pointer items-center space-x-2">
                <input
                  :value="config.removeHash"
                  @input="($event: any) => config.$patch({ removeHash: $event.target.checked })"
                  type="checkbox"
                  class="rounded text-blue-600"
                />
                <span class="text-sm text-gray-700">色值去 "#"</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- 收藏页面 -->
      <div v-else-if="currentPage === 'favorites'">
        <div class="rounded-2xl bg-white p-6 shadow-lg">
          <FavoritesView />
        </div>
      </div>
    </div>

    <!-- 消息通知组件 -->
    <ProvideMessage />
  </div>
</template>

<style scoped></style>
