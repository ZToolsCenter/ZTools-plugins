<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { ref } from 'vue';
  import { useRouter } from 'vue-router';
  import SkillInstallSection from '../components/skills/SkillInstallSection.vue';
  import SkillListSection from '../components/skills/SkillListSection.vue';

  const router = useRouter();
  const activeTab = ref('install');

  const tabs = [
    { key: 'install', label: '搜索安装' },
    { key: 'installed', label: '已安装' }
  ];
</script>

<template>
  <div class="skills-page">
    <n-page-header title="Skill 管理" @back="router.push('/')" />
    <nav class="sub-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="sub-tab"
        :class="{ 'sub-tab--active': activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </nav>

    <div class="sub-content">
      <SkillInstallSection v-if="activeTab === 'install'" />
      <SkillListSection v-if="activeTab === 'installed'" />
    </div>
  </div>
</template>

<style scoped>
  .skills-page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  /* n-page-header 统一样式 */
  .skills-page :deep(.n-page-header) {
    padding: 8px 16px;
    min-height: 44px;
    border-bottom: 1px solid var(--border);
  }
  .skills-page :deep(.n-page-header__title) {
    font-size: 14px !important;
    font-weight: 600;
  }
  .skills-page :deep(.n-page-header__back) {
    margin-right: 8px;
  }
  .skills-page :deep(.n-page-header__back:hover) {
    color: var(--primary);
  }
  .skills-page :deep(.n-page-header .n-button) {
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
    padding: 16px 0 16px 20px;
  }
  .sub-content > * {
    padding-right: 20px;
  }
</style>
