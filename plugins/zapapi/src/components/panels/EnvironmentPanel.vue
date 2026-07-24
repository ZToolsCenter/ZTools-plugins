<template>
  <div class="env-panel">
    <div class="env-panel__list">
      <div class="env-item env-item--none" :class="{ 'env-item--active': envStore.state.activeEnvId === null }"
        @click="envStore.setActiveEnv(null)">
        <div class="env-item__header">
          <span class="env-item__indicator" :class="{ 'env-item__indicator--active': envStore.state.activeEnvId === null }"></span>
          <span class="env-item__name">{{ t('app.noEnv') }}</span>
        </div>
      </div>
      <div
        v-for="env in envStore.state.environments"
        :key="env.id"
        class="env-item"
        :class="{ 'env-item--active': envStore.state.activeEnvId === env.id, 'env-item--editing': editingEnv?.id === env.id }"
        @click="selectEnv(env)"
      >
        <div class="env-item__header">
          <span class="env-item__indicator" :class="{ 'env-item__indicator--active': envStore.state.activeEnvId === env.id }"></span>
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
        <div v-if="editingEnv?.id === env.id" class="env-item__variables" @click.stop>
          <div v-for="(variable, index) in editingEnv.variables" :key="index" class="var-row">
            <UiInput v-model="variable.key" :placeholder="t('env.varName')" class="var-key" />
            <UiInput v-model="variable.value" :placeholder="t('env.value')" class="var-value" />
            <UiButton variant="danger" size="xs" icon-only @click="removeVariable(index)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </UiButton>
          </div>
          <UiButton variant="ghost" size="xs" class="add-var-btn" @click="addVariable">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {{ t('env.addVariable') }}
          </UiButton>
        </div>
      </div>
    </div>
    <UiEmpty v-if="envStore.state.environments.length === 0" :text="t('env.selectEnv')" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEnvironmentStore, type Environment } from '../../store/environments'
import UiButton from '../ui/UiButton.vue'
import UiInput from '../ui/UiInput.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiTooltip from '../ui/UiTooltip.vue'

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
  envStore.setActiveEnv(env.id)
}

function selectEnv(env: Environment) {
  if (editingEnv.value?.id === env.id) {
    editingEnv.value = null
  } else {
    editingEnv.value = env
  }
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

defineExpose({ createNewEnv })
</script>

<style scoped>
.env-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.env-panel__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.env-item {
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
  transition: all var(--transition-base);
}

.env-item__header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all var(--transition-base);
  border-left: 2px solid transparent;
  min-width: 0;
}

.env-item__header:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--text-muted);
}

.env-item--active .env-item__header {
  color: var(--text-primary);
}

.env-item--editing .env-item__header {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-left-color: var(--accent-primary);
}

.env-item__indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.env-item__indicator--active {
  background: var(--accent-primary);
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

.env-item__header:hover .env-item__actions,
.env-item:focus-within .env-item__actions {
  opacity: 1;
}

.env-item__variables {
  padding: var(--space-sm) var(--space-sm) var(--space-sm) 20px;
  border-top: 1px solid var(--border-color);
}

.var-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: 4px;
  padding: 2px 0;
}

.var-key {
  flex: 1;
  min-width: 0;
}

.var-value {
  flex: 1.2;
  min-width: 0;
}

.add-var-btn {
  width: 100%;
  justify-content: center;
  margin-top: 4px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
}
</style>
