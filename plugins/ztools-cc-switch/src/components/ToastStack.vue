<script setup>
defineProps({ items: { type: Array, required: true } })
defineEmits(['dismiss'])
</script>

<template>
  <div class="toast-stack" aria-live="polite">
    <TransitionGroup name="toast">
      <button v-for="item in items" :key="item.id" class="toast-item" :class="item.tone" @click="$emit('dismiss', item.id)">
        <span class="toast-symbol">{{ item.tone === 'error' ? '!' : item.tone === 'warning' ? '·' : '✓' }}</span>
        <span>{{ item.message }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>
