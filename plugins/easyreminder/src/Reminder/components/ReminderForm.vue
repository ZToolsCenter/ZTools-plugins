<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  AlignMode,
  DayFilter,
  DaySchedule,
  Reminder,
  ReminderFormData,
  ReminderGroup,
  ReminderType,
  TriggerRule
} from '../../types/reminder'
import {
  DAY_FILTER_LABELS,
  REMINDER_TYPE_LABELS,
  createRule,
  describeRule,
  migrateReminder
} from '../../types/reminder'
import { useReminders } from '../../composables/useReminders'
import OnceForm from './form/OnceForm.vue'
import DailyForm from './form/DailyForm.vue'
import IntervalForm from './form/IntervalForm.vue'

const props = defineProps<{
  editReminder?: Reminder | null
  groups?: ReminderGroup[]
}>()

const emit = defineEmits<{
  save: [data: ReminderFormData]
  cancel: []
}>()

const { addGroup } = useReminders()

const TYPE_DESCRIPTIONS: Record<ReminderType, string> = {
  interval: '在所选星期的时间段内，每隔固定间隔提醒一次，适合久坐、喝水等循环提醒',
  daily: '在所选星期的固定时刻提醒一次',
  once: '在指定的日期和时刻只提醒一次，触发后自动标记为已触发'
}

interface RuleDraft {
  key: string
  // 编辑已有规则时保留原始对象：id/createdAt/lastTriggered/firedAt 等触发状态要带回存储
  source?: TriggerRule
  type: ReminderType
  enabled: boolean
  expanded: boolean
  dayFilter: DayFilter
  // 各类型参数缓存：切换类型/折叠时回写，子表单重新挂载时作为初始值
  once: { triggerAt?: number }
  daily: { weekdays: number[]; triggerTime: string }
  interval: { schedules: DaySchedule[]; interval: number; align: AlignMode }
}

interface RuleFormInstance {
  validate: () => boolean
  getData: () => any
}

const form = ref({ title: '', content: '', groupId: '' })
const drafts = ref<RuleDraft[]>([])

// 子表单实例：key = 规则 key + ':' + 规则类型，不同类型间切换时各自挂载
const ruleForms = new Map<string, RuleFormInstance>()

function setRuleForm(d: RuleDraft, el: any): void {
  // 卸载回调不删除实例：切类型时新旧实例的卸载顺序不可靠，留着旧键也不会被读取
  if (el) ruleForms.set(d.key + ':' + d.type, el as RuleFormInstance)
}

function getRuleForm(d: RuleDraft): RuleFormInstance | undefined {
  return ruleForms.get(d.key + ':' + d.type)
}

let ruleKeySeed = 0
function nextRuleKey(): string {
  ruleKeySeed += 1
  return 'r' + Date.now().toString(36) + ruleKeySeed
}

function draftFromRule(rule: TriggerRule): RuleDraft {
  const draft: RuleDraft = {
    key: rule.id,
    source: rule,
    type: rule.type,
    enabled: rule.enabled,
    expanded: false,
    dayFilter: rule.type === 'once' ? 'all' : rule.dayFilter,
    once: {},
    daily: { weekdays: [], triggerTime: '09:00' },
    interval: { schedules: [], interval: 60, align: 'start' }
  }
  if (rule.type === 'once') {
    draft.once = { triggerAt: rule.triggerAt }
  } else if (rule.type === 'daily') {
    draft.daily = { weekdays: [...rule.weekdays], triggerTime: rule.triggerTime }
  } else {
    draft.interval = {
      schedules: rule.schedules.map(s => ({ ...s })),
      interval: rule.interval,
      align: rule.align
    }
  }
  return draft
}

function draftFromNew(type: ReminderType): RuleDraft {
  const draft = draftFromRule(createRule(type))
  draft.key = nextRuleKey()
  draft.source = undefined
  draft.expanded = true
  return draft
}

function loadFromReminder(r: Reminder): void {
  const migrated = migrateReminder(r)
  form.value = { title: migrated.title, content: migrated.content, groupId: migrated.groupId || '' }
  drafts.value = migrated.rules.map(draftFromRule)
  drafts.value.forEach((d, i) => { d.expanded = i === 0 })
  ruleForms.clear()
}

function resetForm(): void {
  form.value = { title: '', content: '', groupId: '' }
  drafts.value = [draftFromNew('interval')]
  ruleForms.clear()
}

onMounted(() => {
  if (props.editReminder) loadFromReminder(props.editReminder)
  else resetForm()
})

watch(() => props.editReminder, (val) => {
  if (val) loadFromReminder(val)
  else resetForm()
})

// 下拉里直接输入的新组名会以文本为值，保存时换成真实分组 id
function resolveGroupId(value?: string): string | undefined {
  const v = (value || '').trim()
  if (!v) return undefined
  if ((props.groups || []).some(g => g.id === v)) return v
  if (typeof window.services?.addGroup !== 'function') return undefined
  const group = addGroup(v)
  return group ? group.id : undefined
}

// ==================== 规则编辑 ====================

function expandRule(d: RuleDraft): void {
  for (const other of drafts.value) {
    if (other === d) continue
    // 折叠前先回写缓存，保证折叠态的摘要显示的是最新配置
    if (other.expanded) syncDraftCache(other)
    other.expanded = false
  }
  d.expanded = true
}

function toggleRule(d: RuleDraft): void {
  if (d.expanded) {
    syncDraftCache(d)
    d.expanded = false
    return
  }
  expandRule(d)
}

// 把子表单当前值写回缓存：折叠、切换类型、以及重新挂载时都要用
function syncDraftCache(d: RuleDraft): void {
  const inst = getRuleForm(d)
  if (!inst) return
  try {
    const data = inst.getData()
    if (d.type === 'once') {
      if (Number.isFinite(data.triggerAt)) d.once = { triggerAt: data.triggerAt }
    } else if (d.type === 'daily') {
      const weekdays = [...(data.weekdays || [])]
      // 空选择是非法状态（保存时会被拦下）：不要用它覆盖缓存，否则子表单 watch 到
      // props 变化会按默认值重新灌回「全选」，把用户刚清掉的选择冲掉
      if (weekdays.length) d.daily = { weekdays, triggerTime: data.triggerTime }
    } else {
      const schedules = data.schedules || []
      if (schedules.length) {
        d.interval = {
          schedules: schedules.map((s: DaySchedule) => ({ ...s })),
          interval: data.interval,
          align: data.align === 'create' ? 'create' : 'start'
        }
      }
    }
  } catch {
    // getData 不应抛错，这里仅防御：缓存失败不影响保存（保存时以子表单为准）
  }
}

function changeType(d: RuleDraft, type: ReminderType): void {
  if (d.type === type) return
  syncDraftCache(d)
  d.type = type
  expandRule(d)
}

// 添加规则：默认复制上一次规则的配置（类型、星期、时间、触发日），只需改差异部分
function addRule(): void {
  const prev = drafts.value[drafts.value.length - 1]
  const draft = prev ? cloneDraft(prev) : draftFromNew('daily')
  drafts.value.push(draft)
  expandRule(draft)
}

function cloneDraft(src: RuleDraft): RuleDraft {
  // 以子表单当前值为准：用户可能正在编辑最后一条规则、还没折叠
  syncDraftCache(src)
  return {
    key: nextRuleKey(),
    type: src.type,
    enabled: src.enabled,
    expanded: true,
    dayFilter: src.dayFilter,
    once: { ...src.once },
    daily: { weekdays: [...src.daily.weekdays], triggerTime: src.daily.triggerTime },
    interval: {
      schedules: src.interval.schedules.map(s => ({ ...s })),
      interval: src.interval.interval,
      align: src.interval.align
    }
  }
}

function removeRule(d: RuleDraft): void {
  if (drafts.value.length <= 1) {
    ElMessage.warning('至少保留一条规则')
    return
  }
  drafts.value = drafts.value.filter(x => x !== d)
}

// 折叠态的规则摘要（直接复用列表项的格式化逻辑）
function draftSummary(d: RuleDraft): string {
  const base = { id: d.key, enabled: d.enabled, createdAt: d.source?.createdAt || 0 }
  if (d.type === 'once') {
    return describeRule({ ...base, type: 'once', triggerAt: d.once.triggerAt || 0 })
  }
  if (d.type === 'daily') {
    return describeRule({
      ...base,
      type: 'daily',
      weekdays: d.daily.weekdays,
      triggerTime: d.daily.triggerTime,
      dayFilter: d.dayFilter
    })
  }
  return describeRule({
    ...base,
    type: 'interval',
    schedules: d.interval.schedules,
    interval: d.interval.interval,
    align: d.interval.align,
    dayFilter: d.dayFilter
  })
}

// ==================== 一次性规则的初始值 ====================

function onceInitialDate(d: RuleDraft): string | undefined {
  const ts = d.once.triggerAt
  if (!ts || !Number.isFinite(ts)) return undefined
  const dt = new Date(ts)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function onceInitialTime(d: RuleDraft): string | undefined {
  const ts = d.once.triggerAt
  if (!ts || !Number.isFinite(ts)) return undefined
  const dt = new Date(ts)
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// 编辑历史一次性规则时，原始时刻（时刻没改动则允许保留过去的时刻，不阻断整条任务保存）
function onceOriginalTriggerAt(d: RuleDraft): number | undefined {
  const src = d.source
  return src && src.type === 'once' ? src.triggerAt : undefined
}

// ==================== 保存 ====================

function buildRule(d: RuleDraft, data: any): TriggerRule {
  const base = {
    id: d.source?.id || d.key,
    enabled: d.enabled,
    createdAt: d.source?.createdAt || Date.now(),
    lastTriggered: d.source?.lastTriggered
  }
  if (d.type === 'once') {
    const source = d.source?.type === 'once' ? d.source : undefined
    // 改了时刻就重新变成待触发；没改则保留「已触发」状态
    const keepFired = !!source && source.triggerAt === data.triggerAt
    return {
      ...base,
      type: 'once',
      triggerAt: Number(data.triggerAt) || 0,
      firedAt: keepFired && source ? source.firedAt : undefined
    }
  }
  if (d.type === 'daily') {
    return {
      ...base,
      type: 'daily',
      weekdays: [...(data.weekdays || [])].sort((a: number, b: number) => a - b),
      triggerTime: data.triggerTime,
      dayFilter: d.dayFilter
    }
  }
  return {
    ...base,
    type: 'interval',
    schedules: (data.schedules || []).map((s: DaySchedule) => ({ ...s })),
    interval: data.interval,
    align: data.align === 'create' ? 'create' : 'start',
    dayFilter: d.dayFilter
  }
}

// 判重只看调度参数：同一任务里两条完全相同的规则没有意义
function ruleSignature(rule: TriggerRule): unknown[] {
  if (rule.type === 'once') return ['once', rule.triggerAt]
  if (rule.type === 'daily') {
    return ['daily', [...rule.weekdays].sort((a, b) => a - b).join(','), rule.triggerTime, rule.dayFilter]
  }
  // 时段顺序不影响语义：排序后再序列化，避免历史数据顺序不同被判成两条不同规则
  const schedules = [...rule.schedules].sort((a, b) =>
    a.weekday - b.weekday || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)
  )
  return ['interval', JSON.stringify(schedules), rule.interval, rule.align, rule.dayFilter]
}

function handleSubmit(): void {
  // 没重启 ZTools 时 preload 还是 1.4.x 的旧调度模块，只认旧的单类型字段；
  // 这时保存会落出一条「没有规则、永远不触发」的任务，直接拦下并提示重启
  if (window.services?.supportsMultiRules !== true) {
    ElMessage.warning('定时提醒的调度模块已更新，请重启 ZTools 后再保存')
    return
  }
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入提醒标题')
    return
  }
  if (!drafts.value.length) {
    ElMessage.warning('请至少添加一条提醒规则')
    return
  }

  const rules: TriggerRule[] = []
  const seen = new Set<string>()
  for (const d of drafts.value) {
    const inst = getRuleForm(d)
    if (!inst) {
      expandRule(d)
      ElMessage.warning('请完善提醒规则')
      return
    }
    if (!inst.validate()) {
      expandRule(d)
      return
    }
    const rule = buildRule(d, inst.getData())
    const signature = JSON.stringify(ruleSignature(rule))
    if (seen.has(signature)) {
      expandRule(d)
      ElMessage.warning('存在完全相同的规则，请合并或删除其中一条')
      return
    }
    seen.add(signature)
    rules.push(rule)
  }

  emit('save', {
    title: form.value.title,
    content: form.value.content,
    rules,
    groupId: resolveGroupId(form.value.groupId)
  })
}
</script>

<template>
  <div class="reminder-form">
    <div class="form-header">
      <h3>{{ editReminder ? '编辑提醒' : '新建提醒' }}</h3>
    </div>

    <div class="form-body">
      <div class="form-item">
        <label>提醒标题</label>
        <el-input v-model="form.title" placeholder="输入提醒标题" maxlength="50" clearable />
      </div>

      <div class="form-item">
        <label>提醒内容</label>
        <el-input v-model="form.content" type="textarea" placeholder="输入提醒内容（可选）" :rows="2" maxlength="200" show-word-limit />
      </div>

      <div class="form-item">
        <label>分组</label>
        <el-select
          v-model="form.groupId"
          filterable
          allow-create
          default-first-option
          placeholder="不分组，输入新组名可直接创建"
          style="width: 100%"
        >
          <el-option label="不分组" value="" />
          <el-option v-for="g in groups || []" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
      </div>

      <div class="form-item">
        <div class="rules-header">
          <label>提醒规则</label>
          <span class="rules-tip">同一任务可配置多条规则，任意一条到点即提醒一次</span>
        </div>

        <div
          v-for="(d, i) in drafts"
          :key="d.key"
          :class="['rule-card', { expanded: d.expanded }]"
        >
          <div class="rule-head" @click="toggleRule(d)">
            <span class="rule-index">规则 {{ i + 1 }}</span>
            <span class="rule-summary">{{ d.expanded ? REMINDER_TYPE_LABELS[d.type] : draftSummary(d) }}</span>
            <el-switch v-model="d.enabled" size="small" title="启用/停用该规则" @click.stop />
            <button
              class="rule-del"
              :disabled="drafts.length <= 1"
              title="删除该规则"
              @click.stop="removeRule(d)"
            >
              ×
            </button>
            <span class="rule-arrow" :class="{ open: d.expanded }">▾</span>
          </div>

          <div v-show="d.expanded" class="rule-body">
            <div class="form-item">
              <el-radio-group
                :model-value="d.type"
                size="small"
                @update:model-value="(v: string | number | boolean | undefined) => changeType(d, v as ReminderType)"
              >
                <el-radio-button v-for="(label, key) in REMINDER_TYPE_LABELS" :key="key" :value="key">
                  {{ label }}
                </el-radio-button>
              </el-radio-group>
              <div class="form-tip">{{ TYPE_DESCRIPTIONS[d.type] }}</div>
            </div>

            <div class="form-item" v-if="d.type !== 'once'">
              <label>触发日</label>
              <el-radio-group v-model="d.dayFilter" size="small">
                <el-radio-button v-for="(label, key) in DAY_FILTER_LABELS" :key="key" :value="key">
                  {{ label }}
                </el-radio-button>
              </el-radio-group>
              <div class="form-tip" v-if="d.dayFilter !== 'all'">
                按国家法定节假日安排（含调休）判断，与所选星期同时生效
              </div>
            </div>

            <OnceForm
              v-if="d.type === 'once'"
              :ref="(el) => setRuleForm(d, el)"
              :initial-date="onceInitialDate(d)"
              :initial-time="onceInitialTime(d)"
              :original-trigger-at="onceOriginalTriggerAt(d)"
            />
            <DailyForm
              v-if="d.type === 'daily'"
              :ref="(el) => setRuleForm(d, el)"
              :initial-weekdays="d.daily.weekdays"
              :initial-time="d.daily.triggerTime"
            />
            <IntervalForm
              v-if="d.type === 'interval'"
              :ref="(el) => setRuleForm(d, el)"
              :initial-schedules="d.interval.schedules"
              :initial-interval="d.interval.interval"
              :initial-align="d.interval.align"
            />
          </div>
        </div>

        <el-button class="add-rule" size="small" plain @click="addRule">+ 添加规则</el-button>
      </div>
    </div>

    <div class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" @click="handleSubmit">保存</el-button>
    </div>
  </div>
</template>

<style scoped>
.reminder-form {
  padding: 16px;
}

.form-header h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.form-item {
  margin-bottom: 14px;
}

.form-item label {
  display: block;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.form-tip {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  margin-top: 6px;
  line-height: 1.5;
}

.rules-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.rules-header label {
  margin-bottom: 0;
}

.rules-tip {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.rule-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  margin-bottom: 10px;
  background: var(--el-bg-color);
  overflow: hidden;
}

.rule-card.expanded {
  border-color: var(--el-border-color);
}

.rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
}

.rule-head:hover {
  background: var(--el-fill-color-lighter);
}

.rule-index {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.rule-summary {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-del {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.rule-del:hover:not(:disabled) {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.rule-del:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.rule-arrow {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  transition: transform 0.2s;
}

.rule-arrow.open {
  transform: rotate(180deg);
}

.rule-body {
  padding: 4px 10px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.add-rule {
  width: 100%;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>