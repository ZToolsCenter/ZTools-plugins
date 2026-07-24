<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  confirmDialog: {
    visible: boolean
    title: string
    message: string
    confirmText: string
    danger: boolean
  }
  transferring: boolean
  transferProgress: number
  transferStatus: string
  transferIndeterminate?: boolean
}>()

defineEmits<{
  confirm: [value: boolean]
}>()

const displayTransferStatus = computed(() => truncateTransferStatus(props.transferStatus))

function truncateTransferStatus(value: string) {
  const status = value || '正在处理'
  const separatorIndex = Math.max(status.lastIndexOf('：'), status.lastIndexOf(':'))

  if (separatorIndex < 0) return truncateMiddle(status, 42)

  const prefix = status.slice(0, separatorIndex + 1)
  const name = status.slice(separatorIndex + 1).trim()
  if (!name) return status

  return `${prefix}${truncateFileName(name)}`
}

function truncateFileName(name: string) {
  return truncateMiddle(name, 30)
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  const marker = '**'
  const keep = Math.max(4, maxLength - marker.length)
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return `${value.slice(0, head)}${marker}${value.slice(-tail)}`
}
</script>

<template>
  <div v-if="transferring" class="progress-card">
    <div class="progress-head">
      <strong :title="transferStatus || '正在处理'">{{ displayTransferStatus }}</strong>
      <span>{{ transferIndeterminate ? '处理中' : `${transferProgress}%` }}</span>
    </div>
    <div class="progress-track">
      <span
        class="progress-fill"
        :class="{ indeterminate: transferIndeterminate }"
        :style="{ width: transferIndeterminate ? '38%' : `${transferProgress}%` }"
      />
    </div>
  </div>

  <div v-if="confirmDialog.visible" class="confirm-mask" @click.self="$emit('confirm', false)">
    <section class="confirm-card" role="dialog" aria-modal="true" :aria-label="confirmDialog.title">
      <h2>{{ confirmDialog.title }}</h2>
      <p>{{ confirmDialog.message }}</p>
      <div class="confirm-actions">
        <button class="confirm-button ghost" type="button" @click="$emit('confirm', false)">
          取消
        </button>
        <button
          class="confirm-button"
          :class="{ danger: confirmDialog.danger }"
          type="button"
          @click="$emit('confirm', true)"
        >
          {{ confirmDialog.confirmText }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.progress-card {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2600;
  display: grid;
  gap: 10px;
  width: min(340px, calc(100vw - 36px));
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-solid);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.16);
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
  color: var(--strong);
  font-size: 13px;
}

.progress-head strong {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-head span {
  flex: 0 0 auto;
  color: var(--muted);
}

.progress-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--soft-bg);
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand);
  transition: width 160ms ease;
}

.progress-fill.indeterminate {
  animation: progress-indeterminate 1.1s ease-in-out infinite;
  transition: none;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-110%);
  }

  100% {
    transform: translateX(280%);
  }
}

.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 2800;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
}

.confirm-card {
  width: min(380px, 100%);
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-solid);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
  color: var(--strong);
}

.confirm-card h2 {
  margin: 0 0 10px;
  font-size: 17px;
  line-height: 1.3;
}

.confirm-card p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.confirm-button {
  min-width: 72px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--brand);
  border-radius: 6px;
  background: var(--brand);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.confirm-button.ghost {
  border-color: var(--line);
  background: transparent;
  color: var(--text);
}

.confirm-button.danger {
  border-color: var(--danger);
  background: var(--danger);
}
</style>
