<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Cmd, MatchCmd, WindowMatch } from '../types'
import { CMD_TYPE_NAMES } from '../types'
import { cmdTypeIcon } from '../icons'
import Icon from './Icon.vue'
import TextField from './TextField.vue'
import SelectField from './SelectField.vue'

const props = defineProps<{ cmd: Cmd; readonly?: boolean }>()
const emit = defineEmits<{
  (e: 'update', cmd: Cmd): void
  (e: 'remove'): void
}>()

const isKeyword = computed(() => typeof props.cmd === 'string')
// 本地最新副本：父级 props 更新是异步的，同一 tick 连续修改多个字段时
// 直接基于 props 快照重建会丢失前一次改动，故以本地副本为基准
let pending: MatchCmd | null = null
watch(
  () => props.cmd,
  () => {
    pending = null
  }
)
const current = () => pending || (props.cmd as MatchCmd)
const m = computed(() => props.cmd as MatchCmd)
const typeName = computed(() => (isKeyword.value ? CMD_TYPE_NAMES.keyword : CMD_TYPE_NAMES[m.value.type]))
const typeIcon = computed(() => (isKeyword.value ? null : cmdTypeIcon(m.value.type)))
const winMatch = computed(() => (m.value.match || {}) as WindowMatch)

function setKeyword(value: string) {
  emit('update', value)
}

function setField(field: string, value: string | number | undefined) {
  const next = { ...current() } as Record<string, unknown>
  if (value === '' || value === undefined) delete next[field]
  else next[field] = value
  pending = next as unknown as MatchCmd
  emit('update', next as unknown as Cmd)
}

// 文件类型允许空值（「无」）；占位值不写入
function setFileType(value: string) {
  if (value === '__unset') return
  const next = { ...current() } as Record<string, unknown>
  next.fileType = value
  pending = next as unknown as MatchCmd
  emit('update', next as unknown as Cmd)
}

// 与原版一致：非纯数字忽略输入，空值删除该字段
function setNumber(field: string, raw: string) {
  if (raw) {
    if (!/^\d+$/.test(raw)) return
    setField(field, parseInt(raw))
  } else {
    setField(field, undefined)
  }
}

function setWindow(field: keyof WindowMatch, raw: string) {
  const base = current()
  const match = { ...((base.match || {}) as WindowMatch) } as Record<string, unknown>
  // 原版：空值也写入（保留字段），由保存时统一规整
  match[field] = raw
  const next = { ...base } as Record<string, unknown>
  next.match = match
  pending = next as unknown as MatchCmd
  emit('update', next as unknown as Cmd)
}

const winText = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(',') : v || '')

// 与原版一致：只读模式下，空的可选字段不渲染
const show = (v: unknown) => !props.readonly || (v !== undefined && v !== null && v !== '')
</script>

<template>
  <div class="feature-cmd">
    <div class="feature-type">
      <Icon v-if="typeIcon" :paths="typeIcon" />
      <span>{{ typeName }}</span>
    </div>
    <span v-if="!readonly" class="feature-cmd-remove" aria-label="移除" @click="emit('remove')">
      <Icon name="cancel" />
    </span>

    <div class="feature-cmd-match">
      <!-- 功能指令 -->
      <TextField
        v-if="isKeyword"
        label="指令名称"
        :model-value="cmd as string"
        @update:model-value="setKeyword"
      />

      <template v-else>
        <TextField label="指令名称" :model-value="m.label" @update:model-value="setField('label', $event)" />

        <!-- 任意文本：排除正则 / 最少字符数 / 最多字符数 -->
        <template v-if="m.type === 'over'">
          <TextField
            v-if="show(m.exclude)"
            label="排除正则"
            :model-value="m.exclude || ''"
            @update:model-value="setField('exclude', $event)"
          />
          <TextField
            v-if="show(m.minLength)"
            label="最少字符数"
            :model-value="m.minLength ?? ''"
            @update:model-value="setNumber('minLength', $event)"
          />
          <TextField
            v-if="show(m.maxLength)"
            label="最多字符数"
            :model-value="m.maxLength ?? ''"
            @update:model-value="setNumber('maxLength', $event)"
          />
        </template>

        <!-- 特定文本：正则 / 最少字符数 / 最多字符数 -->
        <template v-else-if="m.type === 'regex'">
          <TextField label="正则" :model-value="(m.match as string) || ''" @update:model-value="setField('match', $event)" />
          <TextField
            v-if="show(m.minLength)"
            label="最少字符数"
            :model-value="m.minLength ?? ''"
            @update:model-value="setNumber('minLength', $event)"
          />
          <TextField
            v-if="show(m.maxLength)"
            label="最多字符数"
            :model-value="m.maxLength ?? ''"
            @update:model-value="setNumber('maxLength', $event)"
          />
        </template>

        <!-- 文件：类型 / 名称匹配正则 / 最少文件数 / 最多文件数 -->
        <template v-else-if="m.type === 'files'">
          <SelectField
            v-if="show(m.fileType)"
            label="类型"
            :model-value="m.fileType === undefined ? '__unset' : m.fileType"
            @update:model-value="setFileType"
          >
            <!-- 与原版一致：未设置时显示空白，且该占位项不出现在下拉列表中 -->
            <option v-if="m.fileType === undefined" value="__unset" hidden></option>
            <option value="">无</option>
            <option value="file">文件</option>
            <option value="directory">文件夹</option>
          </SelectField>
          <TextField
            v-if="show(m.match)"
            label="名称匹配正则"
            :model-value="(m.match as string) || ''"
            @update:model-value="setField('match', $event)"
          />
          <TextField
            v-if="show(m.minLength)"
            label="最少文件数"
            :model-value="m.minLength ?? ''"
            @update:model-value="setNumber('minLength', $event)"
          />
          <TextField
            v-if="show(m.maxLength)"
            label="最多文件数"
            :model-value="m.maxLength ?? ''"
            @update:model-value="setNumber('maxLength', $event)"
          />
        </template>

        <!-- 系统窗口：应用名称 / 标题匹配正则 / 窗口类 -->
        <template v-else-if="m.type === 'window'">
          <TextField
            v-if="show(winMatch.app)"
            label='应用名称 (多个","隔开)'
            :model-value="winText(winMatch.app)"
            @update:model-value="setWindow('app', $event)"
          />
          <TextField
            v-if="show(winMatch.title)"
            label="标题匹配正则"
            :model-value="winMatch.title || ''"
            @update:model-value="setWindow('title', $event)"
          />
          <TextField
            v-if="show(winMatch.class)"
            label="窗口类 (Windows专有)"
            :model-value="winText(winMatch.class)"
            @update:model-value="setWindow('class', $event)"
          />
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.feature-cmd {
  background: var(--paper);
  border-radius: 4px;
  padding: 10px 12px 15px;
  position: relative;
  margin-bottom: 16px;
}

.feature-type {
  font-size: 14px;
  padding-bottom: 10px;
  color: rgba(0, 0, 0, 0.87);
  display: flex;
  align-items: center;
}

.feature-type :deep(.icon) {
  font-size: 20px;
  margin-right: 8px;
}

.feature-cmd-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  color: #ccc;
  cursor: pointer;
  display: flex;
  font-size: 20px;
}

.feature-cmd-match > div {
  margin-top: 15px;
}

.feature-cmd-match > div:first-child {
  margin-top: 0;
}
</style>
