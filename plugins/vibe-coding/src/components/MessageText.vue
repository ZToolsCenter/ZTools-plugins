<script setup>
defineProps({ content: { type: String, default: '' } })
</script>

<template>
  <div class="message-text">{{ content }}</div>
</template>
