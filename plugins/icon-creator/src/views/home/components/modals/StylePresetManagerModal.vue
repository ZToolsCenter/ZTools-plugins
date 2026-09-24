<template>
  <ZModal
    :show="show"
    preset="dialog"
    :show-mask="true"
    :mask-closable="true"
    :close-on-esc="true"
    :auto-focus="true"
    @update:show="$emit('update:show', $event)"
  >
    <div class="style-preset-manager-dialog">
      <div class="style-preset-manager-header">
        <div class="style-preset-manager-title">样式预设管理</div>
        <div class="style-preset-manager-tabs">
          <button
            class="style-preset-manager-tab"
            :class="{ active: activeTab === 'colors' }"
            @click="activeTab = 'colors'"
          >色板</button>
          <button
            class="style-preset-manager-tab"
            :class="{ active: activeTab === 'gradients' }"
            @click="activeTab = 'gradients'"
          >渐变预设</button>
        </div>
      </div>
      <div ref="managerContentRef" class="style-preset-manager-content">
        <template v-if="activeTab === 'colors'">
          <div class="manager-toolbar">
            <label class="manager-inline-field">
              <span class="flex-shrink-0">展示列数</span>
              <ZInput
                size="small"
                type="text"
                :model-value="colorColumnsInput"
                @update:model-value="colorColumnsInput = String($event)"
                @change="commitColorColumnsInput"
              />
            </label>
            <div class="manager-toolbar-actions">
              <ZButton size="small" @click="addColorGroup">新增分类</ZButton>
              <ZButton size="small" @click="resetColorsToDefault">重置色板</ZButton>
            </div>
          </div>
          <div v-if="!localColorGroups.length" class="manager-empty">
            <div>当前还没有色板分类。</div>
            <ZButton size="small" type="primary" @click="addColorGroup">新增第一个分类</ZButton>
          </div>
          <VueDraggable
            v-else
            v-model="localColorGroups"
            class="color-group-list"
            item-key="id"
            handle=".group-drag-handle"
          >
            <section
              v-for="group in localColorGroups"
              :key="group.id"
              class="color-group-card"
              :data-group-id="group.id"
            >
              <div class="color-group-head">
                <button class="drag-handle group-drag-handle" type="button" title="拖动分类排序">
                  <Icon icon="mdi:drag-vertical" />
                </button>
                <ZInput
                  size="small"
                  type="text"
                  :model-value="group.name"
                  placeholder="分类名称"
                  @update:model-value="group.name = String($event)"
                />
                <div class="color-group-actions">
                  <ZButton size="small" :disabled="!currentFillColor" @click="addCurrentColorToGroup(group.id, 'fill')">取填充</ZButton>
                  <ZButton size="small" :disabled="!currentStrokeColor" @click="addCurrentColorToGroup(group.id, 'stroke')">取描边</ZButton>
                  <ZButton size="small" @click="addEmptyColorToGroup(group.id)">新增颜色</ZButton>
                  <button class="icon-btn danger" type="button" title="删除分类" @click="removeColorGroup(group.id)">
                    <Icon icon="mdi:delete-outline" />
                  </button>
                </div>
              </div>
              <div v-if="group.colors.length" class="color-row-list">
                <VueDraggable
                  v-model="group.colors"
                  class="color-draggable-list"
                  item-key="id"
                  handle=".color-drag-handle"
                >
                  <div v-for="swatch in group.colors" :key="swatch.id" class="color-row">
                    <button class="drag-handle color-drag-handle" type="button" title="拖动颜色排序">
                      <Icon icon="mdi:drag-vertical" />
                    </button>
                    <ZColorPicker
                      size="small"
                      show-alpha
                      :show-input="false"
                      :model-value="swatch.color"
                      @change="swatch.color = String($event)"
                    />
                    <ZInput
                      size="small"
                      type="text"
                      :model-value="swatch.name"
                      placeholder="颜色名称"
                      @update:model-value="swatch.name = String($event)"
                    />
                    <div class="color-preview-chip" :style="{ '--preview-color': swatch.color }"></div>
                    <button class="icon-btn danger" type="button" title="删除颜色" @click="removeColorSwatch(group.id, swatch.id)">
                      <Icon icon="mdi:close" />
                    </button>
                  </div>
                </VueDraggable>
              </div>
              <div v-else class="manager-empty nested">该分类还没有颜色，可收录当前填充 / 描边色，或手动新增颜色。</div>
            </section>
          </VueDraggable>
        </template>
        <template v-else>
          <div class="manager-toolbar">
            <label class="manager-inline-field">
              <span class="flex-shrink-0">展示行数</span>
              <ZInput
                size="small"
                type="text"
                :model-value="gradientRowsInput"
                @update:model-value="gradientRowsInput = String($event)"
                @change="commitGradientRowsInput"
              />
            </label>
            <div class="manager-toolbar-actions">
              <ZButton size="small" :disabled="!currentGradientPreset" @click="addCurrentGradientPreset">取当前渐变</ZButton>
              <ZButton size="small" @click="addEmptyGradientPreset">新增渐变</ZButton>
              <ZButton size="small" @click="resetGradientsToDefault">重置渐变</ZButton>
            </div>
          </div>
          <div v-if="!localGradientPresets.length" class="manager-empty">
            <div>当前还没有渐变预设。</div>
            <div class="manager-toolbar-actions compact">
              <ZButton size="small" :disabled="!currentGradientPreset" @click="addCurrentGradientPreset">取当前渐变</ZButton>
              <ZButton size="small" type="primary" @click="addEmptyGradientPreset">新增渐变</ZButton>
            </div>
          </div>
          <VueDraggable
            v-else
            v-model="localGradientPresets"
            class="gradient-card-list"
            item-key="id"
            handle=".gradient-drag-handle"
          >
            <section
              v-for="preset in localGradientPresets"
              :key="preset.id"
              class="gradient-card"
            >
              <div class="gradient-card-head">
                <button class="drag-handle gradient-drag-handle" type="button" title="拖动渐变排序">
                  <Icon icon="mdi:drag-vertical" />
                </button>
                <span class="gradient-card-preview" :style="getGradientPresetStyle(preset)"></span>
                <ZInput
                  size="small"
                  type="text"
                  :model-value="preset.name"
                  placeholder="渐变名称"
                  @update:model-value="preset.name = String($event)"
                />
              </div>
              <div class="gradient-card-type-row">
                <div class="gradient-type-toggle">
                  <button class="toggle-btn" :class="{ active: preset.type === 'linear' }" @click="setGradientType(preset.id, 'linear')">线性</button>
                  <button class="toggle-btn" :class="{ active: preset.type === 'radial' }" @click="setGradientType(preset.id, 'radial')">径向</button>
                </div>
                <button class="icon-btn danger" type="button" title="删除渐变" @click="removeGradientPreset(preset.id)">
                  <Icon icon="mdi:delete-outline" />
                </button>
              </div>
              <div class="gradient-stop-list">
                <div v-for="(stop, stopIndex) in preset.stops" :key="stop.id" class="gradient-stop-row">
                  <ZColorPicker
                    size="small"
                    show-alpha
                    :show-input="false"
                    :model-value="stop.color"
                    @change="stop.color = String($event)"
                  />
                  <label class="manager-inline-field stop-offset-field">
                    <span class="flex-shrink-0">位置</span>
                    <ZInput
                      size="small"
                      type="number"
                      :model-value="Math.round(stop.offset * 100)"
                      min="0"
                      max="100"
                      step="1"
                      @change="updateGradientStopOffset(preset.id, stopIndex, $event)"
                    >
                      <template #suffix>%</template>
                    </ZInput>
                  </label>
                  <div class="gradient-stop-actions">
                    <button
                      class="icon-btn"
                      type="button"
                      title="新增色标"
                      @click="addGradientStop(preset.id)"
                    >
                      <Icon icon="mdi:plus" />
                    </button>
                    <button
                      class="icon-btn danger"
                      type="button"
                      title="删除色标"
                      :disabled="preset.stops.length <= 2"
                      @click="removeGradientStop(preset.id, stop.id)"
                    >
                      <Icon icon="mdi:close" />
                    </button>
                  </div>
                </div>
              </div>
              <div class="gradient-card-body">
                <div v-if="preset.type === 'linear'" class="gradient-param-row angle-control-row">
                  <span class="param-label">角度</span>
                  <ZSlider
                    :model-value="Math.round(Number(preset.angle ?? 0))"
                    :min="0"
                    :max="359"
                    :step="1"
                    @change="updateGradientNumberField(preset.id, 'angle', $event)"
                  />
                  <ZInput
                    size="small"
                    type="number"
                    :model-value="Math.round(Number(preset.angle ?? 0))"
                    min="0"
                    max="359"
                    step="1"
                    @change="updateGradientNumberField(preset.id, 'angle', $event)"
                  >
                    <template #suffix>°</template>
                  </ZInput>
                </div>
                <div v-else class="gradient-radial-fields">
                  <label class="manager-inline-field gradient-param-row">
                    <span>中心 X</span>
                    <ZInput
                      size="small"
                      type="number"
                      :model-value="Number(preset.centerX ?? 0.5).toFixed(2)"
                      min="0"
                      max="1"
                      step="0.01"
                      @change="updateGradientNumberField(preset.id, 'centerX', $event)"
                    />
                  </label>
                  <label class="manager-inline-field gradient-param-row">
                    <span>中心 Y</span>
                    <ZInput
                      size="small"
                      type="number"
                      :model-value="Number(preset.centerY ?? 0.5).toFixed(2)"
                      min="0"
                      max="1"
                      step="0.01"
                      @change="updateGradientNumberField(preset.id, 'centerY', $event)"
                    />
                  </label>
                  <label class="manager-inline-field gradient-param-row">
                    <span>半径</span>
                    <ZInput
                      size="small"
                      type="number"
                      :model-value="Number(preset.radius ?? 0.5).toFixed(2)"
                      min="0.05"
                      max="2"
                      step="0.01"
                      @change="updateGradientNumberField(preset.id, 'radius', $event)"
                    />
                  </label>
                </div>
              </div>
            </section>
          </VueDraggable>
        </template>
      </div>
      <div class="style-preset-manager-actions">
        <ZButton size="small" @click="$emit('update:show', false)">取消</ZButton>
        <ZButton size="small" type="primary" @click="emitConfirm">保存</ZButton>
      </div>
    </div>
  </ZModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { Icon } from '@iconify/vue'
import {
  DEFAULT_COLOR_PALETTE_COLUMNS,
  MAX_COLOR_PALETTE_COLUMNS,
  MAX_GRADIENT_PRESET_ROWS,
  MIN_COLOR_PALETTE_COLUMNS,
  MIN_GRADIENT_PRESET_ROWS
} from '../../constants'
import {
  DEFAULT_FILL_GRADIENT_ANGLE,
  DEFAULT_FILL_GRADIENT_CENTER,
  DEFAULT_FILL_GRADIENT_RADIUS
} from '../../fabric/objectMetadata'
import type {
  ColorPaletteGroup,
  GradientPresetItem,
  StylePresetManagerTab,
  StylePresetSettings
} from '../../types'
import { ZButton, ZColorPicker, ZInput, ZModal, ZSlider } from 'ztools-ui'


type EditableGradientStop = {
  id: string
  color: string
  offset: number
}

type EditableGradientPreset = Omit<GradientPresetItem, 'stops'> & {
  stops: EditableGradientStop[]
}

const props = defineProps<{
  show: boolean
  initialTab: StylePresetManagerTab
  colorPaletteGroups: ColorPaletteGroup[]
  gradientPresets: GradientPresetItem[]
  defaultColorPaletteGroups: ColorPaletteGroup[]
  defaultGradientPresets: GradientPresetItem[]
  colorColumns: number
  defaultColorColumns: number
  gradientRows: number
  defaultGradientRows: number
  currentFillColor: string
  currentStrokeColor: string
  currentGradientPreset: GradientPresetItem | null
}>()

const emit = defineEmits<{
  (event: 'update:show', value: boolean): void
  (event: 'confirm', value: StylePresetSettings): void
}>()

const activeTab = ref<StylePresetManagerTab>('colors')
const colorColumnsInput = ref(String(DEFAULT_COLOR_PALETTE_COLUMNS))
const gradientRowsInput = ref(String(MIN_GRADIENT_PRESET_ROWS))
const localColorGroups = ref<ColorPaletteGroup[]>([])
const localGradientPresets = ref<EditableGradientPreset[]>([])
// 滚动容器引用：新增分类后用于把新卡片滚动到可视区域。
const managerContentRef = ref<HTMLElement | null>(null)

// 为弹窗内新增的分类、颜色和渐变生成临时 id，保证拖拽和局部编辑时 key 稳定。
function createLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// 深拷贝色板分类，避免弹窗里尚未确认的编辑直接污染右侧属性面板的已生效数据。
function cloneColorPaletteGroups(groups: ColorPaletteGroup[]) {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    colors: group.colors.map((color) => ({ ...color }))
  }))
}

// 为渐变卡片补齐本地 stop id，让颜色和位置编辑在列表增删后仍能保持稳定映射关系。
function cloneGradientPresets(presets: GradientPresetItem[]): EditableGradientPreset[] {
  return presets.map((preset) => ({
    ...preset,
    stops: preset.stops.map((stop) => ({
      id: createLocalId('gradient-stop'),
      color: stop.color,
      offset: stop.offset
    }))
  }))
}

// 每次打开弹窗都从当前已保存配置重新生成本地副本，取消时即可自然回滚未确认修改。
function resetLocalState() {
  activeTab.value = props.initialTab
  colorColumnsInput.value = String(props.colorColumns)
  gradientRowsInput.value = String(props.gradientRows)
  localColorGroups.value = cloneColorPaletteGroups(props.colorPaletteGroups)
  localGradientPresets.value = cloneGradientPresets(props.gradientPresets)
}

// 将列数限制在合理范围内，避免输入过大或非数字时把属性面板色板排版撑坏。
function normalizeColorColumns(value: unknown, fallback = props.defaultColorColumns) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_COLOR_PALETTE_COLUMNS, Math.max(MIN_COLOR_PALETTE_COLUMNS, parsed))
}

// 将展示行数限制为正整数，既兼容手输输入，也保证右侧渐变列表始终可预期。
function normalizeGradientRows(value: unknown, fallback = props.defaultGradientRows) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_GRADIENT_PRESET_ROWS, Math.max(MIN_GRADIENT_PRESET_ROWS, parsed))
}

// 点击保存前统一收敛本地草稿，过滤空名称并把 stop id 剥离成运行时真正需要的结构。
function buildSubmitPayload(): StylePresetSettings {
  const colorColumns = normalizeColorColumns(colorColumnsInput.value)
  const gradientPresetRows = normalizeGradientRows(gradientRowsInput.value)
  return {
    colorColumns,
    gradientPresetRows,
    colorPaletteGroups: localColorGroups.value.map((group, groupIndex) => ({
      id: group.id || createLocalId('palette-group'),
      name: group.name.trim() || `分类 ${groupIndex + 1}`,
      colors: group.colors
        .map((color, colorIndex) => ({
          id: color.id || createLocalId('color-swatch'),
          name: String(color.name || '').trim() || `颜色 ${colorIndex + 1}`,
          color: String(color.color || '').trim()
        }))
        .filter((color) => !!color.color)
    })),
    gradientPresets: localGradientPresets.value.map((preset, presetIndex) => ({
      id: preset.id || createLocalId('gradient-preset'),
      name: String(preset.name || '').trim() || `渐变 ${presetIndex + 1}`,
      type: preset.type === 'radial' ? 'radial' : 'linear',
      angle: Number(preset.angle ?? DEFAULT_FILL_GRADIENT_ANGLE),
      centerX: Number(preset.centerX ?? DEFAULT_FILL_GRADIENT_CENTER),
      centerY: Number(preset.centerY ?? DEFAULT_FILL_GRADIENT_CENTER),
      radius: Number(preset.radius ?? DEFAULT_FILL_GRADIENT_RADIUS),
      userCreated: preset.userCreated === true,
      stops: preset.stops
        .map((stop) => ({
          color: String(stop.color || '').trim(),
          offset: Math.min(1, Math.max(0, Number(stop.offset ?? 0)))
        }))
        .filter((stop) => !!stop.color)
    }))
  }
}

// 根据当前面板状态收录一个颜色到指定分类；没有颜色时直接忽略，避免插入无效空条目。
function addCurrentColorToGroup(groupId: string, channel: 'fill' | 'stroke') {
  const group = localColorGroups.value.find((item) => item.id === groupId)
  const sourceColor = channel === 'fill' ? props.currentFillColor : props.currentStrokeColor
  if (!group || !sourceColor) return
  group.colors.unshift({
    id: createLocalId('color-swatch'),
    name: `${channel === 'fill' ? '填充色' : '描边色'} ${group.colors.length + 1}`,
    color: sourceColor
  })
}

// 为分类追加一条可手工编辑的空白颜色，便于没有选中对象时也能先搭好配色结构。
function addEmptyColorToGroup(groupId: string) {
  const group = localColorGroups.value.find((item) => item.id === groupId)
  if (!group) return
  group.colors.push({
    id: createLocalId('color-swatch'),
    name: `颜色 ${group.colors.length + 1}`,
    color: '#2563eb'
  })
}

// 新增分类时自动给出默认标题，减少第一次管理色板时的命名成本；
// 渲染完成后滚动到新卡片位置，分类较多时新分类不再藏在滚动区域外。
async function addColorGroup() {
  const newGroup = {
    id: createLocalId('palette-group'),
    name: `分类 ${localColorGroups.value.length + 1}`,
    colors: []
  }
  localColorGroups.value.push(newGroup)
  await nextTick()
  const target = managerContentRef.value?.querySelector(`[data-group-id="${newGroup.id}"]`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// 删除分类仅影响弹窗内草稿；用户点击取消即可恢复，不需要额外改动已保存状态。
function removeColorGroup(groupId: string) {
  localColorGroups.value = localColorGroups.value.filter((group) => group.id !== groupId)
}

// 删除单个颜色条目，便于在调整分类内容时快速清理无用配色。
function removeColorSwatch(groupId: string, swatchId: string) {
  const group = localColorGroups.value.find((item) => item.id === groupId)
  if (!group) return
  group.colors = group.colors.filter((color) => color.id !== swatchId)
}

// 新增渐变时预置两端色标和线性角度，确保卡片创建后立刻就能看到有效预览。
function addEmptyGradientPreset() {
  localGradientPresets.value.unshift({
    id: createLocalId('gradient-preset'),
    name: `渐变 ${localGradientPresets.value.length + 1}`,
    type: 'linear',
    angle: 45,
    centerX: DEFAULT_FILL_GRADIENT_CENTER,
    centerY: DEFAULT_FILL_GRADIENT_CENTER,
    radius: DEFAULT_FILL_GRADIENT_RADIUS,
    userCreated: true,
    stops: [
      { id: createLocalId('gradient-stop'), color: '#22d3ee', offset: 0 },
      { id: createLocalId('gradient-stop'), color: '#2563eb', offset: 1 }
    ]
  })
}

// 将当前对象的渐变快照转换为本地草稿，方便从画布样式快速沉淀为可复用预设。
function addCurrentGradientPreset() {
  if (!props.currentGradientPreset) return
  localGradientPresets.value.unshift({
    ...props.currentGradientPreset,
    id: createLocalId('gradient-preset'),
    name: props.currentGradientPreset.name || `渐变 ${localGradientPresets.value.length + 1}`,
    userCreated: true,
    stops: props.currentGradientPreset.stops.map((stop) => ({
      id: createLocalId('gradient-stop'),
      color: stop.color,
      offset: stop.offset
    }))
  })
}

// 切换渐变类型时补齐对应参数，避免线性和径向字段切换后出现空值预览。
function setGradientType(presetId: string, type: 'linear' | 'radial') {
  const preset = localGradientPresets.value.find((item) => item.id === presetId)
  if (!preset) return
  preset.type = type
  if (type === 'linear') {
    preset.angle = Number.isFinite(Number(preset.angle)) ? Number(preset.angle) : DEFAULT_FILL_GRADIENT_ANGLE
    return
  }
  preset.centerX = Number.isFinite(Number(preset.centerX)) ? Number(preset.centerX) : DEFAULT_FILL_GRADIENT_CENTER
  preset.centerY = Number.isFinite(Number(preset.centerY)) ? Number(preset.centerY) : DEFAULT_FILL_GRADIENT_CENTER
  preset.radius = Number.isFinite(Number(preset.radius)) ? Number(preset.radius) : DEFAULT_FILL_GRADIENT_RADIUS
}

// 允许继续往预设里追加色标，后续通过位置输入框即可完成 stop 细调。
function addGradientStop(presetId: string) {
  const preset = localGradientPresets.value.find((item) => item.id === presetId)
  if (!preset) return
  const nextOffset = preset.stops.length <= 1 ? 1 : Math.min(1, Math.max(0, preset.stops[preset.stops.length - 1].offset))
  preset.stops.push({
    id: createLocalId('gradient-stop'),
    color: '#ffffff',
    offset: nextOffset
  })
}

// 保留至少两个色标，避免用户误删后生成无法预览或应用的无效渐变结构。
function removeGradientStop(presetId: string, stopId: string) {
  const preset = localGradientPresets.value.find((item) => item.id === presetId)
  if (!preset || preset.stops.length <= 2) return
  preset.stops = preset.stops.filter((stop) => stop.id !== stopId)
}

// 用百分比输入更新 stop offset，并在本地立即限制到 0-100 范围内。
function updateGradientStopOffset(presetId: string, stopIndex: number, eventOrValue: string | number) {
  const preset = localGradientPresets.value.find((item) => item.id === presetId)
  if (!preset) return
  const value = typeof eventOrValue === 'number' ? eventOrValue : Number(eventOrValue)
  const normalized = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : Math.round(preset.stops[stopIndex]?.offset ?? 0)
  if (!preset.stops[stopIndex]) return
  preset.stops[stopIndex].offset = normalized / 100
}

// 统一更新线性角度和径向参数，避免模板里分散写多套数值清洗逻辑。
function updateGradientNumberField(presetId: string, field: 'angle' | 'centerX' | 'centerY' | 'radius', eventOrValue: string | number) {
  const preset = localGradientPresets.value.find((item) => item.id === presetId)
  if (!preset) return
  const value = typeof eventOrValue === 'number' ? eventOrValue : Number(eventOrValue)
  if (!Number.isFinite(value)) return
  if (field === 'angle') {
    const normalized = value % 360
    preset.angle = normalized < 0 ? normalized + 360 : normalized
    return
  }
  if (field === 'radius') {
    preset.radius = Math.min(2, Math.max(0.05, value))
    return
  }
  preset[field] = Math.min(1, Math.max(0, value))
}

// 删除整个渐变预设，排序和展示条数会在保存时一起重新整理生效。
function removeGradientPreset(presetId: string) {
  localGradientPresets.value = localGradientPresets.value.filter((preset) => preset.id !== presetId)
}

// 色板重置回编辑器内置分组，方便用户从混乱的自定义分类快速回到稳定基线。
function resetColorsToDefault() {
  const confirmed = window.confirm('确定将色板恢复为系统默认分类和颜色吗？未保存的弹窗修改会被覆盖。')
  if (!confirmed) return
  localColorGroups.value = cloneColorPaletteGroups(props.defaultColorPaletteGroups)
  colorColumnsInput.value = String(props.defaultColorColumns)
}

// 渐变重置回系统基线，同时恢复默认展示行数，保证右侧面板和管理弹窗回到一致状态。
function resetGradientsToDefault() {
  const confirmed = window.confirm('确定将渐变预设恢复为系统默认列表吗？未保存的弹窗修改会被覆盖。')
  if (!confirmed) return
  localGradientPresets.value = cloneGradientPresets(props.defaultGradientPresets)
  gradientRowsInput.value = String(props.defaultGradientRows)
}

// 列数输入在失焦或回车时统一纠正格式，避免保留非法字符串影响下次打开弹窗。
function commitColorColumnsInput() {
  colorColumnsInput.value = String(normalizeColorColumns(colorColumnsInput.value))
}

// 展示行数输入同样做提交时纠正，保证右侧只会收到受控的正整数配置。
function commitGradientRowsInput() {
  gradientRowsInput.value = String(normalizeGradientRows(gradientRowsInput.value))
}

// 发送前先把本地输入收敛成正式结构，让父层只处理最终可持久化的配置对象。
function emitConfirm() {
  commitColorColumnsInput()
  commitGradientRowsInput()
  emit('confirm', buildSubmitPayload())
}

// 复用属性面板里的预览算法，把编辑中的渐变草稿即时转成 CSS 背景便于比对效果。
function getGradientPresetStyle(preset: GradientPresetItem | EditableGradientPreset) {
  const stops = [...preset.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
    .join(', ')
  if (preset.type === 'radial') {
    const x = Math.round((Number(preset.centerX) || DEFAULT_FILL_GRADIENT_CENTER) * 100)
    const y = Math.round((Number(preset.centerY) || DEFAULT_FILL_GRADIENT_CENTER) * 100)
    return { background: `radial-gradient(circle at ${x}% ${y}%, ${stops})` }
  }
  const angle = Number.isFinite(Number(preset.angle)) ? Number(preset.angle) : DEFAULT_FILL_GRADIENT_ANGLE
  return { background: `linear-gradient(${(angle + 90) % 360}deg, ${stops})` }
}

watch(
  () => props.show,
  (show) => {
    if (show) resetLocalState()
  },
  { immediate: true }
)

watch(
  () => props.initialTab,
  (tab) => {
    if (props.show) activeTab.value = tab
  }
)

const show = computed(() => props.show)
const currentFillColor = computed(() => props.currentFillColor)
const currentStrokeColor = computed(() => props.currentStrokeColor)
const currentGradientPreset = computed(() => props.currentGradientPreset)
</script>

<style lang="scss" scoped>
.style-preset-manager-dialog {
  width: min(820px, 94vw);
  min-width: 320px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--control-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dialog-bg, #fff);
}
.style-preset-manager-header {
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
}
.style-preset-manager-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color, #333);
}
.style-preset-manager-tabs {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.style-preset-manager-tab,
.toggle-btn {
  padding: 5px 10px;
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 999px;
  background: #fff;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;

  &:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  &.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 10%, #fff);
  }
}
.style-preset-manager-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px;
  background: #fafafa;
}
.style-preset-manager-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--divider-color, rgba(128, 128, 128, 0.18));
  background: #fff;
}
.manager-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.manager-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;

  &.compact {
    justify-content: center;
  }
}
.manager-inline-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #4b5563;

  :deep(.zt-input) {
    width: 100%;
  }
}
.manager-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 132px;
  margin-top: 14px;
  padding: 16px;
  border: 1px dashed rgba(128, 128, 128, 0.24);
  border-radius: 10px;
  background: #fff;
  color: #6b7280;
  text-align: center;

  &.nested {
    min-height: 84px;
    margin-top: 10px;
  }
}
.color-group-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}
.gradient-card-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 14px;
}
.color-group-card,
.gradient-card {
  padding: 12px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 10px;
  background: #fff;
}
.gradient-card {
  display: flex;
  flex: 1 1 330px;
  flex-direction: column;
  min-width: 330px;
  max-width: 450px;
}
.color-group-head,
.gradient-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gradient-card-type-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}
.color-group-head {
  flex-wrap: wrap;
}
.color-group-head :deep(.zt-input),
.gradient-card-head :deep(.zt-input) {
  flex: 1;
  min-width: 160px;
}
.color-group-actions,
.gradient-type-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.drag-handle,
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 6px;
  background: #fff;
  color: #666;
  cursor: pointer;
}
.drag-handle {
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
}
.icon-btn.danger {
  color: #c2410c;
}
.color-row-list,
.gradient-stop-list {
  margin-top: 10px;
}
.color-draggable-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gradient-stop-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.color-row,
.gradient-stop-row {
  display: grid;
  align-items: center;
  gap: 8px;
}
.color-row {
  grid-template-columns: 28px auto minmax(0, 1fr) 40px 28px;
}
.gradient-stop-row {
  grid-template-columns: auto 1fr auto;
}
.color-row :deep(.zt-input) {
  min-width: 0;
}
.color-preview-chip {
  width: 40px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  background: var(--preview-color, #fff);
}
.stop-offset-field {
  justify-content: flex-end;
}
.gradient-stop-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.number-input {
  width: 84px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(128, 128, 128, 0.22);
  border-radius: 6px;
  font-size: 12px;
  color: #333;
  outline: none;
  background: #fff;

  &:focus {
    border-color: var(--primary-color);
  }
}
.gradient-card-preview {
  flex: 0 0 42px;
  width: 42px;
  height: 28px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.gradient-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.gradient-card-actions {
  display: flex;
  justify-content: flex-end;
}
.angle-control-row {
  display: flex;
  align-items: center;
  gap: 10px;

  .param-label {
    flex-shrink: 0;
    font-size: 12px;
    color: #4b5563;
  }

  :deep(.slider-wrapper) {
    flex: 1;
    min-width: 0;
  }

  :deep(.zt-input) {
    width: 84px;
    flex-shrink: 0;
  }
}
.gradient-param-row {
  flex-wrap: nowrap;
}
.gradient-radial-fields {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;

  .manager-inline-field {
    flex: 1;
    min-width: 0;
    gap: 6px;

    > span {
      flex-shrink: 0;
      white-space: nowrap;
      min-width: 36px;
      text-align: justify;
      text-align-last: justify;
    }

    :deep(.zt-input) {
      width: 100%;
    }
  }
}
:global(.zt-modal:has(.style-preset-manager-dialog) .zt-modal__body) {
  padding: 0;
  border-radius: 10px;
}
</style>
