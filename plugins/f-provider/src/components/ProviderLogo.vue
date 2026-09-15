<script setup lang="ts">
/**
 * 翻译/OCR 服务商 logo（传统厂商来自官网 favicon 本地图片，无外链）。
 * AI 系列无独立图标，使用内联 SVG dataURI 作为占位（紫底白字 AI）。
 */
import baiduLogo from '../assets/baidu.png'
import googleLogo from '../assets/google.png'
import youdaoLogo from '../assets/youdao.png'
import microsoftLogo from '../assets/microsoft.png'

defineProps<{
  /** 服务商 key */
  name:
    | 'baidu'
    | 'google'
    | 'youdao'
    | 'microsoft'
    | 'ai-translation'
    | 'ai-ocr'
    | 'ai-latex-ocr'
    | 'image-host'
}>()

// AI provider 的占位图标：紫色圆角方块 + 白色 "AI" 字样。
const aiLogo =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
      '<rect width="48" height="48" rx="10" fill="#6c5ce7"/>' +
      '<text x="24" y="32" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">AI</text>' +
      '</svg>'
  )

// 图床占位图标：紫底白"图"字（与 AI 系列同结构，便于视觉区分）。
const imageHostLogo =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
      '<rect width="48" height="48" rx="10" fill="#6c5ce7"/>' +
      '<text x="24" y="32" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">图</text>' +
      '</svg>'
  )

const logos = {
  baidu: baiduLogo,
  google: googleLogo,
  youdao: youdaoLogo,
  microsoft: microsoftLogo,
  'ai-translation': aiLogo,
  'ai-ocr': aiLogo,
  'ai-latex-ocr': aiLogo,
  'image-host': imageHostLogo
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
