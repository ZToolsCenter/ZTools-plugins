<script setup lang="ts">
import { computed } from 'vue'
import JsonCodeMirrorBlock from './JsonCodeMirrorBlock.vue'
import { prettyJson } from '../../utils/content'

const props = defineProps<{
  content: string
  query?: string
  activeIndex?: number
}>()

const pretty = computed(() => prettyJson(props.content))
</script>

<template>
  <JsonCodeMirrorBlock :content="pretty" language="json" :editable="false" :query="query" :active-index="activeIndex" />
</template>
