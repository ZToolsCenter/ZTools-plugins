<script setup>
const emit = defineEmits(['copy', 'paste', 'clear'])
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-actions">
      <!-- 复制按钮 -->
      <button class="sidebar-btn copy-btn" @click="emit('copy')" data-tooltip="复制">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"/>
        </svg>
      </button>

      <!-- 粘贴按钮 -->
      <button class="sidebar-btn paste-btn" @click="emit('paste')" data-tooltip="粘贴">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="sidebar-bottom">
      <!-- 清空按钮 -->
      <button class="sidebar-btn clear-btn" @click="emit('clear')" data-tooltip="清空">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 6h18M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2m3 0v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6h14z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"/>
          <path d="M10 11v6M14 11v6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 60px;
  min-height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.sidebar-bottom {
  margin-top: auto;
}

.sidebar-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
  color: var(--text-secondary);
}

.sidebar-btn:hover {
  background: var(--bg-hover);
  border-color: var(--primary-color);
  color: var(--primary-color);
  transform: translateX(-2px);
}

.sidebar-btn svg {
  width: 20px;
  height: 20px;
}

/* Tooltip */
.sidebar-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 10px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.sidebar-btn:hover::after {
  opacity: 1;
}

.sidebar-btn.copy-btn:hover {
  color: var(--primary-color);
}

.sidebar-btn.paste-btn:hover {
  color: #4caf50;
  border-color: #4caf50;
}

.sidebar-btn.clear-btn {
  color: var(--text-danger);
}

.sidebar-btn.clear-btn:hover {
  background: var(--bg-danger-light);
  border-color: var(--text-danger);
  color: var(--text-danger);
}
</style>
