<script setup lang="ts">
import { onMounted, ref } from 'vue'
import BaseConverter from './BaseConverter/index.vue'

const inputNum = ref('')

onMounted(() => {
  // 普通浏览器预览时无 ztools 环境，直接跳过
  if (typeof window.ztools === 'undefined') return
  // 进入插件后设置窗口高度，并通过子输入框接收待转换的数字
  window.ztools.onPluginEnter(() => {
    window.ztools.setExpendHeight(375)
    window.ztools.setSubInput(({ text }) => {
      inputNum.value = text
    }, '输入')
  })
})
</script>

<template>
  <BaseConverter v-model="inputNum" />
</template>
