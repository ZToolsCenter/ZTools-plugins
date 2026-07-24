<script setup lang="ts">
/**
 * 规则选择面板组件。
 * @description 显示可用的重命名规则插件列表，支持点击选择并添加到工作流
 * @see registry 插件注册表的实现
 */
import { useI18n } from 'vue-i18n'
import { registry } from '@/core/registry'
import { 
  Type, 
  Replace, 
  PlusCircle, 
  Hash, 
  Calendar, 
  CaseSensitive,
  FileCode,
  Zap,
  X
} from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'
import { FRTooltip } from '@/components/ui'

const { t, te } = useI18n()

withDefaults(defineProps<{
  hideTitle?: boolean
}>(), {
  hideTitle: false,
})

const emit = defineEmits<{
  (e: 'select', pluginId: string): void
  (e: 'close'): void
}>()

// 插件图标映射
const iconMap: Record<string, any> = {
  'replace': Replace,
  'add-prefix-suffix': PlusCircle,
  'sequence': Hash,
  'timestamp': Calendar,
  'case-transform': CaseSensitive,
  'template': FileCode,
  'clean-name': Replace,
  'extension-transform': Type,
  'uniqueify': Hash,
}

const panelRef = ref<HTMLElement | null>(null)

// 点击外部关闭
function handleClickOutside(event: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

onMounted(() => {
  // 延迟添加监听器，防止触发当前点击
  setTimeout(() => {
    window.addEventListener('mousedown', handleClickOutside)
  }, 0)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', handleClickOutside)
})

function handleSelect(pluginId: string) {
  emit('select', pluginId)
  emit('close')
}

function getPluginName(plugin: { id: string; name: string }) {
  const key = `plugins.${plugin.id}.name`
  return te(key) ? t(key) : plugin.name
}

function getPluginDescription(plugin: { id: string; description: string }) {
  const key = `plugins.${plugin.id}.description`
  return te(key) ? t(key) : plugin.description
}

function getPluginTooltip(plugin: { id: string; name: string; description: string }) {
  const name = getPluginName(plugin)
  const detail = (getPluginDescription(plugin) || '').trim()
  return detail ? `${name} - ${detail}` : name
}
</script>

<template>
  <div 
    ref="panelRef"
    class="absolute bottom-full left-2 right-2 mb-2 bg-background/98 backdrop-blur-3xl border border-primary/20 shadow-[0_20px_50px_rgba(0,0,0,0.4)] rounded-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 ring-1 ring-black/10"
  >
    <!-- Header -->
    <div class="px-3 py-2 border-b border-primary/10 flex items-center justify-between bg-primary/3">
      <div class="flex items-center gap-2">
        <Zap class="w-3 h-3 text-primary fill-primary/20" />
        <span v-if="!hideTitle" class="text-[10px] font-bold uppercase tracking-widest text-primary/80">{{ t('workflow.add_rule') }}</span>
      </div>
      <FRTooltip :content="t('common.close')">
        <button @click="$emit('close')" class="p-1 hover:bg-primary/10 rounded-lg transition-colors group">
          <X class="w-3 h-3 text-muted-foreground group-hover:text-primary" />
        </button>
      </FRTooltip>
    </div>

    <!-- Rules List -->
    <div class="max-h-[280px] overflow-y-auto p-1.5 space-y-1 scrollbar-hide">
      <div 
        v-for="plugin in registry.getAll()" 
        :key="plugin.id"
        :class="[
          'group flex rounded-xl border border-transparent hover:border-primary/20 hover:bg-primary/[0.04] transition-all duration-200 cursor-pointer active:scale-[0.97]',
          hideTitle ? 'items-center justify-center p-2' : 'items-center gap-3 p-2',
        ]"
        @click="handleSelect(plugin.id)"
      >
        <FRTooltip :content="getPluginTooltip(plugin)" :side="hideTitle ? 'right' : 'top'" :content-class="hideTitle ? 'max-w-[260px]' : ''">
          <div class="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 shrink-0 shadow-sm">
            <component :is="iconMap[plugin.id] || Type" class="w-3.5 h-3.5" />
          </div>
        </FRTooltip>
        <div v-if="!hideTitle" class="flex-1 min-w-0">
          <h4 class="text-xs font-bold truncate group-hover:text-primary transition-colors leading-tight mb-0.5">
            {{ getPluginName(plugin) }}
          </h4>
          <p class="text-[10px] text-muted-foreground line-clamp-1 opacity-80 font-medium">
            {{ getPluginDescription(plugin) }}
          </p>
        </div>
      </div>
    </div>
    
    <!-- Footer Decor -->
    <div class="p-1.5 bg-muted/30 flex justify-center">
      <div class="w-8 h-1 rounded-full bg-primary/20"></div>
    </div>
  </div>
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
