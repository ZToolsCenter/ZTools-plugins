<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

let route = useRoute();
let currentPage = computed(() => {
  switch (route.path) {
    case "/":
      return "picker";
    default:
      return route.path.substring(1).replace("/", "-") as "picker" | "favorites";
  }
});
</script>
<template>
  <div class="mx-auto max-w-7xl px-6 py-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-800">颜色助手</h1>
      <div class="flex space-x-2">
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
      </div>
    </div>
  </div>
</template>
