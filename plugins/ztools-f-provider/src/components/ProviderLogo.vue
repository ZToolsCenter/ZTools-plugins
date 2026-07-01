<script setup lang="ts">
/**
 * 翻译服务商 logo（来自官网 favicon，本地图片，无外链）。
 */
import baiduLogo from '../assets/baidu.png'
import googleLogo from '../assets/google.png'
import youdaoLogo from '../assets/youdao.png'
import microsoftLogo from '../assets/microsoft.png'

defineProps<{
  /** 服务商 key */
  name: 'baidu' | 'google' | 'youdao' | 'microsoft'
}>()

const logos: Record<'baidu' | 'google' | 'youdao' | 'microsoft', string> = {
  baidu: baiduLogo,
  google: googleLogo,
  youdao: youdaoLogo,
  microsoft: microsoftLogo
}
</script>

<template>
  <img class="provider-logo" :src="logos[name]" :alt="name" draggable="false" />
</template>

<style scoped>
.provider-logo {
  width: 24px;
  height: 24px;
  display: block;
  object-fit: contain;
}
</style>
