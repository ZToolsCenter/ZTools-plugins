<script setup lang="ts">
import { computed } from 'vue';
import { parseRoute } from './core/routes';
import CaptureView from './views/CaptureView.vue';
import LauncherView from './views/LauncherView.vue';
import PinView from './views/PinView.vue';

const route = computed(() => parseRoute());
</script>

<template>
  <CaptureView v-if="route.view === 'capture'" />
  <PinView v-else-if="route.view === 'pin'" />
  <LauncherView v-else />
</template>
