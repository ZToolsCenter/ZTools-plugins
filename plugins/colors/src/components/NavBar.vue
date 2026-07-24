<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const currentPage = computed(() => {
  switch (route.path) {
    case "/":
      return "picker";
    case "/gradient":
      return "gradient";
    case "/ai-colors":
      return "ai-colors";
    case "/favorites":
      return "favorites";
    case "/about":
      return "about";
    default:
      return route.path.substring(1).replace("/", "-");
  }
});
</script>
<template>
  <div class="mx-auto max-w-7xl px-6 py-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-800">颜色助手</h1>
      <div class="flex items-center space-x-2">
        <RouterLink to="/">
          <button
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
        </RouterLink>

        <RouterLink to="/gradient">
          <button
            :class="[
              'rounded-lg px-4 py-2 transition-all',
              currentPage === 'gradient'
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
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
              <span>渐变</span>
            </span>
          </button>
        </RouterLink>

        <RouterLink to="/ai-colors">
          <button
            :class="[
              'rounded-lg px-4 py-2 transition-all',
              currentPage === 'ai-colors'
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
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
              <span>AI 配色</span>
            </span>
          </button>
        </RouterLink>

        <RouterLink to="/favorites">
          <button
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
        </RouterLink>

        <RouterLink to="/about">
          <button
            :class="[
              'rounded-lg p-2 transition-all',
              currentPage === 'about'
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100',
            ]"
            title="关于"
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
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
