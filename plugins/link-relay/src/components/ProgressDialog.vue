<script setup lang="ts">
/**
 * 迁移进度弹窗（纯渲染）：进度条、当前阶段、实时日志流，运行中禁止关闭。
 */
import { computed } from 'vue';
import type { PreviewResult } from '../api/migrate';
import type { ProgressInfo, RunLog } from '../hooks/useMigration';
import { formatBytes } from '../utils/format';

const props = defineProps<{
  open: boolean;
  running: boolean;
  preview: PreviewResult | null;
  logs: RunLog[];
  currentPhase: string;
  currentItem: string;
  progressInfo: ProgressInfo;
}>();

const emit = defineEmits<{ close: []; cancel: [] }>();

const totalOps = computed(() => props.preview?.operations.filter((o) => o.action !== 'skip').length ?? 0);
const doneOps = computed(() => props.logs.filter((l) => l.level === 'ok').length);
const percent = computed(() => {
  if (totalOps.value === 0) return props.running ? 30 : 100;
  return Math.min(100, Math.round((doneOps.value / totalOps.value) * 100));
});
</script>

<template>
  <div v-if="open" class="scrim on">
    <div class="modal on progress-modal">
      <header>
        <h3>{{ running ? '正在迁移…' : '迁移完成' }}</h3>
        <button v-if="!running" class="btn ghost sm close" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <!-- 进度条 -->
        <div class="progress-bar">
          <div class="pb-fill" :style="{ width: percent + '%' }" :class="{ done: !running }" />
        </div>
        <div class="progress-meta">
          <span class="num">{{ percent }}%</span>
          <span v-if="currentItem" class="pm-item">{{ currentItem }}</span>
          <span v-if="progressInfo.filesCopied" class="num">
            已复制 {{ progressInfo.filesCopied }} 个文件 / {{ formatBytes(progressInfo.bytesCopied) }}
          </span>
        </div>
        <p v-if="running && currentPhase" class="phase">{{ currentPhase }}</p>

        <!-- 日志流 -->
        <div class="log-box">
          <div v-for="(line, i) in logs" :key="i" class="log-line" :class="line.level">
            <span class="log-time num">{{ line.time }}</span>
            <span class="log-msg">{{ line.message }}</span>
          </div>
          <div v-if="logs.length === 0" class="log-empty">准备中…</div>
        </div>
      </div>

      <footer>
        <div class="right" style="margin-left:auto; display:flex; gap:8px;">
          <button v-if="running" class="btn ghost danger" @click="emit('cancel')">中止迁移</button>
          <button v-else class="btn primary" @click="emit('close')">完成</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.progress-modal { width: 560px; max-width: calc(100vw - 32px); }
.progress-bar { height: 8px; border-radius: var(--r-pill); background: var(--panel-2); overflow: hidden; }
.pb-fill {
  height: 100%; border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--accent), var(--ok-ink));
  transition: width 0.3s ease;
}
.pb-fill.done { background: var(--ok-ink); }
.progress-meta { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: var(--fs-xs); color: var(--ink-2); }
.pm-item { font-weight: 600; color: var(--ink-1); }
.phase { font-size: var(--fs-xs); color: var(--ink-3); margin-top: 6px; }
.log-box {
  margin-top: 12px; background: #1e2421; border-radius: var(--r-control);
  padding: 10px 12px; height: 220px; overflow-y: auto;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.7;
}
.log-line { display: flex; gap: 9px; }
.log-time { color: rgba(255,255,255,0.35); flex-shrink: 0; }
.log-msg { color: rgba(255,255,255,0.85); word-break: break-all; }
.log-line.ok .log-msg { color: #7fd6a0; }
.log-line.warn .log-msg { color: #e8c07a; }
.log-line.error .log-msg { color: #f08a82; }
.log-empty { color: rgba(255,255,255,0.4); }
.btn.danger { color: var(--bad-ink); }
</style>
