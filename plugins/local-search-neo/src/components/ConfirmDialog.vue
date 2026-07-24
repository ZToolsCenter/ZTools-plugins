<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="confirm-backdrop" @click.self="emit('cancel')">
      <section class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <h2>{{ title }}</h2>
        <p>{{ message }}</p>
        <div class="confirm-actions">
          <button type="button" class="cancel-button" @click="emit('cancel')">
            {{ cancelText ?? "取消" }}
          </button>
          <button type="button" class="confirm-button" :class="{ danger }" @click="emit('confirm')">
            {{ confirmText ?? "确定" }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 42%);
}

.confirm-dialog {
  display: grid;
  gap: 12px;
  width: min(360px, calc(100vw - 48px));
  box-sizing: border-box;
  padding: 18px;
  color: #f5f7fa;
  background: #303234;
  border: 1px solid #55585c;
  border-radius: 10px;
  box-shadow: 0 18px 48px rgb(0 0 0 / 35%);
}

.confirm-dialog h2 {
  margin: 0;
  color: #ffffff;
  font-size: 16px;
}

.confirm-dialog p {
  margin: 0;
  color: #c3c8cf;
  font-size: 13px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.confirm-actions button {
  height: 30px;
  padding: 0 14px;
  color: #ffffff;
  border: 0;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.confirm-actions button:focus,
.confirm-actions button:focus-visible {
  outline: none;
  box-shadow: none;
}

.cancel-button {
  background: #4a4d52;
}

.confirm-button {
  background: #3b82f6;
}

.confirm-button.danger {
  background: #b84242;
}

@media (prefers-color-scheme: light) {
  .confirm-backdrop {
    background: rgb(15 23 42 / 28%);
  }

  .confirm-dialog {
    color: #1f2937;
    background: #ffffff;
    border-color: #d2d9e3;
    box-shadow: 0 18px 48px rgb(15 23 42 / 18%);
  }

  .confirm-dialog h2 {
    color: #111827;
  }

  .confirm-dialog p {
    color: #4f5b6a;
  }

  .confirm-actions .cancel-button {
    color: #1f2937;
    background: #e5eaf2;
  }

  .confirm-actions .confirm-button {
    color: #ffffff;
    background: #2563eb;
  }

  .confirm-button.danger {
    background: #c24141;
  }
}
</style>
