<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";

import {
  createImageRetryStatusController,
  createImageRetryStatusState,
  imageRetryStatusPresentation,
} from "../image-retry-status";

const state = reactive(createImageRetryStatusState());
const controller = createImageRetryStatusController(state, {
  getBridge: () => window.pasteboardPro,
  windowEvents: window,
  documentEvents: document,
});
const presentation = computed(() => imageRetryStatusPresentation(state));

onMounted(() => { void controller.start(); });
onBeforeUnmount(controller.dispose);
</script>

<template>
  <section class="image-retry-status" aria-labelledby="image-retry-status-title">
    <div class="image-retry-status__content">
      <h3 id="image-retry-status-title">图片保存</h3>
      <div class="image-retry-status__summary" role="status" aria-live="polite" :aria-busy="presentation.busy">
        <p class="image-retry-status__message">{{ presentation.message }}</p>
        <div v-if="presentation.counts.length > 0" class="image-retry-status__counts">
          <span v-for="count in presentation.counts" :key="count">{{ count }}</span>
        </div>
        <p v-if="presentation.detail" class="image-retry-status__detail">{{ presentation.detail }}</p>
        <p v-if="presentation.notice" class="image-retry-status__notice">{{ presentation.notice }}</p>
      </div>
    </div>
    <div v-if="presentation.canRetry" class="image-retry-status__action">
      <button type="button" :disabled="presentation.retryDisabled" @click="void controller.retry()">重试保存</button>
      <p v-if="presentation.retryDisabledReason" class="image-retry-status__detail">{{ presentation.retryDisabledReason }}</p>
    </div>
  </section>
</template>

<style scoped>
.image-retry-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 16px;
  margin: 4px 0 16px;
  padding: 14px 15px;
  border: 1px solid var(--settings-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--settings-surface) 94%, var(--settings-accent) 6%);
}

.image-retry-status__content { display: grid; gap: 6px; min-width: 0; }
.image-retry-status h3 { margin: 0; color: var(--settings-ink); font-size: 13px; font-weight: 680; }
.image-retry-status__summary { display: grid; gap: 5px; }
.image-retry-status__message { margin: 0; color: var(--settings-ink); font-size: 12px; line-height: 1.55; }
.image-retry-status__counts { display: flex; flex-wrap: wrap; gap: 6px 12px; color: var(--settings-muted); font-size: 11px; }
.image-retry-status__detail,
.image-retry-status__notice { margin: 0; color: var(--settings-muted); font-size: 11px; line-height: 1.5; }
.image-retry-status__notice { color: var(--settings-ink); }
.image-retry-status__action { display: grid; justify-items: start; gap: 6px; }
.image-retry-status__action button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--settings-accent);
  border-radius: 8px;
  background: var(--settings-accent);
  color: var(--settings-on-accent);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
}
.image-retry-status__action button:focus-visible { outline: 2px solid var(--settings-accent); outline-offset: 3px; }
.image-retry-status__action button:disabled { cursor: wait; opacity: .58; }

@media (max-width: 480px) {
  .image-retry-status { grid-template-columns: minmax(0, 1fr); }
  .image-retry-status__action { justify-items: start; }
}
</style>
