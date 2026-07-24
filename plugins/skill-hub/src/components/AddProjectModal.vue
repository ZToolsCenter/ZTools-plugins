<script setup lang="ts">
import { ref, watch } from 'vue'
import type { RegisteredProject } from '../types'

const props = defineProps<{
  project?: RegisteredProject | null
  submitError?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', project: { name: string; rootDir: string; scanPaths: string[]; id?: string }): void
}>()

const rootDir = ref('')
const projectName = ref('')
const scanPaths = ref<string[]>([])
const newScanPath = ref('')
const error = ref('')
const isSubmitting = ref(false)

const isEdit = () => !!props.project

watch(() => props.project, (p) => {
  if (p) {
    rootDir.value = p.rootDir || ''
    projectName.value = p.name || ''
    scanPaths.value = [...(p.scanPaths || [])]
  } else {
    rootDir.value = ''
    projectName.value = ''
    scanPaths.value = []
  }
  error.value = ''
  isSubmitting.value = false
}, { immediate: true })

function addScanPath() {
  const p = newScanPath.value.trim()
  if (p && !scanPaths.value.includes(p)) {
    scanPaths.value.push(p)
    newScanPath.value = ''
  }
}

function removeScanPath(index: number) {
  scanPaths.value.splice(index, 1)
}

async function selectFolder(target: string) {
  try {
    const dialog = window.ztools?.showOpenDialog
    if (!dialog) {
      error.value = '文件选择对话框不可用，请手动输入路径。'
      return
    }
    const dirs = dialog({
      properties: ['openDirectory'],
      title: target === 'root' ? '选择项目根目录' : '选择扫描目录',
    })
    if (dirs && dirs.length > 0) {
      if (target === 'root') {
        rootDir.value = dirs[0]
        error.value = ''
        if (!projectName.value) {
          projectName.value = dirs[0].split(/[/\\]/).filter(Boolean).pop() || ''
        }
      } else if (!scanPaths.value.includes(dirs[0])) {
        scanPaths.value.push(dirs[0])
      }
    }
  } catch (e) {
    error.value = '选择文件夹失败，请手动输入路径。'
  }
}

watch(() => props.submitError, (newError) => {
  if (newError) {
    isSubmitting.value = false
  }
})

function handleSubmit() {
  const root = rootDir.value.trim()
  const name = projectName.value.trim()
  if (!root) {
    error.value = '请输入项目根目录。'
    return
  }
  if (!name) {
    error.value = '请输入项目名称。'
    return
  }
  error.value = ''
  isSubmitting.value = true
  const data: { name: string; rootDir: string; scanPaths: string[]; id?: string } = {
    name,
    rootDir: root,
    scanPaths: scanPaths.value.filter((p) => p.trim()),
  }
  if (props.project) {
    data.id = props.project.id
  }
  emit('submit', data)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-panel">
      <div class="modal-header">
        <h2 class="modal-title">{{ project ? '编辑项目' : '添加项目' }}</h2>
        <button class="modal-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="field-label">项目根目录</label>
          <p class="field-desc" v-if="!isEdit()">选择根目录后自动填写项目名称并开始扫描。</p>
          <p class="field-desc" v-else>项目根目录在添加后不可修改。</p>
          <div class="field-row">
            <input v-model="rootDir" type="text" class="field-input" :class="{ readonly: isEdit() }" placeholder="/path/to/project" :readonly="isEdit()" />
            <button v-if="!isEdit()" class="btn-browse" @click="selectFolder('root')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              浏览
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">项目名称</label>
          <div class="field-row">
            <input v-model="projectName" type="text" class="field-input" placeholder="工作区项目" />
          </div>
        </div>

        <div class="field">
          <label class="field-label">扫描路径</label>
          <div class="field-row">
            <input v-model="newScanPath" type="text" class="field-input" placeholder="可选的额外扫描目录" @keyup.enter="addScanPath" />
            <button class="btn-secondary" @click="addScanPath">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              添加
            </button>
            <button class="btn-browse" @click="selectFolder('scan')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              浏览
            </button>
          </div>
          <p class="field-hint">仅当技能放在默认扫描目录之外时，才需要添加额外路径。</p>
          <div v-if="scanPaths.length" class="scan-paths-list">
            <div v-for="(p, i) in scanPaths" :key="i" class="scan-path-item">
              <span class="scan-path-text">{{ p }}</span>
              <button class="scan-path-remove" @click="removeScanPath(i)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <p v-else class="field-hint subtle">暂无额外扫描路径</p>
        </div>
      </div>
      <div class="modal-footer">
        <div class="modal-error" v-if="error || props.submitError">{{ error || props.submitError }}</div>
        <button class="btn-cancel" @click="emit('close')">取消</button>
        <button class="btn-primary" :disabled="isSubmitting || !rootDir.trim() || !projectName.trim()" @click="handleSubmit">
          {{ isSubmitting ? '保存中…' : (project ? '保存' : '添加项目') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal-panel {
  width: 560px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px 0;
}

.modal-title {
  font-size: 18px;
  font-weight: 700;
  color: hsl(var(--foreground));
  margin: 0;
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}

.modal-close:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.field-desc {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin: 0 0 2px;
  line-height: 1.4;
}

.field-hint {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin: 0;
  line-height: 1.4;
}

.field-hint.subtle {
  opacity: 0.7;
  font-style: italic;
}

.field-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.field-input {
  flex: 1;
  height: 38px;
  padding: 0 12px;
  font-size: 13px;
  font-family: monospace;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  outline: none;
  transition: all var(--duration-quick) var(--ease-standard);
}

.field-input:focus {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.12);
}

.field-input.readonly {
  background: hsl(var(--muted));
  cursor: default;
}

.field-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-quick) var(--ease-standard);
}

.btn-secondary:hover {
  background: hsl(var(--muted));
}

.btn-browse {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-quick) var(--ease-standard);
}

.btn-browse:hover {
  background: hsl(var(--muted));
}

.scan-paths-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.scan-path-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: hsl(var(--muted));
  border-radius: 6px;
}

.scan-path-text {
  flex: 1;
  font-size: 12px;
  font-family: monospace;
  color: hsl(var(--foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scan-path-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}

.scan-path-remove:hover {
  background: hsl(var(--destructive) / 0.12);
  color: hsl(var(--destructive));
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 24px;
  border-top: 1px solid hsl(var(--border));
}

.btn-cancel {
  height: 38px;
  padding: 0 18px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}

.btn-cancel:hover {
  background: hsl(var(--muted));
}

.btn-primary {
  height: 38px;
  padding: 0 18px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
  transition: all var(--duration-quick) var(--ease-standard);
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-error {
  flex: 1;
  font-size: 12px;
  color: hsl(var(--destructive));
  text-align: left;
}
</style>
