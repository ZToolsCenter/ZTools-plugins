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
type PathKind = 'file' | 'directory' | 'missing' | null
type DirectoryMode = 'handles' | 'files'

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
  const [lockKind, setLockKind] = useState<'file' | 'directory'>('file')
  const [lockMode, setLockMode] = useState<DirectoryMode>('files')
  const [lockAll, setLockAll] = useState(false)
  const [lockAdmin, setLockAdmin] = useState(true)
  const [lockScanned, setLockScanned] = useState(1)
  const [lockTruncated, setLockTruncated] = useState(false)
  const [lockRecurse, setLockRecurse] = useState(false)
  const [holders, setHolders] = useState<FileHolder[]>([])
  const [lockError, setLockError] = useState('')
  const [clearedByKill, setClearedByKill] = useState(false)
  const [pathKind, setPathKind] = useState<PathKind>(null)
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>('handles')
  const [fullScan, setFullScan] = useState(false)
  const [recurse, setRecurse] = useState(false)
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

  // 区分文件与目录；目录默认做句柄检测
  useEffect(() => {
    setRecurse(false)
    setFullScan(false)
    setDirectoryMode('handles')
    const target = normalizePath(keyword)
    if (!isPathLike(target)) {
      setPathKind(null)
      return
    }
    if (!window.services?.pathInfo) {
      setPathKind(null)
      return
    }
    const info = window.services.pathInfo(target)
    setPathKind(info.exists ? (info.isDirectory ? 'directory' : 'file') : 'missing')
  }, [keyword])

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

  const runWhoLocks = useCallback(async (
    path: string,
    source: LockSource,
    options?: { mode?: DirectoryMode; recurse?: boolean; all?: boolean }
  ) => {
    const target = normalizePath(path)
    if (!target) return

    const checkingDirectory = source === 'keyword' && pathKind === 'directory'
    const selectedMode: DirectoryMode = source === 'row'
      ? 'files'
      : checkingDirectory
        ? (options?.mode || directoryMode)
        : 'files'
    const allOption = selectedMode === 'handles' && !!options?.all
    const recurseOption = !!options?.recurse

    lockKeyword.current = normalizePath(keyword)
    const requestId = ++lockRequest.current

    setLockView(true)
    setLockPath(target)
    setLockSource(source)
    setLockKind(checkingDirectory ? 'directory' : 'file')
    setLockMode(selectedMode)
    setLockAll(allOption)
    setLockRecurse(recurseOption)
    setLockScanned(1)
    setLockTruncated(false)
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
      const result = await window.services.whoLocks(target, {
        mode: selectedMode,
        recurse: recurseOption,
        all: allOption
      })
      if (requestId !== lockRequest.current) return
      if (result.success) {
        setHolders(result.holders || [])
        setLockMode(result.mode === 'handles' ? 'handles' : 'files')
        setLockKind(result.kind === 'directory' ? 'directory' : 'file')
        setLockAll(!!result.all)
        setLockAdmin(result.mode === 'handles' ? !!result.admin : true)
        setLockScanned(typeof result.scanned === 'number' ? result.scanned : 1)
        setLockTruncated(!!result.truncated)
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
  }, [keyword, pathKind, directoryMode])

  const backToList = useCallback(() => {
    lockRequest.current++
    setLockView(false)
    setLockStatus('idle')
    setLockKind('file')
    setLockMode('files')
    setLockAll(false)
    setLockAdmin(true)
    setLockScanned(1)
    setLockTruncated(false)
    setLockRecurse(false)
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
    if (lockStatus === 'loading') {
      if (lockMode === 'handles') return '正在检测…'
      return lockKind === 'directory' ? '正在扫描…' : '正在检查…'
    }
    if (lockStatus === 'error') return '检查失败'
    if (holders.length > 0) {
      return lockMode === 'handles' ? `${holders.length} 个句柄持有者` : `${holders.length} 个占用进程`
    }
    if (clearedByKill) {
      if (lockMode === 'handles') return '已结束句柄占用'
      return lockKind === 'directory' ? '已结束占用' : '占用已解除'
    }
    if (lockMode === 'handles') return '未发现句柄'
    if (lockKind === 'directory' && lockScanned === 0) return '目录内无文件'
    return '未发现占用'
  })()

  const renderContext = () => {
    if (!lockView) {
      if (!pathLike) return null
      const target = normalizePath(keyword)
      const isDirectory = pathKind === 'directory'
      const missing = pathKind === 'missing'
      const handlesMode = isDirectory && directoryMode === 'handles'

      return (
        <div className="pm-check-card">
          <span className="pm-lock-mark"><FiLock size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">
              {isDirectory ? '检查目录占用' : missing ? '检查路径' : '检查文件占用'}
            </div>
            <div className="pm-check-path" title={target}>{target}</div>
            {isDirectory && (
              <div className="pm-mode-switch" role="group" aria-label="检测方式">
                <button
                  type="button"
                  className={directoryMode === 'handles' ? 'active' : ''}
                  onClick={() => setDirectoryMode('handles')}
                >
                  目录句柄
                </button>
                <button
                  type="button"
                  className={directoryMode === 'files' ? 'active' : ''}
                  onClick={() => setDirectoryMode('files')}
                >
                  目录内文件
                </button>
              </div>
            )}
            <div className="pm-check-note">
              {missing
                ? '路径不存在或无法访问'
                : isDirectory
                  ? (handlesMode
                      ? '检测目录及子目录的句柄持有者 · 需要管理员权限'
                      : '扫描目录内文件 · 最多 500 个')
                  : 'Restart Manager · 首次约 1–2 秒'}
            </div>
            {handlesMode && (
              <label className="pm-recurse">
                <input
                  type="checkbox"
                  checked={fullScan}
                  onChange={(e) => setFullScan(e.target.checked)}
                />
                全量扫描（较慢）
              </label>
            )}
            {isDirectory && directoryMode === 'files' && (
              <label className="pm-recurse">
                <input
                  type="checkbox"
                  checked={recurse}
                  onChange={(e) => setRecurse(e.target.checked)}
                />
                包含子目录
              </label>
            )}
          </div>
          <button
            className="pm-btn-lock"
            onClick={() => runWhoLocks(target, 'keyword', {
              mode: isDirectory ? directoryMode : 'files',
              recurse,
              all: fullScan
            })}
          >
            {isDirectory ? (handlesMode ? '检测' : '扫描文件') : '检查'}
          </button>
        </div>
      )
    }

    if (lockStatus === 'loading') {
      const isDirectory = lockKind === 'directory'
      const handlesMode = lockMode === 'handles'
      return (
        <div className="pm-check-card loading" aria-busy="true">
          <span className="pm-lock-mark"><FiLock size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">
              {handlesMode
                ? '正在检测目录句柄'
                : isDirectory
                  ? '正在扫描目录内文件'
                  : '正在检查文件占用'} <span className="pm-spinner" />
            </div>
            <div className="pm-check-path" title={lockPath}>{lockPath}</div>
            <div className="pm-check-note">
              {handlesMode
                ? (lockAll ? '全量扫描，可能需要几分钟' : '候选进程扫描 · 包含 Explorer、终端、IDE、同步盘')
                : isDirectory
                  ? '正在收集目录内文件并合并占用结果'
                  : '首次查询需要启动 PowerShell 并编译脚本'}
            </div>
          </div>
          <button className="pm-btn-lock" disabled>{handlesMode ? '检测中…' : isDirectory ? '扫描中…' : '检查中…'}</button>
        </div>
      )
    }

    if (lockStatus === 'error') {
      const isDirectory = lockKind === 'directory'
      const handlesMode = lockMode === 'handles'
      return (
        <div className="pm-check-card error">
          <span className="pm-lock-mark error"><FiAlertTriangle size={16} /></span>
          <div className="pm-check-main">
            <div className="pm-check-title">
              {handlesMode ? '无法检测目录句柄' : `无法检查这个${isDirectory ? '目录' : '文件'}`}
            </div>
            <div className="pm-check-path" title={lockError}>{lockError}</div>
            <div className="pm-check-note">
              {handlesMode
                ? '完整检测需要管理员权限，或路径不可访问。'
                : '如果路径位于受保护目录，尝试以管理员身份运行 ZTools。'}
            </div>
          </div>
          <div className="pm-check-actions">
            <button className="pm-btn-ghost" onClick={backToList}>返回</button>
            <button
              className="pm-btn-lock"
              onClick={() => runWhoLocks(lockPath, lockSource, {
                mode: lockMode,
                recurse: lockRecurse,
                all: lockAll
              })}
            >
              重试
            </button>
          </div>
        </div>
      )
    }

    const count = holders.length
    const cleared = count === 0 && clearedByKill
    const isDirectory = lockKind === 'directory'
    const handlesMode = lockMode === 'handles'
    const title = handlesMode
      ? (count > 0
          ? `${count} 个进程持有目录句柄`
          : cleared ? '已结束目录句柄占用' : '未发现目录句柄持有者')
      : (count > 0
          ? (isDirectory ? `${count} 个进程正在占用目录内文件` : `${count} 个进程正在占用`)
          : cleared
            ? (isDirectory ? '已结束目录内占用' : '占用已解除')
            : (isDirectory ? '未发现目录内文件被占用' : '未发现占用'))

    return (
      <div className="pm-lock-summary">
        <span className={`pm-lock-mark${cleared ? ' success' : ''}`}>
          {cleared ? <FiUnlock size={16} /> : <FiLock size={16} />}
        </span>
        <div className="pm-check-main">
          <div className="pm-check-title">{title}</div>
          <div className="pm-check-path" title={lockPath}>{lockPath}</div>
          {handlesMode ? (
            <div className="pm-check-note">
              {lockAll ? '全量扫描' : '候选进程扫描'}
              {lockAdmin ? '' : ' · 非管理员，结果可能不完整'}
            </div>
          ) : isDirectory ? (
            <div className="pm-check-note">
              已扫描 {lockScanned} 个文件
              {lockRecurse ? '（含子目录）' : ''}
              {lockTruncated ? ' · 已达 500 个上限' : ''}
            </div>
          ) : null}
        </div>
        <button className="pm-btn-ghost" onClick={backToList}>返回进程列表</button>
      </div>
    )
  }

  const renderLockBody = () => {
    if (lockStatus === 'loading') {
      const isDirectory = lockKind === 'directory'
      const handlesMode = lockMode === 'handles'
      return (
        <div className="pm-state">
          <span className="pm-state-icon"><FiLock size={20} /></span>
          <div className="pm-state-title">
            {handlesMode
              ? '正在检测目录句柄…'
              : isDirectory
                ? '正在扫描目录内文件…'
                : '正在检查文件占用…'}
          </div>
          <div className="pm-state-text">
            {handlesMode
              ? (lockAll
                  ? '正在枚举全系统进程句柄，进程较多时可能需要几分钟。'
                  : '正在扫描 Explorer、终端、IDE、同步盘等候选进程的目录句柄。')
              : isDirectory
                ? '正在收集目录内的文件并交给 Restart Manager 查询。首次查询通常需要 1–2 秒，文件较多时会稍慢。'
                : '首次查询会启动 PowerShell 并编译 Restart Manager 脚本，通常需要 1–2 秒。之后的查询会更快。'}
          </div>
        </div>
      )
    }

    if (lockStatus === 'error') {
      const isDirectory = lockKind === 'directory'
      const handlesMode = lockMode === 'handles'
      return (
        <StateBlock
          kind="error"
          icon={<FiAlertTriangle size={20} />}
          title="检查失败"
          text={handlesMode
            ? '句柄枚举没有返回结果。完整检测需要管理员权限；也可以尝试全量扫描。'
            : isDirectory
              ? 'Restart Manager 没有返回结果。可以重试，或检查目录是否可访问。'
              : 'Restart Manager 没有返回结果。可以重试，或检查文件是否位于受保护目录。'}
          actions={(
            <>
              <button
                className="pm-btn-lock"
                onClick={() => runWhoLocks(lockPath, lockSource, {
                  mode: lockMode,
                  recurse: lockRecurse,
                  all: lockAll
                })}
              >
                重试
              </button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
          )}
        />
      )
    }

    if (holderViews.length > 0) {
      if (lockMode === 'handles') {
        return (
          <>
            <div className="pm-lock-hint">
              这些进程持有目录或子目录的句柄，不是目录内文件被占用。Explorer、终端和同步盘通常属于这种情况。
            </div>
            {holderViews.map(({ holder, process: proc }) => {
              const name = proc ? proc.name : (holder.name || `PID ${holder.pid}`)
              const handlePath = holder.handlePath || proc?.path || ''
              const pathCount = holder.handlePaths?.length || 1

              return (
                <div
                  className="pm-item pm-item-held"
                  key={holder.pid}
                  onContextMenu={(e) => handleContextMenu(e, holder.pid, name, true)}
                >
                  <div className="pm-item-top">
                    <div className="pm-item-info">
                      <div className="pm-item-row1">
                        <span className="pm-tag pm-tag-name" title={proc?.path} onClick={() => copy(name)}>{name}</span>
                        <span className="pm-tag pm-tag-pid" onClick={() => copy(String(holder.pid))}>{holder.pid}</span>
                        <span className="pm-tag pm-tag-handle">目录句柄</span>
                        {handlePath ? (
                          <span className="pm-path" onClick={() => copy(handlePath)} title={handlePath}>{handlePath}</span>
                        ) : null}
                      </div>
                      <div className="pm-tags">
                        <span className="pm-friendly">
                          {pathCount > 1 ? `${pathCount} 个句柄路径` : '持有目录/子目录句柄'}
                        </span>
                        {!proc ? <span className="pm-missing">进程信息未在列表中，可能已退出或列表缓存过期</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )
      }

      const isDirectory = lockKind === 'directory'
      return (
        <>
          {isDirectory && (
            <div className="pm-lock-hint">
              结果为占用目录内任意文件的进程合集，不区分具体文件
              {lockTruncated ? '；本次仅扫描前 500 个文件' : ''}。
            </div>
          )}
          {holderViews.map(({ holder, process: proc }) => {
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
          })}
        </>
      )
    }

    const isDirectory = lockKind === 'directory'
    const handlesMode = lockMode === 'handles'

    if (clearedByKill) {
      return (
        <StateBlock
          kind="success"
          icon={<FiCheck size={20} />}
          title={handlesMode ? '已结束目录句柄占用' : isDirectory ? '已结束目录内占用' : '占用已解除'}
          text={handlesMode
            ? '所有检测到的目录句柄持有者已结束。现在可以尝试删除目录。'
            : isDirectory
              ? '所有占用目录内文件的进程已结束。如果目录仍无法删除，可能是文件夹句柄被占用。'
              : '最后一个占用进程已被 Kill。现在可以删除或修改这个文件。'}
          actions={(
            <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
          )}
        />
      )
    }

    if (handlesMode) {
      return (
        <StateBlock
          kind="unlock"
          icon={<FiUnlock size={20} />}
          title="未发现目录句柄持有者"
          text={lockAll
            ? '已完成全量扫描。如果目录仍无法删除，可能是受保护进程或权限不足。'
            : '已扫描候选进程（Explorer、终端、IDE、同步盘等）。可能持有者在候选列表之外；可以尝试全量扫描（较慢）。完整检测需要管理员权限。'}
          actions={lockAll ? (
            <>
              <button
                className="pm-btn-lock"
                onClick={() => runWhoLocks(lockPath, lockSource, { mode: 'handles', all: true })}
              >
                重新检测
              </button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
          ) : (
            <>
              <button
                className="pm-btn-lock"
                onClick={() => runWhoLocks(lockPath, lockSource, { mode: 'handles', all: true })}
              >
                全量扫描
              </button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
          )}
        />
      )
    }

    if (isDirectory && lockScanned === 0) {
      return (
        <StateBlock
          kind="unlock"
          icon={<FiUnlock size={20} />}
          title="目录内没有可扫描的文件"
          text="该目录为空或没有可读取的文件。如果目录本身仍无法删除，可能是文件夹句柄被占用，可以切回“目录句柄”模式检测。"
          actions={(
            <>
              <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource, { mode: 'files', recurse: lockRecurse })}>重新扫描</button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
          )}
        />
      )
    }

    if (isDirectory) {
      return (
        <StateBlock
          kind="unlock"
          icon={<FiUnlock size={20} />}
          title="未发现目录内文件被占用"
          text={`已扫描 ${lockScanned} 个文件。如果目录仍然无法删除，可能是 Explorer、终端或同步盘持有文件夹句柄；可以切回“目录句柄”模式检测。`}
          actions={(
            <>
              <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource, { mode: 'files', recurse: lockRecurse })}>重新扫描</button>
              <button className="pm-btn-lock pm-btn-secondary" onClick={backToList}>返回进程列表</button>
            </>
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
            <button className="pm-btn-lock" onClick={() => runWhoLocks(lockPath, lockSource, { mode: 'files', recurse: lockRecurse })}>重新检查</button>
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
          {lockView
            ? (lockMode === 'handles' ? '右键 Kill 会释放句柄' : '右键 Kill 会解除占用')
            : '右键 Kill · 粘贴路径查占用'}
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
                    <span className="pm-empty-sub">
                      {pathKind === 'directory'
                        ? '可以在上方检测目录句柄，或切换为扫描目录内文件。'
                        : '可以在上方检查是哪个进程占用了该文件。'}
                    </span>
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
                    {lockMode === 'handles'
                      ? <>该进程持有目录或子目录句柄。Kill 后句柄会释放；如果是 Explorer，建议关闭对应文件夹窗口，而不是结束整个 Explorer。</>
                      : lockKind === 'directory'
                        ? <>该进程正在占用目录内的文件。Kill 后相关文件占用会解除，未保存的工作可能丢失。</>
                        : <>该进程正在占用 <strong>{basename(lockPath)}</strong>。Kill 后文件占用会解除，未保存的工作可能丢失。</>}
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
