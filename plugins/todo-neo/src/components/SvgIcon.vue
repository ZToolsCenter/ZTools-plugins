<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  src: string
  size?: number
}>(), {
  size: 16
})

const iconStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  maskImage: `url("${props.src}")`,
  WebkitMaskImage: `url("${props.src}")`
}))
</script>

<template>
  <span
    class="svg-icon"
    :style="iconStyle"
    aria-hidden="true"
  ></span>
</template>

<style scoped>
.svg-icon {
  display: inline-block;
  flex: 0 0 auto;
  background: currentColor;
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: contain;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: contain;
}
</style>
