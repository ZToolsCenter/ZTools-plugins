<script setup>
import { computed, onMounted, ref } from 'vue';
import { darkTheme, useOsTheme } from 'naive-ui';
import Hello from './Hello/index.vue';

const route = ref('');
const enterAction = ref({});
const onEnter = ref(null);

const osThemeRef = useOsTheme();
const theme = computed(() => (osThemeRef.value === 'dark' ? darkTheme : null));

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code;
    enterAction.value = action;
    onEnter.value?.();
  });
  window.ztools.onPluginOut(() => {
    route.value = '';
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      onEnter.value?.();
    }
  });
});
</script>

<template>
  <n-config-provider :theme="theme">
    <n-message-provider>
      <Hello
        :enter-action="enterAction"
        :on-enter="onEnter"
      />
    </n-message-provider>
  </n-config-provider>
</template>
