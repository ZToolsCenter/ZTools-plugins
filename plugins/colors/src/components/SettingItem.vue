<script lang="ts" setup>
interface Props {
  label: string;
}

defineProps<Props>();
</script>

<template>
  <div class="flex items-center justify-between">
    <label class="text-base font-medium">{{ label }}</label>
    <slot />
  </div>
</template>
