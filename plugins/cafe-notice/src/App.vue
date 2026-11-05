<script setup lang="ts">
import { ref } from 'vue'
import Settings from './Settings/index.vue'
import History from './History/index.vue'

const tab = ref('settings')
</script>

<template>
  <el-tabs v-model="tab" class="tabs">
    <el-tab-pane label="配置" name="settings">
      <Settings v-if="tab === 'settings'" />
    </el-tab-pane>
    <el-tab-pane label="历史" name="history">
      <History v-if="tab === 'history'" />
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
.tabs {
  padding: 0 12px;
}
</style>
