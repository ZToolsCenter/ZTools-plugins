<script setup lang="ts">
import { AlertCircle, CheckCircle2 } from 'lucide-vue-next'

defineProps<{
  message: string
  kind: 'success' | 'error'
}>()
</script>

<template>
  <div class="toast-message" :class="kind" role="status" aria-live="polite">
    <CheckCircle2 v-if="kind === 'success'" :size="18" aria-hidden="true" />
    <AlertCircle v-else :size="18" aria-hidden="true" />
    <span>{{ message }}</span>
  </div>
</template>
