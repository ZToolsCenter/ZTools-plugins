import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  binaryToBytes,
  bytesToBinary,
  bytesToHex,
  decodeJwt,
  decryptAes,
  digestHex,
  encryptAes,
  formatJson,
  hexToBytes,
  hmacHex,
  htmlDecode,
  htmlEncode,
  minifyJson,
  textToBytes,
  bytesToText,
  unicodeEscapeDecode,
  unicodeEscapeEncode,
  urlDecode,
  urlEncode,
  verifyJwtHs
} from './codec.js'

const categories = [
  {
    id: 'encoding',
    label: '编码转换',
    operations: [
      op('base64-encode', 'Base64 编码', ({ input }) => base64Encode(input)),
      op('base64-decode', 'Base64 解码', ({ input }) => base64Decode(input)),
      op('base64url-encode', 'Base64URL 编码', ({ input }) => base64UrlEncode(input)),
      op('base64url-decode', 'Base64URL 解码', ({ input }) => base64UrlDecode(input)),
      op('url-encode', 'URL Component 编码', ({ input }) => urlEncode(input)),
      op('url-decode', 'URL Component 解码', ({ input }) => urlDecode(input)),
      op('url-form-decode', 'URL Form 解码', ({ input }) => urlDecode(input, 'form')),
      op('html-encode', 'HTML Entity 编码', ({ input }) => htmlEncode(input)),
      op('html-decode', 'HTML Entity 解码', ({ input }) => htmlDecode(input)),
      op('unicode-encode', 'Unicode escape 编码', ({ input }) => unicodeEscapeEncode(input)),
      op('unicode-decode', 'Unicode escape 解码', ({ input }) => unicodeEscapeDecode(input)),
      op('hex-encode', 'Hex 编码 UTF-8', ({ input }) => bytesToHex(textToBytes(input))),
      op('hex-decode', 'Hex 解码 UTF-8', ({ input }) => bytesToText(hexToBytes(input))),
      op('binary-encode', 'Binary 编码 UTF-8', ({ input }) => bytesToBinary(textToBytes(input))),
      op('binary-decode', 'Binary 解码 UTF-8', ({ input }) => bytesToText(binaryToBytes(input)))
    ]
  },
  {
    id: 'hash',
    label: '哈希与签名',
    operations: [
      op('md5', 'MD5', ({ input }) => digestHex('MD5', input)),
      op('sha1', 'SHA-1', ({ input }) => digestHex('SHA-1', input)),
      op('sha256', 'SHA-256', ({ input }) => digestHex('SHA-256', input)),
      op('sha384', 'SHA-384', ({ input }) => digestHex('SHA-384', input)),
      op('sha512', 'SHA-512', ({ input }) => digestHex('SHA-512', input)),
      op('hmac-sha256', 'HMAC-SHA256', ({ input, secret }) => hmacHex('SHA-256', input, secret), {
        keyLabel: 'HMAC 密钥'
      }),
      op('hmac-sha384', 'HMAC-SHA384', ({ input, secret }) => hmacHex('SHA-384', input, secret), {
        keyLabel: 'HMAC 密钥'
      }),
      op('hmac-sha512', 'HMAC-SHA512', ({ input, secret }) => hmacHex('SHA-512', input, secret), {
        keyLabel: 'HMAC 密钥'
      })
    ]
  },
  {
    id: 'crypto',
    label: '对称加密',
    operations: [
      op('aes-gcm-encrypt', 'AES-GCM 加密', ({ input, secret }) => encryptAes(input, secret, 'AES-GCM'), {
        keyLabel: '口令'
      }),
      op('aes-gcm-decrypt', 'AES-GCM 解密', ({ input, secret }) => decryptAes(input, secret), {
        keyLabel: '口令'
      }),
      op('aes-cbc-encrypt', 'AES-CBC 加密', ({ input, secret }) => encryptAes(input, secret, 'AES-CBC'), {
        keyLabel: '口令'
      }),
      op('aes-cbc-decrypt', 'AES-CBC 解密', ({ input, secret }) => decryptAes(input, secret), {
        keyLabel: '口令'
      })
    ]
  },
  {
    id: 'jwt',
    label: 'JWT',
    operations: [
      op('jwt-decode', 'JWT 解码', ({ input }) => JSON.stringify(decodeJwt(input), null, 2)),
      op(
        'jwt-verify-hs',
        'JWT HS 校验',
        async ({ input, secret }) => {
          const decoded = decodeJwt(input)
          const verified = await verifyJwtHs(input, secret)
          return JSON.stringify({ verified, ...decoded }, null, 2)
        },
        { keyLabel: 'JWT Secret' }
      )
    ]
  },
  {
    id: 'text',
    label: '文本转换',
    operations: [
      op('json-format', 'JSON 格式化', ({ input }) => formatJson(input)),
      op('json-minify', 'JSON 压缩', ({ input }) => minifyJson(input)),
      op('json-stringify', 'JSON 字符串转义', ({ input }) => JSON.stringify(input)),
      op('json-parse-string', 'JSON 字符串反转义', ({ input }) => JSON.parse(input)),
      op('upper-case', '转大写', ({ input }) => input.toUpperCase()),
      op('lower-case', '转小写', ({ input }) => input.toLowerCase()),
      op('trim-lines', '逐行 Trim', ({ input }) =>
        input
          .split(/\r?\n/)
          .map((line) => line.trim())
          .join('\n')
      ),
      op('dedupe-lines', '逐行去重', ({ input }) => Array.from(new Set(input.split(/\r?\n/))).join('\n'))
    ]
  }
]

const operationsById = new Map()
for (const category of categories) {
  for (const operation of category.operations) operationsById.set(operation.id, operation)
}

const els = {
  categoryButtons: Array.from(document.querySelectorAll('.category-item')),
  operation: document.querySelector('#operation'),
  keyField: document.querySelector('#keyField'),
  keyLabel: document.querySelector('#keyLabel'),
  secretKey: document.querySelector('#secretKey'),
  input: document.querySelector('#inputText'),
  output: document.querySelector('#outputText'),
  run: document.querySelector('#runOperation'),
  swap: document.querySelector('#swapText'),
  paste: document.querySelector('#pasteInput'),
  copy: document.querySelector('#copyOutput'),
  clear: document.querySelector('#clearAll'),
  status: document.querySelector('#statusLine')
}

let activeCategory = 'encoding'

renderOperations(activeCategory)
bindEvents()
resizePlugin()

function op(id, label, run, options = {}) {
  return {
    id,
    label,
    run,
    keyLabel: options.keyLabel || '',
    needsKey: !!options.keyLabel
  }
}

function bindEvents() {
  for (const button of els.categoryButtons) {
    button.addEventListener('click', () => {
      activeCategory = button.dataset.category
      renderOperations(activeCategory)
    })
  }

  els.operation.addEventListener('change', () => {
    updateKeyField()
    setStatus('')
  })
  els.run.addEventListener('click', runCurrentOperation)
  els.swap.addEventListener('click', swapInputOutput)
  els.copy.addEventListener('click', copyOutput)
  els.paste.addEventListener('click', pasteInput)
  els.clear.addEventListener('click', clearAll)

  document.addEventListener('keydown', (event) => {
    const modifier = event.metaKey || event.ctrlKey
    if (modifier && event.key === 'Enter') {
      event.preventDefault()
      runCurrentOperation()
    }
  })

  window.addEventListener('resize', resizePlugin)

  if (window.ztools?.onPluginEnter) {
    window.ztools.onPluginEnter((action) => {
      const payload = action?.payload
      if (typeof payload === 'string' && payload) {
        els.input.value = payload
        setStatus('已载入启动文本')
      }
      resizePlugin()
    })
  }
}

function renderOperations(categoryId) {
  const category = categories.find((item) => item.id === categoryId) || categories[0]
  for (const button of els.categoryButtons) {
    button.classList.toggle('active', button.dataset.category === category.id)
  }

  els.operation.innerHTML = ''
  for (const operation of category.operations) {
    const option = document.createElement('option')
    option.value = operation.id
    option.textContent = operation.label
    els.operation.append(option)
  }

  updateKeyField()
  resizePlugin()
}

function updateKeyField() {
  const operation = getCurrentOperation()
  const needsKey = !!operation?.needsKey
  els.keyField.classList.toggle('hidden', !needsKey)
  els.keyLabel.textContent = operation?.keyLabel || '密钥'
}

async function runCurrentOperation() {
  const operation = getCurrentOperation()
  if (!operation) return

  setBusy(true)
  setStatus('处理中')
  try {
    const result = await operation.run({
      input: els.input.value,
      secret: els.secretKey.value
    })
    els.output.value = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    setStatus('完成')
  } catch (error) {
    els.output.value = ''
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    setBusy(false)
    resizePlugin()
  }
}

function swapInputOutput() {
  const currentOutput = els.output.value
  els.output.value = els.input.value
  els.input.value = currentOutput
  setStatus('已交换')
}

async function pasteInput() {
  try {
    els.input.value = await navigator.clipboard.readText()
    setStatus('已粘贴')
  } catch {
    setStatus('无法读取剪贴板', 'warn')
  }
}

async function copyOutput() {
  if (!els.output.value) {
    setStatus('没有可复制的结果', 'warn')
    return
  }

  try {
    if (window.ztools?.copyText) {
      window.ztools.copyText(els.output.value)
    } else {
      await navigator.clipboard.writeText(els.output.value)
    }
    setStatus('已复制')
  } catch {
    setStatus('复制失败', 'error')
  }
}

function clearAll() {
  els.input.value = ''
  els.output.value = ''
  setStatus('')
}

function getCurrentOperation() {
  return operationsById.get(els.operation.value)
}

function setBusy(isBusy) {
  els.run.disabled = isBusy
  els.run.textContent = isBusy ? '执行中' : '执行'
}

function setStatus(message, tone = '') {
  els.status.textContent = message
  els.status.classList.toggle('error', tone === 'error')
  els.status.classList.toggle('warn', tone === 'warn')
}

function resizePlugin() {
  if (!window.ztools?.setExpendHeight) return
  window.requestAnimationFrame(() => {
    const height = Math.min(Math.max(document.documentElement.scrollHeight, 430), 560)
    window.ztools.setExpendHeight(height)
  })
}
