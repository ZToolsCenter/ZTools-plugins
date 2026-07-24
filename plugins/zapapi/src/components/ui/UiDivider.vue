<template>
  <div class="ui-divider" :class="[`ui-divider--${orientation}`]" />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  orientation?: 'horizontal' | 'vertical'
}>(), {
  orientation: 'horizontal'
})
</script>

<style scoped>
.ui-divider {
  flex-shrink: 0;
}

.ui-divider--horizontal {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--border-color-hover), transparent);
}

.ui-divider--vertical {
  width: 1px;
  height: 100%;
  min-height: 16px;
  background: linear-gradient(180deg, transparent, var(--border-color-hover), transparent);
}
</style>
