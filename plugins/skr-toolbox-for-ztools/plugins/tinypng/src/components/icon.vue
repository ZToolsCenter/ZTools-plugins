<template>
  <svg class="icon" aria-hidden="true" :style="{ fontSize: size, color }">
    <use :xlink:href="`#icon-${name}`"></use>
  </svg>
</template>

<style lang="scss" scoped>
.icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  fill: currentColor;
  overflow: hidden;
}
</style>

<script lang="ts" setup>
defineProps({
  name: { type: String, required: true },
  size: { type: String },
  color: { type: String }
});
</script>
