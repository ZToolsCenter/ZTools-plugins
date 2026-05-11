<script setup lang="ts">
import { computed, onMounted } from 'vue'
import TimerWindow from './TimerWindow.vue'

const params = new URLSearchParams(window.location.search)
const isTimerWindow = computed(() => {
  const page = window.location.pathname.split('/').pop()
  return page === 'timer.html' || params.get('timerWindow') === '1'
})

onMounted(() => {
  if (isTimerWindow.value) return

  window.ztools.onPluginEnter((action) => {
    if (action.code === 'stopwatch' || action.code === '正计时') {
      window.timerAPI.openTimer('stopwatch')
    }

    if (action.code === 'countdown' || action.code === '倒计时') {
      window.timerAPI.openTimer('countdown')
    }
  })
})
</script>

<template>
  <TimerWindow v-if="isTimerWindow" />
  <main v-else class="launcher-shell" aria-hidden="true"></main>
</template>
