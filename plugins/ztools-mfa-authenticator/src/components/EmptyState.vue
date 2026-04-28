<template>
  <div class="empty-state">
    <span class="empty-icon">&#128272;</span>
    <h2 class="empty-heading">暂无验证账户</h2>
    <p class="empty-subtitle">添加您的第一个 MFA 账户</p>
    <button class="empty-add-btn" @click="emit('add')">+ 添加账户</button>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  add: []
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.empty-heading {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 28px;
}

.empty-add-btn {
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  padding: 10px 28px;
  font-size: 15px;
  font-weight: 600;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.2s ease;
}

.empty-add-btn:hover {
  background: var(--accent-hover);
}
</style>
