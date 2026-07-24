<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { BackupImportMode, ExportPreview, ImportChangePreview, ImportPackagePreview, SensitiveExportConfirmation } from '../types/api'
import type { ExportOptions } from '../types/domain'

const emit = defineEmits<{
  (event: 'feedback', type: 'success' | 'error', message: string): void
}>()
const props = defineProps<{
  requestConfirmation: (options: {
    title: string
    message: string
    type: 'danger' | 'warning'
    confirmText: string
    cancelText: string
  }) => Promise<boolean>
}>()

const options = ref<ExportOptions>({
  includeEnvironments: false,
  includeEnvironmentValues: false,
  includeSensitiveValues: false
})
const preview = ref<ExportPreview | null>(null)
const previewModalVisible = ref(false)
const includeEnvironmentsDraft = ref(false)
const previewConfirmation = ref<SensitiveExportConfirmation | undefined>()
const operation = ref<'preview' | 'export' | 'import-validation' | 'import' | null>(null)
const expired = ref(false)
const importPreview = ref<ImportPackagePreview | null>(null)
const importPreviewModalVisible = ref(false)
const importMode = ref<BackupImportMode>('merge')
const importValidationTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const previewAvailable = computed(() => typeof window.scripty?.backups?.previewExport === 'function')
let requestGeneration = 0
let expiryTimer: ReturnType<typeof setTimeout> | null = null

/** Formats one import mode's total counters into concise preview text. */
function formatImportChanges(mode: ImportChangePreview) {
  const counts = mode.total
  return `新增 ${counts.added} · 更新 ${counts.updated} · 保留 ${counts.retained} · 重名 ${counts.conflicts} · 将删除 ${counts.deleted}`
}

/** Clears the renderer copy of an import preview without consuming or exposing its preload snapshot. */
function invalidateImportPreview() {
  importPreview.value = null
  importPreviewModalVisible.value = false
  if (importValidationTimer.value !== null) clearTimeout(importValidationTimer.value)
  importValidationTimer.value = null
}

/** Clears preview credentials, optionally keeps its dialog open, and invalidates in-flight responses tied to older options or consumed tokens. */
function invalidatePreview(markExpired = false, closeModal = true) {
  requestGeneration += 1
  preview.value = null
  if (closeModal) previewModalVisible.value = false
  previewConfirmation.value = undefined
  expired.value = markExpired
  if (expiryTimer !== null) clearTimeout(expiryTimer)
  expiryTimer = null
}

/** Rebuilds the immutable preview without a secondary prompt; checking the option is the explicit plaintext-risk acknowledgement. */
async function updatePreviewEnvironmentInclusion(included: boolean) {
  const api = window.scripty?.backups?.previewExport
  if (!api || !preview.value || operation.value) return
  const previousValue = includeEnvironmentsDraft.value
  const confirmation = included ? { acknowledgedPlaintextRisk: true } as const : undefined
  const input: ExportOptions = {
    ...options.value,
    includeEnvironments: included,
    includeEnvironmentValues: included,
    includeSensitiveValues: included
  }
  includeEnvironmentsDraft.value = included
  requestGeneration += 1
  const generation = requestGeneration
  expired.value = false
  if (expiryTimer !== null) clearTimeout(expiryTimer)
  expiryTimer = null
  operation.value = 'preview'
  const result = await api(input, confirmation)
  operation.value = null
  if (generation !== requestGeneration) return
  if (result.ok === false) {
    includeEnvironmentsDraft.value = previousValue
    invalidatePreview()
    emit('feedback', 'error', result.error.message)
    return
  }
  options.value = input
  preview.value = result.data
  previewConfirmation.value = confirmation
  const expiryDelay = Math.max(0, Date.parse(result.data.expiresAt) - Date.now())
  expiryTimer = setTimeout(() => invalidatePreview(true), expiryDelay)
}

/** Builds the default scripts-and-tasks snapshot and opens its modal with environment export unchecked. */
async function generatePreview() {
  const api = window.scripty?.backups?.previewExport
  if (!api || operation.value) return
  const input: ExportOptions = {
    includeEnvironments: false,
    includeEnvironmentValues: false,
    includeSensitiveValues: false
  }
  invalidatePreview()
  const generation = requestGeneration
  operation.value = 'preview'
  const result = await api(input)
  operation.value = null
  if (generation !== requestGeneration) return
  if (result.ok === false) {
    emit('feedback', 'error', result.error.message)
    return
  }
  options.value = input
  preview.value = result.data
  includeEnvironmentsDraft.value = result.data.manifest.options.includeEnvironments
  previewConfirmation.value = undefined
  previewModalVisible.value = true
  const expiryDelay = Math.max(0, Date.parse(result.data.expiresAt) - Date.now())
  expiryTimer = setTimeout(() => invalidatePreview(true), expiryDelay)
}

/** Exports the immutable snapshot that already reflects the modal's selected scope. */
async function confirmExportBackup() {
  if (operation.value) return
  await exportBackup()
}

/** Consumes the current preview once, closes the dialog, and reports the save result through feedback. */
async function exportBackup() {
  const api = window.scripty?.backups?.export
  const currentPreview = preview.value
  if (!api || !currentPreview || operation.value) return
  operation.value = 'export'
  const result = await api(currentPreview.previewToken, previewConfirmation.value)
  operation.value = null
  invalidatePreview()
  if (result.ok === false) {
    emit('feedback', 'error', result.error.message)
    return
  }
  if (!result.data) return
  const warning = result.data.containsSensitiveValues ? '；包内包含本地明文敏感信息，请妥善保管' : ''
  emit('feedback', 'success', `已导出 ${result.data.displayName}${warning}`)
}

/** Selects and validates a ZIP while retaining only presentation state until the preload token expires. */
async function validateImportBackup() {
  const api = window.scripty?.backups?.chooseImportPackage
  if (!api || operation.value) return
  invalidateImportPreview()
  operation.value = 'import-validation'
  const result = await api()
  operation.value = null
  if (result.ok === false) {
    emit('feedback', 'error', result.error.message)
    return
  }
  if (!result.data) return
  importPreview.value = result.data
  importPreviewModalVisible.value = true
  const delay = Math.max(0, Date.parse(result.data.expiresAt) - Date.now())
  importValidationTimer.value = setTimeout(invalidateImportPreview, delay)
  emit('feedback', 'success', '备份包校验通过，已生成变更预览')
}

/** Applies the selected import mode once through the preload-held validation snapshot. */
async function applyImportBackup() {
  const api = window.scripty?.backups?.import
  const currentPreview = importPreview.value
  if (!api || !currentPreview || operation.value) return
  let confirmation: { acknowledgedOverwriteRisk: true } | undefined
  if (importMode.value === 'overwrite') {
    const accepted = await props.requestConfirmation({
      title: '确认覆盖恢复',
      message: '将先在本机备份目录创建包含当前脚本、任务、设置和环境变量值的完整备份，然后按导入包替换现有实体。确认继续？',
      type: 'danger',
      confirmText: '创建备份并覆盖',
      cancelText: '取消'
    })
    if (!accepted) return
    confirmation = { acknowledgedOverwriteRisk: true }
  }
  operation.value = 'import'
  const result = await api(currentPreview.validationToken, { mode: importMode.value }, confirmation)
  operation.value = null
  invalidateImportPreview()
  if (result.ok === false) {
    emit('feedback', 'error', result.error.message)
    return
  }
  emit('feedback', 'success', importMode.value === 'merge' ? '合并导入完成' : '覆盖恢复完成')
}

onBeforeUnmount(() => {
  invalidatePreview()
  invalidateImportPreview()
})
</script>

<template>
  <section class="backup-view" aria-labelledby="backup-heading">
    <ZModal v-model:show="previewModalVisible" :mask-closable="false" trap-focus auto-focus>
      <article v-if="preview" class="backup-preview backup-preview--modal" aria-labelledby="backup-preview-heading" aria-live="polite">
        <div class="backup-preview__heading">
          <div><h3 id="backup-preview-heading">导出备份</h3></div>
        </div>
        <dl class="backup-summary">
          <div><dt>脚本</dt><dd>{{ preview.manifest.entities.scripts }}</dd></div>
          <div><dt>任务</dt><dd>{{ preview.manifest.entities.tasks }}</dd></div>
          <div><dt>环境变量</dt><dd>{{ preview.manifest.entities.environments }}</dd></div>
        </dl>
        <ZCheckbox
          class="backup-preview__environment-option"
          :model-value="includeEnvironmentsDraft"
          :disabled="operation !== null"
          @update:model-value="updatePreviewEnvironmentInclusion"
        >
          导出环境变量
        </ZCheckbox>
        <div class="backup-preview__actions">
          <ZButton type="default" :disabled="operation !== null" @click="previewModalVisible = false">取消</ZButton>
          <ZButton
            type="primary"
            :loading="operation === 'preview' || operation === 'export'"
            :disabled="operation !== null"
            @click="confirmExportBackup"
          >
            确认导出
          </ZButton>
        </div>
      </article>
    </ZModal>

    <div class="section-heading">
      <div>
        <h2 id="backup-heading">备份与迁移</h2>
      </div>
      <ZButton type="primary" :loading="operation === 'preview'" :disabled="!previewAvailable || operation !== null" @click="generatePreview">
        导出备份
      </ZButton>
    </div>

    <p v-if="!previewAvailable" class="backup-capability" aria-live="polite">
      当前运行环境尚未提供备份导出能力。
    </p>

    <p v-if="expired" class="backup-capability" aria-live="polite">备份信息已过期，请重新导出。</p>

    <section class="backup-import" aria-labelledby="backup-import-heading">
      <div>
        <h3 id="backup-import-heading">导入校验</h3>
        <p>选择 ZIP 后会在临时目录完整校验，不会修改当前脚本、任务或设置。</p>
      </div>
      <ZButton :loading="operation === 'import-validation'" :disabled="operation !== null" @click="validateImportBackup">
        选择并校验备份
      </ZButton>
      <ZModal v-model:show="importPreviewModalVisible" :mask-closable="false" trap-focus auto-focus>
        <article v-if="importPreview" class="backup-preview backup-preview--modal" aria-labelledby="backup-import-preview-heading" aria-live="polite">
          <div class="backup-preview__heading">
            <div><h3 id="backup-import-preview-heading">是否确认导入</h3></div>
          </div>
          <dl class="backup-summary">
            <div><dt>脚本</dt><dd>{{ importPreview.package.entities.scripts }}</dd></div>
            <div><dt>任务</dt><dd>{{ importPreview.package.entities.tasks }}</dd></div>
            <div><dt>环境变量</dt><dd>{{ importPreview.package.entities.environments }}</dd></div>
          </dl>
          <div class="backup-import__mode-list">
            <div class="backup-import__mode-option">
              <ZRadio v-model="importMode" value="merge">合并导入</ZRadio>
              <span class="backup-import__mode-changes">{{ formatImportChanges(importPreview.merge) }}</span>
            </div>
            <div class="backup-import__mode-option">
              <ZRadio v-model="importMode" value="overwrite">覆盖恢复</ZRadio>
              <span class="backup-import__mode-changes">{{ formatImportChanges(importPreview.overwrite) }}</span>
            </div>
          </div>
          <ul v-if="importPreview.warnings.length" class="backup-warnings">
            <li v-for="warning in importPreview.warnings" :key="warning">{{ warning }}</li>
          </ul>
          <div class="backup-preview__actions">
            <ZButton type="default" :disabled="operation !== null" @click="invalidateImportPreview">取消</ZButton>
            <ZButton type="primary" :loading="operation === 'import'" :disabled="operation !== null" @click="applyImportBackup">
              {{ importMode === 'merge' ? '确认合并导入' : '确认覆盖恢复' }}
            </ZButton>
          </div>
        </article>
      </ZModal>
    </section>
  </section>
</template>

<style scoped lang="scss">
.backup-view {
  padding-top: 0;
}

.backup-capability,
.backup-risk {
  margin: 0 0 18px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--info-light-bg);
  color: var(--text-secondary);
  line-height: 1.6;
}

.backup-risk {
  border-left: 3px solid var(--warning-color);
  background: var(--warning-light-bg);
}

.backup-preview {
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--card-bg);
}

.backup-preview--modal {
  width: min(520px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}

.backup-preview--modal .backup-summary {
  grid-template-columns: minmax(0, 1fr);
  margin-bottom: 0;
}

.backup-preview--modal .backup-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.backup-preview--modal .backup-summary dd {
  margin: 0;
}

.backup-preview__environment-option {
  margin-top: 18px;
}

.backup-warnings {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 20px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.backup-preview__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 18px;
}

.backup-import {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px 20px;
  margin-top: 24px;
  padding: 20px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--card-bg);
}

.backup-import h3,
.backup-import p {
  margin: 0;
}

.backup-import > div p {
  margin-top: 6px;
  color: var(--text-secondary);
}

.backup-import__mode-list {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.backup-import__mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
}

.backup-import__mode-changes {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.backup-preview--modal .backup-warnings {
  margin: 14px 0 0;
}
</style>
