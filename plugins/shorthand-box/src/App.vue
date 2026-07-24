<script setup>
import { onMounted, ref, onUnmounted } from 'vue';
import Layout from './components/Layout.vue';
import { NConfigProvider, NMessageProvider, zhCN, darkTheme } from 'naive-ui';

const route = ref('');
const enterAction = ref({});
const theme = ref(null);

const updateTheme = (isDark) => {
  theme.value = isDark ? darkTheme : null;
};

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

onMounted(() => {
  updateTheme(mediaQuery.matches);

  mediaQuery.addEventListener('change', (e) => {
    updateTheme(e.matches);
  });

  window.ztools.onPluginEnter((action) => {
    route.value = action.code;
    enterAction.value = action;
  });
  window.ztools.onPluginOut(() => {
    route.value = '';
  });
});

onUnmounted(() => {
  mediaQuery.removeEventListener('change', updateTheme);
});
</script>

<template>
  <NConfigProvider
    :locale="zhCN"
    :theme="theme"
  >
    <NMessageProvider>
      <Layout :enterAction="enterAction">
        <router-view :enterAction="enterAction" />
      </Layout>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped></style>
