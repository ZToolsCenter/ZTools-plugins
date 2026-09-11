<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{
  running: boolean
  logs: string[]
  result: string | null
  error: string | null
}>()
const emit = defineEmits<{ (e: 'rerun'): void }>()
</script>

<template>
  <div class="script-run">
    <div class="script-runing" v-if="running">
      <div class="script-run-progress"><div class="bar"></div><div class="bar2"></div></div>
      <div>脚本运行中...</div>
    </div>
    <div class="script-run-console">
      <div class="script-run-log" v-for="(line, i) in logs" :key="i">{{ line }}</div>
      <div class="script-run-result alert error" v-if="!running && error">
        <span class="alert-icon"><Icon name="alertError" /></span>
        <span class="alert-message">
          <span class="alert-title">出现错误</span>
          {{ error }}
        </span>
        <span class="alert-action">
          <button class="script-run-btn" @click="emit('rerun')">
            <Icon name="refresh" />
            重新运行
          </button>
        </span>
      </div>
      <div class="script-run-result alert success" v-else-if="!running">
        <span class="alert-icon"><Icon name="alertSuccess" /></span>
        <span class="alert-message">
          <span class="alert-title">运行完成</span>
          <template v-if="result">{{ result }}</template>
        </span>
        <span class="alert-action">
          <button class="script-run-btn" @click="emit('rerun')">
            <Icon name="playCircle" />
            再次运行
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.script-run {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.script-runing {
  width: 100%;
  display: flex;
  flex-direction: column;
  font-size: 13px;
  color: rgb(136, 136, 136);
}

.script-runing > div:last-child {
  padding-top: 8px;
  text-align: center;
}

.script-run-progress {
  position: relative;
  height: 2px;
  background: rgb(182, 188, 226);
  overflow: hidden;
}

.script-run-progress .bar,
.script-run-progress .bar2 {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 100%;
  transform-origin: left;
  background: var(--primary);
}

.script-run-progress .bar {
  animation: mui-indeterminate1 2.1s cubic-bezier(0.65, 0.815, 0.735, 0.395) infinite;
}

.script-run-progress .bar2 {
  animation: mui-indeterminate2 2.1s cubic-bezier(0.165, 0.84, 0.44, 1) 1.15s infinite;
}

@keyframes mui-indeterminate1 {
  0% {
    left: -35%;
    right: 100%;
  }
  60% {
    left: 100%;
    right: -90%;
  }
  100% {
    left: 100%;
    right: -90%;
  }
}

@keyframes mui-indeterminate2 {
  0% {
    left: -200%;
    right: 100%;
  }
  60% {
    left: 107%;
    right: -8%;
  }
  100% {
    left: 107%;
    right: -8%;
  }
}

.script-run-console {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
}

.script-run-log {
  white-space: pre-wrap;
  word-break: normal;
  padding: 8px 16px;
  background: var(--paper);
  border-radius: 4px;
  font-size: 16px;
  user-select: text;
}

.script-run-result {
  display: flex;
  border-radius: 4px;
  padding: 6px 16px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
}

.script-run-result.success {
  background: #2e7d32;
}

.script-run-result.error {
  background: #d32f2f;
}

.alert-icon {
  display: flex;
  padding: 7px 0;
  margin-right: 12px;
  opacity: 0.9;
  font-size: 22px;
}

.alert-message {
  flex: 1;
  min-width: 0;
  padding: 8px 0;
  font-size: 14px;
  font-weight: 500;
  overflow: auto;
  user-select: text;
}

.alert-title {
  display: block;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.5;
  margin: -2px 0 5.6px;
}

.alert-action {
  display: flex;
  align-items: flex-start;
  padding: 4px 0 0 16px;
  margin-right: -8px;
}

.script-run-btn {
  display: inline-flex;
  align-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.75;
  letter-spacing: 0.4px;
  padding: 6px 8px;
  min-width: 64px;
  border-radius: 4px;
  word-break: keep-all;
}

.script-run-btn :deep(.icon) {
  font-size: 20px;
  margin: 0 8px 0 -4px;
}

.script-run-btn:hover {
  background: rgba(0, 0, 0, 0.04);
}
</style>
