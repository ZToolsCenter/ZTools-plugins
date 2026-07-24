<script lang="ts" setup>
import zToolsApi from "../utils/ztoolsapi";
const thereIsNoZToolsApiAvailable = !zToolsApi;
</script>
<template>
  <div v-if="thereIsNoZToolsApiAvailable">
    <div class="flex h-screen flex-col items-center justify-center">
      <p class="text-2xl font-semibold text-gray-800">颜色助手</p>
      <p class="text-gray-600">请使用 ZTools 打开此页面</p>
      <a class="text-blue-600 hover:underline" href="https://ztoolscenter.github.io/ZTools-doc/"
        >您可以查看开发者文档了解更多内容</a
      >
    </div>
  </div>
  <slot v-else></slot>
</template>
