<script setup lang="ts">
  // @ts-nocheck TODO: 逐步添加类型注解后移除
  import { onMounted, computed } from 'vue';
  import { useSkills } from '../../composables/useSkills';

  const { nestSkills, syncMode, loadNestSkills, loadSyncMode, saveSyncMode } = useSkills();

  onMounted(() => {
    loadNestSkills();
    loadSyncMode();
  });

  const nestDir = computed(() => {
    const fn = window.ztoolsCctoggle?.getNestDir;
    return fn ? fn() : '~/.ztools-cctoggle/skills';
  });
</script>

<template>
  <n-space vertical :size="12" class="storage-settings">
    <!-- CCToggle 仓库 -->
    <n-card size="small" :bordered="true">
      <n-space align="center" :size="10">
        <span style="font-size: 20px">🏠</span>
        <div style="flex: 1; min-width: 0">
          <n-text strong style="font-size: 13px; display: block">CCToggle</n-text>
          <n-text code style="font-size: 11px">{{ nestDir }}</n-text>
        </div>
        <n-tag type="success" size="small" :bordered="false" round>
          {{ nestSkills.length }} skill
        </n-tag>
      </n-space>
    </n-card>

    <!-- 同步方式 -->
    <n-card size="small" :bordered="true">
      <template #header>
        <n-text depth="2" style="font-size: 12px; font-weight: 600">同步方式</n-text>
      </template>

      <n-space vertical :size="6">
        <n-card
          size="small"
          :bordered="true"
          :class="{ 'sync-card--active': syncMode === 'symlink' }"
          style="cursor: pointer"
          @click="saveSyncMode('symlink')"
        >
          <n-space align="center" :size="8">
            <n-radio :checked="syncMode === 'symlink'" />
            <div>
              <n-text strong style="font-size: 12px; display: block">软链接</n-text>
              <n-text depth="3" style="font-size: 11px"
                >不占磁盘，改一处全局生效 (Win 用 junction 免特权)</n-text
              >
            </div>
          </n-space>
        </n-card>
        <n-card
          size="small"
          :bordered="true"
          :class="{ 'sync-card--active': syncMode === 'copy' }"
          style="cursor: pointer"
          @click="saveSyncMode('copy')"
        >
          <n-space align="center" :size="8">
            <n-radio :checked="syncMode === 'copy'" />
            <div>
              <n-text strong style="font-size: 12px; display: block">复制同步</n-text>
              <n-text depth="3" style="font-size: 11px"
                >跨平台通用，将 skill 复制到目标 agent 目录</n-text
              >
            </div>
          </n-space>
        </n-card>
      </n-space>
    </n-card>
  </n-space>
</template>

<style scoped>
  .storage-settings {
    padding: 0;
  }

  .sync-card--active {
    border-color: var(--primary) !important;
    background: var(--primary-light) !important;
  }
</style>
