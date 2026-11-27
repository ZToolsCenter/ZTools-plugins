<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { attachListToHost } from './host-glue.js';

const props = defineProps({
  flow: { type: Object, required: true },
  host: { type: Object, default: null }
});

const root = ref(null);
const state = ref(props.flow.state);
let detach = () => {};

// 流程自己维护状态，这里只把每次变化同步成响应式数据用于渲染。
const unsubscribe = props.flow.subscribe((next) => {
  state.value = next;
});

onMounted(() => {
  detach = attachListToHost(props.flow, props.host, root.value);
});

onBeforeUnmount(() => {
  detach();
  unsubscribe();
});
</script>

<template>
  <div ref="root" class="transfer-list">
    <div v-if="state.status" class="transfer-status" :class="`tone-${state.status.tone || 'info'}`" role="status">
      <div class="transfer-status-title">{{ state.status.title }}</div>
      <div v-if="state.status.subtitle" class="transfer-status-subtitle">{{ state.status.subtitle }}</div>
    </div>
    <div class="transfer-rows" role="listbox" aria-label="选项">
      <div
        v-for="(row, index) in state.rows"
        :key="row.key"
        class="transfer-row"
        :class="{ active: index === state.highlight }"
        role="option"
        :aria-selected="index === state.highlight"
        :data-kind="row.kind"
        @click="flow.select(index)"
      >
        <div class="transfer-row-title">{{ row.title }}</div>
        <div v-if="row.subtitle" class="transfer-row-subtitle">{{ row.subtitle }}</div>
      </div>
    </div>
  </div>
</template>
