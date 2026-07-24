// ==================== 编解码工具 ====================
// 从 app.js 抽出：LZMA 压缩/解压、AES/Base64 加解密、二维码生成。
// 完全自包含（含 .btn-codec 按钮分发器）。依赖 app.js 全局：$ /
// pushUndo / currentState / persistCurrent / updateCount / showToast，
// 及外部 LZMA / qrcode / crypto.subtle。必须在 app.js 之后加载。

// 整体替换编辑区内容（带撤销/持久化），不受当前选区影响
function replaceEditorAll(label, newText) {
  const editor = $('editor')
  const before = editor.value
  if (newText === before) return
  flushTyping()
  pushUndo({ value: before, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd })
  editor.value = newText
  persistCurrent()
  updateCount()
  if ($('lang-select').value === 'markdown') renderMarkdown()
  if ($('lang-select').value === 'html') renderHtml()
  showUndo(label)
}

// 文本压缩：调用 textpack 的 lzma 模式，把编辑区文本压成 Z85 纯文本
async function codecCompress() {
  const text = $('editor').value
  if (!text.trim()) { showToast('编辑区无内容'); return }
  if (!window.textTool?.runPython || !window.textTool?.getPluginDir) {
    showToast('文本压缩需要 uTools 运行环境'); return
  }
  const tpRoot = window.textTool.getPluginDir().replace(/\\/g, '/') + '/textpack'
  const b64 = btoa(unescape(encodeURIComponent(text)))
  const code = `import sys, base64
sys.path.insert(0, r'${tpRoot}')
from textpack import codecs, container, z85
def _pad4(d):
    return d + b"\\x00" * ((-len(d)) % 4)
data = base64.b64decode("${b64}")
compressed = codecs.compress('lzma', data)
blob = container.build(codecs.codec_id('lzma'), data, compressed)
print(z85.encode(_pad4(blob)))`
  const { python: pythonBin = '' } = loadRuntimeConfig()
  showToast('正在压缩…')
  try {
    const { stdout, stderr } = await window.textTool.runPython(code, 30, pythonBin)
    const result = (stdout || '').trim()
    if (!result) {
      showToast('压缩失败：' + ((stderr || '').trim().split('\n').pop() || '无输出'))
      return
    }
    replaceEditorAll('文本压缩(LZMA)', result)
  } catch {
    showToast('压缩失败')
  }
}

// 文本解压：把 codecCompress 产出的 Z85 纯文本还原回原始文本
async function codecDecompress() {
  const text = $('editor').value
  if (!text.trim()) { showToast('编辑区无内容'); return }
  if (!window.textTool?.runPython || !window.textTool?.getPluginDir) {
    showToast('文本解压需要 uTools 运行环境'); return
  }
  const tpRoot = window.textTool.getPluginDir().replace(/\\/g, '/') + '/textpack'
  const b64 = btoa(unescape(encodeURIComponent(text)))
  const code = `import sys, base64
sys.path.insert(0, r'${tpRoot}')
from textpack import codecs, container, z85
z85_text = base64.b64decode("${b64}").decode('utf-8').strip()
blob = z85.decode(z85_text)
codec_id, orig_len, payload, digest = container.parse(blob)
data = codecs.decompress_by_id(codec_id, payload)
container.verify(data, digest)
print(base64.b64encode(data).decode('ascii'))`
  const { python: pythonBin = '' } = loadRuntimeConfig()
  showToast('正在解压…')
  try {
    const { stdout, stderr } = await window.textTool.runPython(code, 30, pythonBin)
    const out = (stdout || '').trim()
    if (!out) {
      showToast('解压失败：' + ((stderr || '').trim().split('\n').pop() || '无输出'))
      return
    }
    const result = decodeURIComponent(escape(atob(out)))
    replaceEditorAll('文本解压(LZMA)', result)
  } catch {
    showToast('解压失败')
  }
}

// 由口令经 PBKDF2 派生 AES-256 密钥
async function deriveAesKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// AES-256-GCM 加密：输出 salt(16)+iv(12)+密文 的 Base64 纯文本
async function aesEncrypt(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(password, salt)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
  const out = new Uint8Array(28 + ct.byteLength)
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(ct), 28)
  let binary = ''
  out.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

// AES-256-GCM 解密：口令错或密文被篡改会抛错
async function aesDecrypt(b64, password) {
  let data
  try {
    const binary = atob(b64.trim())
    data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
  } catch { throw new Error('AES 解密失败：内容不是有效密文') }
  if (data.length < 29) throw new Error('AES 解密失败：内容不是有效密文')
  const key = await deriveAesKey(password, data.slice(0, 16))
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(16, 28) }, key, data.slice(28))
    return new TextDecoder().decode(pt)
  } catch { throw new Error('AES 解密失败：密钥错误或内容被篡改') }
}

// AES/Base64 卡片：有密钥走 AES，留空走 Base64
function codecCrypto(mode) {
  const key = $('aes-key').value
  if (mode === 'encode') {
    if (key) return applyOp('AES加密', text => aesEncrypt(text, key))
    return applyOp('Base64编码', ops.base64Encode)
  }
  if (key) return applyOp('AES解密', text => aesDecrypt(text, key))
  return applyOp('Base64解码', ops.base64Decode)
}

// 内容转二维码：弹窗显示
function codecQrcode() {
  const text = $('editor').value
  if (!text) { showToast('编辑区无内容'); return }
  if (typeof qrcode === 'undefined') { showToast('二维码库未加载'); return }
  try {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']
    const qr = qrcode(0, 'M') // 0=自动选择版本，M=中等纠错
    qr.addData(text)
    qr.make()
    $('qr-canvas-wrap').innerHTML = qr.createImgTag(6, 12)
    $('qr-modal').style.display = ''
  } catch (e) {
    showToast('内容过长，无法生成二维码（超出容量上限）')
  }
}

document.querySelectorAll('.btn-codec').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.codecTool
    if (tool === 'compress') return codecCompress()
    if (tool === 'decompress') return codecDecompress()
    if (tool === 'qrcode') return codecQrcode()
    if (tool === 'aesEncode') return codecCrypto('encode')
    if (tool === 'aesDecode') return codecCrypto('decode')
    const op = ops[btn.dataset.op]
    if (op) applyOp(btn.textContent, op)
  })
})

function closeQrModal() { $('qr-modal').style.display = 'none' }
$('qr-overlay').addEventListener('click', closeQrModal)
$('qr-close').addEventListener('click', closeQrModal)
