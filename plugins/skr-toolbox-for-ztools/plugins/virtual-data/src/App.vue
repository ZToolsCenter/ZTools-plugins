<script setup>
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import { onMounted, ref } from 'vue';
import { zhCN, dateZhCN } from 'naive-ui';
import Home from './Home/index.vue';

const route = ref('');
const enterAction = ref({});

hljs.registerLanguage('javascript', javascript);
const hljsInstance = hljs;

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code;
    enterAction.value = action;
  });
  window.ztools.onPluginOut(() => {
    route.value = '';
  });
});
</script>

<template>
  <!-- 必须包两层：config-provider + message-provider -->
  <n-config-provider
    :hljs="hljsInstance"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <Home :enter-action="enterAction" />
    </n-message-provider>
  </n-config-provider>
</template>
