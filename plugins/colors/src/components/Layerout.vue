<script setup lang="ts"></script>
<template>
  <div class="flex h-screen flex-col bg-gradient-to-br from-slate-100 to-slate-200">
    <!-- 顶部导航栏 -->
    <div class="shrink-0 border-b border-gray-200 bg-white shadow-sm">
      <slot name="header"></slot>
    </div>
    <!-- 主要内容区域 -->
    <div class="scrollbar-hide flex-1 overflow-auto p-6">
      <div class="mx-auto max-w-7xl">
        <slot></slot>
      </div>
    </div>
  </div>
</template>
