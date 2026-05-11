<script setup lang="ts">
/**
 * 规则卡片组件。
 * @description 显示单个重命名规则的配置界面，支持动态表单生成和配置修改
 * @see registry 插件注册表，获取配置schema
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ActionInstance } from '@/core/types'
import { registry } from '@/core/registry'
import {
  FRButton,
  FRTooltip,
  FRInput,
  FRSelect,
  FRSelectTrigger,
  FRSelectValue,
  FRSelectContent,
  FRSelectItem
} from '@/components/ui'
import { X, ArrowDown } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  action: ActionInstance
  index: number
  total: number
  lineStyle?: 'solid' | 'dashed' | 'none'
  isCollapsed?: boolean
}>()

const emit = defineEmits<{
  (e: 'remove', index: number): void
}>()

const plugin = computed(() => registry.get(props.action.pluginId))

const { t, te } = useI18n()

function getPluginName(pluginLike: { id?: string; name?: string } | undefined) {
  const pluginId = pluginLike?.id ?? props.action.pluginId
  const fallback = pluginLike?.name ?? ''
  const key = `plugins.${pluginId}.name`
  return te(key) ? t(key) : fallback
}

function getPluginDescription(pluginLike: { id?: string; description?: string } | undefined) {
  const pluginId = pluginLike?.id ?? props.action.pluginId
  const fallback = pluginLike?.description ?? ''
  const key = `plugins.${pluginId}.description`
  return te(key) ? t(key) : fallback
}

function getSchemaLabel(fieldKey: unknown, schema: any) {
  const key = `plugins.${props.action.pluginId}.fields.${String(fieldKey)}.label`
  return te(key) ? t(key) : (schema?.label ?? String(fieldKey))
}

function getSchemaDescription(fieldKey: unknown, schema: any) {
  const key = `plugins.${props.action.pluginId}.fields.${String(fieldKey)}.description`
  return te(key) ? t(key) : (schema?.description ?? '')
}

function getOptionLabel(fieldKey: unknown, option: any) {
  const optionValue = String(option?.value ?? '')
  const key = `plugins.${props.action.pluginId}.fields.${String(fieldKey)}.options.${optionValue}`
  return te(key) ? t(key) : (option?.label ?? optionValue)
}

const collapsedTooltipContent = computed(() => {
  const currentPlugin = plugin.value
  if (!currentPlugin) return ''
  const name = getPluginName(currentPlugin)
  const detail = (getPluginDescription(currentPlugin) || '').trim()
  return detail ? `${name} - ${detail}` : name
})

const showConnector = computed(() => props.index < props.total - 1)
const templateTokens = ['[NAME]', '[EXT]', '[INDEX]', '[YYYY]', '[MM]', '[DD]']

function isTemplateField(fieldKey: unknown): boolean {
  return props.action.pluginId === 'template' && String(fieldKey) === 'template'
}

const DELETE_CHAR_MODE_DEPENDENCIES: Record<string, string[]> = {
  chars: ['mode', 'chars', 'caseSensitive', 'protectExtension'],
  type: ['mode', 'type', 'protectExtension'],
  position: ['mode', 'position', 'count', 'protectExtension'],
  dedupe: ['mode', 'style', 'targetChar', 'protectExtension']
}

function shouldShowField(fieldKey: string): boolean {
  if (props.action.pluginId !== 'delete-char') return true
  const currentMode = props.action.config?.mode ?? 'chars'
  const deps = DELETE_CHAR_MODE_DEPENDENCIES[currentMode]
  if (!deps) return true
  if (!deps.includes(fieldKey)) return false

  if (fieldKey === 'count' && currentMode === 'position') {
    const position = props.action.config?.position
    return position === 'firstN' || position === 'lastN' || position === 'nth'
  }
  return true
}

function appendTemplateToken(fieldKey: unknown, token: string) {
  const key = String(fieldKey)
  const currentValue = String(props.action.config[key] ?? '')
  props.action.config[key] = `${currentValue}${token}`
}

function getCountFieldLabel(position: string): string {
  if (position === 'nth') {
    const key = `plugins.${props.action.pluginId}.fields.count.options.nth`
    return te(key) ? t(key) : 'Position (1-indexed)'
  }
  return getSchemaLabel('count', plugin.value?.configSchema?.count)
}
</script>

<template>
  <div class="flex flex-col items-center w-full group">
    <!-- 卡片主体 -->
    <div :class="cn(
      'w-full bg-card border rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all relative z-10',
      isCollapsed ? 'p-0 h-10 flex items-center justify-center' : 'p-3 border-muted-foreground/10'
    )">
      <div v-if="isCollapsed" class="relative w-full h-full">
        <FRTooltip :content="collapsedTooltipContent" :disabled="!collapsedTooltipContent" side="right"
          trigger-class="w-full h-full" content-class="max-w-[260px]">
          <div class="w-full h-full flex items-center justify-center">
            <div
              class="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black border border-primary/20">
              {{ index + 1 }}
            </div>
          </div>
        </FRTooltip>
      </div>

      <template v-else>
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center gap-2">
            <div
              class="w-5 h-5 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold border border-primary/20">
              {{ index + 1 }}
            </div>
            <FRTooltip :content="getPluginName(plugin)" :disabled="!plugin">
              <h3 class="font-bold text-[11px] uppercase tracking-wider text-foreground truncate max-w-40">{{
                getPluginName(plugin) }}</h3>
            </FRTooltip>
          </div>
          <FRTooltip :content="t('workflow.remove_rule')">
            <FRButton variant="ghost" size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
              @click="$emit('remove', index)">
              <X class="w-3.5 h-3.5" />
            </FRButton>
          </FRTooltip>
        </div>

        <div class="space-y-3">
          <template v-for="(schema, key) in plugin?.configSchema" :key="key">
            <div v-if="shouldShowField(String(key))">
            <label class="text-[10px] font-bold text-muted-foreground uppercase mb-1 block px-1 tracking-wider">
              {{ String(key) === 'count' ? getCountFieldLabel(action.config.position) : getSchemaLabel(key, schema) }}
            </label>

            <FRInput v-if="schema.type === 'string' || schema.type === 'number'" v-model="action.config[key]"
              :type="schema.type"
              :min="schema.min"
              :max="schema.max"
              class="h-8 text-xs bg-muted/20 focus:bg-background border-muted-foreground/10 transition-colors" />

            <div v-if="schema.type === 'string' && isTemplateField(key)" class="mt-1.5 flex flex-wrap gap-1.5 px-1">
              <button v-for="token in templateTokens" :key="token" type="button"
                class="h-6 rounded-full border border-primary/25 bg-primary/8 px-2 text-[10px] font-semibold tracking-tight text-primary hover:bg-primary/15 hover:border-primary/35 active:scale-95 transition-all"
                @click="appendTemplateToken(key, token)">
                {{ token }}
              </button>
            </div>

            <FRSelect v-else-if="schema.type === 'select'" v-model="action.config[key]">
              <FRSelectTrigger class="h-8 text-xs bg-muted/20 border-muted-foreground/10">
                <FRSelectValue />
              </FRSelectTrigger>
              <FRSelectContent>
                <FRSelectItem v-for="opt in schema.options" :key="opt.value" :value="opt.value">
                  {{ getOptionLabel(key, opt) }}
                </FRSelectItem>
              </FRSelectContent>
            </FRSelect>

            <div v-else-if="schema.type === 'boolean'" class="flex items-center gap-2 px-1 ml-0.5 group/cb">
              <input type="checkbox" v-model="action.config[key]"
                class="w-3.5 h-3.5 rounded border-input accent-primary transition-all cursor-pointer" />
              <span class="text-xs font-semibold text-foreground/70 group-hover/cb:text-foreground transition-colors">{{
                getSchemaLabel(key, schema) }}</span>
            </div>
            
            <p v-if="getSchemaDescription(key, schema) && !isTemplateField(key)"
              class="mt-1 px-1 text-[10px] text-muted-foreground/85 leading-relaxed">
              {{ getSchemaDescription(key, schema) }}
            </p>
            </div>
          </template>
        </div>
      </template>
    </div>

    <!-- 底部连接线与箭头 -->
    <div v-if="showConnector"
      :class="cn('flex flex-col items-center relative w-px overflow-visible', isCollapsed ? 'py-1 h-4' : 'py-2 h-8')">
      <div :class="cn(
        'absolute top-0 bottom-0 w-0.5',
        lineStyle === 'dashed' ? 'border-l-2 border-dashed border-primary/20' : 'bg-primary/20'
      )"></div>
      <div v-if="!isCollapsed"
        class="absolute -bottom-1 bg-background z-20 p-0.5 rounded-full border border-primary/20 shadow-sm animate-bounce-slow">
        <ArrowDown class="w-2.5 h-2.5 text-primary fill-primary" />
      </div>
    </div>
    <div v-else :class="isCollapsed ? 'h-2' : 'h-4'"></div>
  </div>
</template>

<style scoped>
@keyframes bounce-slow {

  0%,
  100% {
    transform: translateY(-2px);
  }

  50% {
    transform: translateY(1px);
  }
}

.animate-bounce-slow {
  animation: bounce-slow 2s ease-in-out infinite;
}
</style>
