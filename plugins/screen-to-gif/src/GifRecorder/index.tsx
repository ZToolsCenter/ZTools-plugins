import { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'

type RecorderMode = 'screen' | 'window' | 'region'
type RecorderPhase = 'idle' | 'region-pick' | 'countdown' | 'recording' | 'converting' | 'done' | 'error'

interface SourceOption {
  id: string
  name: string
  display_id?: string
}

interface ActiveSettings {
  mode: RecorderMode
  fps: number
  scalePercent: number
  autoStopSeconds: number
  sourceId: string
  region: GifRegionRect | null
  sourceScale: number
}

const FPS_OPTIONS = [5, 10, 15, 24]
const SCALE_OPTIONS = [50, 75, 100]
const AUTO_STOP_OPTIONS = [
  { label: '手动停止', value: 0 },
  { label: '5秒', value: 5 },
  { label: '10秒', value: 10 },
  { label: '30秒', value: 30 }
]

// 通用等待函数，用于倒计时和录制间隔
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 把秒数格式化成 mm:ss
function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

// 根据录屏流实际尺寸和显示器 DIP 宽度，计算选区到视频像素的缩放系数
function getSourceScale(stream: MediaStream, display: Display | undefined, fallback: number) {
  try {
    const track = stream.getVideoTracks()[0]
    const settings = track?.getSettings()
    if (settings?.width && display?.bounds.width) {
      const ratio = settings.width / display.bounds.width
      if (ratio > 0.1 && ratio < 10) return ratio
    }
  } catch {
    // 拿不到流尺寸时使用系统 scaleFactor 兜底
  }
  return fallback
}

export default function GifRecorder() {
  const [mode, setMode] = useState<RecorderMode>('screen')
  const [displays, setDisplays] = useState<Display[]>([])
  const [activeDisplayId, setActiveDisplayId] = useState(0)
  const [screenSources, setScreenSources] = useState<SourceOption[]>([])
  const [windowSources, setWindowSources] = useState<SourceOption[]>([])
  const [activeWindowId, setActiveWindowId] = useState('')

  const [fps, setFps] = useState(10)
  const [scalePercent, setScalePercent] = useState(75)
  const [autoStopSeconds, setAutoStopSeconds] = useState(0)
  const [autoStopMenuOpen, setAutoStopMenuOpen] = useState(false)
  const [region, setRegion] = useState<GifRegionRect | null>(null)

  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [countdown, setCountdown] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const [gifPath, setGifPath] = useState('')
  const [gifUrl, setGifUrl] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const [error, setError] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const webmPathRef = useRef('')
  const gifPathRef = useRef('')
  const controlsWindowRef = useRef<any>(null)
  const regionWindowRef = useRef<any>(null)
  const autoStopTimerRef = useRef<number | undefined>(undefined)
  const settingsRef = useRef<ActiveSettings | null>(null)
  const phaseRef = useRef<RecorderPhase>('idle')
  const startRecordingRef = useRef<(region?: GifRegionRect, autoStopSeconds?: number) => Promise<void>>(async () => {})
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {})

  // 同步阶段到 ref，供子窗口消息回调读取最新的状态
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // 阶段切换时收起时长下拉，避免录制中残留错误状态
  useEffect(() => {
    setAutoStopMenuOpen(false)
  }, [phase])

  // 加载显示器信息和可用的录屏源
  useEffect(() => {
    const allDisplays = window.ztools.getAllDisplays()
    setDisplays(allDisplays)
    if (allDisplays[0]) setActiveDisplayId(allDisplays[0].id)

    const loadSources = async () => {
      try {
        const [screenList, windowList] = await Promise.all([
          window.ztools.desktopCaptureSources({
            types: ['screen'],
            thumbnailSize: { width: 240, height: 140 },
            fetchWindowIcons: false
          }),
          window.ztools.desktopCaptureSources({
            types: ['window'],
            thumbnailSize: { width: 240, height: 140 },
            fetchWindowIcons: false
          })
        ])
        setScreenSources(screenList as any as SourceOption[])
        setWindowSources(windowList as any as SourceOption[])
        const firstWindow = windowList[0] as any as SourceOption | undefined
        if (firstWindow?.id) {
          setActiveWindowId((current) => current || firstWindow.id)
        }
      } catch {
        // 权限未授予时先让用户主动点击，提示信息由 startRecording 统一处理
      }
    }
    loadSources()
  }, [])

  // 监听区域框选窗口和停止控制条发回的消息
  useEffect(() => {
    window.services.onChildMessage('gif-region-selected', (rect: GifRegionRect & { autoStopSeconds?: number }) => {
      if (phaseRef.current !== 'region-pick') return
      window.services.closeWindow(regionWindowRef.current)
      regionWindowRef.current = null
      setRegion(rect)
      const pendingAutoStopSeconds = typeof rect.autoStopSeconds === 'number' ? rect.autoStopSeconds : autoStopSeconds
      setAutoStopSeconds(pendingAutoStopSeconds)
      setAutoStopMenuOpen(false)
      // 用户在选区窗口点击“开始录制”时直接进入倒计时，不再停留回 idle
      startRecordingRef.current(rect, pendingAutoStopSeconds)
    })

    window.services.onChildMessage('gif-region-cancel', () => {
      if (phaseRef.current !== 'region-pick') return
      window.services.closeWindow(regionWindowRef.current)
      regionWindowRef.current = null
      setPhase('idle')
    })

    window.services.onChildMessage('gif-recorder-stop', () => {
      stopRecordingRef.current()
    })
  }, [])

  // 录制过程中每秒更新计时
  useEffect(() => {
    if (phase !== 'recording') return
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed((Date.now() - start) / 1000)
    }, 500)
    return () => clearInterval(timer)
  }, [phase])

  // 计算当前模式对应的目标源
  const targetSource = useMemo(() => {
    if (mode === 'window') {
      return windowSources.find((item) => item.id === activeWindowId) || windowSources[0]
    }
    return (
      screenSources.find((item) => String(item.display_id) === String(activeDisplayId)) ||
      screenSources[0]
    )
  }, [mode, screenSources, windowSources, activeDisplayId, activeWindowId])

  // 弹出全屏透明框选窗口
  const openRegionPicker = () => {
    const display = displays.find((item) => item.id === activeDisplayId) || displays[0]
    if (!display) {
      setError('没有可用的显示器')
      return
    }
    setError('')
    setRegion(null)
    setPhase('region-pick')
    regionWindowRef.current = window.services.openRegionWindow(display, autoStopSeconds)
  }

  // 根据模式解析要录制显示源 id
  const resolveSourceId = () => {
    return targetSource?.id || ''
  }

  // 清理录音对象和临时文件
  const cleanupRecorder = () => {
    window.services.closeWindow(controlsWindowRef.current)
    controlsWindowRef.current = null
    clearTimeout(autoStopTimerRef.current)
    autoStopTimerRef.current = undefined
  }

  // MediaRecorder 使用的 MIME 类型候选
  const pickMimeType = () => {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    return candidates.find((item) => MediaRecorder.isTypeSupported(item)) || ''
  }

  // 开始录制：倒计时 -> 隐藏主窗口 -> 捕获屏幕 -> 写 WebM
  // presetRegion 由选区窗口传入，可直接跳过“回到主界面再点一次开始”
  const startRecording = async (presetRegion?: GifRegionRect, presetAutoStopSeconds?: number) => {
    if (phase === 'converting' || phase === 'countdown') return
    setError('')

    const regionToUse = presetRegion || region
    if (mode === 'region' && !regionToUse) {
      openRegionPicker()
      return
    }
    if (mode === 'region' && presetRegion) {
      setRegion(presetRegion)
    }

    const sourceId = resolveSourceId()
    if (!sourceId) {
      setError('没有找到可用的录屏源，请检查 ZTools 的屏幕录制权限')
      setPhase('error')
      return
    }

    const activeDisplay = displays.find((item) => item.id === activeDisplayId) || displays[0]
    const displayScale = activeDisplay?.scaleFactor || 1
    const effectiveAutoStopSeconds = presetAutoStopSeconds ?? autoStopSeconds
    if (typeof presetAutoStopSeconds === 'number') {
      setAutoStopSeconds(presetAutoStopSeconds)
      setAutoStopMenuOpen(false)
    }

    // 记录本次录制的完整参数，后续转换 GIF 时使用
    settingsRef.current = {
      mode,
      fps,
      scalePercent,
      autoStopSeconds: effectiveAutoStopSeconds,
      sourceId,
      region: regionToUse,
      sourceScale: displayScale
    }

    // 先展示主窗口再倒计时，区域录制确认后也能看到主窗口里的 3 秒倒计时
    window.ztools.showMainWindow()
    setPhase('countdown')
    for (let number = 3; number >= 1; number--) {
      setCountdown(number)
      await sleep(1000)
    }

    // 隐藏主窗口，让屏幕录制不被插件界面遮挡
    window.ztools.hideMainWindow()

    try {
      // 通过 Electron 的 desktopCapturer 拿到屏幕流
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: Math.max(fps, 30)
          }
        } as any
      })

      // 用真实视频流尺寸重新校准选区缩放，避免 Retina 屏上裁剪位置偏移
      const sourceScale = getSourceScale(stream, activeDisplay, displayScale)
      if (settingsRef.current) {
        settingsRef.current.sourceScale = sourceScale
      }

      const webmPath = window.services.createTempFile('webm')
      webmPathRef.current = webmPath
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      // 每收集一小段数据就写到本地临时 WebM
      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          const buffer = await event.data.arrayBuffer()
          window.services.appendFile(webmPath, buffer)
        }
      }
      recorder.onerror = () => {
        setError('录制器发生错误，请重新开始')
      }

      mediaRecorderRef.current = recorder
      recorder.start(1000)
      setElapsed(0)
      setPhase('recording')

      // 打开置顶的停止控制条，并处理定时自动停止
      controlsWindowRef.current = window.services.openControlsWindow()
      if (effectiveAutoStopSeconds > 0) {
        autoStopTimerRef.current = window.setTimeout(() => {
          stopRecordingRef.current()
        }, effectiveAutoStopSeconds * 1000)
      }
    } catch (err: any) {
      window.ztools.showMainWindow()
      const message = err?.name === 'NotAllowedError' ? '未获得屏幕录制权限' : err?.message
      setError(`屏幕捕获失败：${message || '未知错误'}`)
      setPhase('error')
    }
  }

  // 停止录制并转成 GIF
  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current
    const webmPath = webmPathRef.current
    if (!recorder || recorder.state === 'inactive') return

    // 先关闭控制条、恢复主窗口，避免转换时无法展示进度
    cleanupRecorder()
    window.ztools.showMainWindow()
    setPhase('converting')
    setProgress(null)

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        try {
          recorder.stream.getTracks().forEach((track) => track.stop())
        } catch {
          // 轨道可能已被系统回收
        }
        resolve()
      }
      recorder.stop()
    })
    await stopped
    mediaRecorderRef.current = null

    try {
      // 使用内置 ffmpeg 把 WebM 转成 GIF，并套用帧率和缩放参数
      const workSettings = settingsRef.current!
      const filters = [`fps=${workSettings.fps}`]

      // 区域录制时先裁剪出框选范围
      if (workSettings.mode === 'region' && workSettings.region) {
        const { x, y, width, height } = workSettings.region
        const scale = workSettings.sourceScale || 1
        filters.push(
          `crop=${Math.round(width * scale)}:${Math.round(height * scale)}:${Math.round(x * scale)}:${Math.round(y * scale)}`
        )
      }

      // 按设置的比例压缩尺寸，保证最终 GIF 不会太大
      if (workSettings.scalePercent < 100) {
        const ratio = workSettings.scalePercent / 100
        filters.push(
          `scale=trunc(iw*${ratio}/2)*2:trunc(ih*${ratio}/2)*2:flags=lanczos`
        )
      }

      // 调色板优化：先用视频生成调色板，再按调色板输出 GIF
      filters.push(
        'split[s0][s1]',
        '[s0]palettegen=stats_mode=diff[p]',
        '[s1][p]paletteuse=dither=sierra2_4a'
      )
      const filterGraph = filters.join(',')
      const outputPath = window.services.createTempFile('gif')

      await window.ztools.runFFmpeg(
        [
          '-y',
          '-i', webmPath,
          '-an',
          '-vf', filterGraph,
          '-loop', '0',
          outputPath
        ],
        (info) => {
          // ffmpeg 不一定每轮都回报百分比，没有时保持动态进度
          if (info && typeof info.percent === 'number') {
            setProgress(Math.round(info.percent * 100) / 100)
          }
        }
      )

      // 清理临时 WebM，保存结果供页面预览
      window.services.removeFile(webmPath)
      if (gifPathRef.current) window.services.removeFile(gifPathRef.current)
      gifPathRef.current = outputPath
      setGifPath(outputPath)
      setGifUrl(window.services.readFileAsDataUrl(outputPath))
      setSavedPath('')
      setPhase('done')
    } catch (err: any) {
      window.ztools.showMainWindow()
      setError(`GIF 转换失败：${err?.message || '未知错误'}`)
      setPhase('error')
    }
  }

  // 用 ref 保存停止函数，子窗口消息和自动停止计时器都能拿到最新引用
  useEffect(() => {
    stopRecordingRef.current = stopRecording
  })
  useEffect(() => {
    startRecordingRef.current = startRecording
  })

  // 重新开始前清理上一次的临时 GIF
  const resetForNewRecording = () => {
    if (gifPathRef.current) {
      window.services.removeFile(gifPathRef.current)
      gifPathRef.current = ''
    }
    setGifPath('')
    setGifUrl('')
    setSavedPath('')
    setError('')
    setProgress(null)
    setElapsed(0)
    setPhase('idle')
  }

  // 保存 GIF 到用户选择的位置
  const handleSave = () => {
    if (!gifPath) return
    const saved = window.services.saveGifTo(gifPath)
    if (saved) {
      setSavedPath(saved)
      window.ztools.shellShowItemInFolder(saved)
    }
  }

  // 复制 GIF 到系统剪贴板
  const handleCopy = () => {
    if (!gifPath) return
    window.ztools.copyImage(gifPath)
    window.ztools.showNotification('GIF 已复制到剪贴板')
  }

  // 在资源管理器中显示最终 GIF；尚未保存时先弹出保存框
  const handleReveal = () => {
    if (!gifPath) return
    let target = savedPath
    if (!target) {
      target = window.services.saveGifTo(gifPath)
      if (target) setSavedPath(target)
    }
    if (!target) return
    window.ztools.shellShowItemInFolder(target)
  }

  const isBusy = phase === 'countdown' || phase === 'converting' || phase === 'region-pick'
  const primaryLabel = phase === 'recording'
    ? '停止录制'
    : phase === 'converting'
      ? '转换中'
      : phase === 'countdown'
        ? '倒计时中'
        : phase === 'region-pick'
          ? '框选中'
          : phase === 'done'
            ? '再录一次'
            : autoStopSeconds > 0
              ? `录制${autoStopSeconds}秒`
              : '开始录制'

  // 主按钮动作：空闲时开始，录制中停止，完成或异常后重新开始
  const handlePrimaryAction = () => {
    setAutoStopMenuOpen(false)
    if (phase === 'recording') {
      stopRecording()
      return
    }
    if (phase === 'done' || phase === 'error') {
      resetForNewRecording()
      if (phase === 'error') startRecording()
      return
    }
    startRecording()
  }

  return (
    <div className="gif-recorder">
      <div className="gif-panel">
        <section className="gif-settings">
          <div className="setting-row">
            <label>录制模式</label>
            <div className="segmented">
              <button className={mode === 'screen' ? 'active' : ''} onClick={() => setMode('screen')}>全屏</button>
              <button className={mode === 'window' ? 'active' : ''} onClick={() => setMode('window')}>窗口</button>
              <button className={mode === 'region' ? 'active' : ''} onClick={() => setMode('region')}>区域</button>
            </div>
          </div>

          <div className="setting-row">
            <label>{mode === 'window' ? '窗口源' : '显示器'}</label>
            {mode === 'window' ? (
              <select value={activeWindowId} onChange={(e) => setActiveWindowId(e.target.value)} disabled={isBusy}>
                {windowSources.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            ) : (
              <select
                value={activeDisplayId}
                onChange={(e) => setActiveDisplayId(Number(e.target.value))}
                disabled={isBusy}
              >
                {displays.map((item) => (
                  <option key={item.id} value={item.id}>
                    显示器 {item.bounds.width} × {item.bounds.height}
                  </option>
                ))}
              </select>
            )}
          </div>

          {mode === 'region' && (
            <div className="setting-row region-row">
              <label>选区</label>
              <div className="region-value">
                {region ? `${Math.round(region.width)} × ${Math.round(region.height)}px` : '未选择'}
                <button className="text-button" onClick={openRegionPicker} disabled={isBusy}>
                  {region ? '重选' : '框选'}
                </button>
              </div>
            </div>
          )}

          <div className="setting-row">
            <label>帧率</label>
            <div className="segmented">
              {FPS_OPTIONS.map((item) => (
                <button key={item} className={fps === item ? 'active' : ''} onClick={() => setFps(item)} disabled={isBusy}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row">
            <label>尺寸</label>
            <div className="segmented">
              {SCALE_OPTIONS.map((item) => (
                <button
                  key={item}
                  className={scalePercent === item ? 'active' : ''}
                  onClick={() => setScalePercent(item)}
                  disabled={isBusy}
                >
                  {item}%
                </button>
              ))}
            </div>
          </div>

        </section>

        <section className="gif-stage">
          {phase === 'idle' && (
            <div className="idle-stage">
              <div className="stage-icon">GIF</div>
              <p>屏幕片段转 GIF</p>
            </div>
          )}

          {phase === 'region-pick' && (
            <div className="status-box">
              <div className="live-indicator">框选中</div>
              <span>在透明窗口中选择录制区域</span>
            </div>
          )}

          {phase === 'countdown' && (
            <div className="countdown-box">
              {countdown}
            </div>
          )}

          {phase === 'recording' && (
            <div className="status-box recording-box">
              <div className="live-indicator">REC</div>
              <span>{formatDuration(elapsed)}</span>
            </div>
          )}

          {phase === 'converting' && (
            <div className="status-box">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: progress === null || progress === 0 ? '38%' : `${progress}%` }}
                />
              </div>
              <span>{progress === null ? '正在转换 GIF' : `转换 ${progress.toFixed(0)}%`}</span>
            </div>
          )}

          {phase === 'done' && gifUrl && (
            <div className="preview-area">
              <img src={gifUrl} alt="GIF 预览" />
            </div>
          )}

          {phase === 'error' && (
            <div className="error-box">
              <span>出现错误</span>
              <p>{error}</p>
            </div>
          )}

          {error && phase !== 'error' && <div className="error-line">{error}</div>}
        </section>
      </div>

      <div className="gif-actions">
        <div className={`record-combo${autoStopMenuOpen ? ' open' : ''}`}>
          <button className="primary-action" disabled={isBusy} onClick={handlePrimaryAction}>
            {primaryLabel}
          </button>
          <button
            className="combo-toggle"
            type="button"
            aria-label="录制时长"
            disabled={isBusy || phase === 'recording'}
            onClick={() => setAutoStopMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </button>
          {autoStopMenuOpen && (
            <div className="combo-menu" role="menu">
              {AUTO_STOP_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  className={autoStopSeconds === item.value ? 'active' : ''}
                  role="menuitemradio"
                  aria-checked={autoStopSeconds === item.value}
                  onClick={() => {
                    setAutoStopSeconds(item.value)
                    setAutoStopMenuOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {phase === 'done' && (
          <>
            <button className="action" onClick={handleSave}>保存</button>
            <button className="action" onClick={handleCopy}>复制</button>
            <button className="action" onClick={handleReveal}>打开所在文件夹</button>
          </>
        )}
      </div>
    </div>
  )
}
