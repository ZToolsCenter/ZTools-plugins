<template>
  <div class="fixed bottom-4 right-4 z-50 w-80 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-4 transition-all duration-300">
    <div class="flex items-center justify-between mb-2">
      <h3 class="font-medium text-slate-900 dark:text-slate-100">{{ t('update.downloading') }}</h3>
      <div class="flex items-center gap-2">
        <button 
          @click="$emit('background')" 
          class="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
          :title="t('update.background')"
        >
          <div class="i-mdi-minus" />
        </button>
        <button 
          @click="$emit('cancel')"
          class="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 cursor-pointer"
          :title="t('update.cancel')"
        >
          <div class="i-mdi-close" />
        </button>
      </div>
    </div>
    
    <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mb-1">
      <div class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" :style="{ width: `${percentage}%` }"></div>
    </div>
    <div class="text-right text-xs text-slate-500 dark:text-slate-400">{{ percentage }}%</div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  percentage: number
}>();

defineEmits<{
  (e: 'cancel'): void
  (e: 'background'): void
}>();

const { t } = useI18n();
</script>
