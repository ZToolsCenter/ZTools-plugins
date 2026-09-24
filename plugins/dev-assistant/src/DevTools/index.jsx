import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { evalLine, generateVariableNameResults, getToolById, getToolResults } from './tools.js'
import JsonViewer from './JsonViewer.jsx'
import Calendar from './Calendar.jsx'
import { getHost } from '../host.js'
import './index.css'

const DEFAULT_TOOL_ID = 'json'

const TOOL_GROUPS = [
  { id: 'conversion', name: '常用转换', defaultToolId: 'json', toolIds: ['json', 'sql-gorm', 'json-go', 'base64', 'url', 'union-decode', 'qrcode', 'uuid'] },
  { id: 'productivity', name: '效率工具', defaultToolId: 'crontab', toolIds: ['crontab', 'variable-naming'] },
  { id: 'other', name: '其他工具', defaultToolId: 'time', toolIds: ['time', 'calc', 'calendar'] }
]

const CRON_EXAMPLES = [
  { expr: '* * * * *', desc: '每分钟' },
  { expr: '*/5 * * * *', desc: '每 5 分钟' },
  { expr: '0 * * * *', desc: '每小时整点' },
  { expr: '0 9 * * *', desc: '每天 09:00' },
  { expr: '0 9 * * 1-5', desc: '工作日 09:00' },
  { expr: '0 9 1 * *', desc: '每月 1 日 09:00' },
  { expr: '0 0 * * 0', desc: '每周日 00:00' },
  { expr: '0 2 * * *', desc: '每天凌晨 02:00' },
  { expr: '30 8 * * 1-5', desc: '工作日 08:30' },
  { expr: '0 0 1 1 *', desc: '每年 1 月 1 日 00:00' }
]

const VARIABLE_CONFIG_KEY = 'devtools.variableNaming.baiduConfig'
const EMPTY_VARIABLE_CONFIG = { appId: '', secretKey: '' }

export default function DevTools ({ enterAction }) {
  const [activeToolId, setActiveToolId] = useState(DEFAULT_TOOL_ID)
  const [input, setInput] = useState(() => getToolById(DEFAULT_TOOL_ID).sample)
  const [results, setResults] = useState([])
  const [jsonParsed, setJsonParsed] = useState(null)
  const [jsonRaw, setJsonRaw] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrDecoded, setQrDecoded] = useState('')
  const [qrMode, setQrMode] = useState('generate') // 'generate' | 'decode'
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)
  const [variableConfig, setVariableConfig] = useState(EMPTY_VARIABLE_CONFIG)
  const [variableConfigSaved, setVariableConfigSaved] = useState(false)
  const [variableLoading, setVariableLoading] = useState(false)
  const inputRef = useRef(null)

  const activeTool = useMemo(() => getToolById(activeToolId), [activeToolId])
  const activeGroup = useMemo(() => {
    return TOOL_GROUPS.find((group) => group.toolIds.includes(activeToolId)) ?? TOOL_GROUPS[0]
  }, [activeToolId])
  const activeGroupTools = useMemo(() => {
    return activeGroup.toolIds.map((toolId) => getToolById(toolId)).filter(Boolean)
  }, [activeGroup])
  const isJson = activeToolId === 'json'
  const isQr = activeToolId === 'qrcode'
  const isCron = activeToolId === 'crontab'
  const isCalc = activeToolId === 'calc'
  const isCalendar = activeToolId === 'calendar'
  const isVariableNaming = activeToolId === 'variable-naming'

  const run = useCallback(async (toolId, value) => {
    setError('')
    setResults([])
    setJsonParsed(null)
    setJsonRaw('')
    setQrDataUrl('')
    setQrDecoded('')

    const tool = getToolById(toolId)
    if (!value.trim() && tool.autoRunEmpty !== true) return
    if (toolId === 'variable-naming') return

    try {
      const out = getToolResults(toolId, value)
      if (out && typeof out.then === 'function') {
        const resolved = await out
        setResults(resolved)
      } else {
        setResults(out)
      }
    } catch (err) {
      if (err.message === '__async__' && err.promise) {
        try {
          const resolved = await err.promise
          setResults(resolved)
        } catch (asyncErr) {
          setError(asyncErr.message)
        }
        return
      }
      if (err.message === '__qrcode__' && err.text) {
        try {
          const url = await QRCode.toDataURL(err.text, { width: 300, margin: 2, color: { dark: '#1a1d1a', light: '#ffffff' } })
          setQrDataUrl(url)
        } catch (qrErr) {
          setError(`二维码生成失败：${qrErr.message}`)
        }
        return
      }
      setError(err.message)
    }

    // JSON 工具额外解析 AST 供 viewer 用
    if (toolId === 'json' && value.trim()) {
      try {
        const raw = value.trim()
        // 处理转义字符串的情况
        let target = raw
        if (raw.startsWith('"') && raw.endsWith('"')) {
          try { target = JSON.parse(raw) } catch {}
        }
        const parsed = JSON.parse(target)
        setJsonParsed(parsed)
        setJsonRaw(target)
      } catch {}
    }
  }, [])

  useEffect(() => {
    run(activeToolId, input)
  }, [activeToolId, input, run])

  useEffect(() => {
    setVariableConfig(loadVariableConfig())
  }, [])

  useEffect(() => {
    if (enterAction?.type === 'over' && typeof enterAction.payload === 'string') {
      setInput(enterAction.payload)
    }
  }, [enterAction])

  const handleSelectTool = (toolId) => {
    setActiveToolId(toolId)
    setResults([])
    setError('')
    setJsonParsed(null)
    setQrDataUrl('')
    setQrDecoded('')
    setQrMode('generate')
    setVariableConfigSaved(false)
    setVariableLoading(false)
    const tool = getToolById(toolId)
    setInput(tool.sample ?? '')
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleSelectGroup = (group) => {
    if (group.toolIds.includes(activeToolId)) return
    handleSelectTool(group.defaultToolId)
  }

  const handleCopy = async (value, id) => {
    try {
      const host = getHost()
      if (host?.copyText) {
        host.copyText(value)
      } else {
        await navigator.clipboard.writeText(value)
      }
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {}
  }

  // 解析图片中的二维码
  const decodeQrFromFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    setError('')
    setQrDecoded('')
    const bitmap = await window.createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(imageData.data, imageData.width, imageData.height)
    if (result) {
      setQrDecoded(result.data)
    } else {
      setError('未识别到二维码，请确认图片中包含清晰的二维码')
    }
  }, [])

  const handleQrFileDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) decodeQrFromFile(file)
  }, [decodeQrFromFile])

  const handleQrFilePick = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) decodeQrFromFile(file)
    e.target.value = ''
  }, [decodeQrFromFile])

  // 处理粘贴图片（Ctrl+V）
  useEffect(() => {
    if (!isQr || qrMode !== 'decode') return
    const handlePaste = (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      if (item) {
        const file = item.getAsFile()
        if (file) decodeQrFromFile(file)
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [isQr, qrMode, decodeQrFromFile])
  const handleSaveVariableConfig = () => {
    const nextConfig = {
      appId: variableConfig.appId.trim(),
      secretKey: variableConfig.secretKey.trim()
    }
    saveVariableConfig(nextConfig)
    setVariableConfig(nextConfig)
    setVariableConfigSaved(true)
    setTimeout(() => setVariableConfigSaved(false), 1500)
  }

  const handleGenerateVariableNames = async () => {
    const text = input.trim()
    const appId = variableConfig.appId.trim()
    const secretKey = variableConfig.secretKey.trim()

    setError('')
    setResults([])

    if (!text) {
      setError('请输入需要命名的中文或短语')
      return
    }
    if (!appId || !secretKey) {
      setError('请先填写百度翻译 App ID 和密钥')
      return
    }
    if (!window.services?.translateWithBaidu) {
      setError('当前环境缺少百度翻译服务，请在 ztools / uTools 中运行插件')
      return
    }

    setVariableLoading(true)
    try {
      const translated = await window.services.translateWithBaidu({ query: text, appId, secretKey })
      const namingRows = generateVariableNameResults(translated)
      setResults([
        { id: 'var-translated', label: '英文翻译', value: translated },
        ...namingRows
      ])
    } catch (err) {
      setError(err.message || '百度翻译请求失败，请检查网络或 API 配置')
    } finally {
      setVariableLoading(false)
    }
  }

  const handleJsonAction = async (action) => {
    if (!jsonParsed && !input.trim()) return
    const raw = input.trim()
    let target = raw
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { target = JSON.parse(raw) } catch {}
    }

    let result = ''
    try {
      const parsed = JSON.parse(target)
      if (action === 'minify') result = JSON.stringify(parsed)
      if (action === 'format') result = JSON.stringify(parsed, null, 2)
      if (action === 'escape') result = JSON.stringify(JSON.stringify(parsed))
      if (action === 'copy-format') {
        await handleCopy(JSON.stringify(parsed, null, 2), 'json-action-copy')
        return
      }
      if (action === 'copy-minify') {
        await handleCopy(JSON.stringify(parsed), 'json-action-copy-min')
        return
      }
      if (result) setInput(result)
    } catch {
      // 处理普通文本转义
      if (action === 'escape') result = JSON.stringify(raw)
      if (result) setInput(result)
    }
  }

  return (
    <div className='dt'>
      <header className='dt__topbar'>
        <div className='dt__brand'>
          <span>zTools 插件</span>
          <strong>研发工具箱</strong>
        </div>
        <nav className='dt__nav' aria-label='工具分组'>
          {TOOL_GROUPS.map((group) => (
            <button
              key={group.id}
              type='button'
              className={group.id === activeGroup.id ? 'is-active' : ''}
              onClick={() => handleSelectGroup(group)}
            >
              {group.name}
            </button>
          ))}
        </nav>
      </header>

      <main className='dt__main'>
        <nav className='dt__tool-switcher' aria-label={`${activeGroup.name}工具`}>
          {activeGroupTools.map((tool) => (
            <button
              key={tool.id}
              type='button'
              className={tool.id === activeToolId ? 'is-active' : ''}
              onClick={() => handleSelectTool(tool.id)}
            >
              <span>{tool.name}</span>
              <small>{tool.description}</small>
            </button>
          ))}
        </nav>

        {/* JSON 工具：编辑器 + 树状视图 */}
        {isCalendar
          ? (
            <Calendar />
            )
          : isCalc
            ? (
              <CalcPad input={input} setInput={setInput} inputRef={inputRef} placeholder={activeTool.placeholder} />
              )
            : isJson
              ? (
                <div className='dt__json-layout'>
                  <div className='dt__json-editor-wrap'>
                    <div className='dt__editor-label'>输入</div>
                    <textarea
                      ref={inputRef}
                      className='dt__json-editor'
                      value={input}
                      placeholder={activeTool.placeholder}
                      spellCheck={false}
                      onChange={(e) => setInput(e.target.value)}
                    />
                  </div>

                  <div className='dt__json-viewer-wrap'>
                    <div className='dt__editor-label'>预览</div>
                    {error
                      ? <div className='dt__error' role='alert'>{error}</div>
                      : jsonParsed !== null
                        ? <JsonViewer value={jsonParsed} raw={jsonRaw} />
                        : <div className='dt__json-empty'>粘贴 JSON 后显示树状视图</div>}
                  </div>
                </div>
                )
              : (
            /* 其他工具：输入框 + 结果列表 */
                <>
                  {isQr && (
                    <div className='dt__qr-tabs'>
                      <button
                        type='button'
                        className={qrMode === 'generate' ? 'is-active' : ''}
                        onClick={() => { setQrMode('generate'); setQrDecoded(''); setError('') }}
                      >
                        生成二维码
                      </button>
                      <button
                        type='button'
                        className={qrMode === 'decode' ? 'is-active' : ''}
                        onClick={() => { setQrMode('decode'); setQrDataUrl(''); setError('') }}
                      >
                        解析图片
                      </button>
                    </div>
                  )}

                  {isVariableNaming && (
                    <div className='dt__variable-panel'>
                      <div className='dt__variable-config'>
                        <label>
                          <span>App ID</span>
                          <input
                            type='text'
                            value={variableConfig.appId}
                            placeholder='百度翻译 App ID'
                            onChange={(e) => setVariableConfig((prev) => ({ ...prev, appId: e.target.value }))}
                          />
                        </label>
                        <label>
                          <span>密钥</span>
                          <input
                            type='password'
                            value={variableConfig.secretKey}
                            placeholder='百度翻译密钥'
                            onChange={(e) => setVariableConfig((prev) => ({ ...prev, secretKey: e.target.value }))}
                          />
                        </label>
                        <button type='button' onClick={handleSaveVariableConfig}>
                          {variableConfigSaved ? '已保存' : '保存配置'}
                        </button>
                      </div>
                    </div>
                  )}

                  {(!isQr || qrMode === 'generate') && !isVariableNaming && (
                    <div className='dt__input-wrap'>
                      <textarea
                        ref={inputRef}
                        className='dt__input'
                        value={input}
                        placeholder={activeTool.placeholder}
                        spellCheck={false}
                        onChange={(e) => setInput(e.target.value)}
                      />
                      {input && (
                        <button type='button' className='dt__input-clear' aria-label='清空' onClick={() => setInput('')}>✕</button>
                      )}
                    </div>
                  )}

                  {isVariableNaming && (
                    <div className='dt__variable-workspace'>
                      <div className='dt__input-wrap'>
                        <textarea
                          ref={inputRef}
                          className='dt__input'
                          value={input}
                          placeholder={activeTool.placeholder}
                          spellCheck={false}
                          onChange={(e) => setInput(e.target.value)}
                        />
                        {input && (
                          <button type='button' className='dt__input-clear' aria-label='清空' onClick={() => setInput('')}>✕</button>
                        )}
                      </div>
                      <button
                        type='button'
                        className='dt__variable-generate'
                        disabled={variableLoading}
                        onClick={handleGenerateVariableNames}
                      >
                        {variableLoading ? '生成中...' : '生成变量名'}
                      </button>
                    </div>
                  )}

                  {error && <div className='dt__error' role='alert'>{error}</div>}

                  {isQr && qrMode === 'generate' && (
                    <>
                      {qrDataUrl && (
                        <div className='dt__qr-wrap'>
                          <img src={qrDataUrl} alt='二维码' className='dt__qr-img' />
                          <div className='dt__qr-actions'>
                            <button
                              type='button'
                              onClick={() => {
                                const a = document.createElement('a')
                                a.href = qrDataUrl
                                a.download = 'qrcode.png'
                                a.click()
                              }}
                            >
                              下载 PNG
                            </button>
                            <button
                              type='button'
                              onClick={async () => {
                                try {
                                  const res = await fetch(qrDataUrl)
                                  const blob = await res.blob()
                                  await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
                                  setCopiedId('qr-copy')
                                  setTimeout(() => setCopiedId(null), 1500)
                                } catch {}
                              }}
                            >
                              {copiedId === 'qr-copy' ? '已复制 ✓' : '复制图片'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {isQr && qrMode === 'decode' && (
                    <div
                      className={`dt__qr-drop${dragOver ? ' is-over' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleQrFileDrop}
                    >
                      <div className='dt__qr-drop-hint'>
                        <svg width='36' height='36' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5'>
                          <rect x='3' y='3' width='7' height='7' rx='1' /><rect x='14' y='3' width='7' height='7' rx='1' />
                          <rect x='3' y='14' width='7' height='7' rx='1' /><rect x='14' y='14' width='4' height='4' rx='1' />
                          <rect x='20' y='14' width='1' height='1' /><rect x='14' y='20' width='1' height='1' /><rect x='20' y='20' width='1' height='1' />
                        </svg>
                        <p>拖入图片 / 粘贴图片（Ctrl+V）</p>
                        <label className='dt__qr-file-btn'>
                          选择文件
                          <input type='file' accept='image/*' onChange={handleQrFilePick} hidden />
                        </label>
                      </div>
                      {qrDecoded && (
                        <div className='dt__qr-decoded'>
                          <div className='dt__qr-decoded-label'>识别结果</div>
                          <div className='dt__qr-decoded-value'>{qrDecoded}</div>
                          <div className='dt__qr-actions'>
                            <button
                              type='button'
                              onClick={() => handleCopy(qrDecoded, 'qr-decoded')}
                            >
                              {copiedId === 'qr-decoded' ? '已复制 ✓' : '复制'}
                            </button>
                            <button type='button' onClick={() => { setInput(qrDecoded); setQrMode('generate') }}>
                              生成该内容的二维码
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isQr && results.length > 0 && (
                    <ul className='dt__results'>
                      {results.map((row) => (
                        <li key={row.id} className={`dt__result-row${row.id === 'cron-next' ? ' dt__result-row--pre' : ''}`}>
                          <span className='dt__result-label'>{row.label}</span>
                          <span className='dt__result-value'>{row.value}</span>
                          <button
                            type='button'
                            className={`dt__copy-btn${copiedId === row.id ? ' is-copied' : ''}`}
                            aria-label={`复制 ${row.label}`}
                            onClick={() => handleCopy(row.value, row.id)}
                          >
                            {copiedId === row.id
                              ? '✓'
                              : (
                                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                                  <rect x='9' y='9' width='13' height='13' rx='2' />
                                  <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
                                </svg>
                                )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {isCron && !error && !results.length && (
                    <div className='dt__cron-examples'>
                      <div className='dt__cron-examples-title'>常用示例</div>
                      <ul className='dt__cron-examples-list'>
                        {CRON_EXAMPLES.map((ex) => (
                          <li key={ex.expr} onClick={() => setInput(ex.expr)}>
                            <code>{ex.expr}</code>
                            <span>{ex.desc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
                )}
      </main>

      {/* JSON 工具底部操作栏 */}
      {isJson && (
        <footer className='dt__json-footer'>
          <button type='button' onClick={() => handleJsonAction('format')}>格式化</button>
          <button type='button' onClick={() => handleJsonAction('minify')}>压缩</button>
          <button type='button' onClick={() => handleJsonAction('escape')}>转义</button>
          <span className='dt__json-footer-sep' />
          <button type='button' onClick={() => handleJsonAction('copy-format')}>
            {copiedId === 'json-action-copy' ? '已复制 ✓' : '复制格式化'}
          </button>
          <button type='button' onClick={() => handleJsonAction('copy-minify')}>
            {copiedId === 'json-action-copy-min' ? '已复制 ✓' : '复制压缩'}
          </button>
          {input && (
            <button type='button' className='dt__json-footer-clear' onClick={() => setInput('')}>清空</button>
          )}
        </footer>
      )}
    </div>
  )
}

function loadVariableConfig () {
  try {
    const host = getHost()
    const stored = host?.dbStorage?.getItem?.(VARIABLE_CONFIG_KEY)
    if (stored?.appId || stored?.secretKey) {
      return {
        appId: stored.appId || '',
        secretKey: stored.secretKey || ''
      }
    }
  } catch {}

  try {
    const raw = window.localStorage?.getItem(VARIABLE_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        appId: parsed.appId || '',
        secretKey: parsed.secretKey || ''
      }
    }
  } catch {}

  return EMPTY_VARIABLE_CONFIG
}

function saveVariableConfig (config) {
  try {
    const host = getHost()
    host?.dbStorage?.setItem?.(VARIABLE_CONFIG_KEY, config)
  } catch {}

  try {
    window.localStorage?.setItem(VARIABLE_CONFIG_KEY, JSON.stringify(config))
  } catch {}
}

// ─── CalcPad 组件 ──────────────────────────────────────────────────────────

function CalcPad ({ input, setInput, inputRef, placeholder }) {
  const lines = input.split('\n')
  const results = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null
    return evalLine(trimmed)
  })

  return (
    <div className='calc-pad'>
      <div className='calc-pad__rows'>
        {lines.map((line, i) => {
          const res = results[i]
          const trimmed = line.trim()
          return (
            <div key={i} className='calc-pad__row'>
              <div className='calc-pad__expr'>{trimmed || <span className='calc-pad__placeholder'>输入表达式…</span>}</div>
              {res && !res.error && (
                <div className='calc-pad__result'>
                  = {Number.isInteger(res.value)
                  ? res.value.toLocaleString('zh-CN')
                  : parseFloat(res.value.toPrecision(12)).toLocaleString('zh-CN', { maximumFractionDigits: 10 })}
                </div>
              )}
              {res && res.error && (
                <div className='calc-pad__result calc-pad__result--error'>{res.error}</div>
              )}
            </div>
          )
        })}
      </div>
      <textarea
        ref={inputRef}
        className='calc-pad__input'
        value={input}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
      />
    </div>
  )
}
