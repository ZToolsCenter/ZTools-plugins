<template>
  <div class="settings">
    <h2 class="settings-title">百度翻译密钥设置</h2>
    <p class="settings-desc">
      密钥仅保存在本机（加密存储），不上传网络。
      <a href="#" @click.prevent="openConsole">申请密钥 →</a>
    </p>

    <label class="field">
      <span class="field-label">APPID</span>
      <input
        v-model="appId"
        class="field-input"
        type="text"
        placeholder="百度翻译开放平台的 APPID"
        autocomplete="off"
        spellcheck="false"
      />
    </label>

    <label class="field">
      <span class="field-label">密钥 Secret Key</span>
      <div class="secret-row">
        <input
          v-model="secret"
          class="field-input"
          :type="showSecret ? 'text' : 'password'"
          :placeholder="creds?.hasSecret ? '已保存（输入可覆盖）' : '百度翻译开放平台的密钥'"
          autocomplete="new-password"
          spellcheck="false"
        />
        <button class="icon-btn" :title="showSecret ? '隐藏' : '显示'" @click="showSecret = !showSecret">
          {{ showSecret ? '🙈' : '👁' }}
        </button>
      </div>
      <span v-if="creds?.hasSecret" class="field-hint">
        已为 APPID「{{ creds.appId }}」保存密钥。密钥无法查看，重新输入即可覆盖。
      </span>
    </label>

    <div class="settings-actions">
      <button class="primary-btn" :disabled="!canSave" @click="save">保存</button>
      <button v-if="creds" class="danger-btn" @click="clear">清除密钥</button>
    </div>

    <p v-if="tip" :class="['tip', tipOk ? 'tip-ok' : 'tip-err']">{{ tip }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置面板：填百度翻译的 APPID + Secret Key。
 * 明文只在输入框里存在，保存时直接交给 preload 加密落盘。
 *
 * @author yhx
 */
import { computed, ref } from 'vue'
import { api } from '../api'
import { errMsgOf } from '../baidu'
import type { CredsInfo } from '../types'

const props = defineProps<{ creds: CredsInfo | null }>()
const emit = defineEmits<{ saved: [CredsInfo]; cleared: [] }>()

const appId = ref(props.creds?.appId ?? '')
const secret = ref('')
const showSecret = ref(false)
const tip = ref('')
const tipOk = ref(false)

/** 已有密钥时允许只改 APPID（secret 留空 = 沿用旧密钥） */
const canSave = computed(() => !!appId.value.trim() && (!!secret.value.trim() || !!props.creds))

async function save() {
  tip.value = ''
  const res = await api.saveCreds(appId.value.trim(), secret.value.trim())
  if (res.ok) {
    tipOk.value = true
    tip.value = '已加密保存'
    secret.value = ''
    emit('saved', api.loadCreds()!)
  } else {
    tipOk.value = false
    tip.value = errMsgOf(res.reason)
  }
}

async function clear() {
  await api.clearCreds()
  appId.value = ''
  secret.value = ''
  tipOk.value = false
  tip.value = '已清除本机保存的密钥'
  emit('cleared')
}

function openConsole() {
  ;(api as unknown as { openConsole(): void }).openConsole()
}
</script>
