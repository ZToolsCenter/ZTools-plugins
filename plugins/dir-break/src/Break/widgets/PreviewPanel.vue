<script setup lang="ts">
import type { ScanResult } from '../../types'

interface DiffNode {
  name: string; type: 'file' | 'dir'; depth: number
  status: 'move' | 'delete' | 'keep'; label: string
}
interface FilePreview { items: ScanResult['files']; remaining: number }
interface DirPreview { items: { name: string; relativePath: string }[]; remaining: number }

defineProps<{
  scanResult: ScanResult
  recursive: boolean
  diffTree: { nodes: DiffNode[]; after: string }
  previewFiles: FilePreview
  previewDirs: DirPreview
  showAllFiles: boolean
  showAllDirs: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-files'): void
  (e: 'toggle-dirs'): void
}>()

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
  return (bytes / 1073741824).toFixed(2) + ' GB'
}
</script>

<template>
  <div class="preview">
    <div class="preview-summary-bar">
      <div class="summary-stat">
        <span class="summary-stat-value">{{ scanResult.totalFiles }}</span>
        <span class="summary-stat-label">文件</span>
      </div>
      <div class="summary-stat">
        <span class="summary-stat-value">{{ scanResult.totalDirs }}</span>
        <span class="summary-stat-label">文件夹</span>
      </div>
      <div class="summary-stat">
        <span class="summary-stat-value">{{ scanResult.totalFiles > 0 ? formatSize(scanResult.totalSize) : '--' }}</span>
        <span class="summary-stat-label">{{ scanResult.totalFiles > 0 ? '总计' : '仅子目录' }}</span>
      </div>
    </div>

    <div v-if="scanResult.totalFiles > 0 && scanResult.fileTypes.length > 0" class="preview-types">
      <span v-for="(t, i) in scanResult.fileTypes.slice(0, 6)" :key="i" class="type-badge">{{ t.ext || '(无扩展名)' }} {{ t.count }}</span>
      <span v-if="scanResult.fileTypes.length > 6" class="type-badge type-badge--more">+{{ scanResult.fileTypes.length - 6 }}</span>
    </div>

    <div class="diff-tree">
      <div class="diff-tree-header">
        <span class="diff-tree-title">结构变化</span>
        <span class="diff-tree-summary">{{ diffTree.after }}</span>
      </div>
      <div v-if="diffTree.nodes.length > 0" class="diff-tree-list">
        <div v-for="(n, i) in diffTree.nodes" :key="i" class="diff-node" :class="'diff-node--' + n.status"
          :style="{ paddingLeft: (n.depth * 20 + 12) + 'px' }">
          <span class="diff-node-icon">
            <svg v-if="n.type === 'dir'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <span class="diff-node-name">{{ n.name }}</span>
          <span class="diff-node-label">{{ n.label }}</span>
        </div>
      </div>
    </div>

    <div v-if="previewFiles.items.length > 0" class="preview-section">
      <div class="preview-section-header"><span>文件列表</span><span class="preview-section-count">{{ scanResult.totalFiles }}</span></div>
      <div class="preview-list">
        <div v-for="(f, i) in previewFiles.items" :key="i" class="preview-row"
          :class="{ 'preview-row--nested': f.relativePath.includes('/') || f.relativePath.includes('\\') }">
          <span class="preview-row-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </span>
          <span class="preview-row-name" :title="f.relativePath">{{ f.relativePath }}</span>
          <span class="preview-row-size">{{ formatSize(f.size) }}</span>
        </div>
        <div v-if="previewFiles.remaining > 0" class="preview-more">
          <button class="btn-link" @click="emit('toggle-files')">还有 {{ previewFiles.remaining }} 个文件...</button>
        </div>
      </div>
    </div>

    <div v-if="previewDirs.items.length > 0" class="preview-section">
      <div class="preview-section-header"><span>子目录列表</span><span class="preview-section-count">{{ scanResult.totalDirs }}</span></div>
      <div class="preview-list">
        <div v-for="(d, i) in previewDirs.items" :key="i" class="preview-row">
          <span class="preview-row-icon preview-row-icon--dir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </span>
          <span class="preview-row-name" :title="d.name">{{ d.name }}</span>
          <span class="preview-row-meta">
            <template v-if="recursive">将被清空</template>
            <template v-else>将移到父目录</template>
          </span>
        </div>
        <div v-if="previewDirs.remaining > 0" class="preview-more">
          <button class="btn-link" @click="emit('toggle-dirs')">还有 {{ previewDirs.remaining }} 个目录...</button>
        </div>
      </div>
    </div>

    <div v-if="scanResult.totalFiles === 0 && scanResult.totalDirs === 0" class="preview-empty">该文件夹中没有文件</div>
  </div>
</template>

<style scoped>
.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 12px;
}
.preview-summary-bar {
  display: flex;
  gap: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}
.summary-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  text-align: center;
}
.summary-stat + .summary-stat { border-left: 1px solid var(--border); }
.summary-stat-value {
  font-size: 18px; font-weight: 700; color: var(--text); line-height: 1.2;
}
.summary-stat-label {
  font-size: 11px; color: var(--text-muted); margin-top: 2px;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.preview-types {
  display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.type-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: var(--bg-tertiary); color: var(--text-secondary); white-space: nowrap;
}
.type-badge--more { background: transparent; color: var(--text-muted); }
.diff-tree { border-bottom: 1px solid var(--border); }
.diff-tree-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}
.diff-tree-title { font-size: 12px; font-weight: 600; color: var(--text); }
.diff-tree-summary { font-size: 11px; color: var(--text-muted); }
.diff-tree-list { max-height: 260px; overflow-y: auto; padding: 2px 0; }
.diff-node {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 12px; font-size: 13px; min-height: 24px;
}
.diff-node--move { color: var(--text); }
.diff-node--move .diff-node-label { color: var(--primary); }
.diff-node--delete { color: var(--text-muted); text-decoration: line-through; }
.diff-node--delete .diff-node-icon { color: var(--danger); }
.diff-node--delete .diff-node-label { color: var(--danger); }
.diff-node--keep { color: var(--text); }
.diff-node--keep .diff-node-label { color: var(--text-muted); }
.diff-node-icon { display: flex; flex-shrink: 0; color: var(--text-muted); }
.diff-node--move .diff-node-icon { color: var(--primary); }
.diff-node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-node-label { flex-shrink: 0; font-size: 11px; white-space: nowrap; margin-left: auto; }
.preview-section { border-bottom: 1px solid var(--border); }
.preview-section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  color: var(--text-secondary); background: var(--bg-secondary);
}
.preview-section-count { font-size: 11px; color: var(--text-muted); font-weight: 400; }
.preview-list { max-height: 220px; overflow-y: auto; }
.preview-row {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 12px; font-size: 13px; color: var(--text); min-height: 24px;
}
.preview-row:hover { background: var(--bg-secondary); }
.preview-row--nested { padding-left: 28px; }
.preview-row-icon { display: flex; flex-shrink: 0; color: var(--text-muted); }
.preview-row-icon--dir { color: var(--primary); }
.preview-row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.preview-row-size { flex-shrink: 0; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.preview-row-meta { flex-shrink: 0; font-size: 11px; color: var(--text-muted); }
.preview-more { padding: 6px 12px; text-align: center; }
.btn-link {
  background: none; border: none; padding: 0;
  font-size: 13px; color: var(--primary); cursor: pointer;
}
.preview-empty { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
