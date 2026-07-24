<script setup lang="ts">
import RunStatusTag from './RunStatusTag.vue'
import type { RunStatus } from '../types/domain'

const statuses: RunStatus[] = ['starting', 'running', 'success', 'failed', 'timed_out', 'stopped', 'interrupted']
</script>

<template>
  <section class="status-reference" aria-label="运行状态说明">
    <RunStatusTag v-for="status in statuses" :key="status" :status="status" size="medium" />
  </section>
</template>

<style scoped lang="scss">
.status-reference {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
</style>
