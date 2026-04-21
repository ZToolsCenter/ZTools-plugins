<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { IDEConfig } from '../types'
import { getIDEConfigs, saveIDEConfig, deleteIDEConfig } from '../config'

const ideConfigs = ref<IDEConfig[]>([])
const showAddForm = ref(false)
const showDeleteConfirm = ref(false)
const showEditDialog = ref(false)
const deletingCode = ref('')
const newCode = ref('')
const newCommand = ref('')
const newTerminal = ref('')
const newDatabase = ref('')
const newTimeout = ref('10000')
const errorMsg = ref('')

// 加载 IDE 列表
function loadConfigs() {
  try {
    ideConfigs.value = getIDEConfigs()
  } catch (e: any) {
    errorMsg.value = String(e.message ?? e ?? '加载失败')
  }
}

// 添加 IDE
function addIDE() {
  const code = newCode.value.trim().toLowerCase()
  const command = newCommand.value.trim() || code

  if (!code) {
    errorMsg.value = '请输入 IDE 标识'
    return
  }

  if (ideConfigs.value.some((c) => c.code === code)) {
    errorMsg.value = `IDE "${code}" 已存在`
    return
  }

  try {
    const config: IDEConfig = {
      code,
      icon: '',
      terminal: newTerminal.value.trim(),
      command,
      database: newDatabase.value.trim(),
      timeout: newTimeout.value.trim() || '10000',
    }

    // 自动检测数据库路径
    if (!config.database) {
      const appName = code === 'vscode' ? 'Code' : code === 'cursor' ? 'Cursor' : code === "vscode-insiders" ? "Code - Insiders" : ""
      if (appName) {
        config.database = window.ztools.getPath('appData') + '/' + appName + '/User/globalStorage/state.vscdb'
      }
    }

    saveIDEConfig(config)
    loadConfigs()
    resetAddForm()
    errorMsg.value = ''
    window.ztools.showNotification(`已添加 IDE: ${code}`)
  } catch (e: any) {
    errorMsg.value = String(e.message ?? e ?? '添加失败')
  }
}

function resetAddForm() {
  newCode.value = ''
  newCommand.value = ''
  newTerminal.value = ''
  newDatabase.value = ''
  newTimeout.value = '10000'
  showAddForm.value = false
}

// 删除 IDE
function confirmDelete(code: string) {
  deletingCode.value = code
  showDeleteConfirm.value = true
}

function executeDelete() {
  const code = deletingCode.value
  try {
    deleteIDEConfig(code)
    loadConfigs()
    showDeleteConfirm.value = false
    deletingCode.value = ''
    window.ztools.showNotification(`已删除: ${code}`)
  } catch (e: any) {
    window.ztools.showNotification('删除失败: ' + String(e.message ?? e ?? ''))
  }
}

// 编辑 IDE（打开对话框）
const editingEditDialog = ref(false)
const editForm = ref({ code: '', terminal: '', database: '', timeout: '10000' })

function editConfig(config: IDEConfig) {
  editForm.value = {
    code: config.code,
    terminal: config.terminal || '',
    database: config.database || '',
    timeout: config.timeout || '10000',
  }
  editingEditDialog.value = true
}

// 保存编辑
function saveEdit() {
  if (!editForm.value.code) return
  try {
    const config = ideConfigs.value.find((c) => c.code === editForm.value.code)
    if (config) {
      config.terminal = editForm.value.terminal
      config.database = editForm.value.database
      config.timeout = editForm.value.timeout
      saveIDEConfig(config)
      loadConfigs()
      editingEditDialog.value = false
      window.ztools.showNotification('配置已更新')
    }
  } catch (e: any) {
    window.ztools.showNotification('保存失败: ' + String(e.message ?? e ?? ''))
  }
}

// 创建默认 IDE
function createDefault(code: string, command: string) {
  try {
    const config: IDEConfig = {
      code,
      icon: '',
      terminal: '',
      command,
      database: '',
      timeout: '10000',
    }

    const appName = code === 'vscode' ? 'Code' : code === 'cursor' ? 'Cursor' : code === 'vscode-insiders' ? "Code - Insiders": ""
    if (appName) {
      config.database = window.ztools.getPath('appData') + '/' + appName + '/User/globalStorage/state.vscdb'
    }

    saveIDEConfig(config)
    loadConfigs()
    window.ztools.showNotification(`已创建默认配置: ${code}`)
  } catch (e: any) {
    window.ztools.showNotification('创建失败: ' + String(e.message ?? e ?? ''))
  }
}

onMounted(() => {
  loadConfigs()
})
</script>

<template>
  <div class="ide-page">

    <!-- 错误信息 -->
    <Transition name="fade">
      <div v-if="errorMsg" class="alert alert-error">
        <span class="alert-icon">⚠️</span>
        <span>{{ errorMsg }}</span>
        <button class="alert-close" @click="errorMsg = ''">✕</button>
      </div>
    </Transition>

    <!-- 快速创建 -->
    <section class="card quick-create-card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">⚡</span>
          快速创建
        </h3>
      </div>
      <div class="quick-actions">
        <button class="btn btn-outline" @click="createDefault('vscode', 'code')">
          <span class="btn-icon">📘</span>
          VSCode
        </button>
        <button class="btn btn-outline" @click="createDefault('vscode-insiders', 'code-insiders')">
          <span class="btn-icon">📘</span>
          VSCode Insider
        </button>
        <button class="btn btn-outline" @click="createDefault('cursor', 'cursor')">
          <span class="btn-icon">🔶</span>
          Cursor
        </button>
        <button class="btn btn-outline" @click="showAddForm = true">
          <span class="btn-icon">➕</span>
          自定义添加
        </button>
      </div>
    </section>

    <!-- 添加表单 -->
    <Transition name="slide">
      <section v-if="showAddForm" class="card form-card">
        <div class="card-header">
          <h3 class="card-title">添加新 IDE</h3>
          <button class="close-btn" @click="resetAddForm">✕</button>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>IDE 标识 <span class="required">*</span></label>
            <input
              v-model="newCode"
              placeholder="例如: vscode, myeditor"
              @keyup.enter="addIDE"
              class="input"
            />
          </div>
          <div class="form-group">
            <label>启动命令 <span class="required">*</span></label>
            <input
              v-model="newCommand"
              placeholder="例如: code, cursor"
              class="input"
            />
          </div>
          <div class="form-group">
            <label>终端命令（可选）</label>
            <input
              v-model="newTerminal"
              placeholder="例如: pwsh, cmd"
              class="input"
            />
          </div>
          <div class="form-group">
            <label>数据库路径（可选）</label>
            <input
              v-model="newDatabase"
              placeholder="自动检测默认已填写"
              class="input"
            />
          </div>
          <div class="form-group">
            <label>超时时间（ms）</label>
            <input
              v-model="newTimeout"
              type="number"
              placeholder="3000"
              class="input"
            />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click="addIDE">确认添加</button>
          <button class="btn btn-secondary" @click="resetAddForm">取消</button>
        </div>
      </section>
    </Transition>

    <!-- IDE 列表 -->
    <section class="card list-card">
      <div class="card-header">
        <h3 class="card-title">
          <span class="card-icon">📋</span>
          已配置 IDE
        </h3>
        <span class="config-count">{{ ideConfigs.length }}</span>
      </div>

      <div v-if="ideConfigs.length === 0" class="empty-list">
        <div class="empty-icon">🔌</div>
        <p class="empty-text">暂无已配置的 IDE</p>
        <p class="empty-hint">使用上方快速创建或添加自定义 IDE</p>
      </div>

      <div v-for="cfg in ideConfigs" :key="cfg.code" class="ide-item">
        <div class="ide-avatar">
          <span class="avatar-text">{{ cfg.code.charAt(0).toUpperCase() }}</span>
        </div>
        <div class="ide-info">
          <div class="ide-name-row">
            <span class="ide-name">{{ cfg.code }}</span>
          </div>
          <div class="ide-details">
            <span class="detail-item">
              <span class="detail-label">命令</span>
              <span class="detail-value">{{ cfg.command }}</span>
            </span>
            <span v-if="cfg.database" class="detail-item">
              <span class="detail-label">数据库</span>
              <span class="detail-value db-path" :title="cfg.database">{{ cfg.database }}</span>
            </span>
            <span v-if="cfg.terminal" class="detail-item">
              <span class="detail-label">终端</span>
              <span class="detail-value">{{ cfg.terminal }}</span>
            </span>
          </div>
        </div>
        <div class="ide-actions">
          <button
            class="btn btn-secondary btn-sm"
            @click="editConfig(cfg)"
          >
            编辑
          </button>
          <button
            class="btn btn-danger btn-sm"
            @click="confirmDelete(cfg.code)"
          >
            删除
          </button>
        </div>
      </div>
    </section>

    <!-- 编辑对话框 -->
    <Transition name="fade">
      <div v-if="editingEditDialog" class="overlay" @click="editingEditDialog = false">
        <div class="modal" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">编辑 IDE 配置</h3>
            <button class="modal-close" @click="editingEditDialog = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>IDE 标识</label>
              <input :value="editForm.code" disabled class="input" />
            </div>
            <div class="form-group">
              <label>终端命令（可选）</label>
              <input v-model="editForm.terminal" placeholder="例如: pwsh" class="input" />
            </div>
            <div class="form-group">
              <label>数据库路径（可选）</label>
              <input v-model="editForm.database" placeholder="自动检测默认已填写" class="input" />
            </div>
            <div class="form-group">
              <label>超时时间（ms）</label>
              <input v-model="editForm.timeout" type="number" class="input" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="editingEditDialog = false">取消</button>
            <button class="btn btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 删除确认弹窗 -->
    <Transition name="fade">
      <div v-if="showDeleteConfirm" class="overlay" @click="showDeleteConfirm = false">
        <div class="modal" @click.stop>
          <div class="modal-header">
            <h3 class="modal-title">确认删除</h3>
            <button class="modal-close" @click="showDeleteConfirm = false">✕</button>
          </div>
          <div class="modal-body">
            <p>确定要删除 IDE <strong>"{{ deletingCode }}"</strong> 的配置吗？</p>
            <p class="modal-hint">此操作不可撤销。</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showDeleteConfirm = false">取消</button>
            <button class="btn btn-danger" @click="executeDelete">确认删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ide-page {
  margin: 10px;
  padding: 0;
  height: 100%;
  overflow-y: auto;
}

/* ===== 页面标题 ===== */
.page-header {
  padding: 24px 24px 20px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-color, #1e293b);
  letter-spacing: -0.02em;
}

.page-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #64748b);
}

/* ===== 卡片 ===== */
.card {
  margin: 0 16px;
  background: var(--vscode-editor-bg, #ffffff);
  border-radius: 10px;
  border: 1px solid var(--border-color, #e2e8f0);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  background: rgba(0, 0, 0, 0.01);
}

.card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #334155);
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-icon {
  font-size: 14px;
}

.config-count {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--primary-color, #4a90d9);
  color: #fff;
  border-radius: 10px;
  font-weight: 600;
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  transition: all 0.15s;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-color, #334155);
}

/* ===== 快速创建卡片 ===== */
.quick-create-card {
  margin-bottom: 16px;
}

.quick-actions {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
}

/* ===== 表单卡片 ===== */
.form-card {
  margin-bottom: 16px;
}

.form-grid {
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}

.form-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e2e8f0);
  justify-content: flex-end;
}

/* ===== 列表 ===== */
.list-card {
  margin-bottom: 24px;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.7;
}

.empty-text {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--text-color, #64748b);
  font-weight: 500;
}

.empty-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}

/* ===== IDE 行 ===== */
.ide-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #f1f5f9);
}

.ide-item:last-child {
  border-bottom: none;
}

.ide-avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.avatar-text {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--primary-color, #4a90d9), #6366f1);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  border-radius: 8px;
}

.ide-info {
  flex: 1;
  min-width: 0;
}

.ide-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.ide-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.detail-label {
  color: var(--text-secondary, #94a3b8);
  font-weight: 500;
}

.detail-value {
  color: var(--text-secondary, #64748b);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-path {
  color: var(--primary-color, #4a90d9);
}

.ide-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* ===== 弹窗 ===== */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.modal {
  width: 400px;
  max-width: 90vw;
  background: var(--vscode-editor-bg, #fff);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
}

.modal-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  border-radius: 6px;
  font-size: 16px;
  transition: all 0.15s;
}

.modal-close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-color, #334155);
}

.modal-body {
  padding: 20px;
}

.modal-body p {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-color, #334155);
}

.modal-hint {
  margin: 0 !important;
  font-size: 12px !important;
  color: var(--text-secondary, #94a3b8) !important;
}

.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid var(--border-color, #e2e8f0);
}

/* ===== Alert ===== */
.alert {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
}

.alert-error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.alert-icon {
  font-size: 16px;
}

.alert-close {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  opacity: 0.7;
  padding: 2px 6px;
  border-radius: 4px;
}

.alert-close:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.1);
}

/* ===== 按钮 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
  white-space: nowrap;
  height: 34px;
}

.btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.btn-primary {
  background: var(--primary-color, #4a90d9);
  color: #fff;
  border-color: var(--primary-color, #4a90d9);
}

.btn-primary:hover {
  background: var(--primary-hover, #3a7bc8);
}

.btn-secondary {
  background: #f1f5f9;
  color: var(--text-color, #334155);
  border-color: var(--border-color, #e2e8f0);
}

.btn-secondary:hover {
  background: #e2e8f0;
}

.btn-danger {
  background: #ef4444;
  color: #fff;
  border-color: #ef4444;
}

.btn-danger:hover {
  background: #dc2626;
}

.btn-outline {
  background: transparent;
  border-color: var(--border-color, #e2e8f0);
  color: var(--text-color, #334155);
}

.btn-outline:hover {
  background: rgba(0, 0, 0, 0.03);
  border-color: var(--text-secondary, #cbd5e1);
}

.btn-icon {
  font-size: 14px;
}

/* ===== 输入框 ===== */
label {
  display: block;
  margin-bottom: 5px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  font-weight: 500;
}

.required {
  color: #ef4444;
}

.input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #d0d7de);
  border-radius: 6px;
  background: var(--input-bg, #fafbfc);
  color: var(--text-color, #334155);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
  height: 34px;
}

.input:focus {
  border-color: var(--primary-color, #4a90d9);
  box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.12);
}

.input::placeholder {
  color: var(--text-secondary, #94a3b8);
}

.input-sm {
  height: 30px;
  font-size: 12px;
}

/* ===== 动画 ===== */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ===== 滚动条 ===== */
.ide-page::-webkit-scrollbar {
  width: 6px;
}

.ide-page::-webkit-scrollbar-track {
  background: transparent;
}

.ide-page::-webkit-scrollbar-thumb {
  background: var(--border-color, #d0d7de);
  border-radius: 3px;
}

.ide-page::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary, #94a3b8);
}
</style>
