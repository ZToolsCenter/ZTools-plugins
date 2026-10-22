import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { FiRefreshCw, FiLock, FiUnlock, FiAlertTriangle, FiCheck } from 'react-icons/fi'
import './index.css'
import { searchProcesses } from './search'
import { useProcessData, CACHE_TTL } from './useProcessData'
import { basename, isPathLike, normalizePath } from './fileLock'

interface Props {
  keyword: string
}

type LockStatus = 'idle' | 'loading' | 'done' | 'error'
type LockSource = 'keyword' | 'row'

interface KillTarget {
  pid: number
  name: string
  isHolder: boolean
}

interface StateBlockProps {
  kind: 'lock' | 'unlock' | 'success' | 'error'
  icon: ReactNode
  title: string
  text: string
  actions: ReactNode
}

function StateBlock({ kind, icon, title, text, actions }: StateBlockProps) {
  return (
    <div className="pm-state">
      <span className={`pm-state-icon ${kind}`}>{icon}</span>
      <div className="pm-state-title">{title}</div>
      <div className="pm-state-text">{text}</div>
      <div className="pm-state-actions">{actions}</div>
    </div>
  )
}

export default function ProcessManager({ keyword }: Props) {
  const { processes, loading, refresh, lastUpdated } = useProcessData()
  const [toast, setToast] = useState('')
  const [killModal, setKillModal] = useState<KillTarget | null>(null)
  const [killing, setKilling] = useState(false)

  const [lockView, setLockView] = useState(false)
  const [lockStatus, setLockStatus] = useState<LockStatus>('idle')
  const [lockPath, setLockPath] = useState('')
  const [lockSource, setLockSource] = useState<LockSource>('keyword')
  const [holders, setHolders] = useState<FileHolder[]>([])
  const [lockError, setLockError] = useState('')
  const [clearedByKill, setClearedByKill] = useState(false)
  const lockRequest = useRef(0)
  const lockKeyword = useRef('')

  const barRef = useRef<HTMLDivElement>(null)
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const fill = barRef.current
    if (!fill) return
    const tick = () => {
      const pct = Math.min((Date.now() - startRef.current) / CACHE_TTL * 100, 100)
      fill.style.width = pct + '%'
      rafRef.current = requestAnimationFrame(tick)
    }
    startRef.current = Date.now()
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    startRef.current = Date.now()
  }, [lastUpdated])

  // 宿主搜索词一变，占用视图就回到进程列表
  useEffect(() => {
    if (!lockView) return
    if (normalizePath(keyword) !== lockKeyword.current) {
      lockRequest.current++
      setLockView(false)
      setLockStatus('idle')
      setHolders([])
      setLockError('')
      setClearedByKill(false)
    }
  }, [keyword, lockView])

  useEffect(() => {
    if (!killModal) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !killing) setKillModal(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [killModal, killing])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 1500)
  }, [])

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast('已复制: ' + text))
  }, [showToast])

  const runWhoLocks = useCallback(async (path: string, source: LockSource) => {
    const target = normalizePath(path)
    if (!target) return

    lockKeyword.current = normalizePath(keyword)
    const requestId = ++lockRequest.current

    setLockView(true)
    setLockPath(target)
    setLockSource(source)
    setLockStatus('loading')
    setHolders([])
    setLockError('')
    setClearedByKill(false)

    if (!window.services?.whoLocks) {
      setLockError('文件占用服务不可用')
      setLockStatus('error')
      return
    }

    try {
      const result = await window.services.whoLocks(target)
      if (requestId !== lockRequest.current) return
      if (result.success) {
        setHolders(result.holders || [])
        setLockStatus('done')
      } else {
        setLockError(result.error || '查询失败')
        setLockStatus('error')
      }
    } catch (err) {
      if (requestId !== lockRequest.current) return
      console.error('whoLocks error:', err)
      setLockError('查询失败')
      setLockStatus('error')
    }
  }, [keyword])

  const backToList = useCallback(() => {
    lockRequest.current++
    setLockView(false)
    setLockStatus('idle')
    setHolders([])
    setLockError('')
    setClearedByKill(false)
  }, [])

  const confirmKill = useCallback((pid: number, name: string, isHolder: boolean) => {
    setKillModal({ pid, name, isHolder })
  }, [])

  const executeKill = useCallback(async () => {
    if (!killModal || killing) return
    const target = killModal

    setKilling(true)
    const result = await window.services.killProcess(target.pid)
    setKilling(false)
    setKillModal(null)

    if (result.success) {
      if (lockView && target.isHolder) {
        const remaining = holders.filter(holder => holder.pid !== target.pid)
        setHolders(remaining)
        if (remaining.length === 0) setClearedByKill(true)
      }
      showToast(`已 Kill ${target.name} (PID: ${target.pid})`)
      refresh(true)
    } else {
      showToast(`Kill 失败: ${result.error}`)
    }
  }, [killModal, killing, lockView, holders, showToast, refresh])

  const cancelKill = useCallback(() => {
    if (killing) return
    setKillModal(null)
  }, [killing])

  const handleContextMenu = useCallback((e: React.MouseEvent, pid: number, name: string, isHolder = false) => {
    e.preventDefault()
    confirmKill(pid, name, isHolder)
  }, [confirmKill])

  const filtered = searchProcesses(keyword, processes)
  const pathLike = isPathLike(keyword)
  const holderViews = holders.map(holder => ({
    holder,
    process: processes.find(p => p.pid === holder.pid)
  }))

  const footerCount = (() => {
    if (!lockView) return `共 ${filtered.length} 个结果`
    if (lockStatus === 'loading') return '正在检查…'
    if (lockStatus === 'error') return '检查失败'
    if (holders.length > 0) return `${holders.length} 个占用进程`
    return clearedByKill ? '占用已解除' : '未发现占用'
  })()

  const renderContext = () => {
    if (!lockView) {
      if (!pathLike) return null
      const target = normalizePath(keyword)
      return (
        <div className="pm-check-card">
          <span className="pm-lock-mark"><FiLock size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">检查文件占用</div>
            <div className="pm-check-path" title={target}>{target}</div>
            <div className="pm-check-note">Restart Manager · 首次约 1–2 秒</div>
          </div>
          <button className="pm-btn-lock" onClick={() => runWhoLocks(target, 'keyword')}>检查</button>
        </div>
      )
    }

    if (lockStatus === 'loading') {
      return (
        <div className="pm-check-card loading" aria-busy="true">
          <span className="pm-lock-mark"><FiLock size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">正在检查文件占用 <span className="pm-spinner" /></div>
            <div className="pm-check-path" title={lockPath}>{lockPath}</div>
            <div className="pm-check-note">首次查询需要启动 PowerShell 并编译脚本</div>
          </div>
          <button className="pm-btn-lock" disabled>检查中…</button>
        </div>
      )
    }

    if (lockStatus === 'error') {
      return (
        <div className="pm-check-card error">
          <span className="pm-lock-mark error"><FiAlertTriangle size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">无法检查这个文件</div>
            <div className="pm-check-path" title={lockError}>{lockError}</div>
            <div className="pm-check-note">如果文件位于系统目录，尝试以管理员身份运行 ZTools。</div>
          </div>
          <div className="pm-check-actions">
            <button className="pm-btn-ghost" onClick={backToList}>返回</button>
            <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource)}>重试</button>
          </div>
        </div>
      )
    }

    const count = holders.length
    const cleared = count === 0 && clearedByKill
    return (
      <div className="pm-lock-summary">
        <span className={`pm-lock-mark${cleared ? ' success' : ''}`}>
          {cleared ? <FiUnlock size={16} /> : <FiLock size={16} />}
        </span>
        <div className="pm-check-main">
          <div className="pm-check-title">
            {count > 0 ? `${count} 个进程正在占用` : cleared ? '占用已解除' : '未发现占用'}
          </div>
          <div className="pm-check-path" title={lockPath}>{lockPath}</div>
        </div>
        <button className="pm-btn-ghost" onClick={backToList}>返回进程列表</button>
      </div>
    )
  }

  const renderLockBody = () => {
    if (lockStatus === 'loading') {
      return (
        <div className="pm-state">
          <span className="pm-state-icon"><FiLock size={20} /></span>
          <div className="pm-state-title">正在检查文件占用…</div>
          <div className="pm-state-text">首次查询会启动 PowerShell 并编译 Restart Manager 脚本，通常需要 1–2 秒。之后的查询会更快。</div>
        </div>
      )
    }

    if (lockStatus === 'error') {
      return (
        <StateBlock
          kind="error"
          icon={<FiAlertTriangle size={20} />}
          title="检查失败"
          text="Restart Manager 没有返回结果。可以重试，或检查文件是否位于受保护目录。"
          actions={(
            <>
              <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource)}>重试</button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
          )}
        />
      )
    }

    if (holderViews.length > 0) {
      return holderViews.map(({ holder, process: proc }) => {
        const name = proc ? proc.name : (holder.name || `PID ${holder.pid}`)
        const friendly = proc && holder.name && holder.name.toLowerCase() !== name.toLowerCase()
          ? holder.name
          : ''
        const ports = proc?.ports || []

        return (
          <div
            className="pm-item pm-item-held"
            key={holder.pid}
            onContextMenu={(e) => handleContextMenu(e, holder.pid, name, true)}
          >
            <div className="pm-item-top">
              <div className="pm-item-info">
                <div className="pm-item-row1">
                  <span className="pm-tag pm-tag-name" onClick={() => copy(name)}>{name}</span>
                  <span className="pm-tag pm-tag-pid" onClick={() => copy(String(holder.pid))}>{holder.pid}</span>
                  {holder.service ? (
                    <span className="pm-tag pm-tag-service" title={holder.service}>服务</span>
                  ) : null}
                  {proc?.path ? (
                    <span className="pm-path" onClick={() => copy(proc.path)} title={proc.path}>{proc.path}</span>
                  ) : null}
                </div>
                <div className="pm-tags">
                  {ports.length > 0
                    ? ports.map(port => (
                        <span key={port} className="pm-tag pm-tag-port" onClick={() => copy(String(port))}>{port}</span>
                      ))
                    : <span className="pm-tag pm-tag-none">无端口占用</span>}
                  {friendly ? <span className="pm-friendly">{friendly}</span> : null}
                  {!proc ? <span className="pm-missing">进程信息未在列表中，可能已退出或列表缓存过期</span> : null}
                </div>
              </div>
            </div>
          </div>
        )
      })
    }

    if (clearedByKill) {
      return (
        <StateBlock
          kind="success"
          icon={<FiCheck size={20} />}
          title="占用已解除"
          text="最后一个占用进程已被 Kill。现在可以删除或修改这个文件。"
          actions={(
            <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
          )}
        />
      )
    }

    return (
      <StateBlock
        kind="unlock"
        icon={<FiUnlock size={20} />}
        title="未发现占用此文件的进程"
        text="如果文件仍然无法删除，可能是系统服务或杀毒软件在瞬时扫描。稍等片刻再检查。"
        actions={(
          <>
            <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource)}>重新检查</button>
            <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
          </>
        )}
      />
    )
  }

  return (
    <div className="pm">
      <div className="pm-header">
        <div className="pm-hints">
          <span className="pm-hint pm-hint-name">进程名</span>
          <span className="pm-hint pm-hint-pid">PID</span>
          <span className="pm-hint pm-hint-port">端口号</span>
          <span className={`pm-hint pm-hint-path${pathLike && !lockView ? ' active' : ''}`}>文件路径</span>
        </div>
        <span className="pm-hint pm-hint-tip">
          {lockView ? '右键 Kill 会解除占用' : '右键 Kill · 粘贴路径查占用'}
        </span>
      </div>

      <div className="pm-context" aria-live="polite">{renderContext()}</div>

      <div className="pm-body">
        {lockView ? renderLockBody() : (
          <>
            {loading && processes.length === 0 && (
              <div className="pm-empty">正在获取进程列表...</div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="pm-empty">
                {pathLike ? (
                  <>
                    没有进程匹配这个路径
                    <br />
                    <span className="pm-empty-sub">可以在上方检查是哪个进程占用了该文件。</span>
                  </>
                ) : keyword ? '没有匹配的进程' : '暂无进程数据，请刷新'}
              </div>
            )}

            {filtered.map(p => (
              <div
                className="pm-item"
                key={p.pid}
                onContextMenu={(e) => handleContextMenu(e, p.pid, p.name)}
              >
                <div className="pm-item-top">
                  <div className="pm-item-info">
                    <div className="pm-item-row1">
                      <span className="pm-tag pm-tag-name" onClick={() => copy(p.name)}>{p.name}</span>
                      <span className="pm-tag pm-tag-pid" onClick={() => copy(String(p.pid))}>{p.pid}</span>
                      <span className="pm-path" onClick={() => copy(p.path)} title={p.path}>{p.path}</span>
                    </div>
                    <div className="pm-tags">
                      {p.ports.length > 0
                        ? p.ports.map(port => (
                            <span key={port} className="pm-tag pm-tag-port" onClick={() => copy(String(port))}>{port}</span>
                          ))
                        : <span className="pm-tag pm-tag-none">无端口占用</span>}
                    </div>
                  </div>
                  {p.path ? (
                    <button
                      className="pm-row-lock"
                      title="查看文件占用"
                      aria-label={`查看 ${p.name} 的文件占用`}
                      onClick={() => runWhoLocks(p.path, 'row')}
                    >
                      <FiLock size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="pm-footer">
        <span>{footerCount}</span>
        <span className="pm-footer-right">
          <span className="pm-updated">{lastUpdated || '--:--:--'}</span>
          <span className="pm-progress-tag"><span className="pm-progress-fill" ref={barRef} /></span>
          <button className="pm-refresh" onClick={() => refresh(true)}>
            <FiRefreshCw size={13} />
          </button>
        </span>
      </div>

      {killModal && (
        <div className="pm-modal-overlay" onClick={killing ? undefined : cancelKill}>
          <div className="pm-modal" onClick={e => e.stopPropagation()}>
            <div className="pm-modal-title">确认 Kill 进程</div>
            <div className="pm-modal-content">
              {killing
                ? <>正在 Kill <strong>{killModal.name}</strong> (PID: {killModal.pid})...</>
                : <>确定要 Kill 进程 <strong>{killModal.name}</strong> (PID: {killModal.pid}) 吗？</>
              }
              {killModal.isHolder && (
                <div className="pm-kill-note">
                  <FiAlertTriangle size={14} />
                  <span>
                    该进程正在占用 <strong>{basename(lockPath)}</strong>。Kill 后文件占用会解除，未保存的工作可能丢失。
                  </span>
                </div>
              )}
            </div>
            <div className="pm-modal-actions">
              <button className="pm-modal-btn pm-modal-btn-cancel" onClick={cancelKill} disabled={killing}>取消</button>
              <button className="pm-modal-btn pm-modal-btn-confirm" onClick={executeKill} disabled={killing}>
                {killing ? '正在 Kill...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
