<script setup lang="ts">
import { useRouter } from '../stores/router'
import { useTheme } from '../stores/theme'

const router = useRouter()
const theme = useTheme()
</script>

<template>
  <header class="header">
    <!-- 左侧：导航 -->
    <nav class="nav-left">
      <button
        v-for="item in [
          { key: 'space', label: '空间', icon: 'M4 6h16M4 12h16M4 18h7' },
          { key: 'compose', label: '组合', icon: 'M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3' },
          { key: 'manage', label: '管理', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
        ]"
        :key="item.key"
        :class="['nav-btn', { active: router.currentView.value === item.key }]"
        @click="router.navigateTo(item.key as any)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path :d="item.icon" />
        </svg>
        {{ item.label }}
      </button>
    </nav>

    <!-- 右侧：操作 -->
    <div class="nav-right">
      <button class="icon-btn" title="设置" @click="router.navigateTo('settings')">
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
      <button class="icon-btn theme-toggle" :title="theme.theme.value === 'dark' ? '切换到浅色' : '切换到深色'" @click="theme.toggle(); theme.persist()">
        <svg v-if="theme.theme.value === 'dark'" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: 52px; flex-shrink: 0;
  display: flex; align-items: center;
  gap: 16px; padding: 0 20px;
  background: var(--pf-bg-elevated);
  border-bottom: 1px solid var(--pf-border);
  transition: background 0.3s, border-color 0.3s;
}
.nav-left { display: flex; gap: 2px; flex-shrink: 0; }
.nav-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-radius: var(--pf-radius-sm);
  font-size: 13px; font-weight: 500;
  color: var(--pf-text-muted);
  transition: all 0.15s ease;
}
.nav-btn:hover { color: var(--pf-text); background: var(--pf-surface-raised); }
.nav-btn.active {
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
  font-weight: 600;
}
.nav-btn svg { opacity: 0.6; }
.nav-btn.active svg { opacity: 1; }

.nav-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; }
.icon-btn {
  width: 34px; height: 34px;
  border-radius: var(--pf-radius-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--pf-text-muted);
  transition: all 0.15s ease;
}
.icon-btn:hover { background: var(--pf-surface-raised); color: var(--pf-text); }
.theme-toggle:hover { color: var(--pf-accent); }
</style>
