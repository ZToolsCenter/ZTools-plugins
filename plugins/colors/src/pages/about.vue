<script setup lang="ts">
/**
 * 关于页
 */
import DatabaseIO from "@/components/DatabaseIO.vue";
import { databaseNames } from "@/utils/databases";

const dbNames = databaseNames();

const APP_VERSION = "1.4.0";

const techStack = [
  { name: "Vue 3", version: "3.5" },
  { name: "Pinia", version: "3.0" },
  { name: "Tailwind CSS", version: "4.2" },
  { name: "Vite", version: "8.0" },
];
</script>

<template>
  <div class="space-y-6">
    <!-- 关于 -->
    <div class="rounded-xl bg-white p-6 shadow-md">
      <div class="mb-4 flex items-center gap-3">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-xl font-bold text-white shadow-md"
        >
          C
        </div>
        <div>
          <h2 class="text-xl font-bold text-gray-800">颜色助手</h2>
          <p class="text-sm text-gray-500">v{{ APP_VERSION }}</p>
        </div>
      </div>

      <p class="mb-4 text-sm text-gray-600">颜色工具集 — 取色器 · 渐变编辑 · 收藏管理</p>

      <!-- 技术栈 -->
      <div class="mb-4">
        <h4 class="mb-2 text-xs font-semibold text-gray-400 uppercase">技术栈</h4>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tech in techStack"
            :key="tech.name"
            class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
          >
            {{ tech.name }} {{ tech.version }}
          </span>
        </div>
      </div>

      <!-- 作者 & 仓库 -->
      <div class="space-y-2 text-sm">
        <div class="flex items-center gap-2 text-gray-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span>作者：<strong>mekefly</strong></span>
        </div>
        <a
          href="https://github.com/mekefly/colors"
          target="_blank"
          class="flex items-center gap-2 text-gray-600 transition-colors hover:text-indigo-600"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0 text-gray-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
            />
          </svg>
          <span>GitHub：<strong>mekefly/colors</strong></span>
        </a>
      </div>
    </div>

    <!-- 数据库导入导出 -->
    <div class="rounded-xl bg-white p-6 shadow-md">
      <h3 class="mb-4 text-lg font-semibold text-gray-800">数据库</h3>
      <DatabaseIO :db-names="dbNames" />
    </div>
  </div>
</template>
