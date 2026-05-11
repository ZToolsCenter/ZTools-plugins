<template>
  <div class="ui-empty">
    <svg class="ui-empty__icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
    <p class="ui-empty__text">{{ text }}</p>
    <div v-if="$slots.action" class="ui-empty__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  text?: string
}>()

const text = computed(() => props.text || t('empty.noData'))
</script>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-2xl) var(--space-lg);
  color: var(--text-muted);
  width: 100%;
  height: 100%;
}

.ui-empty__icon {
  opacity: 0.2;
  color: var(--accent-primary);
}

.ui-empty__text {
  margin: 0;
  font-size: 13px;
  text-align: center;
}

.ui-empty__action {
  margin-top: var(--space-xs);
}
</style>
