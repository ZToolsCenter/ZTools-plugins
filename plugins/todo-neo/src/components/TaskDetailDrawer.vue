<script setup lang="ts">
import { useTodoStore } from '../composables/useTodoStore'
import BaseDrawer from './BaseDrawer.vue'

const store = useTodoStore()
</script>

<template>
  <BaseDrawer
    :open="Boolean(store.detailTask.value)"
    title="任务详情"
    subtitle="查看时间记录和截止日期"
    ariaLabel="任务详情"
    width="detail"
    @close="store.detailTaskId.value = ''"
  >
    <template v-if="store.detailTask.value">
      <section class="detail-section">
        <h2>内容</h2>
        <p class="detail-content">{{ store.detailTask.value.text }}</p>
      </section>
      <section class="detail-section">
        <h2>计划</h2>
        <label class="detail-date-row">
          <span>截止日期</span>
          <input
            type="date"
            :value="store.formatDateInput(store.detailTask.value.dueAt)"
            @change="store.setDueAt(store.detailTask.value, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </section>
      <section class="detail-section">
        <h2>记录</h2>
        <dl class="detail-list">
          <dt>创建时间</dt><dd>{{ store.formatDate(store.detailTask.value.created_at) }}</dd>
          <dt>首次完成</dt><dd>{{ store.formatDate(store.detailTask.value.first_completed_at) }}</dd>
          <dt>本次完成</dt><dd>{{ store.formatDate(store.detailTask.value.completed_at) }}</dd>
        </dl>
      </section>
    </template>
  </BaseDrawer>
</template>

<style scoped>
.detail-section {
  display: grid;
  gap: 10px;
  padding: 18px 20px 0;
}

.detail-section h2 {
  margin: 0 0 2px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.detail-content,
.detail-date-row,
.detail-list {
  display: grid;
  gap: 16px;
  min-height: 62px;
  margin: 0;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: var(--surface-soft);
}

.detail-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-date-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.detail-date-row span {
  color: var(--muted);
  font-size: 13px;
}

.detail-date-row input {
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 7px;
  padding: 0 8px;
  background: var(--surface);
  color: var(--text);
}

.detail-list {
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px 16px;
}

.detail-list dt {
  color: var(--muted);
  font-size: 13px;
}

.detail-list dd {
  margin: 0;
  color: var(--text);
}

@media (prefers-color-scheme: dark) {
  .detail-content,
  .detail-date-row,
  .detail-list {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.045);
    backdrop-filter: blur(16px);
  }

  .detail-date-row input {
    border-color: rgba(255, 255, 255, 0.13);
    background: rgba(0, 0, 0, 0.16);
  }
}
</style>
