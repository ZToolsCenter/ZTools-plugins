<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CategoryDoc } from '../types'

const props = defineProps<{
  categories: CategoryDoc[]
  /** 当前选中的分类（用于 ← 加入），与中间栏筛选无关 */
  selectedCategoryId: string | null
  collapsed: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  select: [id: string | null]
  create: [name: string]
  rename: [id: string, name: string]
  delete: [id: string]
  toggleCollapsed: []
}>()

const drafting = ref(false)
const draftName = ref('')
const renamingId = ref<string | null>(null)
const renameName = ref('')
const menuOpenId = ref<string | null>(null)
const menuPos = ref({ top: 0, left: 0 })

async function focusInput() {
  await nextTick()
  const el = document.querySelector(
    '.category-sidebar .cat-editor__input',
  ) as HTMLInputElement | null
  el?.focus()
  el?.select()
}

async function startCreate() {
  if (props.busy) return
  if (props.collapsed) emit('toggleCollapsed')
  closeMenu()
  drafting.value = true
  renamingId.value = null
  draftName.value = ''
  await focusInput()
}

async function startRename(id: string) {
  if (props.busy) return
  const cat = props.categories.find((c) => c._id === id)
  if (!cat) return
  closeMenu()
  drafting.value = false
  renamingId.value = id
  renameName.value = cat.name
  await focusInput()
}

function cancelEdit() {
  drafting.value = false
  renamingId.value = null
  draftName.value = ''
  renameName.value = ''
}

function submitCreate() {
  const name = draftName.value.trim()
  if (!name) {
    cancelEdit()
    return
  }
  emit('create', name)
  cancelEdit()
}

function submitRename() {
  const id = renamingId.value
  if (!id) return
  const name = renameName.value.trim()
  if (!name) {
    cancelEdit()
    return
  }
  emit('rename', id, name)
  cancelEdit()
}

function selectCategory(id: string | null) {
  emit('select', id)
}

function toggleMenu(id: string, event: MouseEvent) {
  event.stopPropagation()
  if (menuOpenId.value === id) {
    closeMenu()
    return
  }
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  menuPos.value = { top: rect.top, left: rect.right + 4 }
  menuOpenId.value = id
}

function closeMenu() {
  menuOpenId.value = null
}

function onDelete(id: string) {
  closeMenu()
  emit('delete', id)
}

function onDocClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.cat-menu')) closeMenu()
}

function onDocKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <aside class="panel category-sidebar" :class="{ 'is-collapsed': collapsed }">
    <div class="panel-header">
      <button
        class="btn-icon"
        type="button"
        :title="collapsed ? '展开分类' : '收起分类'"
        :aria-expanded="!collapsed"
        @click="emit('toggleCollapsed')"
      >
        <span aria-hidden="true">{{ collapsed ? '›' : '‹' }}</span>
      </button>
      <span v-if="!collapsed" class="header-title">分类</span>
      <button
        v-if="!collapsed"
        class="btn btn-sm btn-ghost"
        type="button"
        :disabled="busy || drafting || !!renamingId"
        @click="startCreate"
      >
        新建
      </button>
    </div>
    <div class="panel-body">
      <div v-if="!collapsed && drafting" class="cat-editor">
        <input
          v-model="draftName"
          class="cat-editor__input"
          type="text"
          placeholder="分类名称"
          maxlength="32"
          @keydown.enter.prevent="submitCreate"
          @keydown.esc.prevent="cancelEdit"
        />
        <button class="btn btn-sm btn-primary" type="button" @click="submitCreate">确定</button>
        <button class="btn btn-sm btn-ghost" type="button" @click="cancelEdit">取消</button>
      </div>

      <div
        class="list-item"
        :class="{ active: selectedCategoryId == null }"
        :title="collapsed ? '未选分类' : undefined"
        @click="selectCategory(null)"
      >
        <span class="rail-mark" aria-hidden="true">空</span>
        <span v-if="!collapsed">未选</span>
      </div>

      <div
        v-for="cat in categories"
        :key="cat._id"
        class="list-item"
        :class="{ active: selectedCategoryId === cat._id }"
        :title="collapsed ? cat.name : undefined"
        @click="selectCategory(cat._id)"
      >
        <span class="rail-mark" aria-hidden="true">{{ cat.name.slice(0, 1) }}</span>
        <template v-if="!collapsed">
          <div v-if="renamingId === cat._id" class="cat-editor inline" @click.stop>
            <input
              v-model="renameName"
              class="cat-editor__input"
              type="text"
              maxlength="32"
              @keydown.enter.prevent="submitRename"
              @keydown.esc.prevent="cancelEdit"
            />
            <button class="btn btn-sm btn-primary" type="button" @click="submitRename">确定</button>
          </div>
          <template v-else>
            <span class="cat-name">{{ cat.name }}</span>
            <div class="cat-menu" @click.stop>
              <button
                class="cat-menu__trigger"
                type="button"
                title="操作"
                :aria-expanded="menuOpenId === cat._id"
                @click="toggleMenu(cat._id, $event)"
              >
                ›
              </button>
            </div>
          </template>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="menuOpenId"
        class="cat-menu__pop"
        role="menu"
        :style="{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }"
        @click.stop
      >
        <button
          class="cat-menu__item"
          type="button"
          role="menuitem"
          @click="startRename(menuOpenId)"
        >
          重命名
        </button>
        <button
          class="cat-menu__item danger"
          type="button"
          role="menuitem"
          @click="onDelete(menuOpenId)"
        >
          删除
        </button>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.category-sidebar {
  width: var(--sidebar);
  flex-shrink: 0;
  transition: width var(--ease);
  overflow: visible;
}

.category-sidebar.is-collapsed {
  width: var(--rail);
}

.category-sidebar.is-collapsed .panel-header {
  justify-content: center;
  padding-inline: 6px;
}

.category-sidebar.is-collapsed .panel-body {
  padding: 6px;
}

.category-sidebar.is-collapsed .list-item {
  justify-content: center;
  padding: 8px 0;
}

.header-title {
  flex: 1;
  min-width: 0;
}

.rail-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.list-item.active .rail-mark {
  color: var(--badge-fg);
  background: var(--badge-bg);
  border-color: var(--selected-border);
}

.cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-menu {
  position: relative;
  flex-shrink: 0;
}

.cat-menu__trigger {
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.cat-menu__trigger:hover,
.cat-menu__trigger[aria-expanded='true'] {
  color: var(--accent);
  border-color: var(--border);
  background: var(--surface-2);
}


.cat-editor {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.cat-editor.inline {
  flex: 1;
  min-width: 0;
  margin-bottom: 0;
}

.cat-editor__input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--input-bg);
  outline: none;
}

.cat-editor__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--selected);
}
</style>
