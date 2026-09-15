<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Power, RefreshCw, ShieldCheck, X } from 'lucide-vue-next'
import type { ServerStatus } from '../types'

const props = defineProps<{ server: ServerStatus | null; busy: boolean }>()
const emit = defineEmits<{ close: []; regenerate: []; toggle: [] }>()
const copied = ref(false)
const digits = computed(() => props.server?.pairingCode.split('') || [])

async function copyAddress() {
  if (!props.server?.accessUrl) return
  await navigator.clipboard.writeText(props.server.accessUrl)
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <section class="dialog pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="pair-title" aria-describedby="pair-description">
      <button class="dialog__close" type="button" aria-label="关闭" @click="emit('close')"><X :size="19" /></button>
      <header class="pairing-dialog__header">
        <div class="dialog__eyebrow"><ShieldCheck :size="15" />端到端加密配对</div>
        <h2 id="pair-title">连接一台新设备</h2>
        <p id="pair-description">让手机与电脑处于同一局域网；扫码会自动完成匹配，也可打开地址后手动连接。</p>
      </header>

      <template v-if="server?.running">
        <div class="pairing-dialog__body">
          <div class="pairing-step pairing-step--scan">
            <div class="pairing-step__label"><span>1</span>手机扫码，自动安全连接</div>
            <div class="qr-frame"><img :src="server.qrDataUrl" alt="设备配对二维码"></div>
          </div>
          <div class="pairing-step pairing-step--verify">
            <div class="pairing-step__label"><span>2</span>无法扫码？使用地址和手动匹配码</div>
            <div class="pair-code" :aria-label="`本次手动匹配码 ${server.pairingCode}`"><span v-for="(digit, index) in digits" :key="index" aria-hidden="true">{{ digit }}</span></div>
            <div class="pair-address"><span>{{ server.accessUrl }}</span><button type="button" @click="copyAddress"><Copy :size="14" />{{ copied ? '已复制' : '复制地址' }}</button></div>
            <p class="pairing-hint">直接打开上方地址时，再输入本次匹配码。已授权设备以后会自动连接。</p>
          </div>
        </div>
        <footer class="pairing-dialog__footer">
          <p class="privacy-note">二维码包含本次一次性授权信息，请勿分享链接或截图；手动连接受匹配码、错误锁定与设备授权保护。</p>
          <div class="dialog-actions"><button class="button button--secondary" type="button" @click="emit('regenerate')"><RefreshCw :size="16" />刷新配对信息</button><button class="button button--primary" type="button" @click="emit('close')">完成</button></div>
        </footer>
      </template>
      <template v-else>
        <div class="pairing-dialog__offline">
          <div class="server-off"><Power :size="24" /><strong>接收服务尚未启动</strong><span>启动后才能发现和连接其他设备。</span></div>
          <button class="button button--primary button--wide" type="button" :disabled="busy" @click="emit('toggle')">启动接收服务</button>
        </div>
      </template>
    </section>
  </div>
</template>
