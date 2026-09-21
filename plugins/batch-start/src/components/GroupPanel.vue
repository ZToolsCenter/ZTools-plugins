<script setup lang="ts">
import { computed } from 'vue'
import type { AppDoc, GroupDoc } from '../types'

export type GroupDraft = {
  id?: string
  name: string
  cmdsText: string
  appIds: string[]
  order: number
  featureSynced?: boolean
}

const props = defineProps<{
  groups: GroupDoc[]
  apps: AppDoc[]
  selectedGroupId: string | null
  draft: GroupDraft | null
  saveError: string | null
  busy?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
  'update:draft': [value: GroupDraft]
  save: []
  delete: []
  retrySync: []
  removeMember: [appId: string]
}>()

const appById = computed(() => new Map(props.apps.map((a) => [a._id, a])))

const members = computed(() => {
  if (!props.draft) return []
  return props.draft.appIds.map((id) => {
    const app = appById.value.get(id)
    return {
      id,
      name: app?.name ?? id,
      path:
        app?.source === 'ztools' || app?.source === 'plugin'
          ? app.pluginTitle || app.pluginName || app.path
          : (app?.path ?? ''),
      isZtools: app?.source === 'ztools' || app?.source === 'plugin',
      missing: !app,
    }
  })
})

const showUnsynced = computed(
  () => props.draft?.id != null && props.draft.featureSynced === false,
)

function patchDraft(partial: Partial<GroupDraft>) {
  if (!props.draft) return
  emit('update:draft', { ...props.draft, ...partial })
}
</script>

<template>
  <aside class="panel group-panel">
    <div class="panel-header">
      <span>启动组</span>
      <button class="btn btn-sm" type="button" :disabled="busy" @click="emit('create')">
        新建
      </button>
    </div>

    <div class="group-list">
      <div v-if="groups.length === 0" class="empty-hint muted">暂无启动组</div>
      <div
        v-for="group in groups"
        :key="group._id"
        class="list-item"
        :class="{ active: selectedGroupId === group._id }"
        @click="emit('select', group._id)"
      >
        <span class="group-name">{{ group.name }}</span>
        <span v-if="!group.featureSynced" class="badge-unsynced" title="Feature 未同步">未同步</span>
      </div>
    </div>

    <div class="editor">
      <div v-if="!draft" class="empty-state">
        <div>选择或创建一个启动组进行编辑</div>
        <button class="btn btn-primary" type="button" @click="emit('create')">创建启动组</button>
      </div>

      <template v-else>
        <div v-if="showUnsynced" class="sync-row">
          <span class="badge-unsynced">未同步</span>
          <button class="btn btn-sm" type="button" :disabled="busy" @click="emit('retrySync')">
            重试同步
          </button>
        </div>

        <div v-if="saveError" class="error-banner">{{ saveError }}</div>

        <div class="field">
          <label>名称</label>
          <input
            type="text"
            :value="draft.name"
            placeholder="启动组名称"
            @input="patchDraft({ name: ($event.target as HTMLInputElement).value })"
          />
        </div>

        <div class="field">
          <label>指令（逗号分隔）</label>
          <input
            type="text"
            :value="draft.cmdsText"
            placeholder="默认使用名称"
            @input="patchDraft({ cmdsText: ($event.target as HTMLInputElement).value })"
          />
        </div>

        <div class="field">
          <label>成员（{{ members.length }}）</label>
          <div v-if="members.length === 0" class="muted">从中间应用列表勾选后点「加入当前组」</div>
          <div v-else class="member-list">
            <div v-for="m in members" :key="m.id" class="member-row">
              <div class="member-meta">
                <div :class="{ missing: m.missing }">
                  {{ m.name }}
                  <span v-if="m.isZtools" class="source-badge">指令</span>
                </div>
                <div class="muted member-path">{{ m.path || m.id }}</div>
              </div>
              <button class="btn btn-sm" type="button" @click="emit('removeMember', m.id)">
                移除
              </button>
            </div>
          </div>
        </div>

        <div class="editor-actions">
          <button class="btn btn-primary" type="button" :disabled="busy" @click="emit('save')">
            保存
          </button>
          <button
            v-if="draft.id"
            class="btn btn-danger"
            type="button"
            :disabled="busy"
            @click="emit('delete')"
          >
            删除
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.group-panel {
  width: 300px;
  flex-shrink: 0;
}

.group-list {
  max-height: 160px;
  overflow: auto;
  border-bottom: 1px solid var(--border);
  padding: 8px;
}

.empty-hint {
  padding: 8px;
}

.group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor {
  flex: 1;
  overflow: auto;
  padding: 12px;
}

.sync-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.member-meta {
  flex: 1;
  min-width: 0;
}

.member-path {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-badge {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 4px;
  color: #1d4ed8;
  background: #dbeafe;
}

.missing {
  color: var(--danger);
}

.editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
