<script setup lang="ts">
/**
 * 工作流侧边栏组件。
 * @description 展示和管理文件重命名规则（动作）的容器，支持规则的添加、删除和拖拽排序
 * @see ActionCard 单个规则卡片的实现
 * @see RulePickerPanel 规则选择面板的实现
 */
import { useI18n } from 'vue-i18n'
import { registry } from '@/core/registry'
import type { ActionInstance } from '@/core/types'
import ActionCard from './ActionCard.vue'
import { FRButton, FRTooltip } from '@/components/ui'
import { Plus, Settings2, PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import RulePickerPanel from './RulePickerPanel.vue'
import { ref } from 'vue'

const { t } = useI18n()

const props = defineProps<{
  workflow: ActionInstance[]
  lineStyle: 'solid' | 'dashed' | 'none'
  isCollapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'add-action', pluginId: string): void
  (e: 'remove-action', index: number): void
  (e: 'move-action', payload: { from: number; to: number }): void
  (e: 'toggle-collapse'): void
}>()

/** 是否显示规则选择面板 */
const showRulePicker = ref(false)
/** 当前正在拖拽的规则索引 */
const draggingIndex = ref<number | null>(null)
/** 拖拽目标位置的索引 */
const dropTargetIndex = ref<number | null>(null)
/** 拖拽位置相对于目标元素的方向 */
const dropPosition = ref<'before' | 'after'>('before')

/**
 * 重置拖拽状态。
 * 将拖拽相关状态重置为初始值
 */
function resetDragState() {
  draggingIndex.value = null
  dropTargetIndex.value = null
  dropPosition.value = 'before'
}

/**
 * 拖拽开始事件处理。
 * @param index - 拖拽元素的索引
 * @param event - 拖拽事件对象
 * @description 初始化拖拽状态，设置数据传输效果
 */
function onDragStart(index: number, event: DragEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, button, [role="button"], [role="combobox"], [data-radix-select-trigger]')) {
    event.preventDefault()
    return
  }

  draggingIndex.value = index
  dropTargetIndex.value = index

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

/**
 * 拖拽经过事件处理。
 * @param index - 经过的元素索引
 * @param event - 拖拽事件对象
 * @description 计算拖拽位置是before还是after，确定插入点
 */
function onDragOver(index: number, event: DragEvent) {
  event.preventDefault()

  if (draggingIndex.value === null) return
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }

  const currentTarget = event.currentTarget as HTMLElement | null
  if (currentTarget) {
    const rect = currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    dropPosition.value = offsetY < rect.height / 2 ? 'before' : 'after'
  }

  dropTargetIndex.value = index
}

/**
 * 拖拽放下事件处理。
 * @param index - 放下位置的索引
 * @param event - 拖拽事件对象
 * @description 触发move-action事件，重新排序规则
 */
function onDrop(index: number, event: DragEvent) {
  event.preventDefault()

  const from = draggingIndex.value
  if (from === null) {
    resetDragState()
    return
  }

  const targetIndex = dropPosition.value === 'after' ? index + 1 : index
  emit('move-action', { from, to: targetIndex })

  resetDragState()
}

/**
 * 拖拽结束事件处理。
 * @description 清理拖拽状态
 */
function onDragEnd() {
  resetDragState()
}
</script>

<template>
  <aside 
    :class="cn(
      'flex flex-col border-r bg-background/50 backdrop-blur-xl h-full shadow-2xl relative z-10 transition-all duration-300',
      isCollapsed ? 'w-20' : 'w-[280px]'
    )"
  >
    <!-- Header -->
    <div :class="cn('p-4 border-b flex items-center bg-background/80 transition-all', isCollapsed ? 'justify-center' : 'justify-between')">
      <div v-if="!isCollapsed" class="flex items-center gap-2 overflow-hidden">
        <div class="p-1.5 bg-primary rounded-lg text-primary-foreground shadow-lg shadow-primary/20 shrink-0">
          <Settings2 class="w-4 h-4" />
        </div>
        <h2 class="text-sm font-black tracking-tight truncate">{{ t('app.workflow') }}</h2>
      </div>
      
      <FRTooltip :content="isCollapsed ? t('workflow.expand') : t('workflow.collapse')">
        <FRButton 
          variant="ghost" 
          size="icon" 
          class="h-8 w-8 text-muted-foreground transition-transform" 
          @click="$emit('toggle-collapse')"
        >
          <PanelLeftClose v-if="!isCollapsed" class="w-4 h-4" />
          <PanelLeftOpen v-else class="w-4 h-4" />
        </FRButton>
      </FRTooltip>
    </div>

    <!-- Workflow List -->
    <div class="flex-1 overflow-y-auto p-4 scrollbar-hide space-y-2">
      <div v-if="workflow.length === 0 && !isCollapsed" class="flex flex-col items-center justify-center py-10 text-muted-foreground opacity-50">
        <Plus class="w-6 h-6 mb-2" />
        <p class="text-[10px] font-medium">{{ t('app.no_rules') }}</p>
      </div>
      
      <div id="onboarding-workflow-list" class="flex flex-col items-center gap-1 w-full">
        <div
          v-for="(action, index) in workflow"
          :key="action.instanceId"
          :class="cn(
            'w-full rounded-xl transition-all duration-150 cursor-grab active:cursor-grabbing relative',
            draggingIndex === index && 'opacity-65 scale-[0.985]',
            dropTargetIndex === index && draggingIndex !== null && draggingIndex !== index && 'ring-2 ring-primary/45 ring-offset-2 ring-offset-background bg-primary/5'
          )"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver(index, $event)"
          @drop="onDrop(index, $event)"
          @dragend="onDragEnd"
        >
          <div
            v-if="dropTargetIndex === index && draggingIndex !== null && draggingIndex !== index"
            :class="cn(
              'absolute left-3 right-3 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_22%,transparent)]',
              dropPosition === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'
            )"
          />
          <ActionCard
            :action="action"
            :index="index"
            :total="workflow.length"
            :line-style="lineStyle"
            :is-collapsed="isCollapsed"
            @remove="$emit('remove-action', $event)"
          />
        </div>
      </div>
    </div>

    <!-- Add Action Button -->
    <div class="p-4 border-t bg-background/80 relative">
      <RulePickerPanel 
        v-if="showRulePicker"
        :hide-title="isCollapsed"
        @select="$emit('add-action', $event)"
        @close="showRulePicker = false"
      />
      
      <FRButton 
        id="onboarding-add-rule-btn"
        v-if="!isCollapsed"
        variant="outline"
        class="w-full justify-center gap-2 h-10 rounded-xl border-dashed border-primary/30 hover:border-primary hover:bg-primary/5 text-primary transition-all active:scale-95 group"
        @click="showRulePicker = !showRulePicker"
      >
        <Plus :class="cn('w-4 h-4 transition-transform duration-300', showRulePicker && 'rotate-45')" />
        <span class="text-xs font-black uppercase tracking-tight">{{ t('workflow.add_rule') }}</span>
      </FRButton>
      <div v-else class="flex justify-center">
         <FRTooltip :content="t('workflow.add_rule')" side="right" content-class="whitespace-nowrap">
           <FRButton 
            id="onboarding-add-rule-btn"
            variant="outline"
            size="icon"
            class="h-10 w-10 border-dashed border-primary/30 hover:border-primary text-primary rounded-xl"
            @click="showRulePicker = !showRulePicker"
          >
             <Plus :class="cn('w-5 h-5 transition-transform duration-300', showRulePicker && 'rotate-45')" />
           </FRButton>
         </FRTooltip>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
