<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import Calendar from './Calendar/index.vue'

const route = ref('calendar')
const enterAction = ref({})
const isUtools = ref(false)

onMounted(() => {
  if (window.utools) {
    isUtools.value = true
    document.body.classList.add('is-utools')
    window.utools.onPluginEnter((action) => {
      route.value = action.code || 'calendar'
      enterAction.value = action
    })
  }
})
</script>

<template>
  <div class="app-container" :class="{ 'is-utools': isUtools }">
    <Calendar :enterAction="enterAction"></Calendar>
  </div>
</template>

<style>
.app-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* 响应式布局 - 大屏幕卡片化 */
@media (min-width: 1024px) {
  .app-container:not(.is-utools) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }
  
  .app-container:not(.is-utools) > * {
    max-width: 1200px;
    max-height: 800px;
    width: 100%;
    height: 100%;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    overflow: hidden;
  }
}

/* 中等屏幕 */
@media (min-width: 768px) and (max-width: 1023px) {
  .app-container:not(.is-utools) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }
  
  .app-container:not(.is-utools) > * {
    max-width: 95%;
    max-height: 95%;
    border-radius: 12px;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }
}
</style>
