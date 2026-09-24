<script setup lang="ts">
// @ts-nocheck TODO: 逐步添加类型注解后移除
import { onMounted } from "vue";
import { useSkills } from "../../composables/useSkills";

const { syncMode, loadSyncMode, saveSyncMode } = useSkills();
onMounted(() => loadSyncMode());

function setMode(mode) {
  saveSyncMode(mode);
}
</script>

<template>
  <div class="sync-options">
    <label class="sync-option" :class="{ 'sync-option--active': syncMode === 'copy' }">
      <input type="radio" name="syncMode" value="copy" :checked="syncMode === 'copy'" @change="setMode('copy')">
      <span class="option-body">
        <strong>复制同步</strong>
        <small>跨平台通用，将 skill 复制到目标 agent 目录</small>
      </span>
    </label>
    <label class="sync-option" :class="{ 'sync-option--active': syncMode === 'symlink' }">
      <input type="radio" name="syncMode" value="symlink" :checked="syncMode === 'symlink'" @change="setMode('symlink')">
      <span class="option-body">
        <strong>软链接</strong>
        <small>不占磁盘，改一处全局生效 (Win 用 junction 免特权)</small>
      </span>
    </label>
  </div>
</template>

<style scoped>
.sync-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sync-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.sync-option:hover { border-color: var(--text-muted); }
.sync-option--active {
  border-color: var(--primary);
  background: var(--primary-light);
}
.sync-option input[type="radio"] {
  margin-top: 2px;
  accent-color: var(--primary);
}
.option-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-body strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.option-body small {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
