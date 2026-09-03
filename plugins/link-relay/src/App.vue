<script setup lang="ts">
/** 应用根组件：只负责挂载唯一页面 Home，不写任何界面业务。 */
import Home from './views/Home.vue';
</script>

<template>
  <Home />
</template>

<style>
/* ── 应用根挂载点容器初始化（全局，非 scoped） ── */
#app {
  width: 100%;
  min-height: 100vh;
  background: var(--page);
  color: var(--ink-2);
  font-family: var(--font-sans);
  font-size: var(--fs-base);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
</style>
