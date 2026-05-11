<script setup lang="ts">
const props = defineProps<{
  show: boolean,
  title: string,
  tip?: string,
  confirmText: string,
  cancelText: string,
  countdown?: number,
  isDanger?: boolean
}>()

const emits = defineEmits(['update:show', 'confirm', 'cancel'])
</script>

<template>
  <transition name="modal-fade">
    <div class="modal-overlay" v-if="show" @click.self="emits('update:show', false)">
      <div class="modal-content modal-delete">
        <h3 class="modal-title">{{ title }}</h3>
        <p v-if="tip" class="modal-tip dark bold">{{ tip }}</p>
        <slot></slot>
        <div class="modal-actions">
          <button class="btn btn-secondary" @click="emits('cancel')">
            <span class="btn-text">{{ cancelText }}</span>
          </button>
          <button 
            class="btn" 
            :class="{ 'btn-confirm-delete': isDanger, 'btn-primary': !isDanger, 'disabled': (countdown || 0) > 0 }" 
            :disabled="(countdown || 0) > 0" 
            @click="emits('confirm')"
            style="min-width: 90px;"
          >
            <span class="btn-text">
              {{ confirmText }}{{ (countdown || 0) > 0 ? ` (${countdown}s)` : '' }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>
