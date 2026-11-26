<script setup lang="ts">
/**
 * 迁移预览 / 确认弹窗（纯渲染）：展示 dry-run 计划与目标盘空间，收集执行选项。
 */
import { ref, watch } from 'vue';
import type { ConflictStrategy, MigrationOptions, PreviewResult } from '../api/migrate';
import { formatBytes } from '../utils/format';

const props = defineProps<{ open: boolean; preview: PreviewResult | null }>();
const emit = defineEmits<{ close: []; confirm: [options: MigrationOptions] }>();

const excludeCache = ref(true);
const keepBackup = ref(true);
const conflictStrategy = ref<ConflictStrategy>('prefer-source');

function actionLabel(action: string): string {
  switch (action) {
    case 'migrate': return '迁移';
    case 'relink': return '重建链接';
    case 'repair': return '修复';
    default: return '跳过';
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      excludeCache.value = true;
      keepBackup.value = true;
      conflictStrategy.value = 'prefer-source';
    }
  }
);

function confirm(): void {
  emit('confirm', {
    excludeCache: excludeCache.value,
    keepBackup: keepBackup.value,
    conflictStrategy: conflictStrategy.value,
  });
}
</script>

<template>
  <div v-if="open && preview" class="scrim on" @click.self="emit('close')">
    <div class="modal on">
      <header>
        <h3>迁移预览</h3>
        <button class="btn ghost sm close" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <!-- 空间概览 -->
        <div class="preview-summary">
          <div class="ps-item">
            <span class="ps-label">待迁移总大小</span>
            <span class="ps-value num">{{ preview.totalSizeFormatted }}</span>
          </div>
          <div class="ps-item">
            <span class="ps-label">目标盘可用</span>
            <span class="ps-value num">{{ preview.targetFreeFormatted }}</span>
          </div>
          <div class="ps-item">
            <span class="ps-label">操作条目</span>
            <span class="ps-value num">{{ preview.operations.length }}</span>
          </div>
        </div>

        <!-- 冲突提示 -->
        <div v-if="preview.hasConflicts" class="conflict-tip">
          <p class="ct-title">检测到 {{ preview.conflicts.length }} 处「源与目标都有数据」冲突</p>
          <label class="ct-option">
            <input type="radio" value="prefer-source" v-model="conflictStrategy" />
            <span>以源盘为准（目标盘同名数据移入 .backup 备份，推荐）</span>
          </label>
          <label class="ct-option">
            <input type="radio" value="prefer-target" v-model="conflictStrategy" />
            <span>以目标盘为准（源盘数据移入 .backup 备份）</span>
          </label>
        </div>

        <!-- 操作清单 -->
        <div class="plan-list">
          <div v-for="op in preview.operations" :key="op.itemId" class="plan-item" :class="op.action">
            <div class="pi-head">
              <span class="pi-group">{{ op.groupDisplayName }} · {{ op.dirLabel }}</span>
              <span class="pi-action" :class="op.action">{{ actionLabel(op.action) }}</span>
            </div>
            <div class="pi-reason">{{ op.reason }}</div>
            <div class="pi-paths mono">
              <span>{{ op.source }}</span> → <span>{{ op.target }}</span>
            </div>
            <div v-if="op.size > 0" class="pi-size num">{{ formatBytes(op.size) }}</div>
          </div>
        </div>

        <!-- 选项 -->
        <div class="migrate-options">
          <label class="opt-line">
            <input type="checkbox" v-model="excludeCache" />
            <span>排除缓存目录（Cache / GPUCache / Code Cache 等）</span>
          </label>
          <label class="opt-line">
            <input type="checkbox" v-model="keepBackup" />
            <span>保留原目录备份（验证链接成功后再清理，更安全）</span>
          </label>
        </div>
      </div>

      <footer>
        <div class="right" style="margin-left:auto; display:flex; gap:8px;">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="confirm">
          开始迁移（{{ preview.operations.filter((o) => o.action !== 'skip').length }} 项）
        </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal { width: 600px; max-width: calc(100vw - 32px); max-height: 86vh; display: flex; flex-direction: column; }
.modal > .body { overflow-y: auto; }
.preview-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
.ps-item { background: var(--panel-2); border-radius: var(--r-control); padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.ps-label { font-size: var(--fs-xs); color: var(--ink-3); }
.ps-value { font-size: var(--fs-lg); font-weight: 700; color: var(--ink-1); }
.conflict-tip {
  border: 1px solid rgba(196, 142, 64, 0.3); background: var(--warn-soft);
  border-radius: var(--r-control); padding: 10px 12px; margin-bottom: 14px;
}
.ct-title { font-size: var(--fs-sm); font-weight: 600; color: var(--warn-ink); margin-bottom: 6px; }
.ct-option { display: flex; align-items: flex-start; gap: 7px; font-size: var(--fs-xs); padding: 3px 0; cursor: pointer; }
.plan-list { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; max-height: 280px; overflow-y: auto; }
.plan-item { border: 1px solid var(--border); border-radius: var(--r-control); padding: 8px 11px; background: var(--panel-2); }
.plan-item.skip { opacity: 0.55; }
.pi-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pi-group { font-size: var(--fs-sm); font-weight: 600; color: var(--ink-1); }
.pi-action { font-size: 10.5px; font-weight: 700; padding: 1px 9px; border-radius: var(--r-pill); }
.pi-action.migrate { background: var(--accent-soft); color: var(--accent-ink); }
.pi-action.relink { background: var(--info-soft); color: var(--info-ink); }
.pi-action.repair { background: var(--bad-soft); color: var(--bad-ink); }
.pi-action.skip { background: var(--panel); color: var(--ink-3); }
.pi-reason { font-size: var(--fs-xs); color: var(--ink-2); margin: 3px 0; }
.pi-paths { font-size: 11px; color: var(--ink-3); display: flex; gap: 4px; flex-wrap: wrap; }
.pi-size { font-size: var(--fs-xs); color: var(--ink-2); margin-top: 2px; }
.migrate-options { display: flex; flex-direction: column; gap: 7px; border-top: 1px solid var(--border); padding-top: 12px; }
.opt-line { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); cursor: pointer; }
.opt-line input { accent-color: var(--accent); }
</style>
