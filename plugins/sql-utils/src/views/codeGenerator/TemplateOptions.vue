<template>
  <div class="template-options">
    <n-space :size="8" :wrap="true" align="center">
      <template v-for="option in options" :key="option.key">
        <n-checkbox v-if="option.type === 'checkbox'" v-model:checked="model[option.key]" @update:checked="$emit('change')">
          {{ option.label }}
        </n-checkbox>
        <n-input v-else-if="option.type === 'input'" v-model:value="model[option.key]" :placeholder="option.default" size="small" @update:value="$emit('change')" />
      </template>
    </n-space>
  </div>
</template>

<script setup>
defineProps({
  options: { type: Array, required: true },
  model: { type: Object, required: true }
})

defineEmits(['change'])
</script>

<style scoped>
.template-options {
  flex: 0;
}
</style>
