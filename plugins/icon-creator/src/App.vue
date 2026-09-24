<script setup lang="ts">
import { onMounted } from 'vue'
import router from './router'
import { useZtoolsTheme } from 'ztools-ui'
import { syncZtoolsRoute } from './ztoolsRouteSync'

onMounted(() => {
  useZtoolsTheme()
  syncZtoolsRoute(router)
})
</script>

<template>
  <router-view />
</template>

<style>
* {
  box-sizing: border-box;
}
</style>