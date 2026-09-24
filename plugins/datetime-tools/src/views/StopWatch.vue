<template>
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">秒表</h5>
      <hr />

      <div class="form-group">
        <div class="time-box">{{ display }}</div>
        <div class="btn-box">
          <button type="button" class="btn btn-outline-success" @click="toggle">
            <svg v-if="!running" class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"
              />
            </svg>
            <svg v-else class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"
              />
            </svg>
            {{ running ? '暂停' : elapsed > 0 ? '继续' : '开始' }}
          </button>
          <button type="button" class="btn btn-outline-primary" :disabled="!running" @click="lap">
            <svg class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8.5 5.5a.5.5 0 0 0-1 0v3.362l-1.429 2.38a.5.5 0 1 0 .858.515l1.5-2.5A.5.5 0 0 0 8.5 9V5.5z" />
              <path
                d="M6.5 0a.5.5 0 0 0 0 1H7v1.07a7.001 7.001 0 0 0-3.273 12.474l-.602.602a.5.5 0 0 0 .707.708l.746-.746A6.97 6.97 0 0 0 8 16a6.97 6.97 0 0 0 3.422-.892l.746.746a.5.5 0 0 0 .707-.708l-.601-.602A7.001 7.001 0 0 0 9 2.07V1h.5a.5.5 0 0 0 0-1h-3zm1.038 3.018a6.093 6.093 0 0 1 .924 0 6 6 0 1 1-.924 0zM0 3.5c0 .753.333 1.429.86 1.887A8.035 8.035 0 0 1 4.387 1.86 2.5 2.5 0 0 0 0 3.5zM13.5 1c-.753 0-1.429.333-1.887.86a8.035 8.035 0 0 1 3.527 3.527A2.5 2.5 0 0 0 13.5 1z"
              />
            </svg>
            计次
          </button>
          <button
            type="button"
            class="btn btn-outline-danger"
            :disabled="elapsed === 0"
            @click="reset"
          >
            <svg class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"
              />
              <path
                d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"
              />
            </svg>
            复位
          </button>
        </div>
      </div>

      <div class="form-group">
        <ul class="list-group log-box" v-if="logs.length">
          <li
            v-for="(item, i) in logs"
            :key="i"
            :class="[
              'list-group-item',
              item.type === 'lap' ? 'list-group-item-primary' : 'list-group-item-success'
            ]"
          >
            <svg v-if="item.type === 'lap'" class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8.5 5.5a.5.5 0 0 0-1 0v3.362l-1.429 2.38a.5.5 0 1 0 .858.515l1.5-2.5A.5.5 0 0 0 8.5 9V5.5z" />
              <path
                d="M6.5 0a.5.5 0 0 0 0 1H7v1.07a7.001 7.001 0 0 0-3.273 12.474l-.602.602a.5.5 0 0 0 .707.708l.746-.746A6.97 6.97 0 0 0 8 16a6.97 6.97 0 0 0 3.422-.892l.746.746a.5.5 0 0 0 .707-.708l-.601-.602A7.001 7.001 0 0 0 9 2.07V1h.5a.5.5 0 0 0 0-1h-3zm1.038 3.018a6.093 6.093 0 0 1 .924 0 6 6 0 1 1-.924 0zM0 3.5c0 .753.333 1.429.86 1.887A8.035 8.035 0 0 1 4.387 1.86 2.5 2.5 0 0 0 0 3.5zM13.5 1c-.753 0-1.429.333-1.887.86a8.035 8.035 0 0 1 3.527 3.527A2.5 2.5 0 0 0 13.5 1z"
              />
            </svg>
            <svg v-else class="bi" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z" />
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
            </svg>
            <span>{{ item.type === 'lap' ? '计次' : '记录' }}{{ item.index }}</span>
            <span class="float-right">{{ formatMs(item.time) }}</span>
          </li>
        </ul>
        <p class="key-tip">提示：键盘快捷键：A-开始/暂停，S-计次，C-复位</p>
      </div>

      <div class="alert alert-info">
        <b class="alert-heading">使用说明</b>
        <p>1、点击“开始”按钮或键盘“A”可以启动秒表。</p>
        <p>2、秒表计时中点击“暂停”按钮或键盘“A”可以暂停秒表，并记录当前时间。</p>
        <p>3、秒表计时中点击“计次”按钮或键盘“S”可以计次。</p>
        <p>4、点击“复位”按钮或键盘“C”可清除所有记录。</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { pad } from '../utils/date'

const props = defineProps<{ active?: boolean }>()

const elapsed = ref(0)
const running = ref(false)
const logs = ref<{ type: 'lap' | 'pause'; index: number; time: number }[]>([])

let acc = 0
let base = 0
let timer: number | undefined
let lapCount = 0
let pauseCount = 0

const tick = () => {
  elapsed.value = acc + performance.now() - base
}

const toggle = () => {
  if (running.value) {
    acc += performance.now() - base
    window.clearInterval(timer)
    elapsed.value = acc
    running.value = false
    // 暂停时记录当前时间（对齐原插件行为）
    logs.value.push({ type: 'pause', index: ++pauseCount, time: acc })
  } else {
    base = performance.now()
    timer = window.setInterval(tick, 31)
    running.value = true
  }
}

const lap = () => {
  if (!running.value) return
  tick()
  logs.value.push({ type: 'lap', index: ++lapCount, time: elapsed.value })
}

const reset = () => {
  window.clearInterval(timer)
  running.value = false
  acc = 0
  elapsed.value = 0
  logs.value = []
  lapCount = 0
  pauseCount = 0
}

// 键盘快捷键 A/S/C，仅在本标签页激活且焦点不在输入框时响应
const onKeydown = (e: KeyboardEvent) => {
  if (!props.active) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const key = e.key.toLowerCase()
  if (key === 'a') toggle()
  else if (key === 's') lap()
  else if (key === 'c') reset()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearInterval(timer)
})

const formatMs = (ms: number) => {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = Math.floor(ms % 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`
}

const display = computed(() => formatMs(elapsed.value))
</script>

<style scoped>
/* 对齐原插件：60px 红色大数字，与记录列表同为 400px 定宽居中块 */
.time-box {
  width: 400px;
  margin: 0 auto 14px;
  font-size: 60px;
  color: #cc221a;
  font-family: Avenir, Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
}

.btn-box {
  text-align: center;
}

.btn-box .btn {
  margin: 0 4px;
}

.bi {
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
}

.log-box {
  width: 400px;
  margin: 10px auto;
}

.log-box .list-group-item {
  padding: 10px 18px;
}

.log-box .bi {
  margin-right: 4px;
}

.key-tip {
  color: #909399;
  font-size: 13px;
  margin: 10px 0 0;
  text-align: center;
}
</style>
