<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import ResultList from './ResultList.vue'
import { service } from '../service'
import type { BrowseSection, Result, VideoChannel } from '../types'

const props = defineProps<{ channel: VideoChannel | null; label: string }>()
const emit = defineEmits<{ open: [result: Result] }>()
const cache = reactive<Partial<Record<VideoChannel, BrowseSection[]>>>({})
const refresh = ref(0)
const loading = ref(false)
const error = ref('')
const sections = computed(() => props.channel ? cache[props.channel] ?? [] : [])

function reload() {
  if (!props.channel || loading.value) return
  delete cache[props.channel]
  refresh.value++
}

watch([() => props.channel, refresh], async ([channel], _previous, onCleanup) => {
  let active = true
  onCleanup(() => { active = false })
  loading.value = false
  error.value = ''
  if (!channel || cache[channel]) return
  loading.value = true
  try {
    const result = await service.channel(channel)
    if (active) cache[channel] = result
  } catch (cause) {
    if (active) error.value = cause instanceof Error ? cause.message : '频道暂时无法加载。'
  } finally {
    if (active) loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <section class="content channel-browser" :aria-label="label">
    <div v-if="loading || error" class="state-panel" :class="{ failure: error }" role="status">
      <span v-if="loading" class="spinner" aria-hidden="true"></span>
      <span>{{ error || `正在加载${label}频道…` }}</span>
      <button v-if="error" class="secondary" type="button" @click="reload">重试</button>
    </div>
    <template v-else-if="sections.length">
      <section v-for="(section, index) in sections" :key="index + ':' + section.title" class="channel-section">
        <div class="section-heading results-heading">
          <h2>{{ section.title }}</h2>
          <button v-if="index === 0" class="secondary refresh-channel" type="button" @click="reload">刷新</button>
        </div>
        <ResultList :results="section.items" :label="section.title" posters @open="result => emit('open', result)" />
      </section>
    </template>
    <div v-else class="state-panel" role="status">
      <span>该频道暂时没有可显示的影片。</span>
      <button class="secondary" type="button" @click="reload">刷新</button>
    </div>
  </section>
</template>
