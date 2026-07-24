<script setup>
import { reactive, ref } from 'vue'
import { useConfig } from '@/composables/useConfig'

const { snapshot, save } = useConfig()
const form = reactive(snapshot())
const testing = ref(false)
const message = ref(null) // { kind: 'ok'|'err', text }

const emit = defineEmits(['saved'])

function setMsg(kind, text) {
  message.value = { kind, text }
}

async function onTest() {
  setMsg(null, '')
  testing.value = true
  try {
    if (!form.host || !form.username || !form.remoteDir) {
      throw new Error('host / username / remoteDir 不能为空')
    }
    if (!window.sshShot) throw new Error('preload 未加载，无法测试连接')
    const r = await window.sshShot.testConnection({
      host: form.host,
      port: Number(form.port) || 22,
      username: form.username,
      password: form.password,
      remoteDir: form.remoteDir
    })
    setMsg('ok', `连接成功，远端目录可写：${r.remoteDir}`)
  } catch (e) {
    setMsg('err', e.message || String(e))
  } finally {
    testing.value = false
  }
}

function onSave() {
  save({
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
    password: form.password,
    remoteDir: form.remoteDir.trim()
  })
  setMsg('ok', '配置已保存')
  emit('saved')
}
</script>

<template>
  <div class="config card">
    <h2 style="margin-top:0">SSH 截图配置</h2>
    <p style="color:var(--muted);margin-top:0">
      配置后，使用 <b>「粘贴截图路径」</b> 命令时会把剪贴板里的截图上传到下面指定的远端目录，并把远端路径自动粘贴到上一个焦点窗口。
    </p>

    <div class="row">
      <div class="field" style="flex:3">
        <label>Host</label>
        <input v-model="form.host" placeholder="192.168.1.10 或 example.com" />
      </div>
      <div class="field" style="flex:1">
        <label>Port</label>
        <input v-model="form.port" type="number" placeholder="22" />
      </div>
    </div>

    <div class="field">
      <label>Username</label>
      <input v-model="form.username" placeholder="root" />
    </div>

    <div class="field">
      <label>Password</label>
      <input v-model="form.password" type="password" placeholder="登录密码（明文存储于本机 dbStorage）" />
    </div>

    <div class="field">
      <label>远端截图存放路径（绝对路径）</label>
      <input v-model="form.remoteDir" placeholder="/home/user/shots" />
    </div>

    <div style="display:flex;gap:8px;align-items:center">
      <button class="primary" @click="onSave">保存</button>
      <button @click="onTest" :disabled="testing">{{ testing ? '测试中…' : '测试连接' }}</button>
      <span v-if="message" :style="{color: message.kind === 'ok' ? 'var(--ok)' : 'var(--danger)', marginLeft: '8px'}">
        {{ message.text }}
      </span>
    </div>
  </div>
</template>
