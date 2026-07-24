<template>
  <div class="home">
    <div class="home-section">
      <span class="home-label">编辑模式</span>
      <el-radio-group :model-value="settings.mode" size="small" @change="onMode">
        <el-radio-button value="wysiwyg">所见即所得</el-radio-button>
        <el-radio-button value="split">双栏</el-radio-button>
      </el-radio-group>
      <div class="home-font">
        <span class="home-label">字号</span>
        <el-button
          size="small"
          :icon="Minus"
          circle
          :disabled="settings.fontSize <= 12"
          @click="decFont"
        />
        <span class="home-font-val">{{ settings.fontSize }}</span>
        <el-button
          size="small"
          :icon="Plus"
          circle
          :disabled="settings.fontSize >= 28"
          @click="incFont"
        />
      </div>
    </div>

    <div class="home-actions">
      <el-button type="primary" :icon="Plus" @click="$emit('new')">新建便签</el-button>
      <span class="home-tip">在便利贴内可 Ctrl+滚轮 调字号</span>
    </div>

    <div class="home-list">
      <div
        v-for="n in sortedNotes"
        :key="n.id"
        class="home-item"
        @click="$emit('open', n.id)"
      >
        <div class="home-item-main">
          <div class="home-item-title">{{ n.title || '无标题' }}</div>
          <div class="home-item-meta">{{ formatTime(n.updatedAt) }}</div>
        </div>
        <el-button link :icon="Delete" @click.stop="onDelete(n.id)" />
      </div>
      <div v-if="!sortedNotes.length" class="home-empty">
        暂无已保存便签，点击「新建便签」开始
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Minus, Delete } from '@element-plus/icons-vue'
import { useNotes } from './composables/useNotes'
import { useSettings } from './composables/useSettings'

defineEmits<{
  (e: 'new'): void
  (e: 'open', id: string): void
}>()

const { sortedNotes, deleteNote } = useNotes()
const { settings, setMode, setFontSize } = useSettings()

function onMode(v: string | number | boolean | undefined) {
  setMode(v as 'wysiwyg' | 'split')
}
function incFont() {
  setFontSize(settings.value.fontSize + 1)
}
function decFont() {
  setFontSize(settings.value.fontSize - 1)
}
function onDelete(id: string) {
  deleteNote(id)
}

function formatTime(t: number): string {
  const d = new Date(t)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>
