<template>
  <div class="home-col">
    <div class="home-col-header">
      <span class="home-col-title">{{ title }}</span>
      <div class="home-col-header-right">
        <el-tag size="small" :type="tagType" effect="plain">
          <slot name="count">{{ items.length }}</slot>
        </el-tag>
        <el-button
          link
          type="danger"
          size="small"
          :icon="Delete"
          :disabled="!items.length"
          title="清空该栏"
          @click="$emit('clear')"
        >
          清空
        </el-button>
      </div>
    </div>
    <div class="home-list">
      <div
        v-for="n in items"
        :key="n.id"
        class="home-item"
        @click="$emit('open', n.id)"
      >
        <slot name="prefix" :item="n" />
        <div class="home-item-main">
          <div class="home-item-title" :class="{ 'home-item-done': n.done }">
            {{ n.title || '无标题' }}
          </div>
          <div class="home-item-meta">
            <el-tooltip placement="bottom" :show-after="300">
              <template #content>
                <div class="meta-tooltip">
                  <div>创建于 {{ formatFullTime(n.createdAt) }}</div>
                  <div>更新于 {{ formatFullTime(n.updatedAt) }}</div>
                  <div v-if="n.done && n.doneAt">完成于 {{ formatFullTime(n.doneAt) }}</div>
                </div>
              </template>
              <span>
                <template v-if="n.done && n.doneAt">完成于 {{ formatTime(n.doneAt) }}</template>
                <template v-else>{{ formatTime(n.updatedAt) }}</template>
              </span>
            </el-tooltip>
          </div>
        </div>
        <el-button
          link
          :icon="Switch"
          :title="n.type === 'note' ? '转为待办' : '转为笔记'"
          @click.stop="$emit('changeType', n.id)"
        />
        <el-button
          link
          :icon="Memo"
          title="打开便利贴"
          @click.stop="$emit('openSticky', n.id)"
        />
        <el-button link :icon="Delete" @click.stop="$emit('delete', n.id)" />
      </div>
      <div v-if="!items.length" class="home-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Delete, Memo, Switch } from '@element-plus/icons-vue'
import { formatTime, formatFullTime } from '../utils/time'
import type { Note } from '../composables/useNotes'

defineProps<{
  title: string
  emptyText: string
  items: Note[]
  tagType?: 'primary' | 'success' | 'warning' | 'info' | 'danger'
}>()

defineEmits<{
  (e: 'open', id: string): void
  (e: 'openSticky', id: string): void
  (e: 'changeType', id: string): void
  (e: 'delete', id: string): void
  (e: 'clear'): void
}>()
</script>
