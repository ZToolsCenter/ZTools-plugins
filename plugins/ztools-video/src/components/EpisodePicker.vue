<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Episode } from '../types'

const props = defineProps<{ episodes: Episode[]; selected: Episode }>()
const emit = defineEmits<{ select: [episode: Episode] }>()
const pageSize = 24
const line = ref(props.selected.line)
const page = ref(0)
const lines = computed(() => [...new Set(props.episodes.map(e => e.line))])
const lineEpisodes = computed(() => props.episodes.filter(e => e.line === line.value))
const pages = computed(() => Math.max(1, Math.ceil(lineEpisodes.value.length / pageSize)))
const shown = computed(() => lineEpisodes.value.slice(page.value * pageSize, (page.value + 1) * pageSize))

watch(() => props.selected, selected => {
  line.value = selected.line
  const index = lineEpisodes.value.findIndex(e => e.v === selected.v)
  page.value = Math.max(0, Math.floor(index / pageSize))
}, { immediate: true })

function changeLine(event: Event) {
  line.value = Number((event.target as HTMLSelectElement).value)
  page.value = 0
}
</script>

<template>
  <aside class="episodes" aria-label="选集">
    <div class="section-heading">
      <h3>选集 <small>{{ lineEpisodes.length }} 集</small></h3>
      <select v-if="lines.length > 1" :value="line" aria-label="播放线路" @change="changeLine">
        <option v-for="option in lines" :key="option" :value="option">线路 {{ option }}</option>
      </select>
    </div>
    <div class="episode-grid">
      <button v-for="episode in shown" :key="episode.v" type="button"
        :aria-label="'第 ' + episode.number + ' 集'" :aria-current="episode.v === selected.v ? 'true' : undefined"
        @click="emit('select', episode)">{{ episode.number }}</button>
    </div>
    <div v-if="pages > 1" class="pager">
      <button type="button" class="secondary" :disabled="page <= 0" @click="page--">上一页</button>
      <span>{{ page + 1 }} / {{ pages }}</span>
      <button type="button" class="secondary" :disabled="page + 1 >= pages" @click="page++">下一页</button>
    </div>
  </aside>
</template>
