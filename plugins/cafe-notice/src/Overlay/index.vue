<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Danmaku from './Danmaku.vue'
import CardStack from './CardStack.vue'

const mode = new URLSearchParams(location.search).get('mode') || 'danmaku'
const notice = () => window.services.notice

const cfg = ref<Record<string, string>>(notice().getConfig())
const danmaku = ref<InstanceType<typeof Danmaku> | null>(null)
const stack = ref<InstanceType<typeof CardStack> | null>(null)

setInterval(() => {
  cfg.value = notice().getConfig()
}, 2000)

function onHeight(h: number) {
  notice().reportListHeight(h)
}

onMounted(() => {
  notice().helloOverlay(mode)
  setInterval(() => notice().pingOverlay(mode), 2000)
  notice().onMessage((entry) => {
    if (mode === 'danmaku') danmaku.value?.push(entry)
    else stack.value?.push(entry)
  })
})
</script>

<template>
  <Danmaku v-if="mode === 'danmaku'" ref="danmaku" :cfg="cfg" />
  <CardStack v-else ref="stack" :cfg="cfg" @height="onHeight" />
</template>
