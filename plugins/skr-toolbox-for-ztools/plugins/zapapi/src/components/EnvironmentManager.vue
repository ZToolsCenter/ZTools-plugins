<template>
  <div class="env-manager">
    <div class="env-manager__layout">
      <div class="env-manager__list">
        <div class="env-manager__section-header">
          <span>{{ t('env.title') }}</span>
          <UiButton variant="ghost" size="xs" @click="createNewEnv">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {{ t('env.new') }}
          </UiButton>
        </div>
        <div class="env-manager__items">
          <div
            v-for="env in envStore.state.environments"
            :key="env.id"
            class="env-item"
            :class="{ active: editingEnv?.id === env.id }"
            @click="selectEnv(env)"
          >
            <UiInput
              v-if="renamingEnvId === env.id"
              ref="renameInputRef"
              v-model="renamingEnvName"
              class="env-item__input"
              @click.stop
              @blur="saveEnvName"
              @keydown.enter="saveEnvName"
            />
            <span v-else class="env-item__name">{{ env.name }}</span>
            <div class="env-item__actions">
              <UiTooltip :content="t('common.edit')" placement="bottom">
                <UiButton variant="ghost" size="xs" icon-only @click.stop="startRenameEnv(env)">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
                  </svg>
                </UiButton>
              </UiTooltip>
              <UiTooltip :content="t('common.delete')" placement="bottom">
                <UiButton variant="danger" size="xs" icon-only @click.stop="deleteEnv(env.id)">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </UiButton>
              </UiTooltip>
            </div>
          </div>
        </div>
      </div>
      <div v-if="editingEnv" class="env-manager__editor">
        <div class="env-manager__section-header">
          <span>{{ t('env.variables') }} - {{ editingEnv.name }}</span>
          <UiButton variant="ghost" size="xs" @click="addVariable">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {{ t('env.addVariable') }}
          </UiButton>
        </div>
        <div class="env-manager__variables">
          <div v-for="(variable, index) in editingEnv.variables" :key="index" class="var-row">
            <UiInput v-model="variable.key" :placeholder="t('env.varName')" class="var-key" />
            <UiInput v-model="variable.value" :placeholder="t('env.value')" class="var-value" />
            <UiButton variant="danger" size="xs" icon-only @click="removeVariable(index)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </UiButton>
          </div>
        </div>
      </div>
      <UiEmpty v-else :text="t('env.selectEnv')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEnvironmentStore, type Environment } from '../store/environments'
import UiButton from './ui/UiButton.vue'
import UiInput from './ui/UiInput.vue'
import UiEmpty from './ui/UiEmpty.vue'
import UiTooltip from './ui/UiTooltip.vue'

const { t } = useI18n()

const envStore = useEnvironmentStore()
const editingEnv = ref<Environment | null>(null)
const renamingEnvId = ref<string | null>(null)
const renamingEnvName = ref('')
const renameInputRef = ref<{ focusAndSelect?: () => void } | null>(null)

function createNewEnv() {
  const name = `${t('env.defaultName')} ${envStore.state.environments.length + 1}`
  const env = envStore.createEnvironment(name)
  editingEnv.value = env
}

function selectEnv(env: Environment) {
  editingEnv.value = env
  envStore.setActiveEnv(env.id)
}

async function startRenameEnv(env: Environment) {
  selectEnv(env)
  renamingEnvId.value = env.id
  renamingEnvName.value = env.name
  await nextTick()
  renameInputRef.value?.focusAndSelect?.()
}

function saveEnvName() {
  if (!renamingEnvId.value) {
    return
  }

  const env = envStore.state.environments.find((item) => item.id === renamingEnvId.value)
  if (!env) {
    renamingEnvId.value = null
    renamingEnvName.value = ''
    return
  }

  const nextName = renamingEnvName.value.trim() || env.name
  envStore.updateEnvironment(env.id, { name: nextName })

  if (editingEnv.value?.id === env.id) {
    editingEnv.value.name = nextName
  }

  renamingEnvId.value = null
  renamingEnvName.value = ''
}

function deleteEnv(id: string) {
  if (renamingEnvId.value === id) {
    renamingEnvId.value = null
    renamingEnvName.value = ''
  }
  if (editingEnv.value?.id === id) {
    editingEnv.value = null
  }
  envStore.deleteEnvironment(id)
}

function addVariable() {
  if (editingEnv.value) {
    editingEnv.value.variables.push({ key: '', value: '' })
  }
}

function removeVariable(index: number) {
  if (editingEnv.value) {
    editingEnv.value.variables.splice(index, 1)
  }
}

</script>

<style scoped>
.env-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.env-manager__layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.env-manager__list {
  width: 200px;
  min-width: 200px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.env-manager__editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.env-manager__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.env-manager__items {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
}

.env-item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all var(--transition-base);
  border-left: 2px solid transparent;
  min-width: 0;
}

.env-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--text-muted);
}

.env-item.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--accent-primary);
}

.env-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-item__input {
  flex: 1;
  min-width: 0;
}

.env-item__actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.env-item:focus-within .env-item__actions {
  opacity: 1;
}

.env-item:hover .env-item__actions {
  opacity: 1;
}

.env-manager__variables {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}

.var-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: 4px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.var-row:hover {
  background: var(--bg-elevated);
}

.var-key {
  flex: 1;
  min-width: 0;
}

.var-value {
  flex: 1.2;
  min-width: 0;
}
</style>
