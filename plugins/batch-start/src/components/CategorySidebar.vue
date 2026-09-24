<script setup lang="ts">
import type { CategoryDoc } from '../types'

defineProps<{
  categories: CategoryDoc[]
  selectedCategoryId: string | null
}>()

const emit = defineEmits<{
  select: [id: string | null]
  create: []
  rename: [id: string]
  delete: [id: string]
}>()
</script>

<template>
  <aside class="panel category-sidebar">
    <div class="panel-header">
      <span>分类</span>
      <button class="btn btn-sm" type="button" @click="emit('create')">新建</button>
    </div>
    <div class="panel-body">
      <div
        class="list-item"
        :class="{ active: selectedCategoryId === null }"
        @click="emit('select', null)"
      >
        <span>未分类</span>
      </div>
      <div
        v-for="cat in categories"
        :key="cat._id"
        class="list-item"
        :class="{ active: selectedCategoryId === cat._id }"
        @click="emit('select', cat._id)"
      >
        <span class="cat-name">{{ cat.name }}</span>
        <span class="cat-actions" @click.stop>
          <button class="btn btn-sm" type="button" @click="emit('rename', cat._id)">重命名</button>
          <button class="btn btn-sm btn-danger" type="button" @click="emit('delete', cat._id)">
            删除
          </button>
        </span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.category-sidebar {
  width: 220px;
  flex-shrink: 0;
}

.cat-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-actions {
  display: none;
  gap: 4px;
}

.list-item:hover .cat-actions,
.list-item.active .cat-actions {
  display: inline-flex;
}
</style>
