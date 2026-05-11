<script setup lang="ts">
/**
 * 差异对比工作台组件
 * 应用程序的主布局组件，提供模式切换、主题管理和设置面板功能
 */

import { ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsPanel from '@/components/layout/SettingsPanel.vue'
import ZTooltip from '@/components/ui/ZTooltip.vue'
import ZButton from '@/components/ui/ZButton.vue'
import ZIcon from '@/components/ui/ZIcon.vue'
import { useTheme } from '@/composables/useTheme'

/**
 * 组件属性
 */
const props = defineProps<{
    /** 初始对比模式 */
    initialMode?: string
}>()

const { locale, t } = useI18n()
/** 当前激活的对比模式 */
const activeMode = ref(props.initialMode || 'text')

/**
 * 监听初始模式变化，自动更新当前模式
 */
watchEffect(() => {
    activeMode.value = props.initialMode || 'text'
})

const { themeMode, cycleTheme } = useTheme()
/** 是否显示设置面板 */
const showSettings = ref(false)
</script>

<template>
    <div
        class="workbench-container h-screen overflow-hidden bg-[var(--color-background)] text-[var(--color-text)] flex flex-col transition-colors duration-300">

        <!-- Top Navigation Bar -->
        <header class="relative flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">

            <!-- Left: empty balancer -->
            <div class="w-20"></div>

            <!-- Center: mode tabs -->
            <div
                class="flex gap-1.5 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-sm">
                <ZButton variant="ghost" size="sm" :active="activeMode === 'text'" @click="activeMode = 'text'">
                    <template #icon-left>
                        <ZIcon name="text" :size="15" />
                    </template>
                    {{ t('textMode') }}
                </ZButton>
                <ZButton variant="ghost" size="sm" :active="activeMode === 'image'" @click="activeMode = 'image'">
                    <template #icon-left>
                        <ZIcon name="image" :size="15" />
                    </template>
                    {{ t('imageMode') }}
                </ZButton>
                <ZButton variant="ghost" size="sm" :active="activeMode === 'excel'" @click="activeMode = 'excel'">
                    <template #icon-left>
                        <ZIcon name="excel" :size="15" />
                    </template>
                    {{ t('excelMode') }}
                </ZButton>
                <ZButton variant="ghost" size="sm" :active="activeMode === 'word'" @click="activeMode = 'word'">
                    <template #icon-left>
                        <ZIcon name="word" :size="15" />
                    </template>
                    {{ t('wordMode') }}
                </ZButton>
                <ZButton variant="ghost" size="sm" :active="activeMode === 'pdf'" @click="activeMode = 'pdf'">
                    <template #icon-left>
                        <ZIcon name="pdf" :size="15" />
                    </template>
                    {{ t('pdfMode') }}
                </ZButton>
            </div>

            <!-- Right: icon buttons -->
            <div class="flex items-center gap-1.5 w-24 justify-end">
                <!-- Theme toggle: system -> light -> dark -->
                <ZTooltip position="bottom"
                    :content="themeMode === 'system' ? t('themeSystem') : themeMode === 'light' ? t('themeLight') : t('themeDark')">
                    <ZButton variant="surface" size="md" @click="cycleTheme" class="!w-10 !h-10 !p-0">
                        <ZIcon v-if="themeMode === 'system'" name="monitor" :size="18" />
                        <ZIcon v-else-if="themeMode === 'light'" name="sun" :size="18" />
                        <ZIcon v-else name="moon" :size="18" />
                    </ZButton>
                </ZTooltip>
                <!-- Settings -->
                <ZTooltip position="bottom" :content="t('settings')">
                    <ZButton variant="surface" size="md" @click="showSettings = true" class="!w-10 !h-10 !p-0">
                        <ZIcon name="settings" :size="18" />
                    </ZButton>
                </ZTooltip>
            </div>
        </header>

        <!-- Main Content Area -->
        <main class="flex-1 p-5 flex flex-col overflow-hidden min-h-0">
            <!-- flex-1 wrapper lets slot children (TextDiffView/ImageDiffView) fill full height -->
            <div class="flex-1 min-h-0 flex flex-col">
                <slot :name="activeMode"></slot>
            </div>
            <div v-if="!$slots[activeMode]"
                class="flex-1 flex items-center justify-center text-[var(--color-secondary)] opacity-60">
                <span class="font-mono text-sm">{{ t('wip') }}</span>
            </div>
        </main>

        <!-- Settings Panel (slide-in from right) -->
        <SettingsPanel v-if="showSettings" @close="showSettings = false" />
    </div>
</template>

<style scoped lang="scss"></style>