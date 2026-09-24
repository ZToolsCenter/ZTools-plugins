<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { useProviders } from '../../composables/useProviders';
  import { openUrl } from '../../utils/openUrl';
  const { paths } = useProviders();
</script>

<template>
  <footer class="app-footer">
    <a href="#" @click.prevent="openUrl('https://github.com/Cifferni/zTools-ccToggle')">GitHub</a>
  </footer>
</template>

<style scoped>
  .app-footer {
    padding: 4px 16px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  a {
    color: var(--text-muted);
    text-decoration: none;
  }
  a:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>
