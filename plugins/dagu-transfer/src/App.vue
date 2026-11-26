<script setup>
import TransferList from './list/TransferList.vue';
import SetupView from './setup/SetupView.vue';

defineProps({
  view: { type: Object, required: true },
  flows: { type: Object, required: true },
  host: { type: Object, default: null },
  configStore: { type: Object, required: true }
});
</script>

<template>
  <TransferList v-if="view.route === 'share'" :flow="flows.share" :host="host" />
  <TransferList v-else-if="view.route === 'download'" :flow="flows.download" :host="host" />
  <SetupView v-else-if="view.route === 'setup'" :host="host" :config-store="configStore" />
</template>
