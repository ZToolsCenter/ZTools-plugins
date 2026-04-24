<template>
  <div class="signature-tool">
    <h2>加密签名</h2>
    <p class="desc">根据规则拼接参数后生成加密签名，适用于 API 接口对接场景</p>

    <!-- 参数列表 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">参数列表</span>
        <el-button type="primary" size="small" @click="addParam">
          <el-icon><Plus /></el-icon>添加参数
        </el-button>
      </div>
      <div class="param-list">
        <div v-for="(p, i) in params" :key="i" class="param-row">
          <el-input v-model="p.key" placeholder="Key" class="param-key" size="small" />
          <el-input v-model="p.value" placeholder="Value" class="param-value" size="small">
            <template #suffix>
              <el-tooltip content="填入当前时间戳" placement="top" :show-after="500">
                <el-icon class="fill-btn" @click.stop="fillTimestamp(i)"><Clock /></el-icon>
              </el-tooltip>
              <el-tooltip content="填入随机 UUID" placement="top" :show-after="500">
                <el-icon class="fill-btn" @click.stop="fillUUID(i)"><Key /></el-icon>
              </el-tooltip>
            </template>
          </el-input>
          <el-button
            type="danger"
            link
            size="small"
            :disabled="params.length <= 1"
            @click="removeParam(i)"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <!-- 配置项 -->
    <div class="section config-section">
      <div class="config-row">
        <label class="config-label">哈希算法</label>
        <el-select v-model="algorithm" class="config-value" size="small">
          <el-option label="SHA-256" value="SHA-256" />
          <el-option label="SHA-512" value="SHA-512" />
          <el-option label="SHA-1" value="SHA-1" />
          <el-option label="MD5" value="MD5" />
          <el-option label="HMAC-SHA256" value="HMAC-SHA256" />
          <el-option label="HMAC-SHA512" value="HMAC-SHA512" />
        </el-select>
      </div>
      <div v-if="isHmac" class="config-row">
        <label class="config-label">HMAC 密钥</label>
        <el-input v-model="hmacKey" placeholder="请输入 HMAC 密钥" class="config-value" size="small" />
      </div>
      <div class="config-row">
        <label class="config-label">拼接方式</label>
        <el-radio-group v-model="joinMode" size="small">
          <el-radio-button value="direct">直接拼接</el-radio-button>
          <el-radio-button value="kv">Key=Value</el-radio-button>
          <el-radio-button value="sorted">排序拼接</el-radio-button>
        </el-radio-group>
      </div>
      <div class="config-row">
        <label class="config-label">分隔符</label>
        <el-input v-model="separator" placeholder="默认为空" class="config-value separator-input" size="small" />
      </div>
      <div class="config-row">
        <label class="config-label">输出格式</label>
        <el-radio-group v-model="outputFormat" size="small">
          <el-radio-button value="hex">Hex</el-radio-button>
          <el-radio-button value="base64">Base64</el-radio-button>
        </el-radio-group>
      </div>
    </div>

    <!-- 生成按钮 -->
    <div class="section">
      <el-button type="primary" size="small" @click="generate" :loading="loading">
        生成签名
      </el-button>
    </div>

    <!-- 结果 -->
    <div v-if="result" class="section result-section">
      <div class="result-block">
        <div class="result-label">
          拼接原文
          <el-button type="primary" link size="small" @click="copyText(rawString)">复制</el-button>
        </div>
        <div class="result-value raw-value">{{ rawString }}</div>
      </div>
      <div class="result-block">
        <div class="result-label">
          签名结果 ({{ algorithm }} · {{ outputFormat }})
          <el-button type="primary" link size="small" @click="copyText(result)">复制</el-button>
        </div>
        <div class="result-value signature-value">{{ result }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import { Plus, Delete, Clock, Key } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

interface Param {
  key: string
  value: string
}

const params = ref<Param[]>([
  { key: 'appId', value: '' },
  { key: 'nonce', value: '' },
  { key: 'timestamp', value: '' },
  { key: 'appsecret', value: '' },
])

const algorithm = ref('SHA-256')
const joinMode = ref<'direct' | 'kv' | 'sorted'>('direct')
const separator = ref('')
const outputFormat = ref<'hex' | 'base64'>('hex')
const hmacKey = ref('')
const loading = ref(false)
const rawString = ref('')
const result = ref('')

const isHmac = computed(() => algorithm.value.startsWith('HMAC'))

function addParam() {
  params.value.push({ key: '', value: '' })
}

function removeParam(index: number) {
  params.value.splice(index, 1)
}

function fillTimestamp(index: number) {
  params.value[index].value = String(Math.floor(Date.now() / 1000))
}

function fillUUID(index: number) {
  params.value[index].value = crypto.randomUUID()
}

function buildRawString(): string {
  const sep = separator.value
  let items: Param[]
  if (joinMode.value === 'sorted') {
    items = [...params.value].sort((a, b) => a.key.localeCompare(b.key))
  } else {
    items = params.value
  }
  if (joinMode.value === 'kv') {
    const kvSep = sep || '&'
    return items.map(p => `${p.key}=${p.value}`).join(kvSep)
  }
  return items.map(p => p.value).join(sep)
}

// 纯 JS MD5 实现（RFC 1321）
function md5(input: string): string {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const bytes = md5Bytes(data)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function md5Bytes(input: Uint8Array): Uint8Array {
  let msgLen = input.length
  // Pre-processing: adding padding bits
  const bitLen = msgLen * 8
  // Append bit '1' (0x80), then pad to 56 mod 64
  const padLen = (64 - ((msgLen + 9) % 64)) % 64
  const totalLen = msgLen + 1 + padLen + 8
  const msg = new Uint8Array(totalLen)
  msg.set(input)
  msg[msgLen] = 0x80
  // Append length in bits as 64-bit little-endian
  const view = new DataView(msg.buffer)
  view.setUint32(totalLen - 8, bitLen >>> 0, true)
  view.setUint32(totalLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true)

  // MD5 rounds
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476

  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  }

  for (let offset = 0; offset < totalLen; offset += 64) {
    const M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true)
    }
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return out
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

async function generate() {
  if (isHmac.value && !hmacKey.value.trim()) {
    ElMessage.warning('HMAC 算法需要输入密钥')
    return
  }
  const raw = buildRawString()
  rawString.value = raw
  loading.value = true

  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(raw)

    let hashBuf: ArrayBuffer

    if (algorithm.value === 'MD5') {
      result.value = md5(raw)
      loading.value = false
      return
    } else if (isHmac.value) {
      const hashName = algorithm.value.replace('HMAC-', 'SHA-') as 'SHA-256' | 'SHA-512'
      const keyData = encoder.encode(hmacKey.value)
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: hashName }, false, ['sign']
      )
      hashBuf = await crypto.subtle.sign('HMAC', cryptoKey, data)
    } else {
      hashBuf = await crypto.subtle.digest(algorithm.value as 'SHA-1' | 'SHA-256' | 'SHA-512', data)
    }

    result.value = outputFormat.value === 'hex' ? bufToHex(hashBuf) : bufToBase64(hashBuf)
  } catch (e: any) {
    ElMessage.error('生成失败：' + e.message)
  } finally {
    loading.value = false
  }
}

function copyText(text: string) {
  const doCopy = window.ztools?.copyText
    ? Promise.resolve(window.ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}
</script>

<style scoped>
.signature-tool {
  padding: 20px 24px;
  max-width: 640px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 20px;
  font-size: 13px;
}

.section {
  margin-bottom: 18px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.param-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.param-key {
  width: 140px;
  flex-shrink: 0;
}

.param-value {
  flex: 1;
}

.fill-btn {
  cursor: pointer;
  color: #909399;
  margin-left: 2px;
  font-size: 14px;
  transition: color 0.2s;
}

.fill-btn:hover {
  color: #667eea;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-label {
  width: 80px;
  flex-shrink: 0;
  font-weight: 500;
  color: #606266;
  text-align: right;
}

.config-value {
  flex: 1;
  max-width: 320px;
}

.separator-input {
  max-width: 120px;
}

.result-section {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 16px;
  background: #fafafa;
}

.result-block {
  margin-bottom: 14px;
}

.result-block:last-child {
  margin-bottom: 0;
}

.result-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  color: #909399;
}

.result-value {
  font-family: Consolas, 'Courier New', monospace;
  word-break: break-all;
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
}

.raw-value {
  background: #f0f2f5;
  color: #606266;
}

.signature-value {
  background: #ecf5ff;
  color: #667eea;
  font-weight: 500;
}

@media (prefers-color-scheme: dark) {
  .section-title {
    color: #e0e0e0;
  }

  .config-label {
    color: #b0b0b0;
  }

  .desc {
    color: #8a8a8a;
  }

  .result-section {
    border-color: #414243;
    background: #2b2b2b;
  }

  .raw-value {
    background: #1e1e1e;
    color: #c0c0c0;
  }

  .signature-value {
    background: #1a2744;
    color: #8ba4f7;
  }

  h2 {
    color: #e0e0e0;
  }

  .fill-btn {
    color: #666;
  }

  .fill-btn:hover {
    color: #8ba4f7;
  }
}
</style>
