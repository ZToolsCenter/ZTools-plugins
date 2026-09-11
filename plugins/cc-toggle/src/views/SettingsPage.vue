<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { computed } from 'vue';
  import { useRoute, useRouter } from 'vue-router';

  const route = useRoute();
  const router = useRouter();

  const tabs = [
    { path: '/settings/claude', label: '通用配置' },
    { path: '/settings/routes', label: '路由 / 代理' },
    { path: '/settings/storage', label: 'Skill 存储' },
    { path: '/settings/about', label: '关于' }
  ];

  const activePath = computed(() => route.path);

  function go(p) {
    if (route.path !== p) router.push(p);
  }
</script>

<template>
  <div class="settings-page">
    <n-page-header title="设置" @back="router.push('/')" />

    <nav class="sub-tabs">
      <button
        v-for="t in tabs"
        :key="t.path"
        class="sub-tab"
        :class="{ 'sub-tab--active': activePath === t.path }"
        @click="go(t.path)"
      >
        {{ t.label }}
      </button>
    </nav>

    <div class="sub-content">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
  .settings-page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* n-page-header 统一样式 */
  .settings-page :deep(.n-page-header) {
    padding: 8px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }
  .settings-page :deep(.n-page-header__title) {
    font-size: 14px !important;
    font-weight: 600;
  }
  .settings-page :deep(.n-page-header__back) {
    margin-right: 8px;
  }
  .settings-page :deep(.n-page-header__back:hover) {
    color: var(--primary);
  }
  .settings-page :deep(.n-page-header .n-button) {
    font-size: 12px;
  }

  .sub-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    padding: 0 20px;
    flex-shrink: 0;
  }
  .sub-tab {
    padding: 10px 20px;
    border: none;
    background: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: all 0.15s;
  }
  .sub-tab:hover {
    color: var(--text);
  }
  .sub-tab--active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }
  .sub-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
</style>
