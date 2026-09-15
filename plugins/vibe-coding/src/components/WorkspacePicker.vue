<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown, Folder, FolderPlus, Plus } from '@lucide/vue'

const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  activeWorkspace: { type: Object, default: null },
})
const emit = defineEmits(['select', 'create', 'import'])
const root = ref(null)
const open = ref(false)

/**
 * 打开或关闭工作区选择菜单。
 * @returns {void} 无返回值。
 */
function toggleMenu() {
  open.value = !open.value
}

/**
 * 选择指定工作区并关闭菜单。
 * @param {string} workspaceId 工作区标识；空字符串表示不绑定。
 * @returns {void} 无返回值。
 */
function selectWorkspace(workspaceId) {
  emit('select', workspaceId)
  open.value = false
}

/**
 * 触发工作区创建流程并关闭菜单。
 * @returns {void} 无返回值。
 */
function createWorkspace() {
  emit('create')
  open.value = false
}

/**
 * 触发本地文件夹登记流程并关闭菜单。
 * @returns {void} 无返回值。
 */
function importWorkspace() {
  emit('import')
  open.value = false
}

/**
 * 点击组件外部时关闭菜单。
 * @param {PointerEvent} event 文档指针事件。
 * @returns {void} 无返回值。
 */
function handleOutsidePointer(event) {
  if (open.value && root.value && !root.value.contains(event.target)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', handleOutsidePointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutsidePointer))
</script>

<template>
  <div ref="root" class="workspace-picker-wrap">
    <button
      class="composer-tool-button workspace-picker-trigger"
      type="button"
      v-tooltip="{ label: activeWorkspace?.path || '选择工作区', side: 'top', maxWidth: 360 }"
      @click="toggleMenu"
    >
      <Folder :size="16" />
      <span>{{ activeWorkspace?.name || '工作区' }}</span>
      <ChevronDown :size="13" />
    </button>
    <section v-if="open" class="workspace-picker-menu" role="menu" aria-label="选择工作区">
      <button class="workspace-picker-option" type="button" role="menuitemradio" :aria-checked="!activeWorkspace" @click="selectWorkspace('')">
        <Folder :size="16" /><span><strong>不使用工作区</strong><small>最近</small></span><Check v-if="!activeWorkspace" :size="15" />
      </button>
      <div v-if="workspaces.length" class="workspace-picker-list">
        <button v-for="workspace in workspaces" :key="workspace.id" class="workspace-picker-option" type="button" role="menuitemradio" :aria-checked="workspace.id === activeWorkspace?.id" @click="selectWorkspace(workspace.id)">
          <Folder :size="16" /><span><strong>{{ workspace.name }}</strong><small>{{ workspace.path }}</small></span><Check v-if="workspace.id === activeWorkspace?.id" :size="15" />
        </button>
      </div>
      <div class="workspace-picker-actions">
        <button type="button" role="menuitem" @click="createWorkspace"><Plus :size="16" />创建新工作区</button>
        <button type="button" role="menuitem" @click="importWorkspace"><FolderPlus :size="16" />添加本地文件夹</button>
      </div>
    </section>
  </div>
</template>
