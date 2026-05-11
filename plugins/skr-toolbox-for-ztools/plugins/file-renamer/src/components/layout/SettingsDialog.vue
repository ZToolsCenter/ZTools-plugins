<script setup lang="ts">
/**
 * 设置对话框组件。
 * @description 应用全局设置配置界面，包括主题、品牌样式、语言和关于信息
 */
import { useI18n } from 'vue-i18n'
import { 
  FRDialog, 
  FRDialogContent, 
  FRDialogHeader, 
  FRDialogTitle,
  FRLabel,
  FRSelect,
  FRSelectTrigger,
  FRSelectValue,
  FRSelectContent,
  FRSelectItem,
  FRSeparator
} from '@/components/ui'
import { Info, Monitor, Moon, Sun, Languages, Cpu, Github, Palette } from 'lucide-vue-next'

const { t, locale } = useI18n()

defineProps<{
  open: boolean
  theme: string
  brandPreset: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:theme', value: string): void
  (e: 'update:brand-preset', value: string): void
}>()

const techStack = [
  {
    name: 'Vue',
    version: '3.5',
    icon: 'V',
    color: 'text-success',
    roleKey: 'settings.stack_role_core_runtime',
    descKey: 'settings.stack_desc_vue',
    pillClass: 'bg-success/12 text-success-foreground border-success/30'
  },
  {
    name: 'TypeScript',
    version: '5.x',
    icon: 'TS',
    color: 'text-info',
    roleKey: 'settings.stack_role_type_safety',
    descKey: 'settings.stack_desc_typescript',
    pillClass: 'bg-info/12 text-info-foreground border-info/30'
  },
  {
    name: 'Vite',
    version: '6.x',
    icon: 'Vt',
    color: 'text-primary',
    roleKey: 'settings.stack_role_build_tool',
    descKey: 'settings.stack_desc_vite',
    pillClass: 'bg-primary/12 text-primary border-primary/30'
  },
  {
    name: 'Tailwind CSS',
    version: '4.x',
    icon: 'Tw',
    color: 'text-info',
    roleKey: 'settings.stack_role_design_system',
    descKey: 'settings.stack_desc_tailwind',
    pillClass: 'bg-info/12 text-info-foreground border-info/30'
  },
  {
    name: 'Radix Vue',
    version: '1.9',
    icon: 'R',
    color: 'text-primary',
    roleKey: 'settings.stack_role_a11y',
    descKey: 'settings.stack_desc_radix',
    pillClass: 'bg-primary/12 text-primary border-primary/30'
  },
  {
    name: 'Vue I18n',
    version: '11.x',
    icon: 'I',
    color: 'text-warning',
    roleKey: 'settings.stack_role_localization',
    descKey: 'settings.stack_desc_i18n',
    pillClass: 'bg-warning/12 text-warning-foreground border-warning/30'
  },
  {
    name: 'Lucide Vue',
    version: '1.x',
    icon: 'L',
    color: 'text-warning',
    roleKey: 'settings.stack_role_iconography',
    descKey: 'settings.stack_desc_lucide',
    pillClass: 'bg-warning/12 text-warning-foreground border-warning/30'
  },
  {
    name: 'VueUse',
    version: '14.x',
    icon: 'U',
    color: 'text-success',
    roleKey: 'settings.stack_role_composables',
    descKey: 'settings.stack_desc_vueuse',
    pillClass: 'bg-success/12 text-success-foreground border-success/30'
  }
]
</script>

<template>
  <FRDialog :open="open" @update:open="$emit('update:open', $event)">
    <FRDialogContent class="w-[calc(100%-1.5rem)] sm:max-w-106.25 max-h-[92dvh] overflow-hidden p-0">
      <div class="flex h-full max-h-[92dvh] flex-col">
        <FRDialogHeader class="shrink-0 px-5 pt-5 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
          <FRDialogTitle class="flex items-center gap-2 pr-8">
            <Info class="w-5 h-5 text-primary" />
            {{ t('settings.title') }}
          </FRDialogTitle>
        </FRDialogHeader>

        <div class="settings-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
          <div class="space-y-6 py-1">
        <!-- About Section -->
        <div class="space-y-2">
          <h4 class="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Github class="w-3 h-3" /> {{ t('settings.about') }}
          </h4>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ t('settings.intro') }}
          </p>
        </div>

        <FRSeparator />

        <!-- Theme Setting -->
        <div class="space-y-3">
          <FRLabel class="flex items-center gap-2">
            <Monitor class="w-4 h-4 opacity-70" />
            {{ t('settings.theme') }}
          </FRLabel>
          <FRSelect :model-value="theme" @update:model-value="$emit('update:theme', $event)">
            <FRSelectTrigger>
              <FRSelectValue />
            </FRSelectTrigger>
            <FRSelectContent>
              <FRSelectItem value="system">
                <div class="flex items-center gap-2">
                  <Monitor class="w-4 h-4" /> {{ t('settings.theme_system') }}
                </div>
              </FRSelectItem>
              <FRSelectItem value="light">
                <div class="flex items-center gap-2">
                  <Sun class="w-4 h-4 text-warning" /> {{ t('settings.theme_light') }}
                </div>
              </FRSelectItem>
              <FRSelectItem value="dark">
                <div class="flex items-center gap-2">
                  <Moon class="w-4 h-4 text-info" /> {{ t('settings.theme_dark') }}
                </div>
              </FRSelectItem>
            </FRSelectContent>
          </FRSelect>
        </div>

        <!-- Brand Preset Setting -->
        <div class="space-y-3">
          <FRLabel class="flex items-center gap-2">
            <Palette class="w-4 h-4 opacity-70" />
            {{ t('settings.brand_style') }}
          </FRLabel>
          <FRSelect :model-value="brandPreset" @update:model-value="$emit('update:brand-preset', $event)">
            <FRSelectTrigger>
              <FRSelectValue />
            </FRSelectTrigger>
            <FRSelectContent>
              <FRSelectItem value="professional">{{ t('settings.brand_professional') }}</FRSelectItem>
              <FRSelectItem value="soft">{{ t('settings.brand_soft') }}</FRSelectItem>
              <FRSelectItem value="high-contrast">{{ t('settings.brand_high_contrast') }}</FRSelectItem>
            </FRSelectContent>
          </FRSelect>
          <p class="text-[11px] text-muted-foreground leading-relaxed">{{ t('settings.brand_desc') }}</p>
        </div>

        <!-- Language Setting -->
        <div class="space-y-3">
          <FRLabel class="flex items-center gap-2">
            <Languages class="w-4 h-4 opacity-70" />
            {{ t('settings.language') }}
          </FRLabel>
          <FRSelect :model-value="locale" @update:model-value="locale = $event">
            <FRSelectTrigger>
              <FRSelectValue />
            </FRSelectTrigger>
            <FRSelectContent>
              <FRSelectItem value="zh">简体中文</FRSelectItem>
              <FRSelectItem value="en">English</FRSelectItem>
            </FRSelectContent>
          </FRSelect>
        </div>

        <FRSeparator />

        <!-- Tech Stack -->
        <div class="space-y-3">
          <h4 class="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Cpu class="w-3 h-3" /> {{ t('settings.tech_stack') }}
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div
              v-for="tech in techStack"
              :key="tech.name"
              class="tech-card group relative overflow-hidden rounded-xl border border-border/70 bg-linear-to-br from-card/92 via-card/78 to-muted/36 p-2.5 shadow-sm shadow-primary/5"
            >
              <span class="tech-card-shine" aria-hidden="true" />
              <div class="tech-card-main">
                <span :class="['tech-card-icon font-black text-[10px] min-w-7 h-7 px-1.5 flex items-center justify-center rounded-md bg-background/85 ring-1 ring-border/70 shadow-sm', tech.color]">
                  {{ tech.icon }}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="tech-card-label text-[11px] font-semibold tracking-tight text-foreground/92">{{ tech.name }}</span>
                    <span class="tech-card-version rounded-full border border-border/70 bg-muted/65 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">{{ tech.version }}</span>
                  </div>
                  <p class="tech-card-desc mt-1 text-[10px] leading-snug text-muted-foreground/95">{{ t(tech.descKey) }}</p>
                </div>
              </div>
              <div class="tech-card-footer mt-2 flex items-center justify-between gap-2">
                <span :class="['inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide', tech.pillClass]">{{ t(tech.roleKey) }}</span>
                <span class="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
                  {{ t('settings.stack_stable') }}
                </span>
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>
    </FRDialogContent>
  </FRDialog>
</template>

<style scoped>
.tech-card {
  transition:
    transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 220ms ease,
    box-shadow 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background-color 220ms ease;
}

.tech-card:hover {
  transform: translateY(-2px) scale(1.01);
  border-color: color-mix(in oklab, var(--primary) 42%, var(--border));
  box-shadow:
    0 12px 24px -20px color-mix(in oklab, var(--primary) 58%, transparent),
    0 2px 6px color-mix(in oklab, var(--foreground) 7%, transparent);
}

.tech-card-shine {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      110deg,
      transparent 15%,
      color-mix(in oklab, var(--primary) 24%, transparent) 45%,
      transparent 72%
    );
  opacity: 0;
  transform: translateX(-115%);
  transition: transform 560ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 260ms ease;
  pointer-events: none;
}

.tech-card:hover .tech-card-shine {
  opacity: 0.75;
  transform: translateX(120%);
}

.tech-card-icon,
.tech-card-label {
  position: relative;
  z-index: 1;
}

.tech-card-icon {
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.tech-card-main {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
}

.tech-card:hover .tech-card-icon {
  transform: translateY(-1px) rotate(-4deg);
}

.tech-card-label {
  transition: letter-spacing 220ms ease;
}

.tech-card:hover .tech-card-label {
  letter-spacing: 0.01em;
}

.tech-card-version,
.tech-card-desc,
.tech-card-footer {
  position: relative;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  .tech-card,
  .tech-card-icon,
  .tech-card-label,
  .tech-card-shine {
    transition: none !important;
    transform: none !important;
  }

  .tech-card:hover {
    box-shadow: 0 2px 8px -4px color-mix(in oklab, var(--foreground) 16%, transparent);
  }

  .tech-card:hover .tech-card-shine {
    opacity: 0;
  }
}

.settings-scroll {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.settings-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}
</style>
