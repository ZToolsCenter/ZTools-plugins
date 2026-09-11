<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { fileIconUrl } from '../composables/fileIcons'
import type { DependencyKind } from '../types/domain'
import type { DependencySummary } from '../types/api'

const props = defineProps<{
  requestConfirmation: (options: { title: string; message: string; confirmText?: string; cancelText?: string }) => Promise<boolean>
}>()
const emit = defineEmits<{
  (event: 'feedback', type: 'success' | 'error', message: string): void
}>()

const activeKind = ref<DependencyKind>('node')
const dependencies = ref<DependencySummary[]>([])
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const name = ref('')
const versionSpec = ref('latest')
const postinstall = ref('')
const installing = ref(false)
const currentDependencies = computed(() => dependencies.value.filter(item => item.kind === activeKind.value))
const kindLabels: Record<DependencyKind, string> = { node: 'Node.js', python: 'Python' }
const statusLabels = { installed: '已安装', missing: '缺失', stale: '版本不一致' } as const

/** Loads the direct dependency declarations for every ecosystem in one view refresh. */
async function loadDependencies() {
  const listResult = await window.scripty.dependencies.list()
  if (listResult.ok === false) emit('feedback', 'error', listResult.error.message)
  else dependencies.value = listResult.data
}

/** Opens a blank direct-dependency form for the currently selected ecosystem. */
function openCreateDialog() {
  editingId.value = null
  name.value = ''
  versionSpec.value = 'latest'
  postinstall.value = ''
  dialogVisible.value = true
}

/** Opens version editing while keeping package identity immutable. */
function openVersionDialog(dependency: DependencySummary) {
  editingId.value = dependency.id
  name.value = dependency.name
  versionSpec.value = dependency.versionSpec
  postinstall.value = dependency.postinstall || ''
  dialogVisible.value = true
}

/** Adds a direct dependency and installs it immediately; rolls back on failure. */
async function saveDependency() {
  if (installing.value || !name.value.trim() || !versionSpec.value.trim()) return
  installing.value = true

  const isUpdate = Boolean(editingId.value)
  const result = isUpdate
    ? await window.scripty.dependencies.updateVersion(editingId.value, versionSpec.value, postinstall.value.trim() || null)
    : await window.scripty.dependencies.add({ kind: activeKind.value, name: name.value, versionSpec: versionSpec.value, postinstall: postinstall.value.trim() || null })

  if (result.ok === false) {
    installing.value = false
    return emit('feedback', 'error', result.error.message)
  }

  // 声明写入后立即安装到本地环境
  const installResult = await window.scripty.dependencies.sync(activeKind.value)
  installing.value = false

  if (installResult.ok === false) {
    // 安装失败，回退依赖声明
    if (isUpdate) {
      emit('feedback', 'error', `安装失败，已回退版本变更：${installResult.error.message}`)
    } else {
      await window.scripty.dependencies.remove(result.data.id)
      emit('feedback', 'error', `安装失败，已回退添加操作：${installResult.error.message}`)
    }
    await loadDependencies()
    return
  }

  dialogVisible.value = false
  await loadDependencies()
  emit('feedback', 'success', isUpdate ? '依赖版本已更新并安装' : '依赖已添加并安装')
}

/** Removes one direct declaration and uninstalls it immediately; rolls back on failure. */
async function removeDependency(dependency: DependencySummary) {
  const accepted = await props.requestConfirmation({
    title: '删除依赖',
    message: `确定删除"${dependency.name}"吗？将立即从环境中卸载。`,
    confirmText: '删除',
    cancelText: '取消'
  })
  if (!accepted) return

  installing.value = true

  const result = await window.scripty.dependencies.remove(dependency.id)
  if (result.ok === false) {
    installing.value = false
    return emit('feedback', 'error', result.error.message)
  }

  // 声明移除后立即从本地环境卸载
  const uninstallResult = await window.scripty.dependencies.sync(activeKind.value)
  installing.value = false

  if (uninstallResult.ok === false) {
    // 卸载失败，回退删除操作
    await window.scripty.dependencies.add({ kind: dependency.kind, name: dependency.name, versionSpec: dependency.versionSpec })
    emit('feedback', 'error', `卸载失败，已回退删除操作：${uninstallResult.error.message}`)
    await loadDependencies()
    return
  }

  await loadDependencies()
  emit('feedback', 'success', '依赖已删除并卸载')
}

onMounted(loadDependencies)
</script>

<template>
  <section class="dependencies-view" aria-labelledby="dependencies-heading">
    <ZModal v-model:show="dialogVisible" :mask-closable="false" trap-focus auto-focus>
      <form class="dependency-form" @submit.prevent="saveDependency">
        <h3>{{ editingId ? '修改依赖版本' : `新增 ${kindLabels[activeKind]} 依赖` }}</h3>
        <label><span>包名</span><ZInput v-model="name" :disabled="Boolean(editingId)" placeholder="例如：lodash / requests" /></label>
        <label><span>版本</span><ZInput v-model="versionSpec" placeholder="例如：^4.17.21 / >=2.32" /></label>
        <label><span>后处理命令（可选）</span><ZInput v-model="postinstall" placeholder="例如：npx playwright install chromium" /></label>
        <p class="managed-copy-notice">仅支持 npm/PyPI 注册表包名和版本范围，不支持路径、URL、Git 或命令参数。后处理命令会在依赖同步后自动执行。</p>
        <div class="drawer-actions">
          <ZButton type="default" :disabled="installing" @click="dialogVisible = false">取消</ZButton>
          <ZButton type="primary" :loading="installing" :disabled="!name.trim() || !versionSpec.trim() || installing" @click="saveDependency">
            {{ installing ? '安装中...' : '保存并安装' }}
          </ZButton>
        </div>
      </form>
    </ZModal>

    <div class="section-heading">
      <div>
        <h2 id="dependencies-heading">依赖管理</h2>
        <p>所有脚本共用 Scripty 数据目录中的隔离环境，不依赖全局第三方包。</p>
      </div>
      <div class="section-heading__actions">
        <ZButton type="default" :disabled="installing" @click="openCreateDialog">新增依赖</ZButton>
        <div class="dependency-kind-switch" role="group" aria-label="依赖类型">
          <button
            v-for="kind in (['node', 'python'] as DependencyKind[])"
            :key="kind"
            type="button"
            class="dependency-kind-switch__button"
            :class="{ 'dependency-kind-switch__button--active': activeKind === kind }"
            :disabled="installing"
            :aria-label="`${kindLabels[kind]} 依赖`"
            :aria-pressed="activeKind === kind"
            :title="kindLabels[kind]"
            @click="activeKind = kind"
          >
            <img :src="fileIconUrl(kind === 'node' ? 'package.json' : 'dependency.py')" alt="" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div class="view-body">
      <div v-if="installing" class="installing-overlay">
        <div class="installing-spinner"></div>
        <p>正在安装依赖，请稍候...</p>
      </div>
      <div v-else-if="currentDependencies.length === 0" class="empty-state">
        <div class="empty-state__mark" aria-hidden="true">D</div>
        <h3>还没有 {{ kindLabels[activeKind] }} 直接依赖</h3>
        <p>新增依赖后会自动安装到应用本地环境中。</p>
      </div>
      <ul v-else class="dependency-list">
        <li v-for="dependency in currentDependencies" :key="dependency.id" class="dependency-row">
          <div>
            <strong>{{ dependency.name }}</strong>
            <p>声明 {{ dependency.versionSpec }} · 已安装 {{ dependency.installedVersion || '—' }}</p>
          </div>
          <div class="script-row__actions">
            <ZTag :type="dependency.status === 'installed' ? 'success' : dependency.status === 'missing' ? 'danger' : 'warning'" size="small">
              {{ statusLabels[dependency.status] }}
            </ZTag>
            <ZButton type="text" size="small" :disabled="installing" @click="openVersionDialog(dependency)">修改版本</ZButton>
            <ZButton type="text" size="small" :disabled="installing" @click="removeDependency(dependency)">删除</ZButton>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped lang="scss">
.dependencies-view {
  padding-top: 0;
}

.dependency-kind-switch {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-bg);
}

.dependency-kind-switch__button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.12s ease, box-shadow 0.12s ease;
}

.dependency-kind-switch__button:hover:not(:disabled) {
  background: var(--hover-bg);
}

.dependency-kind-switch__button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--primary-light-bg);
}

.dependency-kind-switch__button--active {
  background: var(--primary-light-bg);
}

.dependency-kind-switch__button--active:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.dependency-kind-switch__button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dependency-kind-switch__button img {
  width: 18px;
  height: 18px;
}

.dependency-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dependency-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--card-bg);
}

.dependency-row p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.installing-overlay {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  margin-bottom: 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--card-bg);

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
  }
}

.installing-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
