<script setup lang="ts">
import { onMounted, ref } from 'vue'

type EnterAction = {
  code?: string
}

type LaunchResult = {
  wechatPath: string
  count: number
}

const currentCode = ref('')
const wechatPath = ref('')
const count = ref(2)
const status = ref('')
const error = ref('')
const isLaunching = ref(false)

function setMessage(message: string, isError = false) {
  status.value = isError ? '' : message
  error.value = isError ? message : ''
}

function loadConfig() {
  const config = window.services.readConfig()
  wechatPath.value = config.wechatPath || window.services.findWeChatPath()
  count.value = config.count || 2
}

function launch(targetCount: number) {
  isLaunching.value = true
  try {
    const result: LaunchResult = window.services.launchWeChat(targetCount, wechatPath.value)
    wechatPath.value = result.wechatPath
    count.value = result.count
    setMessage('')
    return true
  } catch (launchError) {
    const message = launchError instanceof Error ? launchError.message : String(launchError)
    setMessage(message, true)
    window.services.notify(message)
    return false
  } finally {
    isLaunching.value = false
  }
}

function launchTwoAndExit() {
  if (launch(2)) {
    window.ztools.outPlugin()
  }
}

function openSettings() {
  try {
    const selected = window.services.pickWeChatPath()
    if (!selected) return

    wechatPath.value = selected
    window.services.saveConfig({ wechatPath: selected, count: count.value })
    setMessage('')
  } catch (settingsError) {
    const message = settingsError instanceof Error ? settingsError.message : String(settingsError)
    setMessage(message, true)
    window.services.notify(message)
  }
}

function askCountAndLaunch() {
  currentCode.value = 'custom-launch'
  setMessage('')
}

function confirmCountAndLaunch() {
  const nextCount = Number(count.value)
  if (!Number.isFinite(nextCount) || nextCount < 1 || nextCount > 20) {
    setMessage('请输入 1 到 20 之间的数字', true)
    return
  }

  count.value = Math.floor(nextCount)
  if (launch(count.value)) {
    currentCode.value = ''
  }
}

onMounted(() => {
  loadConfig()

  window.ztools.onPluginEnter((action: EnterAction) => {
    currentCode.value = action.code || 'custom-launch'
    loadConfig()

    if (action.code === 'settings') {
      openSettings()
    }

    if (action.code === 'launch-two') {
      launchTwoAndExit()
    }

    if (action.code === 'custom-launch') {
      askCountAndLaunch()
    }
  })

  window.ztools.onPluginOut(() => {
    currentCode.value = ''
    setMessage('')
  })
})
</script>

<template>
  <main class="app">
    <section v-if="currentCode === 'custom-launch'" class="panel compact-panel">
      <div class="count-picker solo">
        <label for="launch-count">开几个</label>
        <div class="count-row">
          <input id="launch-count" v-model.number="count" type="number" min="1" max="20" step="1" autofocus>
          <button class="primary" type="button" @click="confirmCountAndLaunch" :disabled="isLaunching">
            确认
          </button>
        </div>
      </div>

      <p v-if="error" class="status error">{{ error }}</p>
    </section>

    <template v-else>
      <header class="header">
        <div>
          <h1>微信多开</h1>
          <p>{{ wechatPath || '未设置微信路径' }}</p>
        </div>
      </header>

      <section class="panel">
      <div class="button-grid">
        <button class="secondary" type="button" @click="openSettings">
          微信多开设置
        </button>
        <button class="primary" type="button" @click="launch(2)" :disabled="isLaunching">
          微信双开
        </button>
        <button class="primary" type="button" @click="askCountAndLaunch" :disabled="isLaunching">
          微信多开
        </button>
      </div>

      <p v-if="status" class="status">{{ status }}</p>
      <p v-if="error" class="status error">{{ error }}</p>
      </section>
    </template>
  </main>
</template>
