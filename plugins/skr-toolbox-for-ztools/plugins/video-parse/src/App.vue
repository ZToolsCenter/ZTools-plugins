<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import Main from './Main/index.vue';

const route = ref('')
const enterAction = ref({})

onMounted(() => {
  window.utools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })
  window.utools.onPluginOut((isKill) => {
    route.value = ''
  })
})
</script>

<template>
  <template v-if="route === 'parse'">
    <Main :enterAction="enterAction"></Main>
  </template>
</template>
