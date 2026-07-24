<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  CategoryInfo,
  CategoryLayoutSection,
  CategorySectionModel,
  PluginMarketUiPlugin,
} from '../../types/pluginMarket'
import { DetailPanel } from '../common/DetailPanel'
import { shuffleArray } from './utils'
import PluginCard from './PluginCard.vue'
import RefreshButton from './RefreshButton.vue'

const props = defineProps<{
  category: CategoryInfo
  layout: CategoryLayoutSection[]
  installingPluginName: string | null
  pluginMap: Map<string, PluginMarketUiPlugin>
  canInstallFromMarket?: boolean
}>()

defineEmits<{
  (e: 'back'): void
  (e: 'click-plugin', plugin: PluginMarketUiPlugin): void
  (e: 'open-plugin', plugin: PluginMarketUiPlugin): void
  (e: 'download-plugin', plugin: PluginMarketUiPlugin): void
}>()

function interpolateTemplate(template: string): string {
  return template
    .replace(/\$\{title\}/g, props.category.title)
    .replace(/\$\{count\}/g, String(props.category.plugins.length))
}

const randomVersion = ref(0)

const resolvedSections = computed<CategorySectionModel[]>(() => {
  if (props.layout.length === 0) {
    return [{
      key: 'list-default',
      type: 'list',
      title: `${props.category.title} 全部插件（共 ${props.category.plugins.length} 个）`,
      plugins: props.category.plugins,
    }]
  }

  const sections: CategorySectionModel[] = []

  for (let i = 0; i < props.layout.length; i++) {
    const section = props.layout[i]
    const title = section.title ? interpolateTemplate(section.title) : undefined

    if (section.type === 'list') {
      sections.push({ key: `list-${i}`, type: 'list', title, plugins: props.category.plugins })
    } else if (section.type === 'fixed') {
      const pluginNames = section.plugins || []
      const fixedPlugins = pluginNames
        .map((name) => props.pluginMap.get(name))
        .filter((p): p is PluginMarketUiPlugin => !!p)
      if (fixedPlugins.length > 0) {
        sections.push({ key: `fixed-${i}`, type: 'fixed', title, plugins: fixedPlugins })
      }
    } else if (section.type === 'random') {
      const count = section.count || 4
      const shuffled = shuffleArray(props.category.plugins)
      sections.push({
        key: `random-${i}-${randomVersion.value}`,
        type: 'random',
        title,
        plugins: shuffled.slice(0, count),
      })
    }
  }

  return sections.length > 0
    ? sections
    : [{
        key: 'list-fallback',
        type: 'list',
        title: `${props.category.title} 全部插件（共 ${props.category.plugins.length} 个）`,
        plugins: props.category.plugins,
      }]
})

function shuffleSection(): void {
  randomVersion.value++
}
</script>
<template>
  <DetailPanel :title="category.title" @back="$emit('back')">
    <div class="category-detail-content">
      <div v-if="category.description" class="category-detail-header">
        <img
          v-if="category.icon"
          :src="category.icon"
          alt=""
          class="category-detail-icon"
          draggable="false"
        />
        <div class="category-detail-desc">{{ category.description }}</div>
      </div>

      <div v-for="section in resolvedSections" :key="section.key" class="category-detail-section">
        <div v-if="section.title || section.type === 'random'" class="section-header">
          <span v-if="section.title" class="section-title">{{ section.title }}</span>
          <RefreshButton v-if="section.type === 'random'" @click="shuffleSection()" />
        </div>
        <div class="market-grid">
          <PluginCard
            v-for="plugin in section.plugins"
            :key="plugin.name"
            :plugin="plugin"
            :installing-plugin="installingPluginName"
            :can-install-from-market="canInstallFromMarket"
            @click="$emit('click-plugin', plugin)"
            @open="$emit('open-plugin', plugin)"
            @download="$emit('download-plugin', plugin)"
          />
        </div>
      </div>
    </div>
  </DetailPanel>
</template>

<style scoped>
.category-detail-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.category-detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 2px;
}

.category-detail-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.category-detail-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.category-detail-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
</style>
